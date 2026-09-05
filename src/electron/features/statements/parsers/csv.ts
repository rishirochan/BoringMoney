import { classifyTransaction, cleanDescription } from "../classify.js";
import { compareIso, findDateRange, inferDateOrder, parseDate, type DateOrder } from "../dates.js";
import { parseAmount, round2, sum } from "../money.js";
import type {
  AccountKind,
  ExtractedCsv,
  ParsedStatement,
  StatementSummary,
  Transaction,
  TransactionType,
  ValidationIssue,
} from "../types.js";
import { validateStatement } from "../validate.js";

type ColumnRole =
  | "date"
  | "postedDate"
  | "description"
  | "memo"
  | "amount"
  | "debit"
  | "credit"
  | "balance"
  | "reference"
  | "typeHint"
  | "status";

type ColumnMap = Partial<Record<ColumnRole, number>>;
type Decimal = "." | ",";

type InstitutionHit = {
  name: string;
  kind: AccountKind;
};

type DraftRow = {
  date: string;
  postedDate?: string;
  description: string;
  amount: number;
  typeHint?: string;
  referenceNumber?: string;
  balance?: number;
  rawLine: string;
  sourceIndex: number;
};

type HeaderMatch = {
  index: number;
  label: string;
};

const HEADER_SCAN_LIMIT = 30;
const INFER_FRACTION = 0.8;
// Leading \b does not fire before '*' / 'x' masks, so keep those alternatives unanchored.
// The trailing class is greedy so a fully printed number yields its last group, not its first.
const LAST4 = /(?:\*{2,}|x{2,}|ending in\s*|account (?:number|#)?[:\s]*[\d*x -]*)(\d{4})\b/i;
const EUROPEAN_GROUPED = /\d\.\d{3},\d{2}/;
const PAYMENT_LIKE = /payment|autopay|thank you/i;
const CARD_KIND_CUES = [
  "card member",
  "card no",
  "credit card",
  "amex",
  "discover",
  "visa",
  "mastercard",
];
const CARD_SIGN_CUES = [
  "card",
  "credit card",
  "amex",
  "american express",
  "discover",
  "card member",
];
const FLIP_INSTITUTIONS = new Set(["American Express", "Discover", "Apple Card"]);
const BANK_HEADER_CUES = ["check number", "check", "deposit", "deposits", "withdrawal", "withdrawals"];

const DATE_ALIASES = [
  "date",
  "transaction date",
  "trans date",
  "posting date",
  "post date",
  "posted date",
  "booking date",
  "value date",
  "clearing date",
];
const DESCRIPTION_ALIASES = [
  "description",
  "transaction description",
  "original description",
  "narrative",
  "merchant",
  "payee",
  "name",
  "details",
  "memo",
  "transaction",
];
const AMOUNT_ALIASES = ["amount", "transaction amount", "amt"];
const DEBIT_ALIASES = [
  "debit",
  "debits",
  "withdrawal",
  "withdrawals",
  "money out",
  "paid out",
  "charge",
  "outflow",
  "debit amount",
];
const CREDIT_ALIASES = [
  "credit",
  "credits",
  "deposit",
  "deposits",
  "money in",
  "paid in",
  "inflow",
  "credit amount",
];
const BALANCE_ALIASES = [
  "balance",
  "running balance",
  "running bal",
  "ending balance",
  "available balance",
];
const REFERENCE_ALIASES = [
  "reference",
  "reference number",
  "ref",
  "check number",
  "check",
  "cheque number",
  "transaction id",
  "id",
  "fitid",
  "confirmation",
  "check or slip",
];
const TYPE_ALIASES = ["type", "transaction type", "debit credit", "dr cr", "cr dr"];
const STATUS_ALIASES = ["status"];
const IGNORE_ALIASES = [
  "category",
  "card member",
  "account",
  "card no",
  "notes",
  "tags",
  "labels",
  "purchased by",
  "summary amt",
];
const DESCRIPTION_PRIMARY = new Set(["description", "transaction description", "original description"]);
const DESCRIPTION_MEMO = new Set(["memo", "original description", "merchant"]);
const HINT_DEBIT = new Set(["debit", "d", "dr", "withdrawal"]);
const HINT_CREDIT = new Set(["credit", "c", "cr", "deposit"]);
const CARD_TYPE_HINTS = new Set(["sale", "payment"]);

const INSTITUTION_SIGNATURES: Array<{ headers: string[]; hit: InstitutionHit }> = [
  {
    headers: ["transaction date", "post date", "description", "category", "type", "amount", "memo"],
    hit: { name: "Chase", kind: "credit_card" },
  },
  {
    headers: ["details", "posting date", "description", "amount", "type", "balance", "check or slip"],
    hit: { name: "Chase", kind: "bank" },
  },
  {
    headers: ["date", "description", "card member", "account", "amount"],
    hit: { name: "American Express", kind: "credit_card" },
  },
  {
    headers: ["date", "description", "amount", "running bal"],
    hit: { name: "Bank of America", kind: "bank" },
  },
  {
    headers: ["transaction date", "posted date", "card no", "description", "category", "debit", "credit"],
    hit: { name: "Capital One", kind: "credit_card" },
  },
  {
    headers: ["trans date", "post date", "description", "amount", "category"],
    hit: { name: "Discover", kind: "credit_card" },
  },
  {
    headers: ["status", "date", "description", "debit", "credit"],
    hit: { name: "Citi", kind: "credit_card" },
  },
  {
    headers: [
      "transaction date",
      "clearing date",
      "description",
      "merchant",
      "category",
      "type",
      "amount",
      "purchased by",
    ],
    hit: { name: "Apple Card", kind: "credit_card" },
  },
];

function normalizeLabel(text: string): string {
  return text
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function aliasSet(aliases: string[]): Set<string> {
  return new Set(aliases);
}

const ALL_ROLE_ALIASES: Array<[ColumnRole, Set<string>]> = [
  ["date", aliasSet(DATE_ALIASES)],
  ["description", aliasSet(DESCRIPTION_ALIASES)],
  ["amount", aliasSet(AMOUNT_ALIASES)],
  ["debit", aliasSet(DEBIT_ALIASES)],
  ["credit", aliasSet(CREDIT_ALIASES)],
  ["balance", aliasSet(BALANCE_ALIASES)],
  ["reference", aliasSet(REFERENCE_ALIASES)],
  ["typeHint", aliasSet(TYPE_ALIASES)],
  ["status", aliasSet(STATUS_ALIASES)],
];

const VOCAB_ALIASES = new Set([
  ...DATE_ALIASES,
  ...DESCRIPTION_ALIASES,
  ...AMOUNT_ALIASES,
  ...DEBIT_ALIASES,
  ...CREDIT_ALIASES,
  ...BALANCE_ALIASES,
  ...REFERENCE_ALIASES,
  ...TYPE_ALIASES,
  ...STATUS_ALIASES,
  ...IGNORE_ALIASES,
]);

function cellLooksLikeDate(text: string): boolean {
  return parseDate(text) !== null || parseDate(text, { order: "DMY" }) !== null;
}

function cellLooksLikeAmount(text: string, decimal?: Decimal): boolean {
  if (decimal) return parseAmount(text, { decimal }) !== null;
  return parseAmount(text) !== null || parseAmount(text, { decimal: "," }) !== null;
}

function isVocabHeader(cell: string): boolean {
  return VOCAB_ALIASES.has(normalizeLabel(cell));
}

function isHeaderRow(row: string[]): boolean {
  const cells = row.filter((cell) => cell.trim());
  if (cells.length < 3) return false;
  if (cells.some((cell) => cellLooksLikeDate(cell) || cellLooksLikeAmount(cell))) return false;
  return cells.filter((cell) => isVocabHeader(cell)).length >= 2;
}

function findHeaderIndex(rows: string[][]): number {
  const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);
  for (let index = 0; index < limit; index++) {
    if (isHeaderRow(rows[index] ?? [])) return index;
  }
  return -1;
}

function firstDateRowIndex(rows: string[][]): number {
  return rows.findIndex((row) => row.some((cell) => cellLooksLikeDate(cell)));
}

function joinRows(rows: string[][]): string {
  return rows.map((row) => row.join(" ")).join("\n");
}

function findAccountLast4(text: string): string | undefined {
  return text.match(LAST4)?.[1];
}

function findOpeningBalance(preamble: string[][], decimal: Decimal): number | null {
  for (const row of preamble) {
    if (!/beginning balance/i.test(row.join(" "))) continue;
    for (const cell of row) {
      const parsed = parseAmount(cell, { decimal });
      if (parsed) return parsed.value;
    }
  }
  return null;
}

function sniffDecimal(rows: string[][]): Decimal {
  for (const row of rows) {
    if (row.some((cell) => EUROPEAN_GROUPED.test(cell))) return ",";
  }
  return ".";
}

function isPostish(label: string): boolean {
  return /post|clearing/.test(label);
}

function isTransactionish(label: string): boolean {
  return /trans/.test(label) && !isPostish(label);
}

function takeRole(columns: ColumnMap, role: ColumnRole, index: number): void {
  if (columns[role] === undefined) columns[role] = index;
}

function assignDateRoles(matches: HeaderMatch[], columns: ColumnMap): void {
  if (matches.length === 0) return;
  const trans = matches.find((match) => isTransactionish(match.label));
  const post = matches.find((match) => isPostish(match.label));
  const neutral = matches.find((match) => !isTransactionish(match.label) && !isPostish(match.label));
  if (trans) columns.date = trans.index;
  else if (neutral) columns.date = neutral.index;
  else columns.date = matches[0]?.index;
  if (post && post.index !== columns.date) columns.postedDate = post.index;
  else {
    const extra = matches.find((match) => match.index !== columns.date);
    if (extra) columns.postedDate = extra.index;
  }
}

function descriptionPriority(label: string): number {
  if (DESCRIPTION_PRIMARY.has(label)) return 0;
  if (DESCRIPTION_MEMO.has(label) || label === "narrative" || label === "payee" || label === "name") return 1;
  return 2;
}

function assignDescriptionRoles(matches: HeaderMatch[], columns: ColumnMap): void {
  if (matches.length === 0) return;
  const ranked = [...matches].sort((a, b) => descriptionPriority(a.label) - descriptionPriority(b.label));
  const primary = ranked[0];
  if (!primary) return;
  columns.description = primary.index;
  const memo = ranked.find((match) => match.index !== primary.index && DESCRIPTION_MEMO.has(match.label));
  if (memo) columns.memo = memo.index;
}

function columnsFromHeader(header: string[]): ColumnMap {
  const columns: ColumnMap = {};
  const dates: HeaderMatch[] = [];
  const descriptions: HeaderMatch[] = [];
  const taken = new Set<number>();
  header.forEach((cell, index) => {
    const label = normalizeLabel(cell);
    if (DATE_ALIASES.includes(label)) dates.push({ index, label });
    if (DESCRIPTION_ALIASES.includes(label)) descriptions.push({ index, label });
  });
  assignDateRoles(dates, columns);
  assignDescriptionRoles(descriptions, columns);
  for (const role of ["date", "postedDate", "description", "memo"] as const) {
    const index = columns[role];
    if (index !== undefined) taken.add(index);
  }
  header.forEach((cell, index) => {
    if (taken.has(index)) return;
    const label = normalizeLabel(cell);
    for (const [role, aliases] of ALL_ROLE_ALIASES) {
      if (role === "date" || role === "description") continue;
      if (!aliases.has(label)) continue;
      takeRole(columns, role, index);
      taken.add(index);
      break;
    }
  });
  return columns;
}

function headerSet(header: string[]): Set<string> {
  return new Set(header.map((cell) => normalizeLabel(cell)).filter(Boolean));
}

function sameSet(left: Set<string>, right: string[]): boolean {
  if (left.size !== right.length) return false;
  return right.every((label) => left.has(label));
}

function institutionFromHeader(header: string[]): InstitutionHit | undefined {
  const labels = headerSet(header);
  return INSTITUTION_SIGNATURES.find((signature) => sameSet(labels, signature.headers))?.hit;
}

function hasDecimalOrGrouping(text: string): boolean {
  return /[.,]/.test(text);
}

function amountInCell(text: string, decimal: Decimal): boolean {
  return parseAmount(text, { decimal }) !== null && hasDecimalOrGrouping(text);
}

type ColumnStats = {
  dateFraction: number;
  amountFraction: number;
  amountOfFilled: number;
  avgLen: number;
  filled: number;
};

function columnStats(rows: string[][], index: number, decimal: Decimal): ColumnStats {
  let dateHits = 0;
  let amountHits = 0;
  let filled = 0;
  let filledAmounts = 0;
  let textLen = 0;
  for (const row of rows) {
    const cell = row[index] ?? "";
    if (cell) {
      filled++;
      textLen += cell.length;
    }
    if (cellLooksLikeDate(cell)) dateHits++;
    if (amountInCell(cell, decimal)) {
      amountHits++;
      if (cell) filledAmounts++;
    }
  }
  const count = Math.max(rows.length, 1);
  return {
    dateFraction: dateHits / count,
    amountFraction: amountHits / count,
    amountOfFilled: filled === 0 ? 0 : filledAmounts / filled,
    avgLen: filled === 0 ? 0 : textLen / filled,
    filled,
  };
}

function isNumericColumn(stats: ColumnStats): boolean {
  return stats.amountFraction >= INFER_FRACTION || (stats.filled >= 2 && stats.amountOfFilled >= INFER_FRACTION);
}

function valuesInColumn(rows: string[][], index: number, decimal: Decimal): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const parsed = parseAmount(row[index] ?? "", { decimal });
    if (parsed) values.push(parsed.value);
  }
  return values;
}

