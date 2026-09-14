import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeDescription,
  pileBalances,
  routeTransactions,
  summarizePayees,
  validateStore,
} from "../dist-electron/features/piles/piles.js";
import { applyGroups, groupPayees, parseGroups } from "../dist-electron/features/piles/group.js";
import { readStore, writeStore } from "../dist-electron/features/piles/store.js";

const uuid = (index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const row = (description, amount, extra = {}) => ({
  documentId: uuid(9), date: "2026-01-01", description, amount, type: "purchase", rawLine: "", ...extra,
});
const pile = (index, name, fundedBy) => ({ id: uuid(index), name, ...(fundedBy ? { fundedBy } : {}) });
const payee = (index, name, descriptions, pileId) => ({ id: uuid(index), name, descriptions, ...(pileId ? { pileId } : {}) });

test("normalization strips the ids and noise that change per occurrence", () => {
  assert.equal(normalizeDescription("ZELLE FROM MOM 8842193"), "zelle from mom");
  assert.equal(normalizeDescription("ZELLE FROM MOM 9911032"), "zelle from mom");
  assert.equal(normalizeDescription("AMAZON.COM*2K4LP9  #4421"), "amazon.com");
  assert.equal(normalizeDescription("  Rent   Payment "), "rent payment");
});

test("a row lands in the pile of the payee that claims its description", () => {
  const parents = pile(1, "Parents");
  const payees = [payee(2, "Mom", ["zelle from mom", "zelle mom conf"], parents.id), payee(3, "Netflix", ["netflix"])];
  const rows = [row("ZELLE FROM MOM 8842193", 400), row("ZELLE MOM CONF 771", 50), row("NETFLIX 77", -15), row("TRADER JOES 4", -30)];
  const { routed, unrouted } = routeTransactions(rows, [parents], payees);
  assert.deepEqual(routed.get(parents.id), [rows[0], rows[1]]);
  // Netflix has a payee but no pile; Trader Joe's has neither. Both stay unrouted.
  assert.deepEqual(unrouted, [rows[2], rows[3]]);
});

test("summaries cover every payee and every description still ungrouped", () => {
  const payees = [payee(2, "Mom", ["zelle from mom"]), payee(3, "Rent", ["rent payment"])];
  const rows = [row("ZELLE FROM MOM 1", 500.1), row("ZELLE FROM MOM 2", 100.2), row("TRADER JOES 1", -30.05), row("TRADER JOES 2", -0.1)];
  const entries = summarizePayees(rows, payees);
  assert.deepEqual(entries, [
    { id: uuid(2), name: "Mom", grouped: true, descriptions: ["zelle from mom"], count: 2, moneyIn: 600.3, moneyOut: 0 },
    { id: "raw:trader joes", name: "trader joes", grouped: false, descriptions: ["trader joes"], count: 2, moneyIn: 0, moneyOut: 30.15 },
    { id: uuid(3), name: "Rent", grouped: true, descriptions: ["rent payment"], count: 0, moneyIn: 0, moneyOut: 0 },
  ]);
});

test("balances sum in minor units and funding rolls up what funded piles have left", () => {
  const work = pile(3, "Work income");
  const parents = pile(1, "Parents", work.id);
  const food = pile(2, "Food", parents.id);
  const piles = [work, parents, food];
  const payees = [
    payee(4, "Qualcomm payroll", ["payroll acme"], work.id),
    payee(5, "Mom", ["zelle from mom"], parents.id),
    payee(6, "Trader Joe's", ["trader joes"], food.id),
  ];
  const rows = [
    row("PAYROLL ACME 4471", 1000),
    row("ZELLE FROM MOM 1", 500.1), row("ZELLE FROM MOM 2", 100.2),
    row("TRADER JOES 1", -30.05), row("TRADER JOES 2", -0.1), row("TRADER JOES 3", 5),
  ];
  const { routed } = routeTransactions(rows, piles, payees);
  const balances = pileBalances(piles, routed);
  // A refund into Food flows back to Parents, and what Parents has left rolls up to Work.
  assert.deepEqual(balances.get(food.id), { moneyIn: 5, moneyOut: 30.15, net: -25.15, available: -25.15 });
  assert.deepEqual(balances.get(parents.id), { moneyIn: 600.3, moneyOut: 0, net: 600.3, available: 575.15 });
  assert.deepEqual(balances.get(work.id), { moneyIn: 1000, moneyOut: 0, net: 1000, available: 1575.15 });
});

test("validation rejects damaged piles, damaged payees and funding cycles", () => {
  assert.deepEqual(validateStore({ piles: [], payees: [] }), { piles: [], payees: [] });
  assert.deepEqual(
    validateStore({ piles: [pile(1, " Parents ")], payees: [payee(2, " Mom ", ["zelle from mom"], uuid(1))] }),
    { piles: [pile(1, "Parents")], payees: [payee(2, "Mom", ["zelle from mom"], uuid(1))] },
  );
  assert.throws(() => validateStore([]), /damaged/);
  assert.throws(() => validateStore({ piles: [], payees: [], rules: [] }), /damaged/);
  assert.throws(() => validateStore({ piles: [{ id: "nope", name: "A" }], payees: [] }), /invalid id/);
  assert.throws(() => validateStore({ piles: [{ id: uuid(1), name: "" }], payees: [] }), /1 and 64/);
  assert.throws(() => validateStore({ piles: [{ id: uuid(1), name: "A\nB" }], payees: [] }), /line breaks/);
  assert.throws(() => validateStore({ piles: [{ id: uuid(1), name: "A", rules: [] }], payees: [] }), /unknown setting/);
  assert.throws(() => validateStore({ piles: [pile(1, "A"), pile(1, "B")], payees: [] }), /piles share an id/);
  // Descriptions must be their own normalized form, or routing would never find them.
  assert.throws(() => validateStore({ piles: [], payees: [payee(2, "Mom", ["ZELLE FROM MOM 88"])] }), /not normalized/);
  assert.throws(() => validateStore({ piles: [], payees: [payee(2, "Mom", [""])] }), /1 and 200/);
  assert.throws(() => validateStore({ piles: [], payees: [payee(2, "Mom", ["zelle"]), payee(3, "Dad", ["zelle"])] }), /same description/);
  assert.throws(() => validateStore({ piles: [], payees: [payee(2, "Mom", ["zelle"], uuid(7))] }), /pile that no longer exists/);
  assert.throws(() => validateStore({ piles: [pile(1, "A", uuid(1))], payees: [] }), /fund itself/);
  assert.throws(() => validateStore({ piles: [pile(1, "A", uuid(2)), pile(2, "B", uuid(1))], payees: [] }), /fund itself/);
});

test("AI groups are dropped unless every part of them checks out", () => {
  const payees = [payee(2, "Mom", ["zelle from mom"])];
  const offered = ["zelle mom conf", "trader joes", "netflix", "qualcomm payroll"];
  const groups = parseGroups({
    groups: [
      { payeeId: uuid(2), name: "Mom", descriptions: ["zelle mom conf"] },
      { payeeId: null, name: "Trader Joe's", descriptions: ["trader joes", "whole foods"] },
      { payeeId: null, name: "Groceries again", descriptions: ["trader joes"] },
      { payeeId: uuid(8), name: "Unknown payee", descriptions: ["netflix"] },
      { payeeId: null, name: "", descriptions: ["qualcomm payroll"] },
    ],
  }, payees, offered);
  assert.deepEqual(groups, [
    { payeeId: uuid(2), name: "Mom", descriptions: ["zelle mom conf"] },
    // "whole foods" was never offered, so it is dropped while the rest of the group stands.
    { name: "Trader Joe's", descriptions: ["trader joes"] },
  ]);
  assert.throws(() => parseGroups({}, payees, offered), /invalid response/);

  const grouped = applyGroups(payees, groups, () => uuid(5));
  assert.deepEqual(grouped, [
    payee(2, "Mom", ["zelle from mom", "zelle mom conf"]),
    payee(5, "Trader Joe's", ["trader joes"]),
  ]);
  // Descriptions nobody claimed stay ungrouped, and the result is still a valid store.
  validateStore({ piles: [], payees: grouped });
  const netflix = summarizePayees([row("NETFLIX 77", -15)], grouped).find((entry) => entry.name === "netflix");
  assert.deepEqual(netflix, { id: "raw:netflix", name: "netflix", grouped: false, descriptions: ["netflix"], count: 1, moneyIn: 0, moneyOut: 15 });
});

test("grouping sends only descriptions and keeps payees when the model returns nothing", async () => {
  const payees = [payee(2, "Mom", ["zelle from mom"])];
  let prompt = "";
  const unchanged = await groupPayees(payees, ["trader joes"], async (text) => { prompt = text; return { groups: [] }; }, () => uuid(5));
  assert.deepEqual(unchanged, payees);
  assert.match(prompt, /trader joes/);
  assert.match(prompt, new RegExp(uuid(2)));
  assert.doesNotMatch(prompt, /\d+\.\d\d|2026-/);
  assert.deepEqual(await groupPayees(payees, [], async () => assert.fail("no call")), payees);
});

test("the store round-trips and a version 1 file keeps its piles without its rules", async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "boringmoney-piles-"));
  const file = path.join(vault, ".boringmoney", "piles.json");
  assert.deepEqual(await readStore(vault), { piles: [], payees: [] });

  const store = { piles: [pile(1, "Parents"), pile(2, "Food", uuid(1))], payees: [payee(3, "Mom", ["zelle from mom"], uuid(1))] };
  await writeStore(vault, store);
  assert.deepEqual(await readStore(vault), store);

  await fs.writeFile(file, JSON.stringify({
    version: 1,
    piles: [{ id: uuid(1), name: "Parents", rules: [{ pattern: "zelle from mom" }] }, { id: uuid(2), name: "Food", rules: [], fundedBy: uuid(1) }],
  }));
  assert.deepEqual(await readStore(vault), { piles: [pile(1, "Parents"), pile(2, "Food", uuid(1))], payees: [] });

  await fs.writeFile(file, JSON.stringify({ version: 3, piles: [], payees: [] }));
  await assert.rejects(() => readStore(vault), /newer version/);
  await fs.rm(vault, { recursive: true, force: true });
});
