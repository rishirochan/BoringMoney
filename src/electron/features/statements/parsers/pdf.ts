import {
  DATE_TOKEN,
  compareIso,
  findDateRange,
  inferDateOrder,
  parseDate,
  resolveYear,
  type DateOrder,
} from "../dates.js";
import { classifyTransaction, cleanDescription } from "../classify.js";
import { AMOUNT_TOKEN, parseAmount, round2, sum } from "../money.js";
import type {
  AccountKind,
  ExtractedPdf,
  ParsedStatement,
  StatementSummary,
  Transaction,
  ValidationIssue,
  ValidationReport,
} from "../types.js";
import { validateStatement } from "../validate.js";

type Section = "none" | "credits" | "debits" | "fees" | "interest" | "ignore";
type Evidence = "balance" | "marker" | "section" | "default";

type AccountDetection = {
  kind: AccountKind;
  weak: boolean;
};

type AmountFact = {
  value: number;
  found: boolean;
};

type SummaryFacts = {
  openingBalance: number | null;
  closingBalance: number | null;
  purchasesFees: AmountFact;
  paymentsCredits: AmountFact;
  minimumPaymentDue?: number;
  paymentDueDate?: string;
};

type TransactionCandidate = {
  date: string;
  postedDate?: string;
  description: string;
  printedAmount: number;
  creditMarker: boolean;
  balance?: number;
  section: Section;
  evidence: Evidence;
  rawLine: string;
  continuationCount: number;
};

type ParseVariant = {
  kind: AccountKind;
  flipDefaults: boolean;
  transactions: Transaction[];
  summary: StatementSummary;
  validation: ValidationReport;
};

const EMPTY_SECTION: Section = "none";
const MAX_CONTINUATION_LENGTH = 80;
const MAX_CONTINUATION_LINES = 2;
const DATE_AT_START = new RegExp(`^\\s*(?:${DATE_TOKEN})(?:\\s|$)`, "i");
const DATE_ANYWHERE = new RegExp(DATE_TOKEN, "gi");
const DATE_CAPTURE = new RegExp(`(${DATE_TOKEN})`, "i");
const COLUMN_TRANSACTION_LINE = new RegExp(
  `^\\s*(${DATE_TOKEN})\\s+(?:(${DATE_TOKEN})\\s+)?(.+?)\\s{2,}(${AMOUNT_TOKEN})(?:\\s{2,}(${AMOUNT_TOKEN}))?\\s*$`,
  "iu",
);
const TRANSACTION_LINE = new RegExp(
  `^\\s*(${DATE_TOKEN})\\s+(?:(${DATE_TOKEN})\\s+)?(.+?)\\s+(${AMOUNT_TOKEN})(?:\\s+(${AMOUNT_TOKEN}))?\\s*$`,
  "iu",
);
const AMOUNT_AT_END = new RegExp(`(?:${AMOUNT_TOKEN})\\s*$`, "i");
const TOTAL_LINE = /^\s*(?:TOTAL|Total|Subtotal)\b/;

const OPENING_LABELS = [
  "Previous Balance",
  "Beginning Balance",
  "Opening Balance",
  "Balance Forward",
  "Prior Balance",
  "Starting Balance",
];
const CLOSING_LABELS = [
  "New Balance Total",
  "New Balance",
  "Ending Balance",
  "Closing Balance",
  "Statement Balance",
  "Current Balance",
];
const PAYMENT_LABELS = [
  "Payments and Other Credits",
  "Payments and Credits",
  "Payments/Credits",
  "Other Credits",
  "Deposits and Other Additions",
  "Deposits and Additions",
  "Total Deposits",
  "Payments",
  "Credits",
];
const PURCHASE_LABELS = ["Purchases and Adjustments", "Total Purchases", "New Charges", "Purchases"];
const WITHDRAWAL_LABELS = [
  "Withdrawals and Other Subtractions",
  "Withdrawals and Debits",
  "Total Withdrawals",
  "Withdrawals",
];
const CHECK_LABELS = ["Checks Paid", "Checks"];
const FEE_LABELS = ["Fees Charged", "Service Fees", "Fees"];
const INTEREST_LABELS = ["Interest Charged"];
const CASH_ADVANCE_LABELS = ["Cash Advances"];
const MINIMUM_PAYMENT_LABELS = ["Minimum Payment Due", "Minimum Amount Due", "Minimum Payment"];
const ALL_SUMMARY_LABELS = [
  ...OPENING_LABELS,
  ...CLOSING_LABELS,
  "Balance Due",
  ...PAYMENT_LABELS,
  ...PURCHASE_LABELS,
  ...WITHDRAWAL_LABELS,
  ...CHECK_LABELS,
  ...FEE_LABELS,
  ...INTEREST_LABELS,
  ...CASH_ADVANCE_LABELS,
  ...MINIMUM_PAYMENT_LABELS,
];

