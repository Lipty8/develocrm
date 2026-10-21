import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { isDocumentMailbox } from "../shared/document-mailbox.js";

export type DocxTemplateValue = string | number | boolean | null | undefined;

export type DocxTemplateInspection = {
  tokens: string[];
  legacyMarkers: string[];
  malformedTokens: string[];
  xmlParts: string[];
};

export type RenderDocxTemplateOptions = {
  /** Every required token must exist in the template and receive a non-empty value. */
  requiredTokens?: readonly string[];
  /** Reject template tokens outside the approved field catalogue. */
  allowedTokens?: readonly string[];
  /** Server-owned allowlist. Only a complete e-mail token may update a mailto link. */
  mailToTokens?: readonly string[];
};

export type RenderedDocxTemplate = {
  bytes: Uint8Array;
  usedTokens: string[];
};

export type DocxTemplateErrorCode =
  | "invalid_docx"
  | "template_not_parameterized"
  | "legacy_placeholders_present"
  | "required_token_missing_from_template"
  | "unknown_template_token"
  | "malformed_template_token"
  | "unsafe_docx_archive"
  | "template_too_large"
  | "template_value_missing"
  | "unsafe_template_link"
  | "unresolved_template_token";

export class DocxTemplateError extends Error {
  constructor(
    readonly code: DocxTemplateErrorCode,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "DocxTemplateError";
  }
}

const TOKEN_PATTERN = /{{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*}}/g;
const XML_PART_PATTERN = /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const LEGACY_MARKER_PATTERNS = [/\[\s*[•●]\s*]/g, /\[\s*(?:doplnit|vyplnit)\s*]/gi];
const MAX_COMPRESSED_BYTES=4*1024*1024;
const MAX_UNCOMPRESSED_BYTES=32*1024*1024;
const MAX_ARCHIVE_PARTS=2048;

/**
 * Reads only user-visible Word XML parts. It never treats arbitrary ZIP content
 * as a template and therefore cannot accidentally replace relationships or IDs.
 */
export function inspectDocxTemplate(bytes: Uint8Array): DocxTemplateInspection {
  const archive = openDocx(bytes);
  const xmlParts = Object.keys(archive).filter((name) => XML_PART_PATTERN.test(name)).sort();
  if (!xmlParts.includes("word/document.xml")) {
    throw new DocxTemplateError("invalid_docx", "Soubor neobsahuje hlavní část dokumentu Word.");
  }

  const tokens = new Set<string>();
  const legacyMarkers = new Set<string>();
  const malformedTokens = new Set<string>();
  for (const name of xmlParts) {
    const xml = strFromU8(archive[name]);
    const visibleText = extractVisibleText(xml);
    for (const match of visibleText.matchAll(TOKEN_PATTERN)) tokens.add(match[1]);
    for (const pattern of LEGACY_MARKER_PATTERNS) {
      for (const match of visibleText.matchAll(pattern)) legacyMarkers.add(match[0]);
    }
    const textWithoutValidTokens = visibleText.replace(TOKEN_PATTERN, "");
    for (const marker of textWithoutValidTokens.match(/\{\{[^{}\r\n]*|\}\}/g) ?? []) {
      malformedTokens.add(marker.trim());
    }
  }
  return { tokens: [...tokens].sort(), legacyMarkers: [...legacyMarkers].sort(), malformedTokens:[...malformedTokens].sort(), xmlParts };
}

/**
 * Strict renderer for approved explicit tokens. It deliberately fails closed:
 * old [•] placeholders, unknown fields, missing values, and unresolved tokens
 * prevent a DOCX from being produced.
 */