function isMonotoneIsh(values: number[]): boolean {
  if (values.length < 2) return false;
  let up = 0;
  let down = 0;
  for (let index = 1; index < values.length; index++) {
    const current = values[index] ?? 0;
    const previous = values[index - 1] ?? 0;
    if (current > previous) up++;
    else if (current < previous) down++;
  }
  const steps = values.length - 1;
  return up / steps >= 0.7 || down / steps >= 0.7;
}

function meanAbs(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + Math.abs(value), 0) / values.length;
}

function mutuallyExclusive(rows: string[][], left: number, right: number, decimal: Decimal): boolean {
  let both = 0;
  let leftOnly = 0;
  let rightOnly = 0;
  for (const row of rows) {
    const hasLeft = amountInCell(row[left] ?? "", decimal);
    const hasRight = amountInCell(row[right] ?? "", decimal);
    if (hasLeft && hasRight) both++;
    else if (hasLeft) leftOnly++;
    else if (hasRight) rightOnly++;
  }
  return both === 0 && leftOnly > 0 && rightOnly > 0;
}

function inferMissingColumns(rows: string[][], columns: ColumnMap, decimal: Decimal): ColumnMap {
  if (rows.length === 0) return columns;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const stats = Array.from({ length: width }, (_, index) => columnStats(rows, index, decimal));
  const assigned = new Set(Object.values(columns).filter((index): index is number => index !== undefined));

  const dateCols: number[] = [];
  stats.forEach((stat, index) => {
    if (assigned.has(index) || stat.dateFraction < INFER_FRACTION) return;
    dateCols.push(index);
  });
  if (columns.date === undefined && dateCols[0] !== undefined) {
    columns.date = dateCols[0];
    assigned.add(dateCols[0]);
    if (columns.postedDate === undefined && dateCols[1] !== undefined) {
      columns.postedDate = dateCols[1];
      assigned.add(dateCols[1]);
    }
  }

  const numeric = stats
    .map((stat, index) => ({ stat, index }))
    .filter(({ stat, index }) => !assigned.has(index) && isNumericColumn(stat))
    .map(({ index }) => index);

  if (columns.debit === undefined && columns.credit === undefined && numeric.length >= 2) {
    const pair = numeric.find((left, index) =>
      numeric.slice(index + 1).some((right) => mutuallyExclusive(rows, left, right, decimal))
    );
    if (pair !== undefined) {
      const other = numeric.find((right) => right !== pair && mutuallyExclusive(rows, pair, right, decimal));
      if (other !== undefined) {
        columns.debit = Math.min(pair, other);
        columns.credit = Math.max(pair, other);
        assigned.add(pair);
        assigned.add(other);
      }
    }
  }

  const remainingNumeric = numeric.filter((index) => !assigned.has(index));
  if (columns.balance === undefined && remainingNumeric.length >= 2) {
    const ranked = remainingNumeric
      .map((index) => ({ index, values: valuesInColumn(rows, index, decimal) }))
      .filter((entry) => isMonotoneIsh(entry.values))
      .sort((a, b) => meanAbs(b.values) - meanAbs(a.values));
    const balance = ranked[0];
    if (balance && meanAbs(balance.values) > meanAbs(valuesInColumn(rows, remainingNumeric.find((i) => i !== balance.index) ?? -1, decimal))) {
      columns.balance = balance.index;
      assigned.add(balance.index);
    }
  }

  if (columns.amount === undefined && columns.debit === undefined && columns.credit === undefined) {
    const amount = remainingNumeric.find((index) => !assigned.has(index));
    if (amount !== undefined) {
      columns.amount = amount;
      assigned.add(amount);
    }
  } else if (columns.amount === undefined && columns.balance === undefined) {
    const leftover = remainingNumeric.find((index) => !assigned.has(index));
    if (leftover !== undefined && remainingNumeric.length === 1) {
      columns.amount = leftover;
      assigned.add(leftover);
    }
  }

  if (columns.description === undefined) {
    let best = -1;
    let bestLen = -1;
    stats.forEach((stat, index) => {
      if (assigned.has(index) || stat.dateFraction >= INFER_FRACTION || isNumericColumn(stat)) return;
      if (stat.avgLen > bestLen) {
        best = index;
        bestLen = stat.avgLen;
      }
    });
    if (best >= 0) columns.description = best;
  }

  return columns;
}