const INSTITUTIONS: Array<[RegExp, string]> = [
  [/\bAmerican Express\b|\bAMEX\b/i, "American Express"],
  [/\bBank of America\b/i, "Bank of America"],
  [/\bCapital One\b/i, "Capital One"],
  [/\bWells Fargo\b/i, "Wells Fargo"],
  [/\bU\.?\s*S\.?\s+Bank\b/i, "U.S. Bank"],
  [/\bNavy Federal\b/i, "Navy Federal"],
  [/\bCharles Schwab\b/i, "Charles Schwab"],
  [/\bApple Card\b|\bGoldman Sachs\b/i, "Apple Card"],
  [/\bCiti(?:bank)?\b/i, "Citi"],
  [/\bChase\b/i, "Chase"],
  [/\bDiscover\b/i, "Discover"],
  [/\bBarclays\b/i, "Barclays"],
  [/\bSynchrony\b/i, "Synchrony"],
  [/\bTD Bank\b/i, "TD Bank"],
  [/\bPNC\b/i, "PNC"],
  [/\bTruist\b/i, "Truist"],
  [/\bAlly\b/i, "Ally"],
  [/\bFidelity\b/i, "Fidelity"],
  [/\bUSAA\b/i, "USAA"],
  [/\bSoFi\b/i, "SoFi"],
  [/\bMarcus\b/i, "Marcus"],
];

