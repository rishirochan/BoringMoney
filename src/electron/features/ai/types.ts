import type { TransactionFilters } from "../analytics/transactions.js";

export type { TransactionFilters };

export type AiProvider = "codex" | "claude";

export type AiProviderState =
  | "ready"
  | "not_installed"
  | "signed_out"
  | "unsupported_auth"
  | "error";

export type AiProviderStatus = {
  provider: AiProvider;
  label: string;
  state: AiProviderState;
  installed: boolean;
  authenticated: boolean;
  version: string | null;
  loginCommand: string;
  message: string;
  quotaNote: string;
};

export type AiQueryRequest = {
  requestId: string;
  provider: AiProvider;
  question: string;
  filters?: TransactionFilters;
};

export type AiCoverage = {
  totalTransactions: number;
  filteredTransactions: number;
  rowsProvided: number;
  rowsOmitted: number;
  complete: boolean;
  from: string | null;
  to: string | null;
  currencies: string[];
  filters: TransactionFilters;
};

export type AiChart = {
  type: "bar" | "line" | "donut";
  title: string;
  dataset: "categories" | "merchants" | "accounts" | "monthly";
  metric: "amount" | "count" | "moneyIn" | "moneyOut" | "net";
  series: { name: string; points: { label: string; value: number }[] }[];
};

export type AiQueryResponse = {
  requestId: string;
  provider: AiProvider;
  answer: string;
  charts: AiChart[];
  coverage: AiCoverage;
};

export type RegisterAiHandlersOptions = {
  getTransactions(): Promise<import("../statements/types.js").StoredTransaction[]>;
  getDocuments(): Promise<import("../statements/types.js").DocumentRecord[]>;
};
