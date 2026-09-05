// Runnable via `pnpm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isSupportedFile,
  uniqueDestPath,
  importFile,
  importFiles,
  listFiles,
  readVaultPath,
  writeVaultPath,
} from "../dist-electron/features/vault/ingest.js";
import {
  STORE_DIR,
  listDocuments,
  listTransactions,
  loadParsed,
  removeDocument,
} from "../dist-electron/features/documents/store.js";

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "boringmoney-ingest-"));
}

function parsedStatement(description = "Coffee", amount = -4.5) {
  return {
    summary: {
      statementPeriod: { from: "2026-01-01", to: "2026-01-31" },
      openingBalance: null,
      closingBalance: null,
      totalPurchasesFees: amount < 0 ? -amount : 0,
      totalPaymentsCredits: amount > 0 ? amount : 0,
      accountKind: "unknown",
    },
    transactions: [
      {
        date: "2026-01-15",
        description,
        amount,
        type: amount < 0 ? "purchase" : "payment",
        rawLine: `2026-01-15,${description},${amount}`,
      },
    ],
    validation: {
      ok: true,
      confidence: 1,
      issues: [],
      checks: {
        balanceReconciles: true,
        totalsMatch: null,
        datesInPeriod: true,
      },
    },
    parser: "test",
  };
}

const fakeParse = async () => parsedStatement();

test("isSupportedFile: extension filter, case-insensitive", () => {
  assert.equal(isSupportedFile("statement.pdf"), false);
  assert.equal(isSupportedFile("data.csv"), true);
  assert.equal(isSupportedFile("data.CSV"), true);
  assert.equal(isSupportedFile("image.png"), false);
  assert.equal(isSupportedFile("noext"), false);
});

test("uniqueDestPath: appends (2), (3)... on collision, never overwrites", async () => {
  const dir = await tmpDir();
  const first = await uniqueDestPath(dir, "a.csv");
  assert.equal(first, path.join(dir, "a.csv"));
  await fs.writeFile(first, "one");

  const second = await uniqueDestPath(dir, "a.csv");
  assert.equal(second, path.join(dir, "a (2).csv"));
  await fs.writeFile(second, "two");

  const third = await uniqueDestPath(dir, "a.csv");
  assert.equal(third, path.join(dir, "a (3).csv"));
});

test("importFile: rejects unsupported type without copying", async () => {
  const src = await tmpDir();
  const vault = await tmpDir();
  const srcFile = path.join(src, "photo.png");
  await fs.writeFile(srcFile, "not a real image");

  const result = await importFile(vault, srcFile);
  assert.deepEqual(result, { name: "photo.png", ok: false, error: "unsupported file type" });
  assert.deepEqual(await fs.readdir(vault), []);
});

test("importFiles: one failure doesn't abort the batch; collisions renamed", async () => {
  const src = await tmpDir();
  const vault = await tmpDir();

  const good1 = path.join(src, "statement.csv");
  const bad = path.join(src, "malware.exe");
  await fs.writeFile(good1, "csv-bytes");
  await fs.writeFile(bad, "nope");
  // Pre-seed a same-named file in the vault to force a collision rename.
  await fs.writeFile(path.join(vault, "statement.csv"), "existing");

  const results = await importFiles(vault, [good1, bad], { parse: fakeParse });
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].name, "statement (2).csv");
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error, "unsupported file type");

  const files = await listFiles(vault);
  const names = files.map((f) => f.name).sort();
  assert.deepEqual(names, ["statement (2).csv", "statement.csv"]);
  // original vault copy untouched
  assert.equal(await fs.readFile(path.join(vault, "statement.csv"), "utf8"), "existing");
  assert.equal(await fs.readFile(path.join(vault, "statement (2).csv"), "utf8"), "csv-bytes");
});

test("importFiles: same-named files all import", async () => {
  const src = await tmpDir();
  const vault = await tmpDir();
  const first = path.join(src, "one", "statement.csv");
  const second = path.join(src, "two", "statement.csv");
  await fs.mkdir(path.dirname(first), { recursive: true });
  await fs.mkdir(path.dirname(second), { recursive: true });
  await fs.writeFile(first, "first");
  await fs.writeFile(second, "second");

  assert.ok(
    (
      await importFiles(vault, [first, second], {
        parse: async (filePath) => parsedStatement(path.dirname(filePath)),
      })
    ).every((result) => result.ok)
  );
  assert.deepEqual((await listFiles(vault)).map((file) => file.name).sort(), ["statement (2).csv", "statement.csv"]);
});

