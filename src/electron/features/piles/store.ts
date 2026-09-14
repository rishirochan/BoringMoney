import { promises as fs } from "node:fs";
import path from "node:path";
import { STORE_DIR, writeJsonAtomic } from "../documents/store.js";
import { validatePiles, type Pile } from "./piles.js";

const PILES_VERSION = 1;

function pilesPath(vaultDir: string): string {
  return path.join(vaultDir, STORE_DIR, "piles.json");
}

export async function readPiles(vaultDir: string): Promise<Pile[]> {
  let raw: string;
  try {
    raw = await fs.readFile(pilesPath(vaultDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const file = JSON.parse(raw) as unknown;
  if (!file || typeof file !== "object" || (file as { version?: unknown }).version !== PILES_VERSION) {
    throw new Error("The piles file was written by a newer version of this app.");
  }
  return validatePiles((file as { piles?: unknown }).piles);
}

export async function writePiles(vaultDir: string, piles: Pile[]): Promise<Pile[]> {
  await writeJsonAtomic(pilesPath(vaultDir), { version: PILES_VERSION, piles });
  return piles;
}
