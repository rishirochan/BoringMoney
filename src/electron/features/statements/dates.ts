export type DateOrder = "MDY" | "DMY" | "YMD";

export interface ParsedDate {
  iso: string;
  hadYear: boolean;
}

const MONTH_TOKEN =
  "(?:[Jj][Aa][Nn](?:[Uu][Aa][Rr][Yy])?|[Ff][Ee][Bb](?:[Rr][Uu][Aa][Rr][Yy])?|[Mm][Aa][Rr](?:[Cc][Hh])?|[Aa][Pp][Rr](?:[Ii][Ll])?|[Mm][Aa][Yy]|[Jj][Uu][Nn](?:[Ee])?|[Jj][Uu][Ll](?:[Yy])?|[Aa][Uu][Gg](?:[Uu][Ss][Tt])?|[Ss][Ee][Pp](?:[Tt](?:[Ee][Mm][Bb][Ee][Rr])?)?|[Oo][Cc][Tt](?:[Oo][Bb][Ee][Rr])?|[Nn][Oo][Vv](?:[Ee][Mm][Bb][Ee][Rr])?|[Dd][Ee][Cc](?:[Ee][Mm][Bb][Ee][Rr])?)";

// Longest alternatives first so `01/15/2026` wins over `01/15`.
export const DATE_TOKEN = [
  `${MONTH_TOKEN}\\s+\\d{1,2},?\\s+\\d{2,4}`,
  `\\d{1,2}[\\-\\s]${MONTH_TOKEN}[\\-\\s]\\d{2,4}`,
  `${MONTH_TOKEN}\\s+\\d{1,2}`,
  `\\d{4}[\\/\\-]\\d{1,2}[\\/\\-]\\d{1,2}`,
  `\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4}`,
  `\\d{1,2}[\\/\\-]\\d{1,2}`,
].join("|");

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const RANGE_SEP = String.raw`\s*(?:-|–|—|to|through|thru)\s*`;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function expandYear(raw: string): number | null {
  if (!/^\d{2}$|^\d{4}$/.test(raw)) return null;
  const n = Number(raw);
  if (raw.length === 4) return n;
  return n <= 69 ? 2000 + n : 1900 + n;
}

function finish(year: number, month: number, day: number, hadYear: boolean): ParsedDate | null {
  if (!isValidYmd(year, month, day)) return null;
  return { iso: toIso(year, month, day), hadYear };
}

function yearOrNull(hadYear: boolean, rawYear: string | undefined, fallback: number | undefined): number | null {
  if (hadYear && rawYear !== undefined) return expandYear(rawYear);
  return fallback ?? null;
}

function parseNumericDate(text: string, order: DateOrder, fallbackYear: number | undefined): ParsedDate | null {
  const ymd = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (ymd) {
    return finish(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), true);
  }

  const full = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (full) {
    const year = expandYear(full[3]);
    if (year === null) return null;
    const a = Number(full[1]);
    const b = Number(full[2]);
    return order === "DMY" ? finish(year, b, a, true) : finish(year, a, b, true);
  }

  const short = text.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (short) {
    if (fallbackYear === undefined) return null;
    const a = Number(short[1]);
    const b = Number(short[2]);
    return order === "DMY" ? finish(fallbackYear, b, a, false) : finish(fallbackYear, a, b, false);
  }

  return null;
}

function parseNamedDate(text: string, fallbackYear: number | undefined): ParsedDate | null {
  const monthFirst = text.match(
    new RegExp(`^(${MONTH_TOKEN})\\s+(\\d{1,2})(?:(?:,\\s*|\\s+)(\\d{2,4}))?$`, "i")
  );
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    if (!month) return null;
    const day = Number(monthFirst[2]);
    const hadYear = monthFirst[3] !== undefined;
    const year = yearOrNull(hadYear, monthFirst[3], fallbackYear);
    if (year === null) return null;
    return finish(year, month, day, hadYear);
  }

  const dayFirst = text.match(new RegExp(`^(\\d{1,2})[\\-\\s](${MONTH_TOKEN})(?:[\\-\\s](\\d{2,4}))?$`, "i"));
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    if (!month) return null;
    const day = Number(dayFirst[1]);
    const hadYear = dayFirst[3] !== undefined;
    const year = yearOrNull(hadYear, dayFirst[3], fallbackYear);
    if (year === null) return null;
    return finish(year, month, day, hadYear);
  }

  return null;
}

export function parseDate(text: string, opts?: { order?: DateOrder; year?: number }): ParsedDate | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const order = opts?.order ?? "MDY";
  return parseNumericDate(trimmed, order, opts?.year) ?? parseNamedDate(trimmed, opts?.year);
}

function numericDateFields(sample: string): number[] | null {
  const s = sample.trim();
  if (!/^\d{1,4}[/-]\d{1,2}(?:[/-]\d{2,4})?$/.test(s)) return null;
  return s.split(/[/-]/).map((part) => Number(part));
}

export function inferDateOrder(samples: string[]): DateOrder {
  let sawDmy = false;
  let sawMdy = false;
  let sawYmd = false;
  for (const sample of samples) {
    const fields = numericDateFields(sample);
    if (!fields) continue;
    const first = fields[0];
    const second = fields[1];
    // 4-digit lead is a year, not a day-of-month > 12.
    if (first >= 1000 && first <= 9999) {
      sawYmd = true;
      continue;
    }
    if (first > 12) sawDmy = true;
    if (second > 12) sawMdy = true;
  }
  if (sawDmy) return "DMY";
  if (sawMdy) return "MDY";
  if (sawYmd) return "YMD";
  return "MDY";
}

export function resolveYear(month: number, day: number, period: { from: string; to: string }): string {
  const fromYear = Number(period.from.slice(0, 4));
  const toYear = Number(period.to.slice(0, 4));
  const start = Math.min(fromYear, toYear) - 1;
  const end = Math.max(fromYear, toYear) + 1;
  for (let year = start; year <= end; year++) {
    if (!isValidYmd(year, month, day)) continue;
    const iso = toIso(year, month, day);
    if (iso >= period.from && iso <= period.to) return iso;
  }
  return toIso(toYear, month, day);
}

export function findDateRange(text: string, order?: DateOrder): { from: string; to: string } | null {
  const pair = new RegExp(`(${DATE_TOKEN})${RANGE_SEP}(${DATE_TOKEN})`, "g");
  const opts = order ? { order } : undefined;
  let match: RegExpExecArray | null;
  while ((match = pair.exec(text)) !== null) {
    const from = parseDate(match[1], opts);
    const to = parseDate(match[2], opts);
    if (from && to) return { from: from.iso, to: to.iso };
  }
  return null;
}

export function compareIso(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
