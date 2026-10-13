import { randomUUID } from "node:crypto";
import { validName, type Payee } from "./piles.js";

export type PayeeGroup = { payeeId?: string; name: string; descriptions: string[] };

export const GROUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    groups: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          payeeId: { anyOf: [{ type: "string" }, { type: "null" }] },
          name: { type: "string", minLength: 1, maxLength: 64 },
          descriptions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200 },
        },
        required: ["payeeId", "name", "descriptions"],
      },
    },
  },
  required: ["groups"],
} as const;

export function groupingPrompt(payees: Payee[], descriptions: string[]): string {
  return [
    "You group bank transaction descriptions by who was paid or who paid.",
    "Put every description you recognize into a group: either an existing payee, by its id, or a new one with payeeId null.",
    "Give a new group a short human name, like \"Jyothsna Zelle\", \"Qualcomm payroll\" or \"24 Hour Fitness\".",
    "Different spellings, abbreviations and transfer wordings of one person or business belong in one group.",
    "Words carried by the banking system are noise, not names: conf, ppd, des:, indn:, id:, web, ach, ref.",
    "Never merge two different people or businesses, however alike their descriptions look.",
    "Leave out any description you are unsure about. Use each description at most once.",
    "",
    "Existing payees:",
    ...(payees.length ? payees.map((payee) => `${payee.id} ${payee.name}`) : ["(none yet)"]),
    "",
    "Descriptions to group:",
    ...descriptions,
  ].join("\n");
}

/** Trust boundary: keep only groups the model could legitimately have made. */
export function parseGroups(value: unknown, payees: Payee[], offered: string[]): PayeeGroup[] {
  if (!value || typeof value !== "object") throw new Error("The AI returned an invalid response.");
  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) throw new Error("The AI returned an invalid response.");
  const ids = new Set(payees.map((payee) => payee.id));
  const available = new Set(offered);
  const kept: PayeeGroup[] = [];
  for (const item of groups) {
    if (!item || typeof item !== "object") continue;
    const { payeeId, name, descriptions } = item as Record<string, unknown>;
    if (payeeId !== undefined && payeeId !== null && (typeof payeeId !== "string" || !ids.has(payeeId))) continue;
    if (!Array.isArray(descriptions)) continue;
    // Taking each description out of the pool keeps a second group from claiming it.
    const claimed = descriptions.filter((description): description is string =>
      typeof description === "string" && available.delete(description));
    if (claimed.length === 0) continue;
    let groupName: string;
    try {
      groupName = validName(name);
    } catch {
      claimed.forEach((description) => available.add(description));
      continue;
    }
    kept.push({ ...(typeof payeeId === "string" ? { payeeId } : {}), name: groupName, descriptions: claimed });
  }
  return kept;
}

export function applyGroups(payees: Payee[], groups: PayeeGroup[], newId: () => string = randomUUID): Payee[] {
  const merged = payees.map((payee) => ({ ...payee, descriptions: [...payee.descriptions] }));
  for (const group of groups) {
    const existing = merged.find((payee) => payee.id === group.payeeId);
    if (existing) existing.descriptions.push(...group.descriptions);
    else merged.push({ id: newId(), name: group.name, descriptions: group.descriptions });
  }
  return merged;
}

export async function groupPayees(
  payees: Payee[],
  descriptions: string[],
  invoke: (prompt: string, schema: object) => Promise<unknown>,
  newId: () => string = randomUUID,
): Promise<Payee[]> {
  if (descriptions.length === 0) return payees;
  const response = await invoke(groupingPrompt(payees, descriptions), GROUP_SCHEMA);
  const grouped = applyGroups(payees, parseGroups(response, payees, descriptions), newId);
  // Whatever the model left out becomes its own payee, so every description is
  // sent exactly once and the list reads as grouped after a single pass.
  // ponytail: two such singletons the model would later see as one payee cannot be
  // merged by the AI, since it only places new descriptions. Add a merge control if that bites.
  const claimed = new Set(grouped.flatMap((payee) => payee.descriptions));
  return [
    ...grouped,
    ...descriptions.filter((description) => !claimed.has(description))
      .map((description) => ({ id: newId(), name: description.slice(0, 64), descriptions: [description] })),
  ];
}
