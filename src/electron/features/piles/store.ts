import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIR, writeJsonAtomic } from "../documents/store.js";
import { validateStore, type PileStore } from "./piles.js";

const PILES_VERSION = 2;

function pilesPath(vaultDir: string): string {
  return path.join(vaultDir, STORE_DIR, "piles.json");
}

/** Version 1 stored text rules per pile. The piles are worth keeping, the rules are not. */
function fromVersion1(piles: unknown): PileStore {
  if (!Array.isArray(piles)) throw new Error("Piles are damaged. Reload and try again.");
  return validateStore({
    piles: piles.map((pile) => {
      const { id, name, fundedBy } = (pile ?? {}) as Record<string, unknown>;
      return { id, name, ...(fundedBy ? { fundedBy } : {}) };
    }),
    payees: [],
  });
}

export async function readStore(vaultDir: string): Promise<PileStore> {
  let raw: string;
  try {
    raw = await fs.readFile(pilesPath(vaultDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { piles: [], payees: [] };
    throw error;
  }
  const file = JSON.parse(raw) as unknown;
  if (!file || typeof file !== "object") throw new Error("Piles are damaged. Reload and try again.");
  const { version, piles, payees } = file as Record<string, unknown>;
  if (version === 1) return fromVersion1(piles);
  if (version !== PILES_VERSION) throw new Error("The piles file was written by a newer version of this app.");
  return validateStore({ piles, payees });
}

export async function writeStore(vaultDir: string, store: PileStore): Promise<PileStore> {
  await writeJsonAtomic(pilesPath(vaultDir), { version: PILES_VERSION, ...store });
  return store;
}
