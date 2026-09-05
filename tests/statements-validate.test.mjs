import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStatement } from "../dist-electron/features/statements/validate.js";

function txn(overrides) {
  return {
    date: "2026-01-10",
    description: "STARBUCKS",
    amount: -5,
    type: "purchase",
    rawLine: "STARBUCKS -5.00",
    ...overrides,
  };
}

function summary(overrides) {
  return {
    statementPeriod: { from: "2026-01-01", to: "2026-01-31" },
    openingBalance: 1000,
    closingBalance: 1000,
    totalPurchasesFees: 0,
    totalPaymentsCredits: 0,
    accountKind: "credit_card",
    ...overrides,
  };
}

test("validateStatement: reconciling credit card is ok with confidence >= 0.7", () => {
  const transactions = [txn({ amount: -100, type: "purchase" }), txn({ amount: 50, type: "payment", description: "AUTOPAY" })];
  const report = validateStatement({
    summary: summary({
      openingBalance: 1000,
      closingBalance: 1050,
      totalPurchasesFees: 100,
      totalPaymentsCredits: 50,
      accountKind: "credit_card",
    }),
    transactions,
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.balanceReconciles, true);
  assert.equal(report.checks.datesInPeriod, true);
  assert.ok(report.confidence >= 0.7);
  assert.equal(report.issues.length, 0);
});

test("validateStatement: reconciling bank statement", () => {
  const transactions = [txn({ amount: -100 }), txn({ amount: 50, type: "payment", description: "DIRECT DEP" })];
  const report = validateStatement({
    summary: summary({
      openingBalance: 1000,
      closingBalance: 950,
      accountKind: "bank",
    }),
    transactions,
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.balanceReconciles, true);
});

test("validateStatement: balance mismatch is an error", () => {
  const report = validateStatement({
    summary: summary({ openingBalance: 1000, closingBalance: 999, accountKind: "credit_card" }),
    transactions: [txn({ amount: -100 })],
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.balanceReconciles, false);
  const mismatch = report.issues.find((issue) => issue.code === "balance_mismatch");
  assert.ok(mismatch);
  assert.equal(mismatch.severity, "error");
  assert.equal(mismatch.detail.expected, 1100);
  assert.equal(mismatch.detail.actual, 999);
  assert.equal(mismatch.detail.diff, -101);
});

test("validateStatement: unknown accountKind reconciles under the bank formula", () => {
  const report = validateStatement({
    summary: summary({
      openingBalance: 1000,
      closingBalance: 950,
      accountKind: "unknown",
    }),
    transactions: [txn({ amount: -50 })],
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.balanceReconciles, true);
});

test("validateStatement: date outside period is a warning", () => {
  const report = validateStatement({
    summary: summary({
      openingBalance: 1000,
      closingBalance: 1005,
      statementPeriod: { from: "2026-01-01", to: "2026-01-31" },
    }),
    transactions: [txn({ date: "2025-12-20", amount: -5 })],
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.datesInPeriod, false);
  const issue = report.issues.find((row) => row.code === "date_outside_period");
  assert.ok(issue);
  assert.equal(issue.severity, "warning");
  assert.deepEqual(issue.detail.indices, [0]);
});

test("validateStatement: duplicate transactions are info", () => {
  const dup = txn({ date: "2026-01-10", amount: -5, description: "STARBUCKS" });
  const report = validateStatement({
    summary: summary({ openingBalance: 1000, closingBalance: 1010 }),
    transactions: [dup, { ...dup, rawLine: "STARBUCKS again" }],
  });
  assert.equal(report.ok, true);
  const issue = report.issues.find((row) => row.code === "duplicate_transactions");
  assert.ok(issue);
  assert.equal(issue.severity, "info");
  assert.deepEqual(issue.detail.pairs, [[0, 1]]);
});

test("validateStatement: null balances leave balanceReconciles null", () => {
  const report = validateStatement({
    summary: summary({ openingBalance: null, closingBalance: null }),
    transactions: [txn()],
  });
  assert.equal(report.checks.balanceReconciles, null);
  assert.equal(report.ok, true);
  assert.ok(!report.issues.some((issue) => issue.code === "balance_mismatch"));
});

test("validateStatement: no transactions, invalid period, totals, skipped lines, confidence floor", () => {
  const empty = validateStatement({
    summary: summary({
      openingBalance: null,
      closingBalance: null,
      statementPeriod: { from: "2026-02-01", to: "2026-01-01" },
    }),
    transactions: [],
    skippedLines: ["weird $12.00 line", "another", "third", "fourth", "fifth", "sixth"],
  });
  assert.equal(empty.ok, false);
  assert.ok(empty.issues.some((issue) => issue.code === "no_transactions"));
  assert.ok(empty.issues.some((issue) => issue.code === "period_invalid"));
  const skipped = empty.issues.find((issue) => issue.code === "unparsed_amount_lines");
  assert.ok(skipped);
  assert.equal(skipped.detail.count, 6);
  assert.equal(skipped.detail.samples.length, 5);
  assert.equal(empty.checks.datesInPeriod, null);

  const totals = validateStatement({
    summary: summary({ openingBalance: 1000, closingBalance: 1100 }),
    transactions: [txn({ amount: -100 })],
    statedTotals: { purchasesFees: 50, paymentsCredits: 0 },
  });
  assert.equal(totals.checks.totalsMatch, false);
  assert.ok(totals.issues.some((issue) => issue.code === "totals_mismatch" && issue.severity === "warning"));

  const floored = validateStatement({
    summary: summary({ openingBalance: 1000, closingBalance: 1100 }),
    transactions: [txn({ amount: -100 }), txn({ date: "2025-01-01", amount: 0, description: "NOTE" })],
    statedTotals: { purchasesFees: 5 },
    skippedLines: ["x"],
  });
  assert.equal(floored.checks.balanceReconciles, true);
  assert.ok(floored.issues.some((issue) => issue.severity === "warning"));
  assert.ok(floored.confidence >= 0.7);
});
