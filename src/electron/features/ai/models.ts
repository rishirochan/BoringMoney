import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AiEffort, AiProvider, AiSettings } from "./types.js";

// Verified 2026-09-08: developers.openai.com/codex/models and platform.claude.com/docs/en/models/overview.
export const AI_MODELS = {
  codex: [
    { id: "gpt-6-astra", label: "GPT-6 Astra" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "gpt-5.5", label: "GPT-5.5" },
  ],
  claude: [
    { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
} satisfies Record<AiProvider, { id: string; label: string }[]>;

// Both CLIs take the same effort levels: codex as model_reasoning_effort, claude as --effort.
export const AI_EFFORTS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Very high" },
  { id: "max", label: "Max" },
] as const satisfies { id: AiEffort; label: string }[];

export const DEFAULT_AI_SETTINGS: AiSettings = {
  codex: { model: "gpt-5.6-terra", effort: "medium" },
  claude: { model: "claude-opus-5", effort: "medium" },
};

export function validateAiModel(provider: unknown, model: unknown): { provider: AiProvider; model: string } {
  if (provider !== "codex" && provider !== "claude") throw new Error("Unknown AI provider.");
  if (typeof model !== "string" || !AI_MODELS[provider].some((option) => option.id === model)) {
    throw new Error("Choose a model from the available options.");
  }
  return { provider, model };
}

export function validateAiEffort(effort: unknown): AiEffort {
  if (!AI_EFFORTS.some((option) => option.id === effort)) {
    throw new Error("Choose an intelligence level from the available options.");
  }
  return effort as AiEffort;
}

function readProvider(provider: AiProvider, saved: unknown): AiSettings[AiProvider] {
  // ponytail: settings used to be a bare model string per provider; read those as the default effort.
  const value = typeof saved === "string" ? { model: saved } : (saved ?? {}) as Record<string, unknown>;
  return {
    model: validateAiModel(provider, value.model ?? DEFAULT_AI_SETTINGS[provider].model).model,
    effort: validateAiEffort(value.effort ?? DEFAULT_AI_SETTINGS[provider].effort),
  };
}

export function readAiSettings(file: string): AiSettings {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AI settings.");
    const saved = value as Record<string, unknown>;
    return { codex: readProvider("codex", saved.codex), claude: readProvider("claude", saved.claude) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(DEFAULT_AI_SETTINGS);
    throw new Error("Could not read saved AI settings.");
  }
}

export function saveAiSettings(file: string, provider: unknown, patch: unknown): AiSettings {
  if (provider !== "codex" && provider !== "claude") throw new Error("Unknown AI provider.");
  if (!patch || typeof patch !== "object") throw new Error("Nothing to save.");
  const current = readAiSettings(file);
  const changes = patch as Record<string, unknown>;
  const next: AiSettings = {
    ...current,
    [provider]: {
      model: changes.model === undefined ? current[provider].model : validateAiModel(provider, changes.model).model,
      effort: changes.effort === undefined ? current[provider].effort : validateAiEffort(changes.effort),
    },
  };
  const temporary = `${file}.${randomUUID()}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true });
  // ponytail: synchronous writes serialize two tiny settings; use a write queue if settings grow.
  try {
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return next;
}
