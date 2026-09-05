declare module "*.css";

// These shapes mirror src/electron/features/statements/types.ts.
type StatementSummary = {
  statementPeriod: { from: string; to: string };
  openingBalance: number | null;
  closingBalance: number | null;
  totalPurchasesFees: number;
  totalPaymentsCredits: number;
  minimumPaymentDue?: number;
  paymentDueDate?: string;
  accountKind: "credit_card" | "bank" | "unknown";
  institution?: string;
  accountLast4?: string;
};

type ValidationReport = {
  ok: boolean;
  confidence: number;
  issues: {
    code: string;
    severity: "error" | "warning" | "info";
    message: string;
    detail?: Record<string, unknown>;
  }[];
  checks: {
    balanceReconciles: boolean | null;
    totalsMatch: boolean | null;
    datesInPeriod: boolean | null;
  };
};

type DocumentRecord = {
  id: string;
  fileName: string;
  sha256: string;
  size: number;
  importedAt: number;
  status: "parsed" | "failed" | "unsupported";
  error?: string;
  transactionCount: number;
  summary?: StatementSummary;
  validation?: ValidationReport;
};

type StoredTransaction = {
  documentId: string;
  date: string;
  postedDate?: string;
  description: string;
  amount: number;
  type: "purchase" | "payment" | "fee" | "refund" | "interest";
  referenceNumber?: string;
  balance?: number;
  rawLine: string;
};

type ParsedStatement = {
  summary: StatementSummary;
  transactions: Omit<StoredTransaction, "documentId">[];
  validation: ValidationReport;
  parser: string;
};

type ImportResult = {
  name: string;
  ok: boolean;
  error?: string;
  documentId?: string;
  status?: DocumentRecord["status"];
  transactionCount?: number;
  validationOk?: boolean;
  confidence?: number;
};

interface Window {
  boringmoney: {
    getVaultPath(): Promise<string | null>;
    chooseVault(): Promise<string | null>;
    importFiles(paths: string[]): Promise<ImportResult[]>;
    listFiles(): Promise<{ name: string; size: number; importedAt: number }[]>;
    listDocuments(): Promise<DocumentRecord[]>;
    getParsed(id: string): Promise<ParsedStatement | null>;
    deleteDocument(id: string): Promise<DocumentRecord | null>;
    listTransactions(): Promise<StoredTransaction[]>;
    getFilePath(file: File): string;
  };
}
