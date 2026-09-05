import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import {
  extractCsv,
  extractCsvText,
  extractDocument,
  extractPdf,
  extractPdfBuffer,
} from "../dist-electron/features/statements/extract/index.js";

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "boringmoney-extract-"));
}

async function savePdf(document, filePath) {
  const bytes = await document.save();
  await fs.writeFile(filePath, bytes);
  return bytes;
}

async function createStatementPdf(filePath) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([612, 792]);
  const size = 9;
  const draw = (text, x, y) => page.drawText(text, { x, y, size, font });

  draw("Example Bank Credit Card", 50, 750);
  draw("Statement", 50, 725);
  draw(" Period 12/16/2025 - 01/15/2026", 50 + font.widthOfTextAtSize("Statement", size) + 0.5, 725);
  draw("Date", 50, 685);
  draw("Description", 110, 685);
  draw("Amount", 500, 685);

  const transactions = [
    ["12/18/2025", "GROCERY MARKET", "$42.17"],
    ["12/22/2025", "CITY TRANSIT", "$5.00"],
    ["12/31/2025", "YEAR END CAFE", "$18.45"],
    ["01/05/2026", "ONLINE SERVICE", "$12.99"],
    ["01/14/2026", "PAYMENT RECEIVED", "-$100.00"],
  ];
  transactions.forEach(([date, description, amount], index) => {
    const y = 660 - index * 24;
    draw(date, 50, y);
    draw(description, 110, y);
    draw(amount, 550 - font.widthOfTextAtSize(amount, size), y + (index === 2 ? 1 : 0));
  });
  return { bytes: await savePdf(document, filePath), transactions };
}

test("PDF reconstructs statement rows and preserves column gaps", async () => {
  const dir = await tmpDir();
  const filePath = path.join(dir, "statement.pdf");
  const { transactions } = await createStatementPdf(filePath);
  const extracted = await extractPdf(filePath);

  assert.equal(extracted.kind, "pdf");
  assert.equal(extracted.hasText, true);
  assert.equal(extracted.pages.length, 1);
  const lines = extracted.pages[0];
  const transactionLines = lines.filter((line) => /^\d{2}\/\d{2}\/\d{4}/.test(line));
  assert.equal(transactionLines.length, transactions.length);
  transactions.forEach(([date, description, amount], index) => {
    assert.match(transactionLines[index], new RegExp(`^${date}\\s{2,}${description}\\s{2,}${amount.replace("$", "\\$")}$`));
  });
  assert.deepEqual(transactionLines.map((line) => line.slice(0, 10)), transactions.map(([date]) => date));
});

test("PDF joins adjacent text runs with at most one space", async () => {
  const dir = await tmpDir();
  const filePath = path.join(dir, "adjacent.pdf");
  await createStatementPdf(filePath);
  const extracted = await extractPdf(filePath);
  const periodLine = extracted.pages[0].find((line) => line.startsWith("Statement"));

  assert.equal(periodLine, "Statement Period 12/16/2025 - 01/15/2026");
});

test("PDF groups fragments with slightly jittered y coordinates", async () => {
  const dir = await tmpDir();
  const filePath = path.join(dir, "jitter.pdf");
  await createStatementPdf(filePath);
  const extracted = await extractPdf(filePath);
  const line = extracted.pages[0].find((candidate) => candidate.startsWith("12/31/2025"));

  assert.match(line ?? "", /^12\/31\/2025\s{2,}YEAR END CAFE\s{2,}\$18\.45$/);
});

test("PDF preserves page order", async () => {
  const dir = await tmpDir();
  const filePath = path.join(dir, "two-pages.pdf");
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage().drawText("First page text", { x: 50, y: 700, font });
  document.addPage().drawText("Second page text", { x: 50, y: 700, font });
  const bytes = await savePdf(document, filePath);

  const extracted = await extractPdfBuffer(new Uint8Array(bytes));
  assert.equal(extracted.pages.length, 2);
  assert.deepEqual(extracted.pages, [["First page text"], ["Second page text"]]);
});

test("PDF with graphics only reports no text", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage();
  page.drawRectangle({ x: 50, y: 50, width: 100, height: 100, color: rgb(0, 0, 0) });
  const extracted = await extractPdfBuffer(new Uint8Array(await document.save()));

  assert.deepEqual(extracted, { kind: "pdf", pages: [[]], hasText: false });
});

