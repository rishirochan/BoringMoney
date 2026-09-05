import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { extractCsvText } from "../dist-electron/features/statements/extract/csv.js";
import { parseCsvStatement } from "../dist-electron/features/statements/parsers/csv.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/csv", import.meta.url));

function load(name) {
  return extractCsvText(readFileSync(path.join(FIXTURES, name), "utf8"));
}

function parse(name, fileName = name) {
  return parseCsvStatement(load(name), { fileName });
}

function byDesc(parsed, needle) {
  return parsed.transactions.find((txn) => txn.description.includes(needle));
}

function assertChronological(parsed) {
  const dates = parsed.transactions.map((txn) => txn.date);
  assert.deepEqual(dates, [...dates].sort());
}

function assertFlip(parsed) {
  const issue = parsed.validation.issues.find((row) => row.code === "sign_convention_inferred");
  assert.ok(issue);
  assert.equal(issue.severity, "info");
  assert.ok(byDesc(parsed, "AMAZON").amount < 0);
  assert.ok(byDesc(parsed, "STARBUCKS").amount < 0);
  assert.ok(byDesc(parsed, "PAYMENT").amount > 0);
}

test("Chase card: institution, posted dates, memo, already-negative purchases", () => {
  const parsed = parse("chase-card.csv");
  assert.equal(parsed.parser, "csv-generic");
  assert.equal(parsed.summary.institution, "Chase");
  assert.equal(parsed.summary.accountKind, "credit_card");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assert.equal(parsed.validation.ok, true);
  assert.ok(!parsed.validation.issues.some((issue) => issue.code === "sign_convention_inferred"));

  const amazon = byDesc(parsed, "AMAZON");
  assert.deepEqual(
    { date: amazon.date, amount: amazon.amount, type: amazon.type, postedDate: amazon.postedDate },
    { date: "2025-12-20", amount: -42.13, type: "purchase", postedDate: "2025-12-21" }
  );
  assert.equal(amazon.description, "AMAZON.COM AMZN");

  const payment = byDesc(parsed, "PAYMENT THANK YOU");
  assert.deepEqual(
    { date: payment.date, amount: payment.amount, type: payment.type, postedDate: payment.postedDate },
    { date: "2026-01-10", amount: 150, type: "payment", postedDate: "2026-01-11" }
  );

  const starbucks = byDesc(parsed, "STARBUCKS");
  assert.equal(starbucks.date, "2026-01-15");
  assert.equal(starbucks.amount, -6.75);
  assert.equal(starbucks.type, "purchase");
  assert.equal(starbucks.description, "STARBUCKS Coffee");
  assert.equal(starbucks.postedDate, "2026-01-16");
});

test("Chase checking: newest-first sort, balances reconcile, check number", () => {
  const parsed = parse("chase-checking.csv");
  assert.equal(parsed.summary.institution, "Chase");
  assert.equal(parsed.summary.accountKind, "bank");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assert.equal(parsed.summary.openingBalance, 1000);
  assert.equal(parsed.summary.closingBalance, 3453.25);
  assert.equal(parsed.validation.checks.balanceReconciles, true);
  assert.equal(parsed.validation.ok, true);

  const payroll = byDesc(parsed, "PAYROLL");
  assert.deepEqual(
    { date: payroll.date, amount: payroll.amount, type: payroll.type, balance: payroll.balance },
    { date: "2026-01-15", amount: 2500, type: "payment", balance: 3500 }
  );

  const starbucks = byDesc(parsed, "STARBUCKS");
  assert.equal(starbucks.date, "2026-01-18");
  assert.equal(starbucks.amount, -6.75);
  assert.equal(starbucks.type, "purchase");
  assert.equal(starbucks.balance, 3493.25);

  const atm = byDesc(parsed, "ATM");
  assert.equal(atm.date, "2026-01-20");
  assert.equal(atm.amount, -40);
  assert.equal(atm.referenceNumber, "1022");
  assert.equal(atm.balance, 3453.25);
});

test("American Express: charges-positive flip and last4 from preamble", () => {
  const parsed = parse("amex.csv");
  assert.equal(parsed.summary.institution, "American Express");
  assert.equal(parsed.summary.accountKind, "credit_card");
  assert.equal(parsed.summary.accountLast4, "1001");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assertFlip(parsed);
  assert.equal(byDesc(parsed, "AMAZON").amount, -42.13);
  assert.equal(byDesc(parsed, "AMAZON").type, "purchase");
  assert.equal(byDesc(parsed, "PAYMENT").amount, 150);
  assert.equal(byDesc(parsed, "PAYMENT").type, "payment");
  assert.equal(byDesc(parsed, "STARBUCKS").amount, -6.75);
});

