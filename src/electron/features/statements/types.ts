// Shared contract for statement parsing. Every module under features/statements
// and features/documents builds against these types. Pure types only: no runtime code.

export type TransactionType = "purchase" | "payment" | "fee" | "refund" | "interest";

export interface Transaction {
  date: string; // ISO "2026-01-15" (transaction date)
  postedDate?: string; // ISO, only when the statement shows a separate post date
  description: string; // cleaned, single-spaced
  amount: number; // negative = debit (money out / charge), positive = credit (money in / payment / refund)
  type: TransactionType;
  referenceNumber?: string;
  balance?: number; // running balance if the statement prints one (bank accounts)
  rawLine: string; // original text, untouched, for debugging
}

export type AccountKind = "credit_card" | "bank" | "unknown";

export interface StatementSummary {
  statementPeriod: { from: string; to: string }; // ISO. Derived from min/max transaction date if not printed.
  openingBalance: number | null; // null when the document does not state it (common in CSV exports)
  closingBalance: number | null;
  totalPurchasesFees: number; // positive magnitude, sum of debits (stated if printed, else computed)
  totalPaymentsCredits: number; // positive magnitude, sum of credits (stated if printed, else computed)
  minimumPaymentDue?: number;
  paymentDueDate?: string; // ISO
  accountKind: AccountKind;
  institution?: string; // e.g. "Chase", "American Express" when detectable
  accountLast4?: string; // last four digits of the account/card number when printed
}

// Balance semantics by accountKind, given amount sign convention above:
//   credit_card: closing = opening - sum(amount)   (a purchase, negative amount, raises the balance owed)
//   bank:        closing = opening + sum(amount)
//   unknown:     try both, accept whichever reconciles

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  code: string; // stable machine code, e.g. "balance_mismatch", "no_transactions", "date_outside_period"
  severity: ValidationSeverity;
  message: string; // human readable, one sentence
  detail?: Record<string, unknown>; // numbers/indices useful for debugging
}

export interface ValidationReport {
  ok: boolean; // true iff no "error" severity issues
  confidence: number; // 0..1, how much to trust the parse
  issues: ValidationIssue[];
  checks: {
    balanceReconciles: boolean | null; // null = could not check (missing balances)
    totalsMatch: boolean | null; // stated totals vs computed from transactions
    datesInPeriod: boolean | null;
  };
}

export interface ParsedStatement {
  summary: StatementSummary;
  transactions: Transaction[];
  validation: ValidationReport;
  parser: string; // which parser produced this, e.g. "pdf-generic", "csv-generic"
}

// ---- Extraction layer: file bytes -> text structure. No interpretation here. ----

export interface ExtractedPdf {
  kind: "pdf";
  // pages[p] = lines on page p, top to bottom. Within a line, text runs separated by
  // large horizontal gaps are joined with two or more spaces so column boundaries survive.
  pages: string[][];
  hasText: boolean; // false for scanned/image-only PDFs (needs OCR, out of scope)
}

export interface ExtractedCsv {
  kind: "csv";
  rows: string[][]; // raw cells, RFC 4180 unescaped, empty rows dropped, no header detection
  delimiter: string; // "," | ";" | "\t" | "|"
}

export type ExtractedDocument = ExtractedPdf | ExtractedCsv;

// ---- Document tracking: which file did each fact come from. ----

export type DocumentStatus = "parsed" | "failed" | "unsupported";

export interface DocumentRecord {
  id: string; // uuid v4
  fileName: string; // basename within the vault folder
  sha256: string; // content hash, for duplicate detection
  size: number;
  importedAt: number; // epoch ms
  status: DocumentStatus;
  error?: string; // when status !== "parsed"
  transactionCount: number;
  summary?: StatementSummary;
  validation?: ValidationReport;
  // User-assigned account label. Documents sharing a label are treated as the same
  // account for cross-statement dedup (see sourceKey in features/documents/store.ts).
  account?: string;
}

export type StoredTransaction = Transaction & { documentId: string };