function isWellsFargoLayout(rows: string[][], columns: ColumnMap): boolean {
  if (rows.length === 0 || (rows[0]?.length ?? 0) !== 5) return false;
  return columns.date === 0 && columns.amount === 1 && columns.description === 4;
}

function blobHasCue(blob: string, cues: string[]): boolean {
  const normalized = normalizeLabel(blob);
  const lower = blob.toLowerCase();
  return cues.some((cue) => normalized.includes(cue) || lower.includes(cue));
}

function typeHintsAreCardOnly(rows: string[][], typeHint: number | undefined): boolean {
  if (typeHint === undefined) return false;
  const values = new Set<string>();
  for (const row of rows) {
    const value = (row[typeHint] ?? "").trim().toLowerCase();
    if (value) values.add(value);
  }
  return values.size > 0 && [...values].every((value) => CARD_TYPE_HINTS.has(value));
}

function headersSuggestBank(header: string[] | undefined): boolean {
  if (!header) return false;
  return header.some((cell) => BANK_HEADER_CUES.includes(normalizeLabel(cell)));
}

function resolveAccountKind(
  institution: InstitutionHit | undefined,
  header: string[] | undefined,
  fileName: string,
  columns: ColumnMap,
  dataRows: string[][]
): AccountKind {
  if (institution) return institution.kind;
  const blob = `${header?.join(" ") ?? ""} ${fileName}`;
  if (blobHasCue(blob, CARD_KIND_CUES) || typeHintsAreCardOnly(dataRows, columns.typeHint)) return "credit_card";
  if (columns.balance !== undefined || headersSuggestBank(header)) return "bank";
  return "unknown";
}

