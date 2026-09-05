import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { extractPdf } from "../dist-electron/features/statements/extract/pdf.js";
import { parsePdfStatement } from "../dist-electron/features/statements/parsers/pdf.js";

const FIXTURE_DIR = new URL("./fixtures/pdf/", import.meta.url);

async function loadFixture(name) {
  const text = await fs.readFile(new URL(name, FIXTURE_DIR), "utf8");
  const pages = text.trim().split(/\r?\n---page---\r?\n/).map((page) => page.split(/\r?\n/));
  return { kind: "pdf", pages, hasText: true };
}

async function parseFixture(name) {
  return parsePdfStatement(await loadFixture(name), { fileName: name });
}

function assertReconciled(result, expected) {
  assert.equal(result.parser, "pdf-generic");
  assert.equal(result.summary.accountKind, expected.accountKind);
  assert.equal(result.summary.institution, expected.institution);
  assert.deepEqual(result.summary.statementPeriod, expected.period);
  assert.equal(result.summary.openingBalance, expected.openingBalance);
  assert.equal(result.summary.closingBalance, expected.closingBalance);
  assert.equal(result.transactions.length, expected.transactionCount);
  assert.equal(result.validation.ok, true);
  assert.equal(result.validation.checks.balanceReconciles, true);
  assert.ok(result.validation.confidence >= 0.7);
}

function transaction(result, description) {
  const found = result.transactions.find((candidate) => candidate.description === description);
  assert.ok(found, `Missing transaction: ${description}`);
  return found;
}

test("parses a Chase statement across a year boundary and page break", async () => {
  const result = await parseFixture("chase-credit-card.txt");
  assertReconciled(result, {
    accountKind: "credit_card",
    institution: "Chase",
    period: { from: "2025-12-16", to: "2026-01-15" },
    openingBalance: 500,
    closingBalance: 205,
    transactionCount: 6,
  });

  assert.equal(result.summary.accountLast4, "4242");
  assert.equal(result.summary.totalPurchasesFees, 205);
  assert.equal(result.summary.totalPaymentsCredits, 500);
  assert.equal(result.summary.minimumPaymentDue, 25);
  assert.equal(result.summary.paymentDueDate, "2026-02-10");
  assert.deepEqual(transaction(result, "AUTOMATIC PAYMENT - THANK YOU"), {
    date: "2025-12-20",
    description: "AUTOMATIC PAYMENT - THANK YOU",
    amount: 500,
    type: "payment",
    rawLine: "12/20  AUTOMATIC PAYMENT - THANK YOU  -500.00",
  });
  assert.equal(transaction(result, "AMAZON.COM*2K4LP8 AMZN.COM/BILL WA").amount, -54.32);
  assert.equal(transaction(result, "YEAR END CAFE PORTLAND OR").date, "2025-12-31");
});

test("parses American Express continuations and separate statement dates", async () => {
  const result = await parseFixture("american-express.txt");
  assertReconciled(result, {
    accountKind: "credit_card",
    institution: "American Express",
    period: { from: "2025-12-16", to: "2026-01-15" },
    openingBalance: 1200,
    closingBalance: 115,
    transactionCount: 5,
  });

  const uber = transaction(result, "UBER TRIP HELP.UBER.COM");
  assert.equal(uber.date, "2025-12-21");
  assert.equal(uber.amount, -23.1);
  assert.equal(uber.type, "purchase");
  assert.equal(uber.referenceNumber, "320260050123456789");
  assert.match(uber.rawLine, /\nReference: 320260050123456789$/);
  assert.equal(transaction(result, "PAYMENT RECEIVED - THANK YOU").amount, 1200);
  assert.equal(transaction(result, "INTEREST CHARGED").type, "interest");
  assert.equal(result.summary.paymentDueDate, "2026-02-09");
});

test("parses Bank of America checking sections and references", async () => {
  const result = await parseFixture("bank-of-america-checking.txt");
  assertReconciled(result, {
    accountKind: "bank",
    institution: "Bank of America",
    period: { from: "2025-12-16", to: "2026-01-15" },
    openingBalance: 1000,
    closingBalance: 1270,
    transactionCount: 6,
  });

  assert.equal(result.summary.totalPurchasesFees, 280);
  assert.equal(result.summary.totalPaymentsCredits, 550);
  const zelle = transaction(result, "Zelle payment from JOHN DOE");
  assert.equal(zelle.date, "2025-12-28");
  assert.equal(zelle.amount, 250);
  assert.equal(zelle.type, "payment");
  assert.equal(zelle.referenceNumber, "abc12345");
  const withdrawal = transaction(result, "ONLINE BILL PAYMENT POWER COMPANY");
  assert.equal(withdrawal.date, "2025-12-22");
  assert.equal(withdrawal.amount, -120);
  assert.equal(withdrawal.type, "purchase");
  assert.equal(transaction(result, "MONTHLY MAINTENANCE FEE").type, "fee");
});

test("derives Wells Fargo transaction signs from running balances", async () => {
  const result = await parseFixture("wells-fargo-running-balance.txt");
  assertReconciled(result, {
    accountKind: "bank",
    institution: "Wells Fargo",
    period: { from: "2025-12-16", to: "2026-01-15" },
    openingBalance: 1250,
    closingBalance: 1643.25,
    transactionCount: 3,
  });

  const coffee = transaction(result, "Purchase authorized on 01/01 Starbucks Store 12345 Seattle WA");
  assert.equal(coffee.date, "2026-01-03");
  assert.equal(coffee.amount, -6.75);
  assert.equal(coffee.balance, 1243.25);
  assert.equal(coffee.referenceNumber, "S123456789");
  const deposit = transaction(result, "Direct deposit EMPLOYER PAYROLL");
  assert.equal(deposit.date, "2026-01-05");
  assert.equal(deposit.amount, 500);
  assert.equal(deposit.type, "payment");
});