test("importFile: duplicate content is rejected and its copied file is removed", async () => {
  const src = await tmpDir();
  const vault = await tmpDir();
  const first = path.join(src, "first.csv");
  const second = path.join(src, "second.csv");
  await fs.writeFile(first, "same bytes");
  await fs.writeFile(second, "same bytes");

  const imported = await importFile(vault, first, { parse: fakeParse });
  const duplicate = await importFile(vault, second, { parse: fakeParse });

  assert.equal(imported.status, "parsed");
  assert.deepEqual(duplicate, {
    name: "second.csv",
    ok: false,
    error: "already imported as first.csv",
  });
  await assert.rejects(fs.access(path.join(vault, "second.csv")));
  assert.equal((await listDocuments(vault)).length, 1);
});

test("importFile: parse failure saves a failed record without parsed JSON", async () => {
  const src = await tmpDir();
  const vault = await tmpDir();
  const srcFile = path.join(src, "broken.csv");
  await fs.writeFile(srcFile, "broken statement");

  const result = await importFile(vault, srcFile, {
    parse: async () => {
      throw new Error("could not read statement");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "could not read statement");
  const [record] = await listDocuments(vault);
  assert.equal(record.id, result.documentId);
  assert.equal(record.error, "could not read statement");
  assert.equal(record.transactionCount, 0);
  assert.equal(await loadParsed(vault, record.id), null);
  await assert.rejects(fs.access(path.join(vault, STORE_DIR, "parsed", `${record.id}.json`)));
});

test("importFile: parse success saves record, parsed JSON, and transaction count", async () => {
  const src = await tmpDir();
  const vault = await tmpDir();
  const srcFile = path.join(src, "working.csv");
  await fs.writeFile(srcFile, "working statement");
  const parsed = parsedStatement("Groceries");

  const result = await importFile(vault, srcFile, { parse: async () => parsed });

  assert.equal(result.ok, true);
  assert.equal(result.status, "parsed");
  assert.equal(result.transactionCount, 1);
  assert.equal(result.validationOk, true);
  assert.equal(result.confidence, 1);
  const [record] = await listDocuments(vault);
  assert.equal(record.transactionCount, 1);
  assert.deepEqual(await loadParsed(vault, record.id), parsed);
  await fs.access(path.join(vault, STORE_DIR, "parsed", `${record.id}.json`));
});

test("transactions keep provenance and removing a document cascades", async () => {
  const src = await tmpDir();
  const vault = await tmpDir();
  const firstPath = path.join(src, "first.csv");
  const secondPath = path.join(src, "second.csv");
  await fs.writeFile(firstPath, "first");
  await fs.writeFile(secondPath, "second");

  const first = await importFile(vault, firstPath, {
    parse: async () => parsedStatement("First"),
  });
  const second = await importFile(vault, secondPath, {
    parse: async () => parsedStatement("Second", -8),
  });
  const transactions = await listTransactions(vault);
  assert.deepEqual(
    new Set(transactions.map(({ documentId }) => documentId)),
    new Set([first.documentId, second.documentId])
  );

  await removeDocument(vault, first.documentId, { deleteFile: false });
  assert.deepEqual(
    (await listTransactions(vault)).map(({ documentId }) => documentId),
    [second.documentId]
  );
  assert.equal(await loadParsed(vault, first.documentId), null);
});

test("listFiles: filters to CSV only, reports size and importedAt", async () => {
  const vault = await tmpDir();
  await fs.writeFile(path.join(vault, "a.csv"), "12345");
  await fs.writeFile(path.join(vault, "b.pdf"), "1234567890");
  await fs.writeFile(path.join(vault, "ignore.txt"), "x");

  const files = await listFiles(vault);
  const byName = Object.fromEntries(files.map((f) => [f.name, f]));
  assert.equal(Object.keys(byName).length, 1);
  assert.equal(byName["a.csv"].size, 5);
  assert.ok(byName["a.csv"].importedAt > 0);
});

test("vault path persists and invalid data reads as unset", async () => {
  const dir = await tmpDir();
  const config = path.join(dir, "vault-config.json");
  assert.equal(await readVaultPath(config), null);
  await writeVaultPath(config, "/private/vault");
  assert.equal(await readVaultPath(config), "/private/vault");
  await fs.writeFile(config, "not json");
  assert.equal(await readVaultPath(config), null);
});
