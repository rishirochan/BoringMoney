import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AiProvider, AiProviderStatus } from "./types.js";

const STATUS_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 1_000_000;

const PROVIDERS = {
  codex: {
    label: "OpenAI Codex",
    loginCommand: "codex login",
    quotaNote: "Uses your ChatGPT plan allowance. Plan limits and reset windows still apply.",
  },
  claude: {
    label: "Claude",
    loginCommand: "claude auth login --claudeai",
    quotaNote: "Uses your Claude subscription allowance. Plan limits and reset windows still apply.",
  },
} as const;

type ProcessResult = { stdout: string; stderr: string; code: number | null };

class ProcessFailure extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

function subscriptionEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "CODEX_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ]) delete environment[name];
  environment.ENABLE_CLAUDEAI_MCP_SERVERS = "false";
  environment.CLAUDE_CODE_AUTO_CONNECT_IDE = "0";
  return environment;
}

async function resolveBinary(provider: AiProvider): Promise<string> {
  const name = provider === "codex" ? "codex" : "claude";
  const candidates = provider === "codex"
    ? ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"]
    : [path.join(os.homedir(), ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next common installation path, then PATH.
    }
  }
  return name;
}

function capture(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; signal: AbortSignal },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new ProcessFailure("AI request canceled."));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let pendingFailure: Error | null = null;
    let forceKill: NodeJS.Timeout | undefined;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: subscriptionEnvironment(),
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stop = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
    };
    const terminate = (error: Error) => {
      if (pendingFailure) return;
      pendingFailure = error;
      stop("SIGTERM");
      forceKill = setTimeout(() => stop("SIGKILL"), 1_500);
    };
    const onAbort = () => terminate(new ProcessFailure("AI request canceled."));
    options.signal.addEventListener("abort", onAbort, { once: true });
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (forceKill) clearTimeout(forceKill);
      options.signal.removeEventListener("abort", onAbort);
      reject(error);
    };
    const append = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
        terminate(new ProcessFailure("AI provider returned too much data."));
        return current;
      }
      return next;
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on("error", (error: NodeJS.ErrnoException) => {
      fail(new ProcessFailure("AI provider is not installed.", error.code));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (forceKill) clearTimeout(forceKill);
      options.signal.removeEventListener("abort", onAbort);
      if (pendingFailure) {
        reject(pendingFailure);
        return;
      }
      resolve({ stdout, stderr, code });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
  });
}

function baseStatus(provider: AiProvider) {
  return { provider, ...PROVIDERS[provider] };
}

function unavailableStatus(
  provider: AiProvider,
  state: AiProviderStatus["state"],
  message: string,
  version: string | null = null,
): AiProviderStatus {
  return {
    ...baseStatus(provider),
    state,
    installed: state !== "not_installed",
    authenticated: false,
    version,
    message,
  };
}

export function parseCodexAuthStatus(output: string): "subscription" | "other" | "signed_out" {
  if (/ChatGPT/i.test(output)) return "subscription";
  if (/logged in/i.test(output)) return "other";
  return "signed_out";
}

export function parseClaudeAuthStatus(output: string): "subscription" | "other" | "signed_out" {
  try {
    const value = JSON.parse(output) as Record<string, unknown>;
    if (value.loggedIn !== true) return "signed_out";
    return value.authMethod === "claude.ai" && typeof value.subscriptionType === "string"
      ? "subscription"
      : "other";
  } catch {
    return "signed_out";
  }
}