function looksLikeCardForFlip(header: string[] | undefined, fileName: string, institution?: string): boolean {
  const blob = `${header?.join(" ") ?? ""} ${fileName} ${institution ?? ""}`;
  return blobHasCue(blob, CARD_SIGN_CUES) || (institution !== undefined && FLIP_INSTITUTIONS.has(institution));
}

function isTotalsRow(row: string[]): boolean {
  return row.some((cell) => /^totals?$/i.test(cell.trim()));
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => !cell.trim());
}

function isPendingRow(row: string[], status: number | undefined): boolean {
  return status !== undefined && (row[status] ?? "").trim().toLowerCase() === "pending";
}

function parseCellAmount(cell: string, decimal: Decimal): number | null {
  return parseAmount(cell, { decimal })?.value ?? null;
}

function debitCreditAmount(row: string[], columns: ColumnMap, decimal: Decimal): number | null {
  const debitCell = columns.debit !== undefined ? row[columns.debit] ?? "" : "";
  const creditCell = columns.credit !== undefined ? row[columns.credit] ?? "" : "";
  if (!debitCell && !creditCell && columns.amount === undefined) return null;
  const debit = Math.abs(parseCellAmount(debitCell, decimal) ?? 0);
  const credit = Math.abs(parseCellAmount(creditCell, decimal) ?? 0);
  if (!debitCell && !creditCell) return null;
  return round2(credit - debit);
}

