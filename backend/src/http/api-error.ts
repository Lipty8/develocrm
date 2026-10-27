import type {RsReadinessIssue} from '../shared/rs-readiness.js';

export type PublicApiError = {
  code: string;
  message: string;
  correlationId: string;
  error: string;
  issues?: RsReadinessIssue[];
};

// Only explicitly constructed server validation envelopes may carry these
// fields through the global serializer. JSON/request/diagnostic objects cannot
// opt themselves in by supplying a similarly named property.
const publicValidationIssues = new WeakMap<object, RsReadinessIssue[]>();
export function withPublicValidationIssues(payload: PublicApiError, issues: readonly RsReadinessIssue[]): PublicApiError {
  const safe = issues.slice(0, 100).map(item => ({
    code: /^[a-z][a-z0-9_]{0,63}$/.test(item.code) ? item.code : 'invalid_contract_value',
    field: /^[a-zA-Z0-9_.:-]{1,180}$/.test(item.field) ? item.field : 'contract',
    message: item.message.length <= 500 && !containsTechnicalDetail(item.message)
      ? item.message : 'Zkontrolujte údaj pro připravovanou smlouvu.',
    ...(item.action && /^\/(?:clients|units|projects|contracts)(?:\/|\?)[^\r\n]*$/.test(item.action.href)
      && item.action.label.length <= 100 && !containsTechnicalDetail(item.action.label)
      ? {action: {href: item.action.href, label: item.action.label}} : {}),
  }));
  const result = {...payload, issues: safe};
  publicValidationIssues.set(result, safe);
  return result;
}