test("invalid PDF gets a readable error", async () => {
  const dir = await tmpDir();
  const filePath = path.join(dir, "garbage.pdf");
  await fs.writeFile(filePath, "not a pdf");

  await assert.rejects(extractPdf(filePath), (error) => error instanceof Error && /pdf/i.test(error.message));
});

test("CSV parses BOM, CRLF, quoted commas, escapes, and embedded newlines", () => {
  const extracted = extractCsvText(
    "\uFEFFDate,Description,Note\r\n" +
    "2026-01-01,\"Coffee, Inc.\",\"He said \"\"hello\"\"\"\r\n" +
    "2026-01-02,\"Two\r\nLines\",Done\r\n",
  );

  assert.equal(extracted.delimiter, ",");
  assert.deepEqual(extracted.rows, [
    ["Date", "Description", "Note"],
    ["2026-01-01", "Coffee, Inc.", "He said \"hello\""],
    ["2026-01-02", "Two\r\nLines", "Done"],
  ]);
});

test("CSV sniffs semicolon delimiter", () => {
  const extracted = extractCsvText("Date;Description;Amount\n2026-01-01;Café;12.50");
  assert.equal(extracted.delimiter, ";");
  assert.deepEqual(extracted.rows[1], ["2026-01-01", "Café", "12.50"]);
});

test("CSV sniffs tab delimiter", () => {
  const extracted = extractCsvText("Date\tDescription\tAmount\n2026-01-01\tTrain\t4.25");
  assert.equal(extracted.delimiter, "\t");
  assert.deepEqual(extracted.rows[1], ["2026-01-01", "Train", "4.25"]);
});

test("CSV drops blank rows but keeps preamble rows", () => {
  const extracted = extractCsvText(
    "Account Number: ****1234\n\nDate,Description,Amount\n2026-01-01,Market,10.00\n,  ,\n",
  );
  assert.deepEqual(extracted.rows, [
    ["Account Number: ****1234"],
    ["Date", "Description", "Amount"],
    ["2026-01-01", "Market", "10.00"],
  ]);
});

test("CSV tolerates sloppy bank exports instead of failing the import", () => {
  // stray quote inside an unquoted field
  assert.deepEqual(extractCsvText('2026-01-01,5" PIPE FITTING,10.00\n').rows, [
    ["2026-01-01", '5" PIPE FITTING', "10.00"],
  ]);
  // text after a closing quote is kept
  assert.deepEqual(extractCsvText('2026-01-01,"ACME" CORP,10.00\n').rows, [
    ["2026-01-01", "ACME CORP", "10.00"],
  ]);
  // bare carriage returns (classic Mac) end rows
  assert.deepEqual(extractCsvText("a,b\r1,2\r3,4").rows, [
    ["a", "b"],
    ["1", "2"],
    ["3", "4"],
  ]);
  // unterminated quote keeps what was read
  assert.deepEqual(extractCsvText('2026-01-01,"Unfinished,10.00').rows, [
    ["2026-01-01", "Unfinished,10.00"],
  ]);
});

test("CSV file falls back to latin1 for invalid UTF-8", async () => {
  const dir = await tmpDir();
  const filePath = path.join(dir, "latin1.csv");
  await fs.writeFile(filePath, Buffer.from("Name,Description\n1,Caf\xe9", "latin1"));

  const extracted = await extractCsv(filePath);
  assert.equal(extracted.rows[1][1], "Café");
});

test("extractDocument dispatches case-insensitive PDF and CSV extensions", async () => {
  const dir = await tmpDir();
  const csvPath = path.join(dir, "statement.CSV");
  const pdfPath = path.join(dir, "statement.PDF");
  await fs.writeFile(csvPath, "Date,Amount\n2026-01-01,1.00");
  await createStatementPdf(pdfPath);

  assert.equal((await extractDocument(csvPath)).kind, "csv");
  assert.equal((await extractDocument(pdfPath)).kind, "pdf");
});

test("extractDocument rejects unsupported extensions", async () => {
  await assert.rejects(extractDocument("statement.txt"), { message: "unsupported file type" });
});