const CREDIT_CUES = [
  "Minimum Payment Due",
  "Payment Due Date",
  "Credit Limit",
  "Available Credit",
  "New Balance",
  "Previous Balance",
  "Purchases",
  "Cash Advances",
  "APR",
  "Interest Charged",
  "Credit Card",
];
const BANK_CUES = [
  "Beginning Balance",
  "Ending Balance",
  "Deposits and Additions",
  "Deposits and Other Additions",
  "Withdrawals",
  "Checks Paid",
  "Checking",
  "Savings",
  "Daily Balance",
  "Daily Ledger Balances",
  "Available Balance",
  "ATM",
];

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

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function labelPattern(labels: string[]): RegExp {
  return new RegExp(`\\b(?:${labels.map(escapeRegex).join("|")})\\b`, "i");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function detectInstitution(pages: string[][]): string | undefined {
  const text = pages.slice(0, 2).flat().join("\n");
  return INSTITUTIONS.find(([pattern]) => pattern.test(text))?.[1];
}

function cueScore(text: string, cues: string[]): number {
  return cues.reduce((score, cue) => score + (labelPattern([cue]).test(text) ? 1 : 0), 0);
}

function detectAccountKind(lines: string[]): AccountDetection {
  const text = lines.join("\n");
  const creditScore = cueScore(text, CREDIT_CUES);
  const bankScore = cueScore(text, BANK_CUES);
  const kind = creditScore === bankScore ? "unknown" : creditScore > bankScore ? "credit_card" : "bank";
  return { kind, weak: Math.abs(creditScore - bankScore) <= 1 };
}

function detectAccountLast4(lines: string[]): string | undefined {
  const text = lines.join("\n");
  const patterns = [
    /\b(?:account|card)\s+ending(?:\s+in)?\s+(?:[*Xx-]*\s*)?(\d{4})\b/i,
    /\bending\s+in\s+(?:[*Xx-]*\s*)?(\d{4})\b/i,
    /(?:XXXX|\*{4})(?:\s+(?:XXXX|\*{4})){0,2}\s+(\d{4})\b/i,
    /\*{4}\s*(\d{4})\b/,
    // Greedy so a fully printed number yields its last group, not its first.
    /\b(?:account|card)\s+(?:number|no\.?)\s*[:#-]?\s*[*Xx\d -]*(\d{4})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function dateSamples(lines: string[]): string[] {
  return lines.flatMap((line) => {
    const match = line.match(DATE_AT_START);
    if (!match) return [];
    const token = line.trimStart().match(DATE_CAPTURE)?.[1];
    return token ? [token] : [];
  });
}

function firstDateRange(lines: string[], order: DateOrder): { from: string; to: string } | null {
  const preferred = lines.filter((line) => /\b(?:statement|billing|period|opening|closing|cycle)\b/i.test(line));
  for (const line of [...preferred, ...lines]) {
    const range = findDateRange(line, order);
    if (range) return range;
  }
  return null;
}

function subtractDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function closingDatePeriod(lines: string[], order: DateOrder): { from: string; to: string } | null {
  const line = lines.find((candidate) => /\b(?:closing|statement)\s+date\b/i.test(candidate));
  const token = line?.match(DATE_CAPTURE)?.[1];
  if (!token) return null;
  const parsed = parseDate(token, { order });
  if (!parsed) return null;
  return { from: subtractDays(parsed.iso, 30), to: parsed.iso };
}

function currentYearPeriod(): { from: string; to: string } {
  const year = todayIso().slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function monthDayOf(token: string, order: DateOrder): { month: number; day: number } | null {
  const numeric = token.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    return order === "DMY" ? { month: second, day: first } : { month: first, day: second };
  }
  const monthFirst = token.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    return month ? { month, day: Number(monthFirst[2]) } : null;
  }
  const dayFirst = token.match(/^(\d{1,2})[-\s]([A-Za-z]+)$/);
  if (!dayFirst) return null;
  const month = MONTHS[dayFirst[2].toLowerCase()];
  return month ? { month, day: Number(dayFirst[1]) } : null;
}

function transactionDate(token: string, order: DateOrder, period: { from: string; to: string }): string | null {
  const parsed = parseDate(token, { order, year: Number(period.to.slice(0, 4)) });
  if (!parsed) return null;
  if (parsed.hadYear) return parsed.iso;
  const monthDay = monthDayOf(token, order);
  return monthDay ? resolveYear(monthDay.month, monthDay.day, period) : parsed.iso;
}

function maskDates(line: string): string {
  return line.replace(DATE_ANYWHERE, (match) => " ".repeat(match.length));
}

function amountTokens(line: string): string[] {
  const tokens: string[] = [];
  const scanner = new RegExp(AMOUNT_TOKEN, "gi");
  const text = maskDates(line);
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(text)) !== null) {
    const before = text[match.index - 1] ?? " ";
    const after = text[match.index + match[0].length] ?? " ";
    if (!/[\p{L}\p{N}/]/u.test(before) && !/[\p{L}\p{N}/]/u.test(after) && parseAmount(match[0])) {
      tokens.push(match[0]);
    }
    if (match[0].length === 0) scanner.lastIndex++;
  }
  return tokens;
}

function followingAmountToken(lines: string[], index: number): string | undefined {
  const nextLine = lines[index + 1];
  if (!nextLine || DATE_AT_START.test(nextLine) || sectionHeader(nextLine)) return undefined;
  if (labelPattern(ALL_SUMMARY_LABELS).test(nextLine)) return undefined;
  return amountTokens(nextLine).at(-1);
}

function labeledAmount(lines: string[], labels: string[]): AmountFact {
  const pattern = labelPattern(labels);
  for (let index = 0; index < lines.length; index++) {
    if (!pattern.test(lines[index])) continue;
    const sameLine = amountTokens(lines[index]).at(-1);
    if (sameLine) return { value: Math.abs(parseAmount(sameLine)?.value ?? 0), found: true };
    const nextToken = followingAmountToken(lines, index);
    if (nextToken) return { value: Math.abs(parseAmount(nextToken)?.value ?? 0), found: true };
  }
  return { value: 0, found: false };
}

