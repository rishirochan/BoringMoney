import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { listTransactions } from "../dist-electron/features/documents/store.js";
import { importFile } from "../dist-electron/features/vault/ingest.js";

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "boringmoney-pipeline-"));
}

async function writeStatementPdf(filePath) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const draw = (text, x, y) => page.drawText(text, { x, y, size: 9, font });

  draw("Example Bank Credit Card", 50, 750);
  draw("Statement Period 12/16/2025 - 01/15/2026", 50, 725);
  draw("Date", 50, 685);
  draw("Description", 135, 685);
  draw("Amount", 500, 685);
  [
    ["12/18/2025", "GROCERY MARKET", "$42.17"],
    ["01/05/2026", "ONLINE SERVICE", "$12.99"],
    ["01/14/2026", "PAYMENT RECEIVED", "-$100.00"],
  ].forEach(([date, description, amount], index) => {
    const y = 660 - index * 24;
    draw(date, 50, y);
    draw(description, 135, y);
    draw(amount, 550 - font.widthOfTextAtSize(amount, 9), y);
  });

  await fs.writeFile(filePath, await document.save());
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

test("PDF import extracts rows and runs the generic parser", async () => {
  const source = await tmpDir();
  const vault = await tmpDir();
  const pdfPath = path.join(source, "card-statement.pdf");
  await writeStatementPdf(pdfPath);

  const result = await importFile(vault, pdfPath);
  assert.equal(result.status, "parsed");
  assert.ok(result.transactionCount >= 1);
  assert.ok(
    (await listTransactions(vault)).every(({ documentId }) => documentId === result.documentId)
  );
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
