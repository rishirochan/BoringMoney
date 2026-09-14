import { accountKey, amountScale, amountUnits } from "../analytics/transactions.js";
import type { DocumentRecord, StoredTransaction } from "../statements/types.js";

/** account is an accountKey() value, so a rule can be limited to one account. */
export type PileRule = { pattern: string; direction?: "in" | "out"; account?: string };
export type Pile = { id: string; name: string; rules: PileRule[]; fundedBy?: string };
export type PileBalance = { moneyIn: number; moneyOut: number; net: number; available: number };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PILES = 200;
const MAX_RULES = 500;
const MAX_PATTERN = 120;

/**
 * The stable part of a description: Plaid and statements append ids, dates and
 * reference numbers that differ on every occurrence of the same payment.
 */
// ponytail: any token of 4+ characters carrying a digit is dropped as an id, so a
// name like "7-eleven" or "24hr" disappears with it. If that bites, keep tokens
// that are mostly letters and only drop the ones that are mostly digits.
export function normalizeDescription(text: string): string {
  return text
    .toLowerCase()
    .replace(/[#*]+/g, " ")
    .split(/\s+/)
    // A long token carrying a digit is an id, a card number or a date, never a name.
    .filter((token) => !(token.length >= 4 && /\d/.test(token)))
    .join(" ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesRule(row: StoredTransaction, rule: PileRule, documents: DocumentRecord[] = []): boolean {
  const pattern = normalizeDescription(rule.pattern);
  if (!pattern) return false;
  if (rule.direction === "in" && row.amount <= 0) return false;
  if (rule.direction === "out" && row.amount >= 0) return false;
  if (rule.account && accountKey(row, documents) !== rule.account) return false;
  return normalizeDescription(row.description).includes(pattern) ||
    (row.merchantName !== undefined && normalizeDescription(row.merchantName).includes(pattern));
}

/** First pile whose rule matches wins, so pile order is rule precedence. */
export function routeTransactions(
  rows: StoredTransaction[],
  piles: Pile[],
  documents: DocumentRecord[] = [],
): { routed: Map<string, StoredTransaction[]>; unrouted: StoredTransaction[] } {
  const routed = new Map(piles.map((pile) => [pile.id, [] as StoredTransaction[]]));
  const unrouted: StoredTransaction[] = [];
  for (const row of rows) {
    const pile = piles.find((candidate) => candidate.rules.some((rule) => matchesRule(row, rule, documents)));
    if (pile) routed.get(pile.id)?.push(row);
    else unrouted.push(row);
  }
  return { routed, unrouted };
}

export function pileBalances(piles: Pile[], routed: Map<string, StoredTransaction[]>): Map<string, PileBalance> {
  const scale = amountScale(piles.flatMap((pile) => routed.get(pile.id) ?? []));
  const totals = new Map(piles.map((pile) => {
    let incoming = 0;
    let outgoing = 0;
    for (const row of routed.get(pile.id) ?? []) {
      if (!Number.isFinite(row.amount)) throw new Error("A transaction contains an invalid amount.");
      const units = amountUnits(row.amount, scale);
      incoming += Math.max(units, 0);
      outgoing += Math.max(-units, 0);
    }
    return [pile.id, { incoming, outgoing }];
  }));
  // What a pile still holds is its own net plus whatever the piles it funds have
  // left, so a refund into a funded pile flows back and chains roll up.
  // validatePiles rejects funding cycles, so the recursion always terminates.
  const available = (pile: Pile): number => {
    const { incoming, outgoing } = totals.get(pile.id) ?? { incoming: 0, outgoing: 0 };
    return piles
      .filter((candidate) => candidate.fundedBy === pile.id)
      .reduce((sum, candidate) => sum + available(candidate), incoming - outgoing);
  };
  return new Map(piles.map((pile) => {
    const { incoming, outgoing } = totals.get(pile.id) ?? { incoming: 0, outgoing: 0 };
    return [pile.id, {
      moneyIn: incoming / scale,
      moneyOut: outgoing / scale,
      net: (incoming - outgoing) / scale,
      available: available(pile) / scale,
    }];
  }));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Piles are damaged. Reload and try again.");
  return value as Record<string, unknown>;
}

function pileName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Give every pile a name.");
  const name = value.trim();
  if (!name || name.length > 64) throw new Error("Pile names must be between 1 and 64 characters.");
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("Pile names cannot contain line breaks.");
  return name;
}

function pileRule(value: unknown): PileRule {
  const input = record(value);
  if (Object.keys(input).some((key) => !["pattern", "direction", "account"].includes(key))) {
    throw new Error("A pile rule has an unknown setting.");
  }
  if (typeof input.pattern !== "string" || input.pattern.length > MAX_PATTERN || !normalizeDescription(input.pattern)) {
    throw new Error("Rule text must be between 1 and 120 characters and contain letters.");
  }
  if (input.direction !== undefined && input.direction !== "in" && input.direction !== "out") {
    throw new Error("A rule direction must be money in or money out.");
  }
  if (input.account !== undefined && (typeof input.account !== "string" || input.account.length > 500)) {
    throw new Error("A rule account is invalid.");
  }
  return {
    pattern: input.pattern,
    ...(input.direction ? { direction: input.direction } : {}),
    ...(input.account ? { account: input.account } : {}),
  };
}

/** Trust boundary: renderer input and the piles file both come through here. */
export function validatePiles(value: unknown): Pile[] {
  if (!Array.isArray(value)) throw new Error("Piles are damaged. Reload and try again.");
  if (value.length > MAX_PILES) throw new Error(`Keep to ${MAX_PILES} piles or fewer.`);
  const piles = value.map((item): Pile => {
    const input = record(item);
    if (Object.keys(input).some((key) => !["id", "name", "rules", "fundedBy"].includes(key))) {
      throw new Error("A pile has an unknown setting.");
    }
    if (typeof input.id !== "string" || !UUID_PATTERN.test(input.id)) throw new Error("A pile has an invalid id.");
    if (!Array.isArray(input.rules)) throw new Error("A pile has invalid rules.");
    if (input.rules.length > MAX_RULES) throw new Error(`Keep to ${MAX_RULES} rules per pile or fewer.`);
    if (input.fundedBy !== undefined && typeof input.fundedBy !== "string") throw new Error("A pile has an invalid funding source.");
    return {
      id: input.id,
      name: pileName(input.name),
      rules: input.rules.map(pileRule),
      ...(input.fundedBy ? { fundedBy: input.fundedBy } : {}),
    };
  });
  const ids = new Set(piles.map((pile) => pile.id));
  if (ids.size !== piles.length) throw new Error("Two piles share an id.");
  for (const pile of piles) {
    if (pile.fundedBy === undefined) continue;
    if (!ids.has(pile.fundedBy)) throw new Error("A pile is funded by a pile that no longer exists.");
    const seen = new Set<string>();
    let current: string | undefined = pile.id;
    while (current !== undefined) {
      if (seen.has(current)) throw new Error("A pile cannot fund itself, directly or through other piles.");
      seen.add(current);
      current = piles.find((candidate) => candidate.id === current)?.fundedBy;
    }
  }
  return piles;
}
