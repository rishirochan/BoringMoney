// Pure vault/ingest logic. No electron import here on purpose: this file is
// unit-tested with plain node against a real tmp dir.
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  findDuplicate,
  hashFile,
  newDocumentId,
  removeDocument,
  saveDocument,
} from "../documents/store.js";
import type {
  DocumentRecord,
  DocumentStatus,
  ParsedStatement,
} from "../statements/types.js";
import { parseFile } from "../statements/parse.js";

export type ImportResult = {
  name: string;
  ok: boolean;
  error?: string;
  documentId?: string;
  status?: DocumentStatus;
  transactionCount?: number;
  validationOk?: boolean;
  confidence?: number;
};
export type FileEntry = { name: string; size: number; importedAt: number };
type ImportDeps = {
  parse?: (filePath: string) => Promise<ParsedStatement>;
};

const ALLOWED_EXTS = new Set([".csv"]);

export function isSupportedFile(fileName: string): boolean {
  return ALLOWED_EXTS.has(path.extname(fileName).toLowerCase());
}

// Finds a free destination path in dir for fileName, appending " (2)", " (3)"...
// before the extension on collision. Never overwrites.
export async function uniqueDestPath(dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  let candidate = fileName;
  let n = 2;
  while (true) {
    const full = path.join(dir, candidate);
    try {
      await fs.access(full);
      candidate = `${base} (${n})${ext}`;
      n++;
    } catch {
      return full;
    }
  }
}

async function copyToVault(vaultDir: string, srcPath: string): Promise<string> {
  while (true) {
    const destination = await uniqueDestPath(vaultDir, path.basename(srcPath));
    try {
      await fs.copyFile(srcPath, destination, fs.constants.COPYFILE_EXCL);
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRecord(fileName: string, sha256: string, size: number): DocumentRecord {
  return {
    id: newDocumentId(),
    fileName,
    sha256,
    size,
    importedAt: Date.now(),
    status: "failed",
    transactionCount: 0,
  };
}

async function rejectDuplicate(
  vaultDir: string,
  destination: string,
  sha256: string
): Promise<ImportResult | null> {
  const duplicate = await findDuplicate(vaultDir, sha256);
  if (!duplicate) return null;
  if (!(await fileExists(path.join(vaultDir, duplicate.fileName)))) {
    await removeDocument(vaultDir, duplicate.id, { deleteFile: false });
    return null;
  }

  await fs.rm(destination);
  return {
    name: path.basename(destination),
    ok: false,
    error: `already imported as ${duplicate.fileName}`,
  };
}

async function parseAndSave(
  vaultDir: string,
  destination: string,
  record: DocumentRecord,
  parse: (filePath: string) => Promise<ParsedStatement>
): Promise<ImportResult> {
  const name = record.fileName;
  try {
    const parsed = await parse(destination);
    await saveDocument(vaultDir, record, parsed);
    return {
      name,
      ok: true,
      documentId: record.id,
      status: "parsed",
      transactionCount: parsed.transactions.length,
      validationOk: parsed.validation.ok,
      confidence: parsed.validation.confidence,
    };
  } catch (error) {
    const message = errorMessage(error);
    await saveDocument(vaultDir, { ...record, status: "failed", error: message });
    return { name, ok: true, documentId: record.id, status: "failed", error: message };
  }
}

// Copies before parsing so failed statements remain available for inspection.
export async function importFile(
  vaultDir: string,
  srcPath: string,
  deps?: ImportDeps
): Promise<ImportResult> {
  const sourceName = path.basename(srcPath);
  if (!isSupportedFile(sourceName)) {
    return { name: sourceName, ok: false, error: "unsupported file type" };
  }

  let destination: string | undefined;
  try {
    destination = await copyToVault(vaultDir, srcPath);
    const name = path.basename(destination);
    const sha256 = await hashFile(destination);
    const duplicate = await rejectDuplicate(vaultDir, destination, sha256);
    if (duplicate) return duplicate;

    const { size } = await fs.stat(destination);
    const record = createRecord(name, sha256, size);
    const parse = deps?.parse ?? parseFile;
    return parseAndSave(vaultDir, destination, record, parse);
  } catch (error) {
    return {
      name: destination ? path.basename(destination) : sourceName,
      ok: destination !== undefined,
      error: errorMessage(error),
    };
  }
}

// One failing file must not abort the rest of the batch.
export async function importFiles(
  vaultDir: string,
  srcPaths: string[],
  deps?: ImportDeps
): Promise<ImportResult[]> {
  return Promise.all(srcPaths.map((srcPath) => importFile(vaultDir, srcPath, deps)));
}

export async function listFiles(vaultDir: string): Promise<FileEntry[]> {
  const names = await fs.readdir(vaultDir);
  const entries = await Promise.all(
    names
      .filter(isSupportedFile)
      .map(async (name) => {
        const stat = await fs.stat(path.join(vaultDir, name));
        return { name, size: stat.size, importedAt: stat.mtimeMs };
      })
  );
  return entries;
}

export async function readVaultPath(configPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const data = JSON.parse(raw) as { vaultPath?: unknown };
    return typeof data.vaultPath === "string" ? data.vaultPath : null;
  } catch {
    return null;
  }
}

export async function writeVaultPath(configPath: string, vaultPath: string): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify({ vaultPath }), "utf8");
}
