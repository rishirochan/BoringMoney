import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_CONTEXT_ROWS,
  analyzeTransactions,
  buildPlannerPrompt,
  materializeCharts,
  parseAiRequest,
  parseAnalysisPlan,
} from "../dist-electron/features/ai/analysis.js";
import {
  claudeArguments,
  codexArguments,
  parseClaudeAuthStatus,
  parseCodexAuthStatus,
} from "../dist-electron/features/ai/cli.js";
import { DEFAULT_AI_SETTINGS, readAiSettings, saveAiSettings } from "../dist-electron/features/ai/models.js";

test("models and effort persist separately, reject invalid changes, and reach isolated CLI commands", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "boringmoney-model-test-"));
  const settings = path.join(directory, "ai-models.json");
  try {
    assert.deepEqual(readAiSettings(settings), DEFAULT_AI_SETTINGS);
    saveAiSettings(settings, "codex", { model: "gpt-5.6-luna" });
    saveAiSettings(settings, "claude", { model: "claude-sonnet-5", effort: "max" });
    assert.deepEqual(readAiSettings(settings), {
      codex: { model: "gpt-5.6-luna", effort: DEFAULT_AI_SETTINGS.codex.effort },
      claude: { model: "claude-sonnet-5", effort: "max" },
    });
    const saved = readFileSync(settings, "utf8");
    assert.throws(() => saveAiSettings(settings, "codex", { model: "claude-sonnet-5" }), /Choose a model/);
    assert.throws(() => saveAiSettings(settings, "__proto__", { model: "gpt-5.6-luna" }), /Unknown AI provider/);
    assert.throws(() => saveAiSettings(settings, "claude", { model: "--dangerously-skip-permissions" }), /Choose a model/);
    assert.throws(() => saveAiSettings(settings, "claude", { effort: "--dangerously-skip-permissions" }), /intelligence level/);
    assert.equal(readFileSync(settings, "utf8"), saved);
    assert.deepEqual(readdirSync(directory), ["ai-models.json"]);
    // Legacy files stored a bare model string per provider.
    writeFileSync(settings, JSON.stringify({ codex: "gpt-5.5", claude: "claude-opus-5" }));
    assert.deepEqual(readAiSettings(settings).codex, { model: "gpt-5.5", effort: DEFAULT_AI_SETTINGS.codex.effort });
    const codex = codexArguments("gpt-5.6-luna", "high", "/tmp/schema.json");
    const claude = claudeArguments("claude-sonnet-5", "max", { type: "object" });
    assert.equal(codex[codex.indexOf("--model") + 1], "gpt-5.6-luna");
    assert.equal(codex[codex.indexOf("--config") + 1], 'model_reasoning_effort="high"');
    assert.equal(claude[claude.indexOf("--model") + 1], "claude-sonnet-5");
    assert.equal(claude[claude.indexOf("--effort") + 1], "max");
    assert.equal(codex[codex.indexOf("--sandbox") + 1], "read-only");
    assert.ok(codex.includes("--ignore-user-config"));
    assert.ok(claude.includes("--safe-mode"));
    assert.equal(claude[claude.indexOf("--tools") + 1], "");
    writeFileSync(settings, "{broken");
    assert.throws(() => saveAiSettings(settings, "codex", { model: "gpt-6-astra" }), /Could not read/);
    assert.equal(readFileSync(settings, "utf8"), "{broken");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const transaction = (overrides = {}) => ({
  documentId: "plaid",
  source: "plaid",
  accountId: "checking",
  accountName: "Checking",
  date: "2026-08-10",
  description: "MARKET",
  merchantName: "Market",
  category: "groceries",
  currency: "USD",
  amount: -10,
  type: "purchase",
  rawLine: "private raw statement text",
  ...overrides,
});

const nullFilters = {
  from: null,
  to: null,
  account: null,
  category: null,
  query: null,
  currency: null,
  pending: null,
};

test("AI request and model plans are validated at the process boundary", () => {
  assert.deepEqual(parseAiRequest({
    requestId: "request_1",
    provider: "codex",
    question: "  Show groceries last month  ",
  }), {
    requestId: "request_1",
    provider: "codex",
    question: "Show groceries last month",
    filters: {},
  });
  assert.throws(() => parseAiRequest({ requestId: "../bad", provider: "codex", question: "hi" }), /request ID/);
  assert.throws(() => parseAnalysisPlan({
    analysisFilters: nullFilters,
    charts: [{
      type: "line",
      dataset: "monthly",
      metric: "amount",
      filters: nullFilters,
      limit: 12,
    }],
  }), /Invalid AI response/);
});

test("chart filters stay inside the user scope and chart values come from local analytics", () => {
  const rows = [
    transaction({ date: "2026-07-10", amount: -15 }),
    transaction({ date: "2026-08-10", amount: -25 }),
    transaction({ date: "2026-08-11", category: "dining", amount: -50 }),
    transaction({ accountId: "savings", accountName: "Savings", date: "2026-08-12", amount: -500 }),
  ];
  const scopedRows = rows.filter((row) => row.accountId === "checking");
  const charts = materializeCharts([{
    type: "donut",
    dataset: "categories",
    metric: "amount",
    filters: { from: "2026-08-01", to: "2026-08-31", category: "Groceries" },
    limit: 10,
  }], scopedRows, []);
  assert.deepEqual(charts[0].series, [{
    name: "USD",
    points: [{ label: "Groceries", value: 25 }],
  }]);
  assert.match(charts[0].title, /2026-08-01 to 2026-08-31/);
});

test("an empty model filter preserves pending rows already allowed by the user scope", () => {
  const charts = materializeCharts([{
    type: "bar",
    dataset: "categories",
    metric: "amount",
    filters: {},
    limit: 10,
  }], [transaction({ pending: true, amount: -40 })], []);
  assert.equal(charts[0].series[0].points[0].value, 40);
});

test("analysis reports the model-selected coverage and uses two structured provider calls", async () => {
  const rows = [
    transaction({ date: "2026-07-10", amount: -15 }),
    transaction({ date: "2026-08-10", amount: -25 }),
    transaction({ date: "2026-08-11", category: "dining", amount: -50 }),
  ];
  let calls = 0;
  const response = await analyzeTransactions(
    { requestId: "request_2", provider: "claude", question: "Show groceries in August", filters: {} },
    rows,
    [],
    async (_provider, prompt) => {
      calls++;
      assert.match(prompt, /untrusted/);
      if (calls === 1) return {
        analysisFilters: { ...nullFilters, from: "2026-08-01", to: "2026-08-31", category: "Groceries" },
        charts: [{
          type: "bar",
          dataset: "categories",
          metric: "amount",
          filters: { ...nullFilters, from: "2026-08-01", to: "2026-08-31", category: "Groceries" },
          limit: 10,
        }],
      };
      return { answer: "You spent $25 on groceries in August." };
    },
    new AbortController().signal,
  );
  assert.equal(calls, 2);
  assert.equal(response.coverage.totalTransactions, 3);
  assert.equal(response.coverage.filteredTransactions, 1);
  assert.equal(response.charts[0].series[0].points[0].value, 25);
});

test("model context is bounded and excludes statement debugging fields", () => {
  const rows = Array.from({ length: 250 }, (_, index) => transaction({
    date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
    description: `MERCHANT ${index}`,
    merchantName: `Merchant ${index}`,
  }));
  const prepared = buildPlannerPrompt(
    { requestId: "request_3", provider: "codex", question: "What changed?", filters: {} },
    rows,
    [],
  );
  assert.equal(prepared.coverage.rowsProvided, MAX_CONTEXT_ROWS);
  assert.equal(prepared.coverage.rowsOmitted, 50);
  assert.doesNotMatch(prepared.prompt, /private raw statement text/);
  const data = JSON.parse(prepared.prompt.split("\n\nDATA\n")[1]);
  assert.equal(data.recentRows.length, MAX_CONTEXT_ROWS);
  assert.equal(data.scopeSummaries[0].merchants.items.length, 50);
  assert.equal(data.scopeSummaries[0].merchants.omitted, 200);
});

test("provider status accepts subscriptions and rejects other auth", () => {
  assert.equal(parseCodexAuthStatus("Logged in using ChatGPT"), "subscription");
  assert.equal(parseCodexAuthStatus("Logged in using an API key"), "other");
  assert.equal(parseClaudeAuthStatus(JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    subscriptionType: "pro",
  })), "subscription");
  assert.equal(parseClaudeAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "apiKey" })), "other");
});
