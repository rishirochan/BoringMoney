import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  STORE_DIR,
  findDuplicate,
  findOrphans,
  getDocument,
  hashFile,
  listDocuments,
  listTransactions,
  loadParsed,
  newDocumentId,
  removeDocument,
  saveDocument,
} from "../dist-electron/features/documents/store.js";

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "boringmoney-documents-"));
}

function uuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function documentRecord(index, overrides = {}) {
  return {
    id: uuid(index),
    fileName: `statement-${index}.pdf`,
    sha256: `sha-${index}`,
    size: 100 + index,
    importedAt: 1_700_000_000_000 + index,
    status: "failed",
    error: "not parsed yet",
    transactionCount: 0,
    ...overrides,
  };
}

function parsedStatement(transactions = []) {
  return {
    summary: {
      statementPeriod: { from: "2026-01-01", to: "2026-01-31" },
      openingBalance: null,
      closingBalance: null,
      totalPurchasesFees: 0,
      totalPaymentsCredits: 0,
      accountKind: "credit_card",
      institution: "Test Bank",
      accountLast4: "1234",
    },
    transactions,
    validation: {
      ok: true,
      confidence: 0.95,
      issues: [],
      checks: {
        balanceReconciles: null,
        totalsMatch: true,
        datesInPeriod: true,
      },
    },
    parser: "test-parser",
  };
}

function transaction(date, description, amount = -10) {
  return {
    date,
    description,
    amount,
    type: amount < 0 ? "purchase" : "payment",
    rawLine: `${date},${description},${amount}`,
  };
}

function storeFile(vaultDir, ...parts) {
  return path.join(vaultDir, STORE_DIR, ...parts);
}

test("empty vault lists no documents without creating store files", async () => {
  const vault = await tmpDir();
  assert.deepEqual(await listDocuments(vault), []);
  assert.deepEqual(await fs.readdir(vault), []);
});

test("save, list, and get roundtrip", async () => {
  const vault = await tmpDir();
  const record = documentRecord(1);

  assert.deepEqual(await saveDocument(vault, record), record);
  assert.deepEqual(await listDocuments(vault), [record]);
  assert.deepEqual(await getDocument(vault, record.id), record);
  assert.equal(await getDocument(vault, uuid(999)), null);

  const rawManifest = await fs.readFile(storeFile(vault, "documents.json"), "utf8");
  assert.match(rawManifest, /\n  "version": 1,/);
  await assert.rejects(fs.access(storeFile(vault, "documents.json.tmp")));
});

