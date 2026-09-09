import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AiProvider } from "./types.js";

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

export type AiModels = Record<AiProvider, string>;
export const DEFAULT_AI_MODELS: AiModels = { codex: "gpt-5.6-terra", claude: "claude-opus-5" };

export function validateAiModel(provider: unknown, model: unknown): { provider: AiProvider; model: string } {
  if (provider !== "codex" && provider !== "claude") throw new Error("Unknown AI provider.");
  if (typeof model !== "string" || !AI_MODELS[provider].some((option) => option.id === model)) {
    throw new Error("Choose a model from the available options.");
  }
  return { provider, model };
}

export function readAiModels(file: string): AiModels {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AI settings.");
    const saved = value as Record<string, unknown>;
    return {
      codex: validateAiModel("codex", saved.codex ?? DEFAULT_AI_MODELS.codex).model,
      claude: validateAiModel("claude", saved.claude ?? DEFAULT_AI_MODELS.claude).model,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_AI_MODELS };
    throw new Error("Could not read saved AI models.");
  }
}

export function saveAiModel(file: string, provider: unknown, model: unknown): AiModels {
  const selection = validateAiModel(provider, model);
  const models = { ...readAiModels(file), [selection.provider]: selection.model };
  const temporary = `${file}.${randomUUID()}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true });
  // ponytail: synchronous writes serialize two tiny settings; use a write queue if settings grow.
  try {
    writeFileSync(temporary, JSON.stringify(models), { mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return models;
}