const TECHNICAL_PATTERN = /(?:SQLSTATE|syntax error|relation ["']|constraint ["']|duplicate key|violates .* constraint|could not determine data type|parameter \$\d+|SELECT\s|INSERT\s|UPDATE\s|DELETE\s|ECONN|ENOTFOUND|stack|postgres|pg_catalog)/i;

export function mapApiError(input: unknown, statusCode: number, correlationId: string): PublicApiError {
  const source = errorText(input);
  const publicText = messageText(input);
  let code = statusCode >= 500 ? "INTERNAL_ERROR" : statusCode === 401 ? "UNAUTHENTICATED" : statusCode === 403 ? "FORBIDDEN" : statusCode === 404 ? "NOT_FOUND" : statusCode === 409 ? "CONFLICT" : "INVALID_REQUEST";
  let message = statusCode >= 500
    ? "Požadavek se nepodařilo zpracovat. Zkuste to prosím znovu."
    : statusCode === 401
      ? "Přihlášení vypršelo nebo není platné."
      : statusCode === 403
        ? "Nemáte oprávnění provést tuto operaci."
        : statusCode === 404
          ? "Požadovaný záznam nebyl nalezen."
          : statusCode === 409
            ? "Operaci nelze dokončit kvůli aktuálnímu stavu záznamu."
            : "Zkontrolujte zadané údaje.";

  if (!TECHNICAL_PATTERN.test(source) && /[áčďéěíňóřšťúůýž]/i.test(publicText) && publicText.length <= 240) {
    message = publicText;
  }
  const paymentTermsCode=source.match(/\bPAYMENT_TERMS_[A-Z_]+\b/)?.[0];
  const appendixCode=source.match(/\bCONTRACT_APPENDIX_[A-Z_]+\b/)?.[0];
  if (/HOLD_IDEMPOTENCY_(?:CONFLICT|INVALID_KEY)/.test(source)) {
    code = source.includes('HOLD_IDEMPOTENCY_CONFLICT') ? 'HOLD_IDEMPOTENCY_CONFLICT' : 'HOLD_IDEMPOTENCY_INVALID_KEY';
    message = code === 'HOLD_IDEMPOTENCY_CONFLICT'
      ? 'Tento požadavek již byl použit s jinými údaji. Načtěte jednotku znovu a zkontrolujte její aktuální stav.'
      : 'Požadavek není úplný. Otevřete formulář znovu a zkuste to prosím znovu.';
  } else if(appendixCode){
    code=appendixCode;
    const messages:Record<string,string>={
      CONTRACT_APPENDIX_CHANGED:'Příloha byla mezitím změněna. Načtěte aktuální smlouvu a zkontrolujte výběr.',
      CONTRACT_APPENDIX_NEW_VERSION_REQUIRED:'Tato verze již má dokument nebo není aktuální. Pro změnu příloh připravte novou pracovní verzi smlouvy.',
      CONTRACT_APPENDIX_VERSION_IMMUTABLE:'Přílohy této verze již nelze měnit. Připravte novou verzi smlouvy.',
      CONTRACT_APPENDIX_DOCUMENT_NOT_READY:'Vybraný dokument není dostupný jako připravená příloha tohoto projektu.',
      CONTRACT_APPENDIX_DOCUMENT_ALREADY_LINKED:'Tento dokument je již v této verzi smlouvy použit. Zkontrolujte seznam příloh.',
      CONTRACT_APPENDIX_CONTRACT_NOT_EDITABLE:'Ukončenou nebo podepsanou smlouvu nelze touto akcí upravit.',
      CONTRACT_APPENDIX_INVALID_REQUEST:'Vyberte platnou přílohu a její konkrétní verzi.',
      CONTRACT_APPENDIX_GENERATION_STARTED:'Generování této verze již bylo zahájeno. Přílohy nelze měnit; dokončete stejný požadavek nebo připravte novou verzi smlouvy.',
      CONTRACT_APPENDIX_SCHEMA_REQUIRED:'Tato verze šablony nemá úplně určené přílohy. Je potřeba připravit novou zkontrolovanou verzi šablony.',
      CONTRACT_APPENDIX_INCOMPLETE:'Doplňte všechny požadované přílohy smlouvy a jejich konkrétní verze.',
      CONTRACT_APPENDIX_DOCUMENT_IN_USE:'Dokument je součástí připravované nebo podepsané smlouvy. Nelze jej archivovat ani změnit jeho umístění.',
    };
    message=messages[code]??'Přílohu smlouvy nelze změnit. Zkontrolujte aktuální verzi smlouvy.';
  }else if(paymentTermsCode){
    code=paymentTermsCode;
    const messages:Record<string,string>={
      PAYMENT_TERMS_TEMPLATE_CHANGED:'Platební podmínky projektu se změnily. Zavřete formulář a otevřete jej znovu.',
      PAYMENT_TERMS_NOTICE_NOT_AVAILABLE:'U této smlouvy nyní nelze evidovat doručení výzvy. Ověřte stav smlouvy a obchodního případu.',
      PAYMENT_TERMS_AMBIGUOUS_TEMPLATE:'Projekt má více účinných šablon pro stejný typ smlouvy. Nejdříve určete správnou variantu.',
      PAYMENT_TERMS_ALREADY_MATERIALIZED:'Smlouva již má platební předpis. Jeho podmínky nelze touto akcí zpětně změnit.',
      PAYMENT_TERMS_CURRENT_VERSION_REQUIRED:'Smlouva má novější verzi. Načtěte ji a zkuste to znovu.',
      PAYMENT_TERMS_VERSION_IMMUTABLE:'Tato verze již má dokument nebo podpis. Pro změnu připravte novou verzi smlouvy.',
      PAYMENT_TERMS_TEMPLATE_PROFILE_REQUIRED:'Vybraná šablona tento platební plán nepoužívá.',
      PAYMENT_TERMS_PAID_RS_MISMATCH:'Úhrada rezervačního poplatku neodpovídá podmínkám této SBK.',
      PAYMENT_TERMS_SIGNED_RS_REQUIRED:'Pro přípravu plateb SBK je potřeba jednoznačná účinná podepsaná RS.',
      PAYMENT_TERMS_FEE_REQUIRED:'Doplňte platný rezervační poplatek.',
      PAYMENT_TERMS_UNIT_CODE_REQUIRED:'Variabilní symbol musí odpovídat číselnému označení jednotky. Zkontrolujte její označení.',
      PAYMENT_TERMS_DELIVERY_EVIDENCE_REQUIRED:'Vyberte uložený doklad o doručení výzvy patřící k této smlouvě.',
      PAYMENT_TERMS_INVALID_DELIVERY_DATE:'Datum doručení musí být mezi účinným podpisem smlouvy a dneškem.',
      PAYMENT_TERMS_DELIVERY_ALREADY_RECORDED:'Doručení výzvy již bylo zaevidováno s jinými údaji.',
      PAYMENT_TERMS_CONTEXT_CHANGED:'Údaje obchodu se změnily. Před pokračováním ověřte kupujícího a platební podmínky.',
    };
    message=messages[code]??'Platební podmínky této verze smlouvy nejsou úplné nebo konzistentní. Ověřte je před pokračováním.';
  } else if (/CONTRACT_CASE_CLOSED/.test(source)) {
    code = "CONTRACT_CASE_CLOSED";
    message = "Obchod již byl ukončen. Historickou smlouvu nelze posunout ani podepsat.";
  } else if (/SIGNED_CONTRACT_PROTECTS_RESERVATION/.test(source)) {
    code = "SIGNED_CONTRACT_PROTECTS_RESERVATION";
    message = "Jednotku nelze uvolnit, protože má podepsanou smlouvu.";
  } else if (/permission|required|oprávnění/i.test(source)) {
    code = "FORBIDDEN";
    message = "Nemáte oprávnění provést tuto operaci.";
  } else if (/not found|nenalezen/i.test(source)) {
    code = "NOT_FOUND";
    message = "Požadovaný záznam nebyl nalezen.";
  }
  const result = { code, message, error: message, correlationId };
  const issues = input && typeof input === 'object' ? publicValidationIssues.get(input) : undefined;
  return statusCode === 422 && issues ? withPublicValidationIssues(result, issues) : result;
}

export function containsTechnicalDetail(input: unknown): boolean {
  return TECHNICAL_PATTERN.test(errorText(input));
}

function errorText(input: unknown): string {
  if (input instanceof Error) return input.message;
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const value = input as Record<string, unknown>;
    return [value.message, value.error, value.detail, value.code].filter(item => typeof item === "string").join(" ");
  }
  return "";
}

// Diagnostic fields are useful for classification, never for user-facing text.
// A mapped payload may pass through preSerialization a second time; choosing
// exactly one message also prevents duplicate messages on that path.
function messageText(input:unknown):string{
  if(input instanceof Error)return input.message;
  if(typeof input==='string')return input;
  if(input&&typeof input==='object'){
    const value=input as Record<string,unknown>;
    for(const item of [value.message,value.error])if(typeof item==='string'&&item.trim())return item;
  }
  return '';
}