function singleAmount(row: string[], columns: ColumnMap, decimal: Decimal): number | null {
  if (columns.amount === undefined) return null;
  return parseCellAmount(row[columns.amount] ?? "", decimal);
}

function applyTypeHintSign(amount: number, hint: string | undefined): number {
  if (!hint) return amount;
  const token = hint.trim().toLowerCase();
  const magnitude = Math.abs(amount);
  if (HINT_DEBIT.has(token)) return -magnitude;
  if (HINT_CREDIT.has(token)) return magnitude;
  return amount;
}

function combineDescription(row: string[], columns: ColumnMap): string {
  const main = columns.description !== undefined ? row[columns.description] ?? "" : "";
  const memo = columns.memo !== undefined ? row[columns.memo] ?? "" : "";
  const combined =
    memo.trim() && memo.trim().toLowerCase() !== main.trim().toLowerCase() ? `${main} ${memo}` : main;
  return cleanDescription(combined);
}

function typeFromHint(hint: string | undefined): TransactionType | undefined {
  if (!hint) return undefined;
  const token = hint.trim().toLowerCase();
  if (token === "payment") return "payment";
  if (token === "fee") return "fee";
  if (token === "interest") return "interest";
  if (token === "refund" || token === "return") return "refund";
  return undefined;
}

