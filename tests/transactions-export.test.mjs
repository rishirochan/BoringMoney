import assert from "node:assert/strict";
import { test } from "node:test";

import { transactionsToCsv } from "../dist-electron/features/statements/export-csv.js";

const sources = new Map([["doc-1", "chase-jan.pdf"], ["doc-2", "bofa.csv"]]);

test("transactionsToCsv: header and one row", () => {
  const csv = transactionsToCsv(
    [
      {
        documentId: "doc-1",
        date: "2026-01-15",
        description: "COFFEE SHOP",
        amount: -6.75,
        type: "purchase",
        rawLine: "2026-01-15 COFFEE SHOP -6.75",
      },
    ],
    sources
  );
  assert.equal(
    csv,
    [
      "Date,Posted Date,Description,Amount,Type,Reference,Balance,Source",
      "2026-01-15,,COFFEE SHOP,-6.75,purchase,,,chase-jan.pdf",
      "",
    ].join("\n")
  );
});

test("transactionsToCsv: escapes commas, quotes, and newlines", () => {
  const csv = transactionsToCsv(
    [
      {
        documentId: "doc-2",
        date: "2026-01-02",
        postedDate: "2026-01-03",
        description: 'ACME "SUPER" STORE, INC',
        amount: 1234.5,
        type: "payment",
        referenceNumber: "REF12345678",
        balance: 5000,
        rawLine: "raw",
      },
    ],
    sources
  );
  assert.match(csv, /"ACME ""SUPER"" STORE, INC"/);
  assert.match(csv, /2026-01-02,2026-01-03/);
  assert.match(csv, /1234\.50,payment,REF12345678,5000\.00,bofa\.csv/);
});

test("transactionsToCsv: empty list still writes the header", () => {
  assert.equal(transactionsToCsv([], sources), "Date,Posted Date,Description,Amount,Type,Reference,Balance,Source\n");
});