export function renderDocxTemplate(
  bytes: Uint8Array,
  values: Readonly<Record<string, DocxTemplateValue>>,
  options: RenderDocxTemplateOptions = {},
): RenderedDocxTemplate {
  const archive = openDocx(bytes);
  const inspection = inspectDocxTemplate(bytes);
  if (inspection.legacyMarkers.length > 0) {
    throw new DocxTemplateError(
      "legacy_placeholders_present",
      "Šablona stále obsahuje ruční zástupné značky.",
      inspection.legacyMarkers,
    );
  }
  if(inspection.malformedTokens.length>0)throw new DocxTemplateError("malformed_template_token","Šablona obsahuje neplatně zapsaná pole.",inspection.malformedTokens);
  if (inspection.tokens.length === 0) {
    throw new DocxTemplateError(
      "template_not_parameterized",
      "Šablona neobsahuje žádná schválená pole pro automatické doplnění.",
    );
  }

  const templateTokens = new Set(inspection.tokens);
  const missingRequired = (options.requiredTokens ?? []).filter((token) => !templateTokens.has(token));
  if (missingRequired.length > 0) {
    throw new DocxTemplateError(
      "required_token_missing_from_template",
      "Šablona neobsahuje všechna povinná pole.",
      missingRequired,
    );
  }

  if (options.allowedTokens) {
    const allowed = new Set(options.allowedTokens);
    const unknown = inspection.tokens.filter((token) => !allowed.has(token));
    if (unknown.length > 0) {
      throw new DocxTemplateError(
        "unknown_template_token",
        "Šablona obsahuje neschválená pole.",
        unknown,
      );
    }
  }

  const missingValues = inspection.tokens.filter((token) => !hasTemplateValue(values[token]));
  if (missingValues.length > 0) {
    throw new DocxTemplateError(
      "template_value_missing",
      "Pro vytvoření dokumentu chybí povinné údaje.",
      missingValues,
    );
  }

  for (const name of inspection.xmlParts) {
    const xml = strFromU8(archive[name]);
    const linked = options.mailToTokens?.length
      ? synchronizeMailToLinks(xml, name, archive, values, options.mailToTokens)
      : xml;
    archive[name] = strToU8(replaceTokensInXml(linked, values));
  }

  const rendered = zipSync(archive, { level: 6 });
  const unresolved = inspectDocxTemplate(rendered).tokens;
  if (unresolved.length > 0) {
    throw new DocxTemplateError(
      "unresolved_template_token",
      "Dokument po vytvoření stále obsahuje nevyplněná pole.",
      unresolved,
    );
  }
  return { bytes: rendered, usedTokens: inspection.tokens };
}

