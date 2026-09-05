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
] as const;

function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function formatAmount(amount: number): string {
  return amount.toFixed(2);
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
    sourceByDocumentId.get(transaction.documentId) ?? "",
  ]);
  return [HEADERS.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n") + "\n";
}