function labeledBalance(lines: string[], labels: string[]): number | null {
  const pattern = labelPattern(labels);
  for (let index = 0; index < lines.length; index++) {
    if (!pattern.test(lines[index])) continue;
    const token = amountTokens(lines[index]).at(-1) ?? followingAmountToken(lines, index);
    const parsed = token ? parseAmount(token) : null;
    if (!parsed) continue;
    if (parsed.creditMarker) return -Math.abs(parsed.value);
    return parsed.value;
  }
  return null;
}

function totalFacts(lines: string[], kind: AccountKind): AmountFact {
  const groups = kind === "bank"
    ? [WITHDRAWAL_LABELS, CHECK_LABELS, FEE_LABELS]
    : [PURCHASE_LABELS, FEE_LABELS, INTEREST_LABELS, CASH_ADVANCE_LABELS];
  const facts = groups.map((labels) => labeledAmount(lines, labels));
  return { value: sum(facts.filter((fact) => fact.found).map((fact) => fact.value)), found: facts.some((fact) => fact.found) };
}

function paymentDueDate(lines: string[], order: DateOrder, period: { from: string; to: string }): string | undefined {
  const pattern = labelPattern(["Payment Due Date", "Due Date"]);
  for (let index = 0; index < lines.length; index++) {
    if (!pattern.test(lines[index])) continue;
    const token = lines[index].match(DATE_CAPTURE)?.[1] ?? lines[index + 1]?.match(DATE_CAPTURE)?.[1];
    if (!token) continue;
    const parsed = parseDate(token, { order, year: Number(period.to.slice(0, 4)) });
    if (parsed) return parsed.iso;
  }
  return undefined;
}

function readSummaryFacts(
  lines: string[],
  kind: AccountKind,
  order: DateOrder,
  period: { from: string; to: string },
): SummaryFacts {
  const minimum = labeledAmount(lines, MINIMUM_PAYMENT_LABELS);
  const closing = labeledBalance(lines, CLOSING_LABELS) ?? labeledBalance(lines, ["Balance Due"]);
  const dueDate = paymentDueDate(lines, order, period);
  return {
    openingBalance: labeledBalance(lines, OPENING_LABELS),
    closingBalance: closing,
    purchasesFees: totalFacts(lines, kind),
    paymentsCredits: labeledAmount(lines, PAYMENT_LABELS),
    ...(minimum.found ? { minimumPaymentDue: minimum.value } : {}),
    ...(dueDate ? { paymentDueDate: dueDate } : {}),
  };
}

function sectionHeader(line: string): Section | null {
  const normalized = line
    .trim()
    .replace(/\s*\((?:continued|cont\.?)\)\s*$/i, "")
    .replace(/[:*]+$/, "")
    .trim();
  if (/^(?:PAYMENTS AND OTHER CREDITS|PAYMENTS AND CREDITS|PAYMENTS|CREDITS|DEPOSITS AND (?:OTHER )?ADDITIONS|DEPOSITS)$/i.test(normalized)) {
    return "credits";
  }
  if (/^(?:PURCHASES(?: AND ADJUSTMENTS)?|NEW CHARGES|WITHDRAWALS|CHECKS PAID|ELECTRONIC WITHDRAWALS|CARD PURCHASES|OTHER DEBITS)$/i.test(normalized)) {
    return "debits";
  }
  if (/^(?:FEES|FEES CHARGED|SERVICE FEES)$/i.test(normalized)) return "fees";
  if (/^INTEREST CHARGED$/i.test(normalized)) return "interest";
  if (/^(?:DAILY BALANCE|DAILY LEDGER BALANCES|INTEREST CHARGE CALCULATION|DAILY ENDING BALANCE|YEAR-TO-DATE|REWARDS)$/i.test(normalized)) {
    return "ignore";
  }
  return null;
}

function isOnlyLabel(description: string): boolean {
  const normalized = description.trim().replace(/[:*]+$/, "").trim();
  return ALL_SUMMARY_LABELS.some((label) => normalized.toLowerCase() === label.toLowerCase());
}