function dateSamples(rows: string[][], dateCol: number): string[] {
  return rows.map((row) => row[dateCol] ?? "").filter((cell) => cellLooksLikeDate(cell));
}

function applyBalanceSigns(drafts: DraftRow[]): void {
  for (let index = 1; index < drafts.length; index++) {
    const current = drafts[index];
    const previous = drafts[index - 1];
    if (!current || !previous || current.balance === undefined || previous.balance === undefined) continue;
    const delta = round2(current.balance - previous.balance);
    const magnitude = Math.abs(current.amount);
    if (magnitude === 0 || delta === 0) continue;
    current.amount = delta < 0 ? -magnitude : magnitude;
  }
}

function shouldFlipSigns(drafts: DraftRow[], cardLike: boolean): boolean {
  if (!cardLike || drafts.length === 0) return false;
  const negative = drafts.filter((draft) => draft.amount < 0);
  const positive = drafts.filter((draft) => draft.amount > 0);
  if (positive.length * 2 <= drafts.length || negative.length === 0) return false;
  const paymentLike = negative.filter((draft) => PAYMENT_LIKE.test(draft.description)).length;
  return paymentLike * 2 >= negative.length;
}

function computedTotals(transactions: Transaction[]): { purchasesFees: number; paymentsCredits: number } {
  return {
    purchasesFees: sum(transactions.filter((txn) => txn.amount < 0).map((txn) => -txn.amount)),
    paymentsCredits: sum(transactions.filter((txn) => txn.amount > 0).map((txn) => txn.amount)),
  };
}