test("normalizes credit-card CR and parenthesized credits", async () => {
  const result = await parseFixture("credit-markers.txt");
  assertReconciled(result, {
    accountKind: "credit_card",
    institution: "Capital One",
    period: { from: "2025-12-16", to: "2026-01-15" },
    openingBalance: 400,
    closingBalance: 200,
    transactionCount: 3,
  });

  const returned = transaction(result, "RETURN TARGET");
  assert.equal(returned.amount, 25);
  assert.equal(returned.type, "refund");
  assert.equal(returned.referenceNumber, "00012345");
  assert.equal(transaction(result, "PAYMENT RECEIVED").amount, 300);
  assert.equal(transaction(result, "OFFICE SUPPLY STORE").amount, -125);
});

test("reports stated totals that differ from parsed rows", async () => {
  const result = await parseFixture("totals-mismatch.txt");
  assertReconciled(result, {
    accountKind: "credit_card",
    institution: "Citi",
    period: { from: "2026-03-01", to: "2026-03-31" },
    openingBalance: 100,
    closingBalance: 140,
    transactionCount: 3,
  });

  assert.equal(result.validation.checks.totalsMatch, false);
  assert.equal(result.validation.issues.find((issue) => issue.code === "totals_mismatch")?.severity, "warning");
  assert.equal(result.summary.totalPurchasesFees, 60.5);
  const bookStore = transaction(result, "BOOK STORE");
  assert.equal(bookStore.date, "2026-03-10");
  assert.equal(bookStore.amount, -35);
  assert.equal(bookStore.type, "purchase");
});

test("returns no-transactions validation for a scanned PDF", () => {
  const result = parsePdfStatement({ kind: "pdf", pages: [[]], hasText: false });

  assert.equal(result.transactions.length, 0);
  assert.equal(result.validation.ok, false);
  assert.equal(result.validation.checks.balanceReconciles, null);
  assert.ok(result.validation.issues.some((issue) => issue.code === "no_transactions"));
});

test("uses balance reconciliation to correct weak default signs", () => {
  const result = parsePdfStatement({
    kind: "pdf",
    hasText: true,
    pages: [[
      "EXAMPLE CREDIT CARD CHECKING",
      "Statement Period 01/01/26 - 01/31/26",
      "Previous Balance  $100.00",
      "Closing Balance  $50.00",
      "01/10/26  MERCHANT ADJUSTMENT  50.00",
    ]],
  });

  assert.equal(result.summary.accountKind, "credit_card");
  assert.equal(result.transactions[0].amount, 50);
  assert.equal(result.validation.checks.balanceReconciles, true);
  assert.ok(result.validation.issues.some((issue) => issue.code === "sign_convention_inferred"));
});

async function createRoundTripPdf(filePath) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const size = 9;
  const draw = (text, x, y) => page.drawText(text, { x, y, size, font });
  const drawPair = (label, value, y) => {
    draw(label, 50, y);
    draw(value, 550 - font.widthOfTextAtSize(value, size), y);
  };
  const drawTransaction = (date, description, amount, y) => {
    draw(date, 50, y);
    draw(description, 125, y);
    draw(amount, 550 - font.widthOfTextAtSize(amount, size), y);
  };

  draw("Example Credit Card", 50, 750);
  draw("Statement Period 12/16/2025 - 01/15/2026", 50, 730);
  drawPair("Previous Balance", "$100.00", 705);
  drawPair("Payments and Credits", "$50.00", 688);
  drawPair("Purchases", "$42.17", 671);
  drawPair("Fees Charged", "$0.00", 654);
  drawPair("Interest Charged", "$0.00", 637);
  drawPair("New Balance", "$92.17", 620);
  drawPair("Minimum Payment Due", "$25.00", 603);
  draw("PURCHASES", 50, 570);
  drawTransaction("12/31/2025", "YEAR END CAFE", "$42.17", 550);
  draw("TOTAL PURCHASES", 50, 530);
  draw("PAYMENTS AND CREDITS", 50, 500);
  drawTransaction("01/14/2026", "PAYMENT RECEIVED", "-$50.00", 480);

  await fs.writeFile(filePath, await document.save());
}

test("round-trips generated PDF text through extraction and parsing", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "boringmoney-parse-pdf-"));
  const filePath = path.join(directory, "statement.pdf");
  try {
    await createRoundTripPdf(filePath);
    const extracted = await extractPdf(filePath);
    const result = parsePdfStatement(extracted, { fileName: filePath });

    assert.equal(extracted.hasText, true);
    assert.equal(result.summary.accountKind, "credit_card");
    assert.deepEqual(result.summary.statementPeriod, { from: "2025-12-16", to: "2026-01-15" });
    assert.equal(result.transactions.length, 2);
    assert.equal(transaction(result, "YEAR END CAFE").amount, -42.17);
    assert.equal(transaction(result, "PAYMENT RECEIVED").amount, 50);
    assert.equal(result.validation.ok, true);
    assert.equal(result.validation.checks.balanceReconciles, true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
