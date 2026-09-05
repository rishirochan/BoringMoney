import { transactionCurrency } from "../analytics/transactions.js";
import type { StoredTransaction } from "./types.js";

const HEADERS = [
  "Date",
  "Posted Date",
  "Description",
  "Amount",
  "Type",
  "Reference",
  "Balance",
  "Source",
  "Currency",
  "Category",
  "Pending",
] as const;

function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" && /^[=+@\-\t\r]/.test(value) && !/^-?\d+(?:\.\d+)?$/.test(value)
    ? `'${value}` : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function formatAmount(amount: number): string {
  return Math.round(amount * 100) / 100 === amount ? amount.toFixed(2) : String(amount);
}

export function transactionsToCsv(
  transactions: StoredTransaction[],
  sourceByDocumentId: ReadonlyMap<string, string>
): string {
  const rows = transactions.map((transaction) => [
    transaction.date,
    transaction.postedDate ?? "",
    transaction.description,
    formatAmount(transaction.amount),
    transaction.type,
    transaction.referenceNumber ?? "",
    transaction.balance !== undefined ? formatAmount(transaction.balance) : "",
    transaction.accountName ?? sourceByDocumentId.get(transaction.documentId) ?? "",
    transactionCurrency(transaction),
    transaction.category ?? "",
    transaction.pending ? "Yes" : "No",
  ]);
  return [HEADERS.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n") + "\n";
}