async function providerStatus(provider: AiProvider): Promise<AiProviderStatus> {
  const binary = await resolveBinary(provider);
  const signal = AbortSignal.timeout(STATUS_TIMEOUT_MS);
  let versionResult: ProcessResult;
  try {
    versionResult = await capture(binary, ["--version"], { signal });
  } catch (error) {
    if (error instanceof ProcessFailure && error.code === "ENOENT") {
      return unavailableStatus(provider, "not_installed", `${PROVIDERS[provider].label} CLI was not found.`);
    }
    return unavailableStatus(provider, "error", `Could not check the ${PROVIDERS[provider].label} CLI.`);
  }
  const version = `${versionResult.stdout}\n${versionResult.stderr}`.trim().split("\n")[0]?.slice(0, 80) || null;
  if (versionResult.code !== 0) {
    return unavailableStatus(provider, "error", `${PROVIDERS[provider].label} CLI could not start.`, version);
  }

  const authResult = await capture(
    binary,
    provider === "codex" ? ["login", "status"] : ["auth", "status", "--json"],
    { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
  ).catch(() => null);
  const auth = authResult?.code === 0
    ? provider === "codex"
      ? parseCodexAuthStatus(`${authResult.stdout}\n${authResult.stderr}`)
      : parseClaudeAuthStatus(authResult.stdout)
    : "signed_out";
  if (auth === "signed_out") {
    return unavailableStatus(provider, "signed_out", `Sign in with your ${PROVIDERS[provider].label} subscription to continue.`, version);
  }
  if (auth === "other") {
    return unavailableStatus(provider, "unsupported_auth", "This app only uses subscription sign-in, not API-key billing.", version);
  }
  return {
    ...baseStatus(provider),
    state: "ready",
    installed: true,
    authenticated: true,
    version,
    message: `Ready through your ${PROVIDERS[provider].label} subscription.`,
  };
}

export async function assertAiProviderReady(provider: AiProvider): Promise<void> {
  const status = await providerStatus(provider);
  if (status.state !== "ready") throw new Error(status.message);
}

export async function getAiStatus(): Promise<AiProviderStatus[]> {
  return Promise.all([providerStatus("codex"), providerStatus("claude")]);
}

function providerFailure(provider: AiProvider, result: ProcessResult): Error {
  const output = `${result.stdout}\n${result.stderr}`;
  if (/rate.?limit|usage.?limit|quota/i.test(output)) {
    return new Error(`${PROVIDERS[provider].label} usage limit reached. Try again after it resets.`);
  }
  if (/auth|login|sign.?in|credential/i.test(output)) {
    return new Error(`Sign in with your ${PROVIDERS[provider].label} subscription and try again.`);
  }
  return new Error(`${PROVIDERS[provider].label} could not answer this question.`);
}

function structuredOutput(provider: AiProvider, output: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(output.trim());
  } catch {
    throw new Error(`${PROVIDERS[provider].label} returned an invalid response.`);
  }
  if (provider !== "claude" || !value || typeof value !== "object") return value;
  const envelope = value as Record<string, unknown>;
  if (envelope.is_error === true) throw new Error("Claude could not answer this question.");
  if (envelope.structured_output !== undefined) return envelope.structured_output;
  if (typeof envelope.result === "string") {
    try {
      return JSON.parse(envelope.result);
    } catch {
      throw new Error("Claude returned an invalid response.");
    }
  }
  return value;
}

const CODEX_DISABLED_FEATURES = [
  "apps",
  "browser_use",
  "computer_use",
  "goals",
  "image_generation",
  "plugins",
  "shell_tool",
  "sleep_tool",
  "tool_suggest",
  "unified_exec",
  "view_image",
  "workspace_dependencies",
];

async function runCodex(
  binary: string,
  cwd: string,
  prompt: string,
  schemaPath: string,
  signal: AbortSignal,
) {
  const args = [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    "--output-schema",
    schemaPath,
    "-",
  ];
  return capture(binary, args, { cwd, input: prompt, signal });
}

async function runClaude(
  binary: string,
  cwd: string,
  prompt: string,
  schema: object,
  signal: AbortSignal,
) {
  return capture(binary, [
    "-p",
    "--safe-mode",
    "--disable-slash-commands",
    "--no-chrome",
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
  ], { cwd, input: prompt, signal });
}

export async function invokeAiProvider(
  provider: AiProvider,
  prompt: string,
  schema: object,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  await assertAiProviderReady(provider);
  signal.throwIfAborted();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "boringmoney-ai-"));
  const schemaPath = path.join(directory, "response.schema.json");
  try {
    await fs.writeFile(schemaPath, JSON.stringify(schema), { encoding: "utf8", mode: 0o600 });
    const binary = await resolveBinary(provider);
    const result = provider === "codex"
      ? await runCodex(binary, directory, prompt, schemaPath, signal)
      : await runClaude(binary, directory, prompt, schema, signal);
    if (result.code !== 0) throw providerFailure(provider, result);
    return structuredOutput(provider, result.stdout);
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.message === "AI request canceled.")) {
      throw new Error("AI request canceled.");
    }
    throw error;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
