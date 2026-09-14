import { amountScale, amountUnits } from "../analytics/transactions.js";
import type { StoredTransaction } from "../statements/types.js";
import { normalizeDescription, type Pile } from "./piles.js";

export type PileSuggestion = { pileId: string; pattern: string; direction?: "in" | "out" };
export type UnroutedGroup = { description: string; count: number; moneyIn: number; moneyOut: number };

const MAX_DESCRIPTIONS = 150;
const MAX_SUGGESTIONS = 50;

export const SUGGESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestions: {
      type: "array",
      maxItems: MAX_SUGGESTIONS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          pileId: { type: "string" },
          pattern: { type: "string", minLength: 1, maxLength: 120 },
          direction: { anyOf: [{ type: "string", enum: ["in", "out"] }, { type: "null" }] },
        },
        required: ["pileId", "pattern", "direction"],
      },
    },
  },
  required: ["suggestions"],
} as const;

/** Distinct normalized descriptions, most frequent first, with their totals. */
export function groupUnrouted(rows: StoredTransaction[]): UnroutedGroup[] {
  const scale = amountScale(rows);
  const groups = new Map<string, { count: number; incoming: number; outgoing: number }>();
  for (const row of rows) {
    const description = normalizeDescription(row.description);
    if (!description) continue;
    const group = groups.get(description) ?? { count: 0, incoming: 0, outgoing: 0 };
    const units = amountUnits(row.amount, scale);
    group.count++;
    group.incoming += Math.max(units, 0);
    group.outgoing += Math.max(-units, 0);
    groups.set(description, group);
  }
  return [...groups]
    .map(([description, group]) => ({ description, count: group.count, moneyIn: group.incoming / scale, moneyOut: group.outgoing / scale }))
    .sort((left, right) => right.count - left.count || left.description.localeCompare(right.description));
}

export function suggestionPrompt(piles: Pile[], groups: UnroutedGroup[]): string {
  return [
    "You sort bank transactions into named piles by writing text rules.",
    "A rule matches when the normalized transaction description contains the rule pattern.",
    "Descriptions below are already normalized: ids, dates and reference numbers are stripped.",
    "Choose the shortest pattern that identifies the payment and is copied verbatim from a description below.",
    "Only use direction when the pile should take money in or money out of the same payee, otherwise leave it null.",
    "Suggest nothing for descriptions that do not clearly belong to a pile.",
    "",
    "Piles:",
    ...piles.map((pile) => `${pile.id} ${pile.name}`),
    "",
    "Unrouted descriptions (count, money in, money out):",
    ...groups.map((group) => `${group.count}\t${group.moneyIn}\t${group.moneyOut}\t${group.description}`),
  ].join("\n");
}

/** Trust boundary: the provider can return anything, so keep only rules that would work. */
export function parseSuggestions(value: unknown, piles: Pile[], groups: UnroutedGroup[]): PileSuggestion[] {
  if (!value || typeof value !== "object") throw new Error("The AI returned an invalid response.");
  const suggestions = (value as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) throw new Error("The AI returned an invalid response.");
  const ids = new Set(piles.map((pile) => pile.id));
  const kept: PileSuggestion[] = [];
  for (const item of suggestions.slice(0, MAX_SUGGESTIONS)) {
    if (!item || typeof item !== "object") continue;
    const { pileId, pattern, direction } = item as Record<string, unknown>;
    if (typeof pileId !== "string" || !ids.has(pileId)) continue;
    if (typeof pattern !== "string" || pattern.length > 120) continue;
    const normalized = normalizeDescription(pattern);
    if (!normalized || !groups.some((group) => group.description.includes(normalized))) continue;
    if (kept.some((existing) => existing.pileId === pileId && existing.pattern === pattern)) continue;
    kept.push({ pileId, pattern, ...(direction === "in" || direction === "out" ? { direction } : {}) });
  }
  return kept;
}

export async function suggestRules(
  piles: Pile[],
  unroutedRows: StoredTransaction[],
  invoke: (prompt: string, schema: object) => Promise<unknown>,
): Promise<PileSuggestion[]> {
  if (piles.length === 0) throw new Error("Create a pile before asking for suggestions.");
  const groups = groupUnrouted(unroutedRows).slice(0, MAX_DESCRIPTIONS);
  if (groups.length === 0) return [];
  return parseSuggestions(await invoke(suggestionPrompt(piles, groups), SUGGESTION_SCHEMA), piles, groups);
}