test("saving parsed data writes it and fills derived record fields", async () => {
  const vault = await tmpDir();
  const record = documentRecord(2);
  const parsed = parsedStatement([transaction("2026-01-12", "Coffee")]);

  const saved = await saveDocument(vault, record, parsed);
  assert.equal(saved.status, "parsed");
  assert.equal(saved.transactionCount, 1);
  assert.deepEqual(saved.summary, parsed.summary);
  assert.deepEqual(saved.validation, parsed.validation);
  assert.equal("error" in saved, false);
  assert.deepEqual(await loadParsed(vault, record.id), parsed);

  const rawParsed = await fs.readFile(storeFile(vault, "parsed", `${record.id}.json`), "utf8");
  assert.match(rawParsed, /\n  "summary": \{/);
});

test("upsert replaces a document in place without duplicating its id", async () => {
  const vault = await tmpDir();
  const original = documentRecord(3);
  const updated = { ...original, fileName: "renamed.pdf", size: 999 };

  await saveDocument(vault, original);
  await saveDocument(vault, updated);

  assert.deepEqual(await listDocuments(vault), [updated]);
});

test("findDuplicate returns the document with the same content hash", async () => {
  const vault = await tmpDir();
  const record = documentRecord(4, { sha256: "matching-hash" });
  await saveDocument(vault, record);

  assert.deepEqual(await findDuplicate(vault, "matching-hash"), record);
  assert.equal(await findDuplicate(vault, "different-hash"), null);
});

test("failed and unsupported saves remove stale parsed data", async () => {
  const vault = await tmpDir();
  const record = documentRecord(5);
  await saveDocument(vault, record, parsedStatement());
  assert.notEqual(await loadParsed(vault, record.id), null);

  const failed = { ...record, status: "failed", transactionCount: 0 };
  await saveDocument(vault, failed);
  assert.equal(await loadParsed(vault, record.id), null);

  await saveDocument(vault, record, parsedStatement());
  const unsupported = { ...record, status: "unsupported", transactionCount: 0 };
  await saveDocument(vault, unsupported);
  assert.equal(await loadParsed(vault, record.id), null);
});

test("removeDocument cascades and respects deleteFile", async () => {
  const vault = await tmpDir();
  const deletedFile = documentRecord(6);
  const retainedFile = documentRecord(7);
  await fs.writeFile(path.join(vault, deletedFile.fileName), "delete me");
  await fs.writeFile(path.join(vault, retainedFile.fileName), "keep me");
  const deletedSaved = await saveDocument(vault, deletedFile, parsedStatement());
  await saveDocument(vault, retainedFile, parsedStatement());

  assert.deepEqual(await removeDocument(vault, deletedFile.id, { deleteFile: true }), deletedSaved);
  await assert.rejects(fs.access(path.join(vault, deletedFile.fileName)));
  await assert.rejects(fs.access(storeFile(vault, "parsed", `${deletedFile.id}.json`)));

  const retainedRemoved = await removeDocument(vault, retainedFile.id, { deleteFile: false });
  assert.equal(retainedRemoved.id, retainedFile.id);
  assert.equal(await fs.readFile(path.join(vault, retainedFile.fileName), "utf8"), "keep me");
  await assert.rejects(fs.access(storeFile(vault, "parsed", `${retainedFile.id}.json`)));
  assert.deepEqual(await listDocuments(vault), []);
});

test("removeDocument returns null for an unknown id and missing files do not throw", async () => {
  const vault = await tmpDir();
  assert.equal(await removeDocument(vault, uuid(8), { deleteFile: true }), null);

  const record = documentRecord(9);
  await saveDocument(vault, record, parsedStatement());
  await fs.rm(storeFile(vault, "parsed", `${record.id}.json`));
  assert.equal((await removeDocument(vault, record.id, { deleteFile: true })).id, record.id);
});

test("listTransactions tags sources and sorts by date, id, then original order", async () => {
  const vault = await tmpDir();
  const first = documentRecord(10);
  const second = documentRecord(11);
  await saveDocument(
    vault,
    first,
    parsedStatement([
      transaction("2026-02-03", "first-a"),
      transaction("2026-02-03", "first-b"),
    ])
  );
  await saveDocument(
    vault,
    second,
    parsedStatement([
      transaction("2026-02-03", "second-a"),
      transaction("2026-02-02", "second-b"),
    ])
  );

  const transactions = await listTransactions(vault);
  assert.deepEqual(
    transactions.map(({ description, documentId }) => [description, documentId]),
    [
      ["first-a", first.id],
      ["first-b", first.id],
      ["second-a", second.id],
      ["second-b", second.id],
    ]
  );
});

test("corrupt and unknown-version manifests are treated as empty", async () => {
  const vault = await tmpDir();
  await fs.mkdir(storeFile(vault), { recursive: true });
  await fs.writeFile(storeFile(vault, "documents.json"), "{broken");
  assert.deepEqual(await listDocuments(vault), []);

  await fs.writeFile(
    storeFile(vault, "documents.json"),
    JSON.stringify({ version: 2, documents: [documentRecord(12)] })
  );
  assert.deepEqual(await listDocuments(vault), []);
});

test("one malformed manifest record is dropped without losing the others", async () => {
  const vault = await tmpDir();
  const good = documentRecord(21);
  await saveDocument(vault, good);
  const raw = JSON.parse(await fs.readFile(storeFile(vault, "documents.json"), "utf8"));
  raw.documents.push({ id: "not-a-uuid", fileName: "x.pdf" });
  await fs.writeFile(storeFile(vault, "documents.json"), JSON.stringify(raw));

  assert.deepEqual((await listDocuments(vault)).map(({ id }) => id), [good.id]);
  // a subsequent save must not wipe the good record
  const another = documentRecord(22);
  await saveDocument(vault, another);
  assert.deepEqual((await listDocuments(vault)).map(({ id }) => id).sort(), [good.id, another.id].sort());
});

test("listTransactions skips one corrupt parsed file and keeps the others", async () => {
  const vault = await tmpDir();
  const corrupt = documentRecord(13);
  const valid = documentRecord(14);
  await saveDocument(vault, corrupt, parsedStatement([transaction("2026-01-01", "corrupt")]));
  await saveDocument(vault, valid, parsedStatement([transaction("2026-01-02", "valid")]));
  await fs.writeFile(storeFile(vault, "parsed", `${corrupt.id}.json`), "not json");

  assert.deepEqual(
    (await listTransactions(vault)).map(({ description }) => description),
    ["valid"]
  );
});

test("twenty concurrent saves retain all manifest entries", async () => {
  const vault = await tmpDir();
  const records = Array.from({ length: 20 }, (_, index) => documentRecord(100 + index));

  await Promise.all(records.map((record) => saveDocument(vault, record)));

  const savedIds = (await listDocuments(vault)).map(({ id }) => id).sort();
  assert.deepEqual(savedIds, records.map(({ id }) => id).sort());
});

test("hashFile matches node crypto for the same bytes", async () => {
  const vault = await tmpDir();
  const filePath = path.join(vault, "large-statement.pdf");
  const bytes = Buffer.alloc(200_000);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  await fs.writeFile(filePath, bytes);

  assert.equal(await hashFile(filePath), createHash("sha256").update(bytes).digest("hex"));
});

test("findOrphans returns only documents whose vault files are missing", async () => {
  const vault = await tmpDir();
  const existing = documentRecord(15);
  const missing = documentRecord(16);
  await fs.writeFile(path.join(vault, existing.fileName), "present");
  await saveDocument(vault, existing);
  await saveDocument(vault, missing);

  assert.deepEqual(await findOrphans(vault), [missing]);
});

test("newDocumentId returns UUIDs and path traversal ids are rejected", async () => {
  const vault = await tmpDir();
  assert.match(newDocumentId(), /^[0-9a-f-]{36}$/);
  await assert.rejects(loadParsed(vault, "../../etc"), TypeError);
  await assert.rejects(
    saveDocument(vault, documentRecord(17, { id: "../../etc" })),
    TypeError
  );
});
