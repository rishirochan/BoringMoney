import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  matchesRule,
  normalizeDescription,
  pileBalances,
  routeTransactions,
  validatePiles,
} from "../dist-electron/features/piles/piles.js";
import { groupUnrouted, parseSuggestions, suggestRules } from "../dist-electron/features/piles/suggest.js";
import { readPiles, writePiles } from "../dist-electron/features/piles/store.js";

const uuid = (index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const row = (description, amount, extra = {}) => ({
  documentId: uuid(9), date: "2026-01-01", description, amount, type: "purchase", rawLine: "", ...extra,
});
const pile = (index, name, rules, fundedBy) => ({ id: uuid(index), name, rules, ...(fundedBy ? { fundedBy } : {}) });

test("normalization strips the ids and noise that change per occurrence", () => {
  assert.equal(normalizeDescription("ZELLE FROM MOM 8842193"), "zelle from mom");
  assert.equal(normalizeDescription("ZELLE FROM MOM 9911032"), "zelle from mom");
  assert.equal(normalizeDescription("AMAZON.COM*2K4LP9  #4421"), "amazon.com");
  assert.equal(normalizeDescription("  Rent   Payment "), "rent payment");
});

test("rules match on the stable part, and direction and account restrict them", () => {
  const income = row("ZELLE FROM MOM 8842193", 400);
  const refund = row("ZELLE FROM MOM 1", -400, { accountId: "acct-2" });
  assert.equal(matchesRule(income, { pattern: "zelle from mom" }), true);
  assert.equal(matchesRule(income, { pattern: "ZELLE from MOM 555" }), true);
  assert.equal(matchesRule(income, { pattern: "zelle from dad" }), false);
  assert.equal(matchesRule(income, { pattern: "zelle from mom", direction: "out" }), false);
  assert.equal(matchesRule(refund, { pattern: "zelle from mom", direction: "out" }), true);
  assert.equal(matchesRule(refund, { pattern: "zelle from mom", account: "plaid:acct-2" }), true);
  assert.equal(matchesRule(refund, { pattern: "zelle from mom", account: "plaid:acct-9" }), false);
  assert.equal(matchesRule(row("CARD 1234", -5, { merchantName: "Trader Joe's" }), { pattern: "trader joe" }), true);
});

test("the first matching pile wins and the rest stay unrouted", () => {
  const rows = [row("ZELLE FROM MOM 88", 400), row("TRADER JOES 99", -30), row("NETFLIX 77", -15)];
  const piles = [pile(1, "Parents", [{ pattern: "zelle from mom" }]), pile(2, "Everything", [{ pattern: "" }, { pattern: "zelle" }, { pattern: "trader joes" }])];
  const { routed, unrouted } = routeTransactions(rows, piles, []);
  assert.deepEqual(routed.get(uuid(1)), [rows[0]]);
  assert.deepEqual(routed.get(uuid(2)), [rows[1]]);
  assert.deepEqual(unrouted, [rows[2]]);
});

test("balances sum in minor units and funding rolls up what funded piles have left", () => {
  const work = pile(3, "Work income", [{ pattern: "payroll acme" }]);
  const parents = pile(1, "Parents", [{ pattern: "zelle from mom" }], work.id);
  const food = pile(2, "Food", [{ pattern: "trader joes" }], parents.id);
  const piles = [work, parents, food];
  const rows = [
    row("PAYROLL ACME 4471", 1000),
    row("ZELLE FROM MOM 1", 500.1), row("ZELLE FROM MOM 2", 100.2),
    row("TRADER JOES 1", -30.05), row("TRADER JOES 2", -0.1), row("TRADER JOES 3", 5),
  ];
  const { routed } = routeTransactions(rows, piles, []);
  const balances = pileBalances(piles, routed);
  // A refund into Food flows back to Parents, and what Parents has left rolls up to Work.
  assert.deepEqual(balances.get(food.id), { moneyIn: 5, moneyOut: 30.15, net: -25.15, available: -25.15 });
  assert.deepEqual(balances.get(parents.id), { moneyIn: 600.3, moneyOut: 0, net: 600.3, available: 575.15 });
  assert.deepEqual(balances.get(work.id), { moneyIn: 1000, moneyOut: 0, net: 1000, available: 1575.15 });
});

test("validation rejects bad piles and funding cycles", () => {
  assert.deepEqual(validatePiles([]), []);
  assert.deepEqual(validatePiles([{ id: uuid(1), name: " Work income ", rules: [{ pattern: "payroll", direction: "in" }] }]),
    [{ id: uuid(1), name: "Work income", rules: [{ pattern: "payroll", direction: "in" }] }]);
  assert.throws(() => validatePiles({}), /damaged/);
  assert.throws(() => validatePiles([{ id: "nope", name: "A", rules: [] }]), /invalid id/);
  assert.throws(() => validatePiles([{ id: uuid(1), name: "", rules: [] }]), /1 and 64/);
  assert.throws(() => validatePiles([{ id: uuid(1), name: "A\nB", rules: [] }]), /line breaks/);
  assert.throws(() => validatePiles([{ id: uuid(1), name: "A", rules: [{ pattern: "  " }] }]), /1 and 120/);
  assert.throws(() => validatePiles([{ id: uuid(1), name: "A", rules: [{ pattern: "x", direction: "sideways" }] }]), /money in or money out/);
  assert.throws(() => validatePiles([{ id: uuid(1), name: "A", rules: [] }, { id: uuid(1), name: "B", rules: [] }]), /share an id/);
  assert.throws(() => validatePiles([{ id: uuid(1), name: "A", rules: [], fundedBy: uuid(7) }]), /no longer exists/);
  assert.throws(() => validatePiles([{ id: uuid(1), name: "A", rules: [], fundedBy: uuid(1) }]), /fund itself/);
  assert.throws(() => validatePiles([
    { id: uuid(1), name: "A", rules: [], fundedBy: uuid(2) },
    { id: uuid(2), name: "B", rules: [], fundedBy: uuid(1) },
  ]), /fund itself/);
});

test("suggestions keep only patterns that match an offered description in a real pile", async () => {
  const piles = [pile(1, "Food", [])];
  const rows = [row("TRADER JOES 991", -30), row("TRADER JOES 4412", -12), row("NETFLIX 77", -15)];
  const groups = groupUnrouted(rows);
  assert.deepEqual(groups[0], { description: "trader joes", count: 2, moneyIn: 0, moneyOut: 42 });
  const response = {
    suggestions: [
      { pileId: uuid(1), pattern: "trader joes", direction: null },
      { pileId: uuid(1), pattern: "whole foods" },
      { pileId: uuid(5), pattern: "netflix" },
      { pileId: uuid(1), pattern: "netflix", direction: "out" },
    ],
  };
  assert.deepEqual(parseSuggestions(response, piles, groups), [
    { pileId: uuid(1), pattern: "trader joes" },
    { pileId: uuid(1), pattern: "netflix", direction: "out" },
  ]);
  assert.throws(() => parseSuggestions({}, piles, groups), /invalid response/);

  let prompt = "";
  const suggested = await suggestRules(piles, rows, async (text) => { prompt = text; return response; });
  assert.match(prompt, /trader joes/);
  assert.match(prompt, new RegExp(uuid(1)));
  assert.equal(suggested.length, 2);
  await assert.rejects(() => suggestRules([], rows, async () => response), /Create a pile/);
});

test("piles round-trip through the vault file", async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "boringmoney-piles-"));
  assert.deepEqual(await readPiles(vault), []);
  const piles = [pile(1, "Parents", [{ pattern: "zelle from mom", direction: "in" }]), pile(2, "Food", [{ pattern: "trader joes" }], uuid(1))];
  await writePiles(vault, piles);
  assert.deepEqual(await readPiles(vault), piles);
  await fs.writeFile(path.join(vault, ".boringmoney", "piles.json"), JSON.stringify({ version: 2, piles: [] }));
  await assert.rejects(() => readPiles(vault), /newer version/);
  await fs.rm(vault, { recursive: true, force: true });
});