function minMaxDates(dates: string[]): { from: string; to: string } {
  return {
    from: dates.reduce((earliest, date) => (compareIso(date, earliest) < 0 ? date : earliest)),
    to: dates.reduce((latest, date) => (compareIso(date, latest) > 0 ? date : latest)),
  };
}

function emptyPeriod(): { from: string; to: string } {
  return { from: "", to: "" };
}

function hasAmountRole(columns: ColumnMap): boolean {
  return columns.amount !== undefined || columns.debit !== undefined || columns.credit !== undefined;
}

function toTransaction(draft: DraftRow, kind: AccountKind): Transaction {
  const hinted = typeFromHint(draft.typeHint);
  return {
    date: draft.date,
    ...(draft.postedDate ? { postedDate: draft.postedDate } : {}),
    description: draft.description,
    amount: draft.amount,
    type: hinted ?? classifyTransaction(draft.description, draft.amount, kind),
    ...(draft.referenceNumber ? { referenceNumber: draft.referenceNumber } : {}),
    ...(draft.balance !== undefined ? { balance: draft.balance } : {}),
    rawLine: draft.rawLine,
  };
}

function signIssue(): ValidationIssue {
  return {
    code: "sign_convention_inferred",
    severity: "info",
    message: "Amount signs were flipped because this card export prints charges as positive.",
  };
}

