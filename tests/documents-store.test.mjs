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
  renameDocument,
  saveDocument,
  setDocumentAccount,
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

function parsedStatement(transactions = [], summary = {}) {
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
      ...summary,
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

test("renameDocument renames the CSV without overwriting another file", async () => {
  const vault = await tmpDir();
  const record = documentRecord(30, { fileName: "old.csv" });
  await fs.writeFile(path.join(vault, record.fileName), "transactions");
  await saveDocument(vault, record, parsedStatement());

  const renamed = await renameDocument(vault, record.id, "new.csv");
  assert.equal(renamed.fileName, "new.csv");
  assert.equal(await fs.readFile(path.join(vault, "new.csv"), "utf8"), "transactions");
  await assert.rejects(fs.access(path.join(vault, "old.csv")));
  assert.equal((await listDocuments(vault))[0].fileName, "new.csv");

  await fs.writeFile(path.join(vault, "taken.csv"), "keep");
  await assert.rejects(renameDocument(vault, record.id, "taken.csv"), /already exists/);
  assert.equal(await fs.readFile(path.join(vault, "taken.csv"), "utf8"), "keep");
  await assert.rejects(renameDocument(vault, record.id, "../outside.csv"), /without folders/);
  await assert.rejects(renameDocument(vault, record.id, "statement.pdf"), /CSV file name/);
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

// --- cross-statement dedup -------------------------------------------------

const AUG_EARLY = { statementPeriod: { from: "2026-08-01", to: "2026-08-20" } };
const AUG_LATE = { statementPeriod: { from: "2026-08-10", to: "2026-08-30" } };
const SHARED = [transaction("2026-08-15", "Shared Coffee"), transaction("2026-08-18", "Shared Gas", -40)];
const NO_METADATA = { institution: undefined, accountLast4: undefined, accountKind: "unknown" };

async function saveOverlapping(vault, earlyOverrides = {}, lateOverrides = {}, summary = {}) {
  const early = documentRecord(40, earlyOverrides);
  const late = documentRecord(41, lateOverrides);
  await saveDocument(
    vault,
    early,
    parsedStatement([transaction("2026-08-02", "Early only"), ...SHARED], {
      ...summary,
      ...AUG_EARLY,
    })
  );
  await saveDocument(
    vault,
    late,
    parsedStatement([...SHARED, transaction("2026-08-28", "Late only")], {
      ...summary,
      ...AUG_LATE,
    })
  );
  return { early, late };
}

test("overlapping statements for the same account keep the shared rows once", async () => {
  const vault = await tmpDir();
  const { early } = await saveOverlapping(vault);

  const transactions = await listTransactions(vault);
  assert.deepEqual(
    transactions.map(({ description }) => description),
    ["Late only", "Shared Gas", "Shared Coffee", "Early only"]
  );
  // the surviving copies come from the earlier statement
  for (const shared of transactions.filter(({ description }) => description.startsWith("Shared"))) {
    assert.equal(shared.documentId, early.id);
  }
});

test("overlapping statements for different accounts are not deduped", async () => {
  const differentLast4 = await tmpDir();
  await saveOverlapping(differentLast4, {}, {});
  // rewrite the late document with another card number
  const late = documentRecord(41);
  await saveDocument(
    differentLast4,
    late,
    parsedStatement([...SHARED, transaction("2026-08-28", "Late only")], {
      ...AUG_LATE,
      accountLast4: "9999",
    })
  );
  assert.equal((await listTransactions(differentLast4)).length, 6);

  // one labelled account vs an unlabelled one is still two accounts
  const labelled = await tmpDir();
  const { late: laterDoc } = await saveOverlapping(labelled);
  await setDocumentAccount(labelled, laterDoc.id, "Joint card");
  assert.equal((await listTransactions(labelled)).length, 6);
});

test("documents with no detected metadata dedupe only when they share an account label", async () => {
  const vault = await tmpDir();
  const { early, late } = await saveOverlapping(vault, {}, {}, NO_METADATA);
  assert.equal((await listTransactions(vault)).length, 6);

  await setDocumentAccount(vault, early.id, "Amex CSV");
  await setDocumentAccount(vault, late.id, "Amex CSV");
  assert.deepEqual(
    (await listTransactions(vault)).map(({ description }) => description),
    ["Late only", "Shared Gas", "Shared Coffee", "Early only"]
  );
});

test("a charge billed twice in one statement survives dedup", async () => {
  const vault = await tmpDir();
  const early = documentRecord(42);
  const late = documentRecord(43);
  const twice = [transaction("2026-08-15", "Two Lattes"), transaction("2026-08-15", "Two Lattes")];
  await saveDocument(vault, early, parsedStatement(twice, AUG_EARLY));
  await saveDocument(
    vault,
    late,
    parsedStatement([transaction("2026-08-15", "Two Lattes")], AUG_LATE)
  );

  const transactions = await listTransactions(vault);
  assert.equal(transactions.length, 2);
  assert.deepEqual(transactions.map(({ documentId }) => documentId), [early.id, early.id]);
});

test("setDocumentAccount sets, trims, clears, and persists", async () => {
  const vault = await tmpDir();
  const record = documentRecord(44);
  await saveDocument(vault, record, parsedStatement());

  assert.equal((await setDocumentAccount(vault, record.id, "  Chase Sapphire  ")).account, "Chase Sapphire");
  assert.equal((await listDocuments(vault))[0].account, "Chase Sapphire");

  const cleared = await setDocumentAccount(vault, record.id, "   ");
  assert.equal("account" in cleared, false);
  assert.equal("account" in (await listDocuments(vault))[0], false);

  await assert.rejects(setDocumentAccount(vault, record.id, "x".repeat(65)), TypeError);
  await assert.rejects(setDocumentAccount(vault, uuid(999), "Nope"), /Statement not found/);
  await assert.rejects(setDocumentAccount(vault, "../../etc", "Nope"), TypeError);
});

test("manifest records carrying an account label survive validation", async () => {
  const vault = await tmpDir();
  const record = documentRecord(45, { account: "Manual label" });
  await saveDocument(vault, record);
  assert.deepEqual(await listDocuments(vault), [record]);
});
