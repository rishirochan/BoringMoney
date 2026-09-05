export interface ParsedAmount {
  value: number;
  creditMarker: boolean;
  raw: string;
}

const NUM = "(?:\\d{1,3}(?:[,.]\\d{3})+(?:[,.]\\d+)?|\\d+(?:[,.]\\d+)?|[,.]\\d+)";

// Anchor-free so line parsers can scan; covers the shapes parseAmount accepts.
export const AMOUNT_TOKEN = `(?:\\(\\s*)?(?:USD\\s+)?(?:\\$\\s*)?-?(?:\\$\\s*)?${NUM}-?(?:\\s*\\))?(?:\\s*CR)?`;

function stripCurrency(text: string): string {
  return text.replace(/^(?:USD|\$)\s*/i, "");
}

function parseSignedNumber(text: string, decimal: "." | ","): number | null {
  const thousands = decimal === "." ? "," : ".";
  const escapedThousands = thousands === "." ? "\\." : ",";
  const escapedDecimal = decimal === "." ? "\\." : ",";
  const grouped = new RegExp(
    `^(?:\\d{1,3}(?:${escapedThousands}\\d{3})+|\\d+)?(?:${escapedDecimal}\\d+)?$`
  );
  const leadingDecimal = new RegExp(`^${escapedDecimal}\\d+$`);
  if (text === "" || text === decimal || text === thousands) return null;
  if (!grouped.test(text) && !leadingDecimal.test(text)) return null;

  const digits = text.split(thousands).join("").split(decimal).join("");
  if (!/^\d+$/.test(digits)) return null;
  if (!text.includes(decimal) && digits.length > 12) return null;

  const normalized = text.split(thousands).join("").replace(decimal, ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function parseAmount(text: string, opts?: { decimal?: "." | "," }): ParsedAmount | null {
  const trimmed = text.trim();
  if (!trimmed || /\d+[/-]\d+/.test(trimmed)) return null;

  let body = trimmed;
  let creditMarker = false;
  const cr = body.match(/^(.*\d)\s*CR$/i);
  if (cr) {
    creditMarker = true;
    body = cr[1].trim();
  }

  let negative = false;
  if (body.startsWith("(") && body.endsWith(")")) {
    negative = true;
    body = body.slice(1, -1).trim();
  }
  if (body.endsWith("-")) {
    negative = true;
    body = body.slice(0, -1).trim();
  }

  body = stripCurrency(body);
  if (body.startsWith("-")) {
    negative = true;
    body = stripCurrency(body.slice(1).trim());
  }

  if (/[a-z]/i.test(body)) return null;

  const magnitude = parseSignedNumber(body, opts?.decimal ?? ".");
  if (magnitude === null) return null;

  const signed = negative ? -magnitude : magnitude;
  return { value: signed === 0 ? 0 : signed, creditMarker, raw: text };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sum(values: number[]): number {
  let total = 0;
  for (const value of values) total = round2(total + value);
  return total;
}
