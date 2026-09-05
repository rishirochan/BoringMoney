import type { AccountKind, StatementSummary, Transaction, ValidationIssue, ValidationReport } from "./types.js";
import { compareIso } from "./dates.js";
import { round2, sum } from "./money.js";

export interface ValidateInput {
  summary: StatementSummary;
  transactions: Transaction[];
  statedTotals?: { purchasesFees?: number; paymentsCredits?: number };
  skippedLines?: string[];
}

function isValidIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function computedClosing(opening: number, total: number, kind: AccountKind): number[] {
  if (kind === "credit_card") return [round2(opening - total)];
  if (kind === "bank") return [round2(opening + total)];
  return [round2(opening - total), round2(opening + total)];
}

function computedTotals(transactions: Transaction[]): { purchasesFees: number; paymentsCredits: number } {
  return {
    purchasesFees: sum(transactions.filter((txn) => txn.amount < 0).map((txn) => -txn.amount)),
    paymentsCredits: sum(transactions.filter((txn) => txn.amount > 0).map((txn) => txn.amount)),
  };
}

function periodIssue(from: string, to: string): ValidationIssue | null {
  if (!isValidIso(from) || !isValidIso(to) || compareIso(from, to) > 0) {
    return {
      code: "period_invalid",
      severity: "error",
      message: "Statement period is missing, inverted, or not a valid ISO date.",
      detail: { from, to },
    };
  }
  return null;
}

function balanceIssue(
  opening: number,
  closing: number,
  transactions: Transaction[],
  kind: AccountKind
): { issue: ValidationIssue | null; reconciles: boolean } {
  const total = sum(transactions.map((txn) => txn.amount));
  const expecteds = computedClosing(opening, total, kind);
  const match = expecteds.find((expected) => Math.abs(expected - closing) <= 0.01);
  if (match !== undefined) return { issue: null, reconciles: true };

  const expected = expecteds.reduce((best, candidate) =>
    Math.abs(candidate - closing) < Math.abs(best - closing) ? candidate : best
  );
  return {
    reconciles: false,
    issue: {
      code: "balance_mismatch",
      severity: "error",
      message: "Opening and closing balances do not reconcile with transaction amounts.",
      detail: { expected, actual: closing, diff: round2(closing - expected) },
    },
  };
}

function totalsIssue(
  transactions: Transaction[],
  stated: { purchasesFees?: number; paymentsCredits?: number }
): { issue: ValidationIssue | null; match: boolean | null } {
  const computed = computedTotals(transactions);
  const checks: { field: "purchasesFees" | "paymentsCredits"; stated: number; computed: number }[] = [];
  if (stated.purchasesFees !== undefined) {
    checks.push({ field: "purchasesFees", stated: stated.purchasesFees, computed: computed.purchasesFees });
  }
  if (stated.paymentsCredits !== undefined) {
    checks.push({ field: "paymentsCredits", stated: stated.paymentsCredits, computed: computed.paymentsCredits });
  }
  if (checks.length === 0) return { issue: null, match: null };

  const mismatches = checks.filter((row) => Math.abs(row.stated - row.computed) > 0.01);
  if (mismatches.length === 0) return { issue: null, match: true };
  return {
    match: false,
    issue: {
      code: "totals_mismatch",
      severity: "warning",
      message: "Printed purchase or payment totals do not match the transactions.",
      detail: { expected: computed, actual: stated },
    },
  };
}

function dateIssues(
  transactions: Transaction[],
  period: { from: string; to: string },
  periodValid: boolean
): { issue: ValidationIssue | null; inPeriod: boolean | null } {
  if (!periodValid) return { issue: null, inPeriod: null };
  const indices = transactions
    .map((txn, index) => ({ txn, index }))
    .filter(({ txn }) => compareIso(txn.date, period.from) < 0 || compareIso(txn.date, period.to) > 0)
    .map(({ index }) => index);
  if (indices.length === 0) return { issue: null, inPeriod: true };
  return {
    inPeriod: false,
    issue: {
      code: "date_outside_period",
      severity: "warning",
      message: "One or more transactions fall outside the statement period.",
      detail: { indices },
    },
  };
}

function duplicateIssue(transactions: Transaction[]): ValidationIssue | null {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < transactions.length; i++) {
    const txn = transactions[i];
    const key = `${txn.date}|${txn.amount}|${txn.description}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const pairs: number[][] = [];
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    for (let i = 1; i < indices.length; i++) pairs.push([indices[0], indices[i]]);
  }
  if (pairs.length === 0) return null;
  return {
    code: "duplicate_transactions",
    severity: "info",
    message: "Two or more transactions share the same date, amount, and description.",
    detail: { pairs },
  };
}

function skippedIssue(lines: string[]): ValidationIssue | null {
  if (lines.length === 0) return null;
  return {
    code: "unparsed_amount_lines",
    severity: "warning",
    message: "Some lines looked like transactions but could not be parsed.",
    detail: { count: lines.length, samples: lines.slice(0, 5) },
  };
}

function confidenceOf(issues: ValidationIssue[], balanceReconciles: boolean | null): number {
  let confidence = 1;
  for (const issue of issues) {
    if (issue.severity === "error") confidence -= 0.5;
    else if (issue.severity === "warning") confidence -= 0.15;
    else confidence -= 0.02;
  }
  confidence = Math.min(1, Math.max(0, confidence));
  if (balanceReconciles === true) confidence = Math.max(confidence, 0.7);
  return confidence;
}

export function validateStatement(input: ValidateInput): ValidationReport {
  const { summary, transactions, statedTotals, skippedLines } = input;
  const issues: ValidationIssue[] = [];

  if (transactions.length === 0) {
    issues.push({
      code: "no_transactions",
      severity: "error",
      message: "The statement has no parsed transactions.",
    });
  }

  const period = periodIssue(summary.statementPeriod.from, summary.statementPeriod.to);
  if (period) issues.push(period);

  let balanceReconciles: boolean | null = null;
  if (summary.openingBalance !== null && summary.closingBalance !== null) {
    const result = balanceIssue(
      summary.openingBalance,
      summary.closingBalance,
      transactions,
      summary.accountKind
    );
    balanceReconciles = result.reconciles;
    if (result.issue) issues.push(result.issue);
  }

  const totals = totalsIssue(transactions, statedTotals ?? {});
  if (totals.issue) issues.push(totals.issue);

  const dates = dateIssues(transactions, summary.statementPeriod, period === null);
  if (dates.issue) issues.push(dates.issue);

  const duplicates = duplicateIssue(transactions);
  if (duplicates) issues.push(duplicates);

  const skipped = skippedIssue(skippedLines ?? []);
  if (skipped) issues.push(skipped);

  const hasError = issues.some((issue) => issue.severity === "error");
  return {
    ok: !hasError,
    confidence: confidenceOf(issues, balanceReconciles),
    issues,
    checks: {
      balanceReconciles,
      totalsMatch: totals.match,
      datesInPeriod: dates.inPeriod,
    },
  };
}
