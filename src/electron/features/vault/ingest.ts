// Pure vault/ingest logic. No electron import here on purpose: this file is
// unit-tested with plain node against a real tmp dir.
import { promises as fs } from "node:fs";
import path from "node:path";

export type ImportResult = { name: string; ok: boolean; error?: string };
export type FileEntry = { name: string; size: number; importedAt: number };

const ALLOWED_EXTS = new Set([".pdf", ".csv"]);

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

// Copies one source file into vaultDir. Rejects unsupported extensions
// without touching the filesystem. Never throws: caller gets {ok:false} instead.
export async function importFile(vaultDir: string, srcPath: string): Promise<ImportResult> {
  const name = path.basename(srcPath);
  if (!isSupportedFile(name)) {
    return { name, ok: false, error: "unsupported file type" };
  }
  try {
    while (true) {
      const dest = await uniqueDestPath(vaultDir, name);
      try {
        await fs.copyFile(srcPath, dest, fs.constants.COPYFILE_EXCL);
        return { name, ok: true };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  } catch (err) {
    return { name, ok: false, error: (err as Error).message };
  }
}

// One failing file must not abort the rest of the batch.
export async function importFiles(vaultDir: string, srcPaths: string[]): Promise<ImportResult[]> {
  return Promise.all(srcPaths.map((path) => importFile(vaultDir, path)));
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
