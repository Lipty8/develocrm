export type PublicApiError = {
  code: string;
  message: string;
  correlationId: string;
  error: string;
};

const TECHNICAL_PATTERN = /(?:SQLSTATE|syntax error|relation ["']|constraint ["']|duplicate key|violates .* constraint|could not determine data type|parameter \$\d+|SELECT\s|INSERT\s|UPDATE\s|DELETE\s|ECONN|ENOTFOUND|stack|postgres|pg_catalog)/i;

export function mapApiError(input: unknown, statusCode: number, correlationId: string): PublicApiError {
  const source = errorText(input);
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

  if (!TECHNICAL_PATTERN.test(source) && /[áčďéěíňóřšťúůýž]/i.test(source) && source.length <= 240) {
    message = source;
  }
  if (/permission|required|oprávnění/i.test(source)) {
    code = "FORBIDDEN";
    message = "Nemáte oprávnění provést tuto operaci.";
  } else if (/not found|nenalezen/i.test(source)) {
    code = "NOT_FOUND";
    message = "Požadovaný záznam nebyl nalezen.";
  }
  return { code, message, error: message, correlationId };
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
