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
  /** User-assigned account label. Statements sharing one are deduped against each other. */
  account?: string;
  transactionCount: number;
  summary?: StatementSummary;
  validation?: ValidationReport;
};

type StoredTransaction = import("../electron/features/statements/types").StoredTransaction;

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

type PlaidEnvironment = "sandbox" | "production";

type PlaidConnection = {
  id: string;
  institutionName: string;
  connectedAt: number;
  transactionCount: number;
  lastSyncedAt?: number;
  syncError?: string;
  accounts: {
    id: string;
    name: string;
    mask: string | null;
    type: string | null;
    subtype: string | null;
  }[];
};

type PlaidStatus =
  | { configured: false; environment: PlaidEnvironment; connections: [] }
  | {
      configured: true;
      environment: PlaidEnvironment;
      clientIdLast4: string;
      connections: PlaidConnection[];
    };

interface Window {
  boringmoney: {
    getAiStatus(): Promise<import("../electron/features/ai/types").AiProviderStatus[]>;
    queryAi(request: import("../electron/features/ai/types").AiQueryRequest): Promise<import("../electron/features/ai/types").AiQueryResponse>;
    cancelAi(requestId: string): Promise<{ canceled: boolean }>;
    getVaultPath(): Promise<string | null>;
    chooseVault(): Promise<string | null>;
    importFiles(paths: string[]): Promise<ImportResult[]>;
    listFiles(): Promise<{ name: string; size: number; importedAt: number }[]>;
    listDocuments(): Promise<DocumentRecord[]>;
    getParsed(id: string): Promise<ParsedStatement | null>;
    renameDocument(id: string, fileName: string): Promise<DocumentRecord>;
    setDocumentAccount(id: string, account: string): Promise<DocumentRecord>;
    deleteDocument(id: string): Promise<DocumentRecord | null>;
    listTransactions(): Promise<StoredTransaction[]>;
    exportTransactions(filters?: import("../electron/features/analytics/transactions").TransactionFilters): Promise<
      { ok: true; path: string } | { ok: false; canceled: true }
    >;
    syncPlaid(itemId?: string): Promise<{ results: {itemId: string; institutionName: string; added: number; modified: number; removed: number; transactionCount: number; lastSyncedAt?: number; error?: string}[] }>;
    getPlaidStatus(): Promise<PlaidStatus>;
    getPlaidCredentials(): Promise<{
      clientId: string;
      secret: string;
      environment: PlaidEnvironment;
    }>;
    savePlaidCredentials(credentials: {
      clientId: string;
      secret: string;
      environment: PlaidEnvironment;
    }): Promise<PlaidStatus>;
    connectPlaid(): Promise<
      { status: "cancelled" } | { status: "connected"; connection: PlaidConnection }
    >;
    disconnectPlaid(itemId: string): Promise<PlaidStatus & { remoteRemovalFailed: boolean }>;
    getFilePath(file: File): string;
  };
}
