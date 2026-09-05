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

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "boringmoney-ingest-"));
}

test("isSupportedFile: extension filter, case-insensitive", () => {
  assert.equal(isSupportedFile("statement.pdf"), true);
  assert.equal(isSupportedFile("statement.PDF"), true);
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

  const good1 = path.join(src, "statement.pdf");
  const bad = path.join(src, "malware.exe");
  await fs.writeFile(good1, "pdf-bytes");
  await fs.writeFile(bad, "nope");
  // Pre-seed a same-named file in the vault to force a collision rename.
  await fs.writeFile(path.join(vault, "statement.pdf"), "existing");

  const results = await importFiles(vault, [good1, bad]);
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error, "unsupported file type");

  const files = await listFiles(vault);
  const names = files.map((f) => f.name).sort();
  assert.deepEqual(names, ["statement (2).pdf", "statement.pdf"]);
  // original vault copy untouched
  assert.equal(await fs.readFile(path.join(vault, "statement.pdf"), "utf8"), "existing");
  assert.equal(await fs.readFile(path.join(vault, "statement (2).pdf"), "utf8"), "pdf-bytes");
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

  assert.ok((await importFiles(vault, [first, second])).every((result) => result.ok));
  assert.deepEqual((await listFiles(vault)).map((file) => file.name).sort(), ["statement (2).csv", "statement.csv"]);
});

test("listFiles: filters to pdf/csv only, reports size and importedAt", async () => {
  const vault = await tmpDir();
  await fs.writeFile(path.join(vault, "a.csv"), "12345");
  await fs.writeFile(path.join(vault, "b.pdf"), "1234567890");
  await fs.writeFile(path.join(vault, "ignore.txt"), "x");

  const files = await listFiles(vault);
  const byName = Object.fromEntries(files.map((f) => [f.name, f]));
  assert.equal(Object.keys(byName).length, 2);
  assert.equal(byName["a.csv"].size, 5);
  assert.equal(byName["b.pdf"].size, 10);
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