/** Do not template arbitrary URLs, relationship IDs, or executable Word fields. */
function synchronizeMailToLinks(
  xml: string, part: string, archive: Record<string, Uint8Array>,
  values: Readonly<Record<string, DocxTemplateValue>>, allowed: readonly string[],
): string {
  const fail = (token: string): never => {
    // Details contain only a catalogue key, never the address or field instruction.
    throw new DocxTemplateError("unsafe_template_link", "E-mailový odkaz v šabloně nelze bezpečně doplnit.", [token]);
  };
  const binding = (block: string): { token: string; target: string } | null => {
    const visible = extractVisibleText(`<w:p>${block}</w:p>`).trim();
    const tokens = [...visible.matchAll(TOKEN_PATTERN)].map(match => match[1]).filter(token => allowed.includes(token));
    if (!tokens.length) return null;
    const token = tokens[0];
    if (tokens.length !== 1 || visible.replace(TOKEN_PATTERN, "").trim()) fail(token);
    const value = values[token];
    // A single mailbox only: no URI scheme, headers, CRLF, quotes or field switches.
    if (!isDocumentMailbox(value)) fail(token);
    return { token, target: `mailto:${value}` };
  };
  const attribute = (tag: string, key: string): string | undefined => {
    const matches = [...tag.matchAll(new RegExp(`\\s${key}=("[^"]*"|'[^']*')`, "g"))];
    return matches.length === 1 ? decodeXml(matches[0][1].slice(1, -1)) : undefined;
  };
  const withAttribute = (tag: string, key: string, value: string): string =>
    tag.replace(new RegExp(`(\\s${key}=)("[^"]*"|'[^']*')`), (_match, prefix: string) => `${prefix}"${escapeXml(value)}"`);
  const links = new Map<string, { token: string; target: string; uses: number }>();
  let result = xml.replace(/<w:hyperlink\b[^>]*>[\s\S]*?<\/w:hyperlink>/g, block => {
    const bound = binding(block); if (!bound) return block;
    const id = attribute(block.slice(0, block.indexOf(">") + 1), "r:id");
    if (!id) return fail(bound.token);
    const prior = links.get(id);
    if (prior && prior.target !== bound.target) return fail(bound.token);
    links.set(id, { ...bound, uses: (prior?.uses ?? 0) + 1 });
    return block;
  });
  if (links.size) {
    const file = part.slice(part.lastIndexOf("/") + 1);
    const relsPath = `${part.slice(0, part.lastIndexOf("/"))}/_rels/${file}.rels`;
    const rels = archive[relsPath];
    for (const [id, bound] of links) {
      const allUses = [...xml.matchAll(/\sr:id=("[^"]*"|'[^']*')/g)]
        .filter(match => decodeXml(match[1].slice(1, -1)) === id).length;
      if (!rels || allUses !== bound.uses) fail(bound.token);
    }
    let relationshipXml = strFromU8(rels);
    for (const [id, bound] of links) {
      let found = 0;
      relationshipXml = relationshipXml.replace(/<Relationship\b[^>]*\/>/g, tag => {
        if (attribute(tag, "Id") !== id) return tag;
        found++;
        if (attribute(tag, "Type") !== "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
          || attribute(tag, "TargetMode") !== "External"
          || !/^mailto:[^\s?"<>]+@[^\s?"<>]+$/i.test(attribute(tag, "Target") ?? "")) fail(bound.token);
        return withAttribute(tag, "Target", bound.target);
      });
      if (found !== 1) fail(bound.token);
    }
    archive[relsPath] = strToU8(relationshipXml);
  }
  const instruction = (old: string, target: string, token: string): string => {
    // Only an existing plain mailto field. Never accept arbitrary HYPERLINK/INCLUDETEXT/DDE.
    if (!/^\s*HYPERLINK\s+"mailto:[^\s?"<>]+@[^\s?"<>]+"\s*$/i.test(decodeXml(old))) fail(token);
    return escapeXml(`HYPERLINK "${target}"`);
  };
  result = result.replace(/<w:fldSimple\b[^>]*>[\s\S]*?<\/w:fldSimple>/g, block => {
    const bound = binding(block); if (!bound) return block;
    const start = block.slice(0, block.indexOf(">") + 1);
    const old = attribute(start, "w:instr");
    if (!old) return fail(bound.token);
    return withAttribute(start, "w:instr", decodeXml(instruction(escapeXml(old), bound.target, bound.token))) + block.slice(start.length);
  });
  // Locate complete fields, including nested fields, before deciding whether the
  // supported single-mailbox shape is safe. PAGE/NUMPAGES and other fields stay intact.
  const stack: number[] = [];
  const ranges: Array<[number, number]> = [];
  for (const match of result.matchAll(/<w:fldChar\b[^>]*>/g)) {
    const type = attribute(match[0], "w:fldCharType");
    if (type === "begin") stack.push(match.index);
    if (type === "end" && stack.length) {
      const start = stack.pop()!;
      if (!stack.length) ranges.push([start, match.index + match[0].length]);
    }
  }
  if (stack.length && binding(result.slice(stack[0]))) fail(allowed[0]);
  for (const [start, end] of ranges.reverse()) {
    const block = result.slice(start, end);
    const bound = binding(block); if (!bound) continue;
    const chars = [...block.matchAll(/<w:fldChar\b[^>]*>/g)].map(match => attribute(match[0], "w:fldCharType"));
    if (chars.join(",") !== "begin,separate,end") fail(bound.token);
    const parts = [...block.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)];
    if (!parts.length) fail(bound.token);
    const updated = instruction(parts.map(match => match[1]).join(""), bound.target, bound.token);
    let first = true;
    const replacement = block.replace(/(<w:instrText\b[^>]*>)[\s\S]*?(<\/w:instrText>)/g, (_match, open: string, close: string) => {
      const value = first ? updated : ""; first = false; return open + value + close;
    });
    result = result.slice(0, start) + replacement + result.slice(end);
  }
  return result;
}

function openDocx(bytes: Uint8Array): Record<string, Uint8Array> {
  if(bytes.byteLength<1||bytes.byteLength>MAX_COMPRESSED_BYTES)throw new DocxTemplateError("template_too_large","Soubor šablony překračuje povolenou velikost.");
  try {
    let partCount=0,totalSize=0;
    const archive=unzipSync(bytes,{filter:file=>{
      partCount+=1;totalSize+=file.originalSize;
      if(partCount>MAX_ARCHIVE_PARTS||totalSize>MAX_UNCOMPRESSED_BYTES)throw new DocxTemplateError("template_too_large","Rozbalený obsah šablony překračuje bezpečný limit.");
      if(file.name.startsWith("/")||file.name.includes("\\")||file.name.split("/").includes(".."))throw new DocxTemplateError("unsafe_docx_archive","Šablona obsahuje nebezpečnou cestu souboru.");
      return true;
    }});
    if(!archive["[Content_Types].xml"]||!archive["word/document.xml"])throw new DocxTemplateError("invalid_docx","Soubor nemá úplnou strukturu dokumentu Word.");
    return archive;
  } catch(error) {
    if(error instanceof DocxTemplateError)throw error;
    throw new DocxTemplateError("invalid_docx", "Soubor není platný dokument DOCX.");
  }
}

function hasTemplateValue(value: DocxTemplateValue): boolean {
  return value !== null && value !== undefined && (typeof value !== "string" || value.trim().length > 0);
}

function replaceTokensInXml(xml: string, values: Readonly<Record<string, DocxTemplateValue>>): string {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => replaceTokensInParagraph(paragraph, values));
}