test("Bank of America: preamble opening balance and running bal reconcile", () => {
  const parsed = parse("bofa.csv");
  assert.equal(parsed.summary.institution, "Bank of America");
  assert.equal(parsed.summary.accountKind, "bank");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assert.equal(parsed.summary.openingBalance, 1000);
  assert.equal(parsed.summary.closingBalance, 2953.25);
  assert.equal(parsed.validation.checks.balanceReconciles, true);

  const grocery = byDesc(parsed, "GROCERY");
  assert.deepEqual(
    { date: grocery.date, amount: grocery.amount, type: grocery.type, balance: grocery.balance },
    { date: "2025-12-18", amount: -42.17, type: "purchase", balance: 957.83 }
  );
  assert.equal(byDesc(parsed, "ONLINE SERVICE").amount, -4.58);
  assert.equal(byDesc(parsed, "PAYROLL").amount, 2000);
  assert.equal(byDesc(parsed, "PAYROLL").type, "payment");
});

test("Capital One: debit/credit pair and posted dates", () => {
  const parsed = parse("capital-one.csv");
  assert.equal(parsed.summary.institution, "Capital One");
  assert.equal(parsed.summary.accountKind, "credit_card");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assert.ok(!parsed.validation.issues.some((issue) => issue.code === "sign_convention_inferred"));

  const amazon = byDesc(parsed, "AMAZON");
  assert.deepEqual(
    { date: amazon.date, amount: amazon.amount, type: amazon.type, postedDate: amazon.postedDate },
    { date: "2026-01-08", amount: -42.13, type: "purchase", postedDate: "2026-01-09" }
  );
  assert.equal(byDesc(parsed, "PAYMENT").amount, 150);
  assert.equal(byDesc(parsed, "PAYMENT").type, "payment");
  assert.equal(byDesc(parsed, "STARBUCKS").amount, -6.75);
  assert.equal(byDesc(parsed, "STARBUCKS").postedDate, "2026-01-16");
});

test("Discover: charges-positive flip", () => {
  const parsed = parse("discover.csv");
  assert.equal(parsed.summary.institution, "Discover");
  assert.equal(parsed.summary.accountKind, "credit_card");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assertFlip(parsed);
  assert.equal(byDesc(parsed, "AMAZON").postedDate, "2026-01-06");
  assert.equal(byDesc(parsed, "PAYMENT").type, "payment");
  assert.equal(byDesc(parsed, "STARBUCKS").amount, -6.75);
});

test("Citi: pending rows skipped, debit/credit magnitudes", () => {
  const parsed = parse("citi.csv");
  assert.equal(parsed.summary.institution, "Citi");
  assert.equal(parsed.summary.accountKind, "credit_card");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assert.ok(!parsed.transactions.some((txn) => /pending/i.test(txn.description)));
  assert.ok(parsed.validation.issues.some((issue) => issue.code === "unparsed_amount_lines"));
  assert.ok(parsed.validation.issues.find((issue) => issue.code === "unparsed_amount_lines").detail.samples.some((line) => /PENDING MERCHANT/.test(line)));

  assert.equal(byDesc(parsed, "AMAZON").amount, -42.13);
  assert.equal(byDesc(parsed, "AUTOPAY").amount, 150);
  assert.equal(byDesc(parsed, "AUTOPAY").type, "payment");
  assert.equal(byDesc(parsed, "STARBUCKS").amount, -6.75);
  assert.equal(byDesc(parsed, "STARBUCKS").date, "2026-01-15");
});

test("Wells Fargo: headerless 5-column layout", () => {
  const parsed = parse("wells-fargo.csv");
  assert.equal(parsed.summary.institution, "Wells Fargo");
  assert.equal(parsed.summary.accountKind, "unknown");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);

  const amazon = byDesc(parsed, "AMAZON");
  assert.equal(amazon.date, "2026-01-08");
  assert.equal(amazon.amount, -42.13);
  assert.equal(amazon.type, "purchase");

  const payroll = byDesc(parsed, "PAYROLL");
  assert.equal(payroll.date, "2026-01-10");
  assert.equal(payroll.amount, 150);
  assert.equal(payroll.type, "purchase");

  const starbucks = byDesc(parsed, "STARBUCKS");
  assert.equal(starbucks.date, "2026-01-15");
  assert.equal(starbucks.amount, -6.75);
  assert.equal(starbucks.description, "STARBUCKS STORE 12345");
});

test("Apple Card: purchase-positive flip and type hint Payment", () => {
  const parsed = parse("apple-card.csv");
  assert.equal(parsed.summary.institution, "Apple Card");
  assert.equal(parsed.summary.accountKind, "credit_card");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assertFlip(parsed);
  assert.equal(byDesc(parsed, "AMAZON").postedDate, "2026-01-06");
  assert.equal(byDesc(parsed, "PAYMENT").type, "payment");
  assert.equal(byDesc(parsed, "STARBUCKS").type, "purchase");
});

