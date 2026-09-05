import type { DocumentRecord, StoredTransaction } from "../statements/types.js";

export type TransactionFilters = {
  from?: string;
  to?: string;
  account?: string;
  category?: string;
  query?: string;
  currency?: string;
  pending?: "exclude" | "include" | "only";
};

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function validateFilters(value: unknown = {}): TransactionFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid transaction filters.");
  const filters = value as Record<string, unknown>;
  for (const [key, field] of Object.entries(filters)) {
    if (!["from", "to", "account", "category", "query", "currency", "pending"].includes(key)) throw new Error("Unknown transaction filter.");
    if (field !== undefined && (typeof field !== "string" || field.length > 500)) throw new Error("Invalid transaction filter.");
  }
  for (const key of ["from", "to"] as const) {
    if (filters[key] && !validDate(filters[key] as string)) throw new Error("Choose a valid date.");
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new Error("The start date must come before the end date.");
  if (filters.pending !== undefined && !["exclude", "include", "only"].includes(filters.pending as string)) throw new Error("Invalid pending filter.");
  return { ...filters } as TransactionFilters;
}

export function accountKey(row: StoredTransaction, documents: DocumentRecord[]): string {
  if (row.accountId) return `plaid:${row.accountId}`;
  const document = documents.find((item) => item.id === row.documentId);
  if (!document) return row.documentId;
  if (document.account) return document.account;
  const summary = document.summary;
  return summary?.institution || summary?.accountLast4
    ? [summary.institution, summary.accountKind, summary.accountLast4].filter(Boolean).join(":")
    : document.id;
}

export function accountLabel(row: StoredTransaction, documents: DocumentRecord[]): string {
  if (row.accountName) return row.accountName;
  const document = documents.find((item) => item.id === row.documentId);
  if (!document) return "Unknown account";
  if (document.account) return document.account;
  const summary = document.summary;
  const name = summary?.institution ?? (summary?.accountKind === "bank" ? "Bank account" : summary?.accountKind === "credit_card" ? "Credit card" : "");
  return name ? `${name}${summary?.accountLast4 ? ` •${summary.accountLast4}` : ""}` : document.fileName.replace(/\.csv$/i, "");
}

export function transactionCategory(row: StoredTransaction): string {
  if (row.isTransfer) return "Transfers";
  if (!row.category) return "Uncategorized";
  return row.category.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function transactionCurrency(row: StoredTransaction): string {
  // Statement parsers do not capture currency yet; never mix those amounts with a known currency.
  return row.currency ?? "Unknown";
}

export function filterTransactions(rows: StoredTransaction[], filters: TransactionFilters = {}, documents: DocumentRecord[] = []): StoredTransaction[] {
  validateFilters(filters);
  const query = filters.query?.trim().toLocaleLowerCase();
  return rows.filter((row) =>
    (!filters.from || row.date >= filters.from) && (!filters.to || row.date <= filters.to) &&
    (!filters.account || accountKey(row, documents) === filters.account) &&
    (!filters.category || transactionCategory(row) === filters.category) &&
    (!filters.currency || transactionCurrency(row) === filters.currency) &&
    (filters.pending === "include" || (filters.pending === "only" ? row.pending : !row.pending)) &&
    (!query || `${row.description} ${row.merchantName ?? ""} ${accountLabel(row, documents)}`.toLocaleLowerCase().includes(query))
  );
}

type Breakdown = { label: string; amount: number; count: number };
export type TransactionSummary = ReturnType<typeof summarizeTransactions>;

function amountScale(rows: StoredTransaction[]): number {
  const precision = rows.reduce((maximum, row) => {
    const [mantissa, exponent = "0"] = Math.abs(row.amount).toString().split("e");
    return Math.max(maximum, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent));
  }, 2);
  return 10 ** precision;
}

function amountUnits(amount: number, scale: number): number {
  const units = Math.round(amount * scale);
  if (!Number.isSafeInteger(units)) throw new Error("The amounts exceed the precision supported for this comparison.");
  return units;
}

function spendingGroups(rows: StoredTransaction[], label: (row: StoredTransaction) => string, scale: number): Breakdown[] {
  const groups = new Map<string, { cents: number; count: number }>();
  for (const row of rows) {
    const key = label(row);
    const value = groups.get(key) ?? { cents: 0, count: 0 };
    value.cents += amountUnits(-row.amount, scale);
    value.count++;
    groups.set(key, value);
  }
  return [...groups].map(([label, value]) => ({ label, amount: value.cents / scale, count: value.count })).sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

export function summarizeTransactions(rows: StoredTransaction[], documents: DocumentRecord[] = []) {
  const currencies = new Set(rows.map(transactionCurrency));
  if (currencies.size > 1) throw new Error("Choose one currency before comparing amounts.");
  const scale = amountScale(rows);
  let incoming = 0;
  let outgoing = 0;
  const months = new Map<string, { incoming: number; outgoing: number }>();
  for (const row of rows) {
    if (!Number.isFinite(row.amount)) throw new Error("A transaction contains an invalid amount.");
    const cents = amountUnits(row.amount, scale);
    incoming += Math.max(cents, 0);
    outgoing += Math.max(-cents, 0);
    const month = row.date.slice(0, 7);
    const bucket = months.get(month) ?? { incoming: 0, outgoing: 0 };
    bucket.incoming += Math.max(cents, 0);
    bucket.outgoing += Math.max(-cents, 0);
    months.set(month, bucket);
  }
  if (![incoming, outgoing].every(Number.isSafeInteger)) throw new Error("The total exceeds the supported precision.");
  const spending = rows.filter((row) => row.amount < 0 && !row.isTransfer);
  return {
    count: rows.length,
    pendingCount: rows.filter((row) => row.pending).length,
    transferCount: rows.filter((row) => row.isTransfer).length,
    currency: [...currencies][0] ?? "Unknown",
    moneyIn: incoming / scale,
    moneyOut: outgoing / scale,
    net: (incoming - outgoing) / scale,
    spending: spending.reduce((sum, row) => sum + amountUnits(-row.amount, scale), 0) / scale,
    categories: spendingGroups(spending, transactionCategory, scale),
    merchants: spendingGroups(spending, (row) => row.merchantName || row.description, scale),
    accounts: spendingGroups(spending, (row) => accountLabel(row, documents), scale),
    monthly: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({
      month, moneyIn: value.incoming / scale, moneyOut: value.outgoing / scale, net: (value.incoming - value.outgoing) / scale,
    })),
  };
}