export function parseCsvStatement(doc: ExtractedCsv, opts?: { fileName?: string }): ParsedStatement {
  if (doc.kind !== "csv") throw new TypeError("parseCsvStatement requires an extracted CSV");

  const fileName = opts?.fileName ?? "";
  const decimal = sniffDecimal(doc.rows);
  const headerIndex = findHeaderIndex(doc.rows);
  const header = headerIndex >= 0 ? doc.rows[headerIndex] : undefined;
  const firstDate = firstDateRowIndex(doc.rows);
  const dataStart = headerIndex >= 0 ? headerIndex + 1 : firstDate >= 0 ? firstDate : doc.rows.length;
  const preamble = doc.rows.slice(0, headerIndex >= 0 ? headerIndex : dataStart);
  const dataRows = doc.rows.slice(dataStart).filter((row) => !isEmptyRow(row));

  let columns = header ? columnsFromHeader(header) : {};
  const institution = header ? institutionFromHeader(header) : undefined;
  if (columns.date === undefined || !hasAmountRole(columns)) {
    columns = inferMissingColumns(dataRows, { ...columns }, decimal);
  }
  const wells = !header && isWellsFargoLayout(dataRows, columns);
  const resolvedInstitution = institution ?? (wells ? { name: "Wells Fargo", kind: "unknown" as const } : undefined);
  const accountKind = resolveAccountKind(resolvedInstitution, header, fileName, columns, dataRows);

  const skippedLines: string[] = [];
  const drafts: DraftRow[] = [];
  const usedDebitCredit = columns.debit !== undefined || columns.credit !== undefined;
  const order: DateOrder =
    columns.date !== undefined ? inferDateOrder(dateSamples(dataRows, columns.date)) : "MDY";

  if (columns.date !== undefined && hasAmountRole(columns)) {
    dataRows.forEach((row, sourceIndex) => {
      const rawLine = row.join(doc.delimiter);
      if (isTotalsRow(row)) return;
      if (isPendingRow(row, columns.status)) {
        skippedLines.push(rawLine);
        return;
      }
      const parsedDate = parseDate(row[columns.date ?? 0] ?? "", { order });
      if (!parsedDate) {
        skippedLines.push(rawLine);
        return;
      }
      const printed = usedDebitCredit
        ? debitCreditAmount(row, columns, decimal)
        : singleAmount(row, columns, decimal);
      if (printed === null) {
        skippedLines.push(rawLine);
        return;
      }
      const hint = columns.typeHint !== undefined ? row[columns.typeHint] : undefined;
      const amount = usedDebitCredit ? printed : applyTypeHintSign(printed, hint);
      const posted = columns.postedDate !== undefined ? parseDate(row[columns.postedDate] ?? "", { order }) : null;
      const reference = columns.reference !== undefined ? (row[columns.reference] ?? "").trim() : "";
      const balance = columns.balance !== undefined ? parseCellAmount(row[columns.balance] ?? "", decimal) : null;
      drafts.push({
        date: parsedDate.iso,
        ...(posted ? { postedDate: posted.iso } : {}),
        description: combineDescription(row, columns),
        amount,
        ...(hint?.trim() ? { typeHint: hint } : {}),
        ...(reference ? { referenceNumber: reference } : {}),
        ...(balance !== null ? { balance } : {}),
        rawLine,
        sourceIndex,
      });
    });
  }

  // Same-day rows must follow the file's own direction, or balance deltas compare the
  // wrong neighbours in newest-first exports.
  const firstDraft = drafts[0];
  const lastDraft = drafts[drafts.length - 1];
  const newestFirst = firstDraft && lastDraft ? compareIso(firstDraft.date, lastDraft.date) > 0 : false;
  drafts.sort((left, right) => {
    const byDate = compareIso(left.date, right.date);
    if (byDate !== 0) return byDate;
    return newestFirst ? right.sourceIndex - left.sourceIndex : left.sourceIndex - right.sourceIndex;
  });

  if (!usedDebitCredit && columns.balance !== undefined) applyBalanceSigns(drafts);
  const flipped =
    !usedDebitCredit &&
    shouldFlipSigns(drafts, looksLikeCardForFlip(header, fileName, resolvedInstitution?.name));
  if (flipped) {
    for (const draft of drafts) draft.amount = round2(-draft.amount);
  }

  const transactions = drafts.map((draft) => toTransaction(draft, accountKind));
  const totals = computedTotals(transactions);
  const printedPeriod = findDateRange(joinRows(preamble));
  const dates = transactions.map((txn) => txn.date);
  const openingFromPreamble = findOpeningBalance(preamble, decimal);
  const first = transactions[0];
  const last = transactions[transactions.length - 1];
  const openingFromBalance =
    first?.balance !== undefined ? round2(first.balance - first.amount) : null;
  const accountLast4 = findAccountLast4(joinRows(preamble));
  const summary: StatementSummary = {
    statementPeriod: printedPeriod ?? (dates.length > 0 ? minMaxDates(dates) : emptyPeriod()),
    openingBalance: openingFromPreamble ?? openingFromBalance,
    closingBalance: last?.balance ?? null,
    totalPurchasesFees: totals.purchasesFees,
    totalPaymentsCredits: totals.paymentsCredits,
    accountKind,
    ...(resolvedInstitution ? { institution: resolvedInstitution.name } : {}),
    ...(accountLast4 ? { accountLast4 } : {}),
  };

  const validation = validateStatement({ summary, transactions, skippedLines });
  if (flipped) validation.issues.push(signIssue());

  return { summary, transactions, validation, parser: "csv-generic" };
}