test("generic bank: newest-first resort, totals skipped, balances reconcile", () => {
  const parsed = parse("generic-bank.csv");
  assert.equal(parsed.summary.institution, undefined);
  assert.equal(parsed.summary.accountKind, "bank");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assert.ok(!parsed.transactions.some((txn) => /^totals?$/i.test(txn.description)));
  assert.equal(parsed.summary.openingBalance, 1000);
  assert.equal(parsed.summary.closingBalance, 2910);
  assert.equal(parsed.validation.checks.balanceReconciles, true);

  const atm = byDesc(parsed, "ATM");
  assert.deepEqual(
    { date: atm.date, amount: atm.amount, type: atm.type, balance: atm.balance },
    { date: "2026-01-15", amount: -40, type: "purchase", balance: 960 }
  );
  assert.equal(byDesc(parsed, "GROCERY").amount, -50);
  assert.equal(byDesc(parsed, "GROCERY").date, "2026-01-18");
  assert.equal(byDesc(parsed, "PAYROLL").amount, 2000);
  assert.equal(byDesc(parsed, "PAYROLL").type, "payment");
  assert.deepEqual(
    parsed.transactions.map((txn) => txn.date),
    ["2026-01-15", "2026-01-18", "2026-01-20"]
  );
});

test("UK export: DMY from 25/12/2025 and paid out/in columns", () => {
  const parsed = parse("uk-dmy.csv");
  assert.equal(parsed.summary.accountKind, "bank");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assert.equal(parsed.summary.openingBalance, 1000);
  assert.equal(parsed.summary.closingBalance, 2462.7);
  assert.equal(parsed.validation.checks.balanceReconciles, true);

  const tesco = byDesc(parsed, "TESCO");
  assert.equal(tesco.date, "2025-12-25");
  assert.equal(tesco.amount, -32.5);
  assert.equal(tesco.type, "purchase");

  const tfl = byDesc(parsed, "TRANSPORT");
  assert.equal(tfl.date, "2026-01-05");
  assert.equal(tfl.amount, -4.8);

  const salary = byDesc(parsed, "SALARY");
  assert.equal(salary.date, "2026-01-10");
  assert.equal(salary.amount, 1500);
  assert.equal(salary.type, "payment");
});

test("European semicolon export: comma decimals and 1.234,56", () => {
  const parsed = parse("european-semicolon.csv");
  assert.equal(parsed.summary.accountKind, "bank");
  assert.equal(parsed.transactions.length, 3);
  assertChronological(parsed);
  assert.equal(parsed.summary.openingBalance, 1000);
  assert.equal(parsed.summary.closingBalance, 2177.36);
  assert.equal(parsed.validation.checks.balanceReconciles, true);

  const market = byDesc(parsed, "SUPERMARKT");
  assert.equal(market.date, "2026-01-15");
  assert.equal(market.amount, -45.2);
  assert.equal(byDesc(parsed, "BAECKER").amount, -12);
  assert.equal(byDesc(parsed, "BAECKER").date, "2026-01-18");
  const salary = byDesc(parsed, "GEHALT");
  assert.equal(salary.date, "2026-01-20");
  assert.equal(salary.amount, 1234.56);
  assert.equal(salary.type, "payment");
});

test("newest-first export keeps same-day rows in file order for balance signs", () => {
  const parsed = parseCsvStatement(
    extractCsvText(
      [
        "Account Number: 1234 5678 9012 3456",
        "Date,Description,Amount,Balance",
        "01/20/2026,COFFEE SHOP,5.00,995.00",
        "01/20/2026,DIRECT DEPOSIT,100.00,1000.00",
        "01/19/2026,MONTHLY FEE,10.00,900.00",
      ].join("\n"),
    ),
    { fileName: "checking.csv" },
  );
  assert.equal(parsed.summary.accountLast4, "3456");
  assert.deepEqual(
    parsed.transactions.map((txn) => [txn.description, txn.amount]),
    [["MONTHLY FEE", 10], ["DIRECT DEPOSIT", 100], ["COFFEE SHOP", -5]],
  );
  assert.equal(parsed.summary.closingBalance, 995);
  assert.equal(parsed.validation.checks.balanceReconciles, true);
});

test("preamble-only file: zero transactions, no throw, ok false", () => {
  const parsed = parse("preamble-only.csv");
  assert.equal(parsed.parser, "csv-generic");
  assert.equal(parsed.transactions.length, 0);
  assert.equal(parsed.validation.ok, false);
  assert.ok(parsed.validation.issues.some((issue) => issue.code === "no_transactions"));
  assert.equal(parsed.summary.accountLast4, "4291");
  assert.deepEqual(parsed.summary.statementPeriod, { from: "2025-12-16", to: "2026-01-15" });
});