function referenceFrom(description: string): { description: string; referenceNumber?: string } {
  const tokens = [...description.matchAll(/\b[A-Za-z0-9]{8,}\b/g)];
  const candidate = tokens.find((match) => {
    const token = match[0];
    const digits = token.replace(/\D/g, "").length;
    const atStart = (match.index ?? 0) === 0;
    const atEnd = (match.index ?? 0) + token.length === description.trimEnd().length;
    return digits * 2 >= token.length && (atStart || atEnd);
  });
  if (!candidate || candidate.index === undefined) return { description };
  const prefix = description.slice(0, candidate.index).replace(/(?:Reference|Ref|Conf)\s*#?\s*:?\s*$/i, "");
  const suffix = description.slice(candidate.index + candidate[0].length);
  return { description: `${prefix}${suffix}`.trim(), referenceNumber: candidate[0] };
}

function candidateFromLine(
  line: string,
  section: Section,
  order: DateOrder,
  period: { from: string; to: string },
): TransactionCandidate | null {
  // Column gaps keep numeric references in the description instead of treating them as balances.
  const match = line.match(COLUMN_TRANSACTION_LINE) ?? line.match(TRANSACTION_LINE);
  if (!match?.[1] || !match[3] || !match[4] || !/\p{L}/u.test(match[3])) return null;
  const date = transactionDate(match[1], order, period);
  const postedDate = match[2] ? transactionDate(match[2], order, period) : null;
  const amount = parseAmount(match[4]);
  const balance = match[5] ? parseAmount(match[5]) : null;
  if (!date || !amount || (match[2] && !postedDate) || (match[5] && !balance)) return null;
  if (isOnlyLabel(match[3]) && section === "none") return null;
  const evidence: Evidence = balance ? "balance" : amount.creditMarker || amount.value < 0 ? "marker" : section === "none" ? "default" : "section";
  return {
    date,
    ...(postedDate ? { postedDate } : {}),
    description: match[3],
    printedAmount: amount.value,
    creditMarker: amount.creditMarker,
    ...(balance ? { balance: balance.value } : {}),
    section,
    evidence,
    rawLine: line,
    continuationCount: 0,
  };
}

function isContinuation(line: string, previous: TransactionCandidate | undefined, section: Section): boolean {
  if (!previous || section === "ignore" || previous.continuationCount >= MAX_CONTINUATION_LINES) return false;
  if (!line.trim() || line.length >= MAX_CONTINUATION_LENGTH || DATE_AT_START.test(line)) return false;
  if (AMOUNT_AT_END.test(line) && amountTokens(line).length > 0) return false;
  if (sectionHeader(line) || TOTAL_LINE.test(line) || isOnlyLabel(line)) return false;
  return !/^(?:date|description|transaction date|post date|amount|balance)\b/i.test(line.trim());
}

function parseCandidates(
  pages: string[][],
  order: DateOrder,
  period: { from: string; to: string },
): { candidates: TransactionCandidate[]; skippedLines: string[] } {
  const candidates: TransactionCandidate[] = [];
  const skippedLines: string[] = [];
  let section: Section = EMPTY_SECTION;
  let previous: TransactionCandidate | undefined;
  for (const page of pages) {
    section = EMPTY_SECTION;
    previous = undefined;
    for (const line of page) {
      if (TOTAL_LINE.test(line)) {
        section = EMPTY_SECTION;
        previous = undefined;
        continue;
      }
      const header = amountTokens(line).length === 0 && !DATE_AT_START.test(line) ? sectionHeader(line) : null;
      if (header) {
        section = header;
        previous = undefined;
        continue;
      }
      if (section === "ignore") continue;
      const candidate = candidateFromLine(line, section, order, period);
      if (candidate) {
        candidates.push(candidate);
        previous = candidate;
        continue;
      }
      if (isContinuation(line, previous, section) && previous) {
        previous.description = `${previous.description} ${line.trim()}`;
        previous.rawLine = `${previous.rawLine}\n${line}`;
        previous.continuationCount++;
        continue;
      }
      if (DATE_AT_START.test(line) && AMOUNT_AT_END.test(line)) skippedLines.push(line);
      previous = undefined;
    }
  }
  return { candidates, skippedLines };
}

function signedAmount(
  candidate: TransactionCandidate,
  kind: AccountKind,
  previousBalance: number | null,
  flipDefaults: boolean,
): number {
  const magnitude = Math.abs(candidate.printedAmount);
  if (magnitude === 0) return 0;
  if (candidate.balance !== undefined && previousBalance !== null) {
    // Banks often print the daily ending balance on the last row of a day only, so the
    // delta can span several rows. Trust it for the sign only when it matches this row.
    const delta = round2(candidate.balance - previousBalance);
    if (Math.abs(Math.abs(delta) - magnitude) <= 0.01) return delta < 0 ? -magnitude : magnitude;
  }
  if (candidate.creditMarker) return magnitude;
  if (candidate.printedAmount < 0) return kind === "bank" ? -magnitude : magnitude;
  if (candidate.section === "credits") return magnitude;
  if (candidate.section === "debits" || candidate.section === "fees" || candidate.section === "interest") {
    return -magnitude;
  }
  return flipDefaults ? magnitude : -magnitude;
}

function buildTransactions(
  candidates: TransactionCandidate[],
  kind: AccountKind,
  openingBalance: number | null,
  flipDefaults: boolean,
): Transaction[] {
  let previousBalance = openingBalance;
  return candidates.map((candidate) => {
    const amount = signedAmount(candidate, kind, previousBalance, flipDefaults);
    if (candidate.balance !== undefined) previousBalance = candidate.balance;
    const reference = referenceFrom(candidate.description);
    const description = cleanDescription(reference.description);
    return {
      date: candidate.date,
      ...(candidate.postedDate ? { postedDate: candidate.postedDate } : {}),
      description,
      amount,
      type: classifyTransaction(description, amount, kind),
      ...(reference.referenceNumber ? { referenceNumber: reference.referenceNumber } : {}),
      ...(candidate.balance !== undefined ? { balance: candidate.balance } : {}),
      rawLine: candidate.rawLine,
    };
  });
}

function derivedPeriod(transactions: Transaction[]): { from: string; to: string } {
  if (transactions.length === 0) {
    const today = todayIso();
    return { from: today, to: today };
  }
  const dates = transactions.map((transaction) => transaction.date);
  return {
    from: dates.reduce((earliest, date) => compareIso(date, earliest) < 0 ? date : earliest),
    to: dates.reduce((latest, date) => compareIso(date, latest) > 0 ? date : latest),
  };
}

function computedTotals(transactions: Transaction[]): { purchasesFees: number; paymentsCredits: number } {
  return {
    purchasesFees: sum(transactions.filter((transaction) => transaction.amount < 0).map((transaction) => -transaction.amount)),
    paymentsCredits: sum(transactions.filter((transaction) => transaction.amount > 0).map((transaction) => transaction.amount)),
  };
}

function buildSummary(
  facts: SummaryFacts,
  period: { from: string; to: string },
  transactions: Transaction[],
  kind: AccountKind,
  institution: string | undefined,
  accountLast4: string | undefined,
): StatementSummary {
  const computed = computedTotals(transactions);
  return {
    statementPeriod: period,
    openingBalance: facts.openingBalance,
    closingBalance: facts.closingBalance,
    totalPurchasesFees: facts.purchasesFees.found ? facts.purchasesFees.value : computed.purchasesFees,
    totalPaymentsCredits: facts.paymentsCredits.found ? facts.paymentsCredits.value : computed.paymentsCredits,
    ...(facts.minimumPaymentDue !== undefined ? { minimumPaymentDue: facts.minimumPaymentDue } : {}),
    ...(facts.paymentDueDate ? { paymentDueDate: facts.paymentDueDate } : {}),
    accountKind: kind,
    ...(institution ? { institution } : {}),
    ...(accountLast4 ? { accountLast4 } : {}),
  };
}

function validationOf(
  summary: StatementSummary,
  transactions: Transaction[],
  facts: SummaryFacts,
  skippedLines: string[],
): ValidationReport {
  return validateStatement({
    summary,
    transactions,
    statedTotals: {
      ...(facts.purchasesFees.found ? { purchasesFees: facts.purchasesFees.value } : {}),
      ...(facts.paymentsCredits.found ? { paymentsCredits: facts.paymentsCredits.value } : {}),
    },
    skippedLines,
  });
}

function makeVariant(
  candidates: TransactionCandidate[],
  facts: SummaryFacts,
  period: { from: string; to: string },
  kind: AccountKind,
  flipDefaults: boolean,
  institution: string | undefined,
  accountLast4: string | undefined,
  skippedLines: string[],
): ParseVariant {
  const transactions = buildTransactions(candidates, kind, facts.openingBalance, flipDefaults);
  const summary = buildSummary(facts, period, transactions, kind, institution, accountLast4);
  return {
    kind,
    flipDefaults,
    transactions,
    summary,
    validation: validationOf(summary, transactions, facts, skippedLines),
  };
}

function alternativeKinds(kind: AccountKind): AccountKind[] {
  if (kind === "credit_card") return ["credit_card", "bank"];
  if (kind === "bank") return ["bank", "credit_card"];
  return ["unknown", "credit_card", "bank"];
}

function betterVariant(candidate: ParseVariant, current: ParseVariant): boolean {
  if (candidate.validation.confidence !== current.validation.confidence) {
    return candidate.validation.confidence > current.validation.confidence;
  }
  if (candidate.validation.ok !== current.validation.ok) return candidate.validation.ok;
  return candidate.validation.checks.balanceReconciles === true && current.validation.checks.balanceReconciles !== true;
}

function addInferenceIssue(variant: ParseVariant): ParseVariant {
  const issue: ValidationIssue = {
    code: "sign_convention_inferred",
    severity: "info",
    message: "Transaction signs were inferred from the statement balance.",
  };
  return {
    ...variant,
    validation: {
      ...variant.validation,
      confidence: Math.max(0, round2(variant.validation.confidence - 0.02)),
      issues: [...variant.validation.issues, issue],
    },
  };
}

function chooseVariant(
  initial: ParseVariant,
  account: AccountDetection,
  candidates: TransactionCandidate[],
  create: (kind: AccountKind, flipDefaults: boolean) => ParseVariant,
): ParseVariant {
  if (initial.validation.checks.balanceReconciles !== false) return initial;
  const defaultMajority = candidates.filter((candidate) => candidate.evidence === "default").length * 2 > candidates.length;
  if (!account.weak && !defaultMajority) return initial;
  let best = initial;
  for (const kind of alternativeKinds(account.kind)) {
    for (const flipDefaults of defaultMajority ? [false, true] : [false]) {
      const variant = create(kind, flipDefaults);
      if (betterVariant(variant, best)) best = variant;
    }
  }
  const changed = best.kind !== initial.kind || best.flipDefaults !== initial.flipDefaults;
  return changed ? addInferenceIssue(best) : best;
}

export function parsePdfStatement(doc: ExtractedPdf, opts?: { fileName?: string }): ParsedStatement {
  if (doc.kind !== "pdf") throw new TypeError("parsePdfStatement requires an extracted PDF");
  const lines = doc.pages.flat();
  const account = detectAccountKind(lines);
  const institution = detectInstitution(doc.pages);
  const accountLast4 = detectAccountLast4(lines);
  const order = inferDateOrder(dateSamples(lines));
  const printedPeriod = firstDateRange(lines, order) ?? closingDatePeriod(lines, order);
  const parsePeriod = printedPeriod ?? currentYearPeriod();
  const facts = readSummaryFacts(lines, account.kind, order, parsePeriod);
  const parsed = doc.hasText
    ? parseCandidates(doc.pages, order, parsePeriod)
    : { candidates: [], skippedLines: [] };
  const preliminary = buildTransactions(parsed.candidates, account.kind, facts.openingBalance, false);
  const period = printedPeriod ?? derivedPeriod(preliminary);
  const create = (kind: AccountKind, flipDefaults: boolean): ParseVariant =>
    makeVariant(
      parsed.candidates,
      facts,
      period,
      kind,
      flipDefaults,
      institution,
      accountLast4,
      parsed.skippedLines,
    );
  const initial = create(account.kind, false);
  const selected = chooseVariant(initial, account, parsed.candidates, create);
  void opts;
  return {
    summary: selected.summary,
    transactions: selected.transactions,
    validation: selected.validation,
    parser: "pdf-generic",
  };
}