type TextNode = { start: number; end: number; originalLength: number; text: string };

function replaceTokensInParagraph(paragraph: string, values: Readonly<Record<string, DocxTemplateValue>>): string {
  const nodes: TextNode[] = [];
  const textPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  for (const match of paragraph.matchAll(textPattern)) {
    const full = match[0];
    const inner = match[1];
    const fullStart = match.index;
    const innerStart = fullStart + full.indexOf(inner);
    const text = decodeXml(inner);
    nodes.push({ start: innerStart, end: innerStart + inner.length, originalLength: text.length, text });
  }
  if (nodes.length === 0) return paragraph;

  const combined = nodes.map((node) => node.text).join("");
  const offsets: number[] = [];
  let offset = 0;
  for (const node of nodes) {
    offsets.push(offset);
    offset += node.text.length;
  }

  const matches = [...combined.matchAll(TOKEN_PATTERN)].reverse();
  for (const match of matches) {
    const token = match[1];
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const first = nodeIndexAt(offsets, nodes, start);
    const last = nodeIndexAt(offsets, nodes, end - 1);
    if (first < 0 || last < 0) continue;
    const replacement = String(values[token] ?? "");
    const startInFirst = start - offsets[first];
    const endInLast = end - offsets[last];
    if (first === last) {
      nodes[first].text = nodes[first].text.slice(0, startInFirst) + replacement + nodes[first].text.slice(endInLast);
    } else {
      nodes[first].text = nodes[first].text.slice(0, startInFirst) + replacement;
      for (let index = first + 1; index < last; index += 1) nodes[index].text = "";
      nodes[last].text = nodes[last].text.slice(endInLast);
    }
  }

  let result = paragraph;
  for (const node of [...nodes].reverse()) {
    result = result.slice(0, node.start) + escapeXml(node.text) + result.slice(node.end);
  }
  return result;
}

function nodeIndexAt(offsets: number[], nodes: TextNode[], position: number): number {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (position >= offsets[index] && position < offsets[index] + nodes[index].originalLength) return index;
  }
  return -1;
}

function extractVisibleText(xml: string): string {
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)];
  return paragraphs.map((paragraph) =>
    [...paragraph[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((match) => decodeXml(match[1]))
      .join(""),
  ).join("\n");
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
