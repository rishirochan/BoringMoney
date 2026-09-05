import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DATE_TOKEN,
  parseDate,
  inferDateOrder,
  resolveYear,
  findDateRange,
  compareIso,
} from "../dist-electron/features/statements/dates.js";
import { AMOUNT_TOKEN, parseAmount, round2, sum } from "../dist-electron/features/statements/money.js";
import { classifyTransaction, cleanDescription } from "../dist-electron/features/statements/classify.js";

test("parseDate: numeric shapes", () => {
  assert.deepEqual(parseDate("01/15/2026"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("1/15/26"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("01-15-2026"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("2026-01-15"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("2026/01/15"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("15/01/2026", { order: "DMY" }), { iso: "2026-01-15", hadYear: true });
  assert.equal(parseDate("15/01/2026"), null);
  assert.deepEqual(parseDate("01/15", { year: 2026 }), { iso: "2026-01-15", hadYear: false });
  assert.equal(parseDate("01/15"), null);
  assert.deepEqual(parseDate("  01/15/2026  "), { iso: "2026-01-15", hadYear: true });
});

test("parseDate: named-month shapes", () => {
  assert.deepEqual(parseDate("Jan 15, 2026"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("Jan 15 2026"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("15 Jan 2026"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("January 15, 2026"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("Jan 15", { year: 2026 }), { iso: "2026-01-15", hadYear: false });
  assert.equal(parseDate("Jan 15"), null);
  assert.deepEqual(parseDate("15-Jan-2026"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("15 JAN 26"), { iso: "2026-01-15", hadYear: true });
  assert.deepEqual(parseDate("jan 15, 2026"), { iso: "2026-01-15", hadYear: true });
});

test("parseDate: two-digit year pivot and calendar validation", () => {
  assert.deepEqual(parseDate("01/15/69"), { iso: "2069-01-15", hadYear: true });
  assert.deepEqual(parseDate("01/15/70"), { iso: "1970-01-15", hadYear: true });
  assert.deepEqual(parseDate("01/15/00"), { iso: "2000-01-15", hadYear: true });
  assert.deepEqual(parseDate("01/15/99"), { iso: "1999-01-15", hadYear: true });
  assert.equal(parseDate("02/30/2026"), null);
  assert.equal(parseDate("02/29/2025"), null);
  assert.deepEqual(parseDate("02/29/2024"), { iso: "2024-02-29", hadYear: true });
  assert.equal(parseDate("13/01/2026"), null);
  assert.equal(parseDate("not a date"), null);
  assert.equal(parseDate(""), null);
});

test("inferDateOrder: DMY, MDY, YMD, default", () => {
  assert.equal(inferDateOrder(["15/01/2026", "16/01/2026"]), "DMY");
  assert.equal(inferDateOrder(["01/15/2026", "01/16/2026"]), "MDY");
  assert.equal(inferDateOrder(["2026-01-15", "2026-02-20"]), "YMD");
  assert.equal(inferDateOrder(["01/02/2026", "03/04/2026"]), "MDY");
  assert.equal(inferDateOrder(["not a date", "01/15/2026", "garbage"]), "MDY");
  assert.equal(inferDateOrder(["15/01/2026", "01/20/2026"]), "DMY");
  assert.equal(inferDateOrder(["2026-01-15", "01/16/2026"]), "MDY");
});

test("resolveYear: period window and Dec->Jan rollover", () => {
  const period = { from: "2025-12-16", to: "2026-01-15" };
  assert.equal(resolveYear(12, 20, period), "2025-12-20");
  assert.equal(resolveYear(1, 10, period), "2026-01-10");
  assert.equal(resolveYear(12, 16, period), "2025-12-16");
  assert.equal(resolveYear(1, 15, period), "2026-01-15");
  assert.equal(resolveYear(6, 1, period), "2026-06-01");
});

test("findDateRange: four phrasing styles", () => {
  assert.deepEqual(findDateRange("Statement Period: 12/16/2025 - 01/15/2026"), {
    from: "2025-12-16",
    to: "2026-01-15",
  });
  assert.deepEqual(findDateRange("Opening/Closing Date 12/16/25 - 01/15/26"), {
    from: "2025-12-16",
    to: "2026-01-15",
  });
  assert.deepEqual(findDateRange("December 16, 2025 to January 15, 2026"), {
    from: "2025-12-16",
    to: "2026-01-15",
  });
  assert.deepEqual(findDateRange("Billing Period 12/16/25-01/15/26"), {
    from: "2025-12-16",
    to: "2026-01-15",
  });
  assert.equal(findDateRange("no dates here"), null);
  assert.deepEqual(findDateRange("Period 16/12/2025 - 15/01/2026", "DMY"), {
    from: "2025-12-16",
    to: "2026-01-15",
  });
});

test("DATE_TOKEN matches listed shapes at line start", () => {
  const re = new RegExp(`^(${DATE_TOKEN})\\s+`);
  for (const line of [
    "01/15/2026 REST",
    "1/15/26 REST",
    "01-15-2026 REST",
    "2026-01-15 REST",
    "2026/01/15 REST",
    "01/15 REST",
    "Jan 15, 2026 REST",
    "Jan 15 2026 REST",
    "15 Jan 2026 REST",
    "January 15, 2026 REST",
    "Jan 15 REST",
    "15-Jan-2026 REST",
    "15 JAN 26 REST",
  ]) {
    assert.ok(re.test(line), line);
  }
});

test("compareIso orders ISO dates", () => {
  assert.equal(compareIso("2026-01-15", "2026-01-16"), -1);
  assert.equal(compareIso("2026-01-16", "2026-01-15"), 1);
  assert.equal(compareIso("2026-01-15", "2026-01-15"), 0);
});

test("parseAmount: listed shapes", () => {
  assert.deepEqual(parseAmount("1,234.56"), { value: 1234.56, creditMarker: false, raw: "1,234.56" });
  assert.deepEqual(parseAmount("$1,234.56"), { value: 1234.56, creditMarker: false, raw: "$1,234.56" });
  assert.deepEqual(parseAmount("-1,234.56"), { value: -1234.56, creditMarker: false, raw: "-1,234.56" });
  assert.deepEqual(parseAmount("-$1,234.56"), { value: -1234.56, creditMarker: false, raw: "-$1,234.56" });
  assert.deepEqual(parseAmount("$-1,234.56"), { value: -1234.56, creditMarker: false, raw: "$-1,234.56" });
  assert.deepEqual(parseAmount("(1,234.56)"), { value: -1234.56, creditMarker: false, raw: "(1,234.56)" });
  assert.deepEqual(parseAmount("1,234.56-"), { value: -1234.56, creditMarker: false, raw: "1,234.56-" });
  assert.deepEqual(parseAmount("1,234.56 CR"), { value: 1234.56, creditMarker: true, raw: "1,234.56 CR" });
  assert.deepEqual(parseAmount("1,234.56CR"), { value: 1234.56, creditMarker: true, raw: "1,234.56CR" });
  assert.deepEqual(parseAmount("1.234,56", { decimal: "," }), {
    value: 1234.56,
    creditMarker: false,
    raw: "1.234,56",
  });
  assert.deepEqual(parseAmount("$ 1,234.56"), { value: 1234.56, creditMarker: false, raw: "$ 1,234.56" });
  assert.deepEqual(parseAmount("USD 1,234.56"), { value: 1234.56, creditMarker: false, raw: "USD 1,234.56" });
  assert.deepEqual(parseAmount("1234.56"), { value: 1234.56, creditMarker: false, raw: "1234.56" });
  assert.deepEqual(parseAmount(".56"), { value: 0.56, creditMarker: false, raw: ".56" });
  assert.deepEqual(parseAmount("0"), { value: 0, creditMarker: false, raw: "0" });
});

test("parseAmount: rejects non-amounts", () => {
  assert.equal(parseAmount("01/15"), null);
  assert.equal(parseAmount("01-15-2026"), null);
  assert.equal(parseAmount("1234567890123"), null);
  assert.equal(parseAmount("not-money"), null);
  assert.equal(parseAmount("1.234,56"), null);
  assert.ok(parseAmount("123456789012"));
});

test("AMOUNT_TOKEN matches amount tokens", () => {
  const re = new RegExp(`^(${AMOUNT_TOKEN})$`);
  for (const token of ["1,234.56", "$1,234.56", "-$1,234.56", "(1,234.56)", "1,234.56 CR", ".56", "0"]) {
    assert.ok(re.test(token), token);
  }
});

test("round2 and sum avoid float drift", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(sum([0.1, 0.2]), 0.3);
  assert.equal(sum([10.115, -0.005]), 10.11);
});

test("classifyTransaction: priority and account-kind rules", () => {
  assert.equal(classifyTransaction("LATE FEE INTEREST", -12, "credit_card"), "interest");
  assert.equal(classifyTransaction("FINANCE CHARGE", -8.5, "credit_card"), "interest");
  assert.equal(classifyTransaction("INT CHARGE", -3, "bank"), "interest");
  assert.equal(classifyTransaction("INTEREST PAID/EARNED", 1.2, "bank"), "interest");
  assert.equal(classifyTransaction("LATE PAYMENT", -25, "credit_card"), "fee");
  assert.equal(classifyTransaction("ANNUAL MEMBERSHIP FEE", -95, "credit_card"), "fee");
  assert.equal(classifyTransaction("OVERDRAFT", -35, "bank"), "fee");
  assert.equal(classifyTransaction("PAYMENT - THANK YOU", 200, "credit_card"), "payment");
  assert.equal(classifyTransaction("AUTOPAY", 150, "credit_card"), "payment");
  assert.equal(classifyTransaction("TRANSFER", -80, "bank"), "payment");
  assert.equal(classifyTransaction("REFUND AMAZON", 12.4, "credit_card"), "refund");
  assert.equal(classifyTransaction("STARBUCKS #1234", 4.5, "credit_card"), "refund");
  assert.equal(classifyTransaction("STARBUCKS", -4.5, "credit_card"), "purchase");
  assert.equal(classifyTransaction("STARBUCKS", -4.5, "bank"), "purchase");
  assert.equal(classifyTransaction("DIRECT DEP PAYROLL", 2400, "bank"), "payment");
  assert.equal(classifyTransaction("VENMO CASHOUT", 40, "bank"), "payment");
});

test("classifyTransaction: PAYPAL depends on account kind and sign", () => {
  assert.equal(classifyTransaction("PAYPAL *STORE", -32.1, "credit_card"), "purchase");
  assert.equal(classifyTransaction("PAYPAL", 32.1, "credit_card"), "payment");
  assert.equal(classifyTransaction("PAYPAL", -32.1, "bank"), "payment");
  assert.equal(classifyTransaction("PAYPAL", 32.1, "bank"), "payment");
});

test("cleanDescription: collapse whitespace and strip trailing refs", () => {
  assert.equal(cleanDescription("  AMAZON.COM   AMZN.COM/BILL  "), "AMAZON.COM AMZN.COM/BILL");
  assert.equal(cleanDescription("STARBUCKS STORE #1234567"), "STARBUCKS STORE");
  assert.equal(cleanDescription("UBER TRIP 123456789012"), "UBER TRIP");
  assert.equal(cleanDescription("Keep Case As Printed"), "Keep Case As Printed");
});
