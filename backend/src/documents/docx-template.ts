import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type DocxTemplateValue = string | number | boolean | null | undefined;

export type DocxTemplateInspection = {
  tokens: string[];
  legacyMarkers: string[];
  xmlParts: string[];
};

export type RenderDocxTemplateOptions = {
  /** Every required token must exist in the template and receive a non-empty value. */
  requiredTokens?: readonly string[];
  /** Reject template tokens outside the approved field catalogue. */
  allowedTokens?: readonly string[];
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
  | "template_value_missing"
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
  for (const name of xmlParts) {
    const xml = strFromU8(archive[name]);
    const visibleText = extractVisibleText(xml);
    for (const match of visibleText.matchAll(TOKEN_PATTERN)) tokens.add(match[1]);
    for (const pattern of LEGACY_MARKER_PATTERNS) {
      for (const match of visibleText.matchAll(pattern)) legacyMarkers.add(match[0]);
    }
  }
  return { tokens: [...tokens].sort(), legacyMarkers: [...legacyMarkers].sort(), xmlParts };
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
    archive[name] = strToU8(replaceTokensInXml(xml, values));
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

function openDocx(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
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
