import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listTransactions, loadParsed } from "../dist-electron/features/documents/store.js";
import { importFile } from "../dist-electron/features/vault/ingest.js";

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "boringmoney-pipeline-"));
}

test("CSV import runs the real pipeline and tags transaction provenance", async () => {
  const source = await tmpDir();
  const vault = await tmpDir();
  const csvPath = path.join(source, "checking.csv");
  await fs.writeFile(
    csvPath,
    [
      "Date,Description,Amount",
      "2026-01-03,Coffee,-4.25",
      "2026-01-02,Paycheck,1200.00",
      "2026-01-01,Rent,-800.00",
    ].join("\n")
  );

  const result = await importFile(vault, csvPath);
  assert.equal(result.status, "parsed");
  assert.equal(result.transactionCount, 3);
  const transactions = await listTransactions(vault);
  assert.equal(transactions.length, 3);
  assert.ok(transactions.every(({ documentId }) => documentId === result.documentId));
});

test("running-balance CSV derives signs and opening balance", async () => {
  const source = await tmpDir();
  const vault = await tmpDir();
  const csvPath = path.join(source, "running.csv");
  await fs.writeFile(
    csvPath,
    [
      "Date,Description,Amount,Balance",
      "2026-01-03,Coffee,-6.75,1243.25",
      "2026-01-05,Payroll,500.00,1743.25",
      "2026-01-08,ATM Withdrawal,100.00,1643.25",
    ].join("\n")
  );

  const result = await importFile(vault, csvPath);
  assert.equal(result.status, "parsed");
  const parsed = await loadParsed(vault, result.documentId);
  assert.deepEqual(parsed.transactions.map((txn) => txn.amount), [-6.75, 500, -100]);
  assert.equal(parsed.summary.openingBalance, 1250);
});

test("PDF imports are disabled", async () => {
  const source = await tmpDir();
  const vault = await tmpDir();
  const pdfPath = path.join(source, "card-statement.pdf");
  await fs.writeFile(pdfPath, "pdf bytes");

  const result = await importFile(vault, pdfPath);
  assert.deepEqual(result, {
    name: "card-statement.pdf",
    ok: false,
    error: "unsupported file type",
  });
  assert.deepEqual(await fs.readdir(vault), []);
});

test("unsupported files stop before extraction", async () => {
  const source = await tmpDir();
  const vault = await tmpDir();
  const textPath = path.join(source, "notes.txt");
  await fs.writeFile(textPath, "not a statement");

  assert.deepEqual(await importFile(vault, textPath), {
    name: "notes.txt",
    ok: false,
    error: "unsupported file type",
  });
  assert.deepEqual(await fs.readdir(vault), []);
});
