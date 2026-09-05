import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DocumentRecord,
  ParsedStatement,
  StatementSummary,
  StoredTransaction,
  ValidationReport,
} from "../statements/types.js";

export const STORE_DIR = ".boringmoney";

const MANIFEST_VERSION = 1;
const HASH_BUFFER_SIZE = 64 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOCUMENT_STATUSES = new Set(["parsed", "failed", "unsupported"]);
const TRANSACTION_TYPES = new Set(["purchase", "payment", "fee", "refund", "interest"]);
const ACCOUNT_KINDS = new Set(["credit_card", "bank", "unknown"]);
const VALIDATION_SEVERITIES = new Set(["error", "warning", "info"]);
const manifestQueues = new Map<string, Promise<void>>();

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function isNullableNumber(value: unknown): boolean {
  return value === null || typeof value === "number";
}

function isBooleanOrNull(value: unknown): boolean {
  return value === null || typeof value === "boolean";
}

function isStatementSummary(value: unknown): value is StatementSummary {
  if (!isObject(value) || !isObject(value.statementPeriod)) return false;
  return (
    typeof value.statementPeriod.from === "string" &&
    typeof value.statementPeriod.to === "string" &&
    isNullableNumber(value.openingBalance) &&
    isNullableNumber(value.closingBalance) &&
    typeof value.totalPurchasesFees === "number" &&
    typeof value.totalPaymentsCredits === "number" &&
    isOptionalNumber(value.minimumPaymentDue) &&
    isOptionalString(value.paymentDueDate) &&
    typeof value.accountKind === "string" &&
    ACCOUNT_KINDS.has(value.accountKind) &&
    isOptionalString(value.institution) &&
    isOptionalString(value.accountLast4)
  );
}

function isValidationIssue(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.code === "string" &&
    typeof value.severity === "string" &&
    VALIDATION_SEVERITIES.has(value.severity) &&
    typeof value.message === "string" &&
    (value.detail === undefined || isObject(value.detail))
  );
}

function isValidationReport(value: unknown): value is ValidationReport {
  if (!isObject(value) || !isObject(value.checks) || !Array.isArray(value.issues)) return false;
  return (
    typeof value.ok === "boolean" &&
    typeof value.confidence === "number" &&
    value.issues.every(isValidationIssue) &&
    isBooleanOrNull(value.checks.balanceReconciles) &&
    isBooleanOrNull(value.checks.totalsMatch) &&
    isBooleanOrNull(value.checks.datesInPeriod)
  );
}

function isTransaction(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.date === "string" &&
    isOptionalString(value.postedDate) &&
    typeof value.description === "string" &&
    typeof value.amount === "number" &&
    typeof value.type === "string" &&
    TRANSACTION_TYPES.has(value.type) &&
    isOptionalString(value.referenceNumber) &&
    isOptionalNumber(value.balance) &&
    typeof value.rawLine === "string"
  );
}

function isParsedStatement(value: unknown): value is ParsedStatement {
  return (
    isObject(value) &&
    isStatementSummary(value.summary) &&
    Array.isArray(value.transactions) &&
    value.transactions.every(isTransaction) &&
    isValidationReport(value.validation) &&
    typeof value.parser === "string"
  );
}

function isSafeFileName(fileName: string): boolean {
  return (
    fileName.length > 0 &&
    fileName !== "." &&
    fileName !== ".." &&
    !fileName.includes("/") &&
    !fileName.includes("\\") &&
    path.basename(fileName) === fileName
  );
}

function isDocumentRecord(value: unknown): value is DocumentRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    UUID_PATTERN.test(value.id) &&
    typeof value.fileName === "string" &&
    isSafeFileName(value.fileName) &&
    typeof value.sha256 === "string" &&
    typeof value.size === "number" &&
    typeof value.importedAt === "number" &&
    typeof value.status === "string" &&
    DOCUMENT_STATUSES.has(value.status) &&
    isOptionalString(value.error) &&
    typeof value.transactionCount === "number" &&
    (value.summary === undefined || isStatementSummary(value.summary)) &&
    (value.validation === undefined || isValidationReport(value.validation)) &&
    isOptionalString(value.account)
  );
}

function assertDocumentId(id: string): void {
  if (!UUID_PATTERN.test(id)) throw new TypeError(`Invalid document id: ${id}`);
}

function assertDocumentRecord(record: DocumentRecord): void {
  if (!isDocumentRecord(record)) throw new TypeError("Invalid document record");
}

function storePath(vaultDir: string): string {
  return path.join(vaultDir, STORE_DIR);
}

function manifestPath(vaultDir: string): string {
  return path.join(storePath(vaultDir), "documents.json");
}

function parsedPath(vaultDir: string, id: string): string {
  assertDocumentId(id);
  return path.join(storePath(vaultDir), "parsed", `${id}.json`);
}

async function readManifest(vaultDir: string): Promise<DocumentRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath(vaultDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const manifest = JSON.parse(raw) as unknown;
  if (!isObject(manifest) || manifest.version !== MANIFEST_VERSION) return [];
  if (!Array.isArray(manifest.documents)) return [];
  // Drop only the bad records: rejecting the whole list would make the next save
  // rewrite the manifest without every other document.
  return manifest.documents.filter(isDocumentRecord);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeManifest(vaultDir: string, documents: DocumentRecord[]): Promise<void> {
  await writeJsonAtomic(manifestPath(vaultDir), {
    version: MANIFEST_VERSION,
    documents,
  });
}

async function withManifestLock<T>(vaultDir: string, action: () => Promise<T>): Promise<T> {
  const key = path.resolve(vaultDir);
  const previous = manifestQueues.get(key) ?? Promise.resolve();
  const operation = previous.then(action, action);
  const tail = operation.then(
    () => undefined,
    () => undefined
  );
  manifestQueues.set(key, tail);
  try {
    return await operation;
  } finally {
    if (manifestQueues.get(key) === tail) manifestQueues.delete(key);
  }
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function hashFile(filePath: string): Promise<string> {
  const file = await fs.open(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_SIZE);
  try {
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await file.close();
  }
}

export async function listDocuments(vaultDir: string): Promise<DocumentRecord[]> {
  return readManifest(vaultDir);
}

export async function getDocument(vaultDir: string, id: string): Promise<DocumentRecord | null> {
  assertDocumentId(id);
  return (await readManifest(vaultDir)).find((document) => document.id === id) ?? null;
}

export async function findDuplicate(
  vaultDir: string,
  sha256: string
): Promise<DocumentRecord | null> {
  return (await readManifest(vaultDir)).find((document) => document.sha256 === sha256) ?? null;
}

export function newDocumentId(): string {
  return randomUUID();
}

export async function saveDocument(
  vaultDir: string,
  record: DocumentRecord,
  parsed?: ParsedStatement
): Promise<DocumentRecord> {
  assertDocumentRecord(record);
  if (parsed !== undefined && !isParsedStatement(parsed)) {
    throw new TypeError("Invalid parsed statement");
  }

  return withManifestLock(vaultDir, async () => {
    const documents = await readManifest(vaultDir);
    const savedRecord: DocumentRecord =
      parsed === undefined
        ? { ...record }
        : {
            ...record,
            status: "parsed",
            transactionCount: parsed.transactions.length,
            summary: parsed.summary,
            validation: parsed.validation,
          };
    if (parsed !== undefined) delete savedRecord.error;

    await fs.mkdir(path.join(storePath(vaultDir), "parsed"), { recursive: true });
    if (parsed !== undefined) {
      await writeJsonAtomic(parsedPath(vaultDir, record.id), parsed);
    } else if (savedRecord.status === "failed" || savedRecord.status === "unsupported") {
      await removeIfPresent(parsedPath(vaultDir, record.id));
    }

    const existingIndex = documents.findIndex((document) => document.id === savedRecord.id);
    if (existingIndex === -1) documents.push(savedRecord);
    else documents[existingIndex] = savedRecord;
    await writeManifest(vaultDir, documents);
    return savedRecord;
  });
}

export async function renameDocument(
  vaultDir: string,
  id: string,
  fileName: string
): Promise<DocumentRecord> {
  assertDocumentId(id);
  if (!isSafeFileName(fileName) || path.extname(fileName).toLowerCase() !== ".csv") {
    throw new TypeError("Use a CSV file name without folders");
  }

  return withManifestLock(vaultDir, async () => {
    const documents = await readManifest(vaultDir);
    const index = documents.findIndex((document) => document.id === id);
    if (index === -1) throw new Error("Statement not found");

    const document = documents[index];
    if (document.fileName === fileName) return document;
    if (documents.some((item) => item.fileName.toLowerCase() === fileName.toLowerCase())) {
      throw new Error("A statement with that name already exists");
    }

    const source = path.join(vaultDir, document.fileName);
    const destination = path.join(vaultDir, fileName);
    try {
      await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("A file with that name already exists");
      }
      throw error;
    }

    const renamed = { ...document, fileName };
    documents[index] = renamed;
    try {
      await writeManifest(vaultDir, documents);
    } catch (error) {
      await removeIfPresent(destination);
      throw error;
    }
    await fs.unlink(source);
    return renamed;
  });
}

// Mirrors src/renderer/features/vault/sourceGroups.ts sourceKey: same grouping on both sides.
export function sourceKey(document: DocumentRecord): string {
  if (document.account) return document.account;
  const { summary } = document;
  if (!summary?.institution && !summary?.accountLast4) return document.id;
  return [summary.institution, summary.accountKind, summary.accountLast4].filter(Boolean).join(":");
}

export async function setDocumentAccount(
  vaultDir: string,
  id: string,
  account: string | undefined
): Promise<DocumentRecord> {
  assertDocumentId(id);
  const label = account?.trim();
  if (label !== undefined && label.length > 64) {
    throw new TypeError("Account name must be 64 characters or fewer");
  }

  return withManifestLock(vaultDir, async () => {
    const documents = await readManifest(vaultDir);
    const index = documents.findIndex((document) => document.id === id);
    if (index === -1) throw new Error("Statement not found");

    const updated = { ...documents[index] };
    if (label) updated.account = label;
    else delete updated.account;
    documents[index] = updated;
    await writeManifest(vaultDir, documents);
    return updated;
  });
}

export async function loadParsed(vaultDir: string, id: string): Promise<ParsedStatement | null> {
  assertDocumentId(id);
  try {
    const raw = await fs.readFile(parsedPath(vaultDir, id), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isParsedStatement(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function removeDocument(
  vaultDir: string,
  id: string,
  opts: { deleteFile: boolean }
): Promise<DocumentRecord | null> {
  assertDocumentId(id);
  return withManifestLock(vaultDir, async () => {
    const documents = await readManifest(vaultDir);
    const index = documents.findIndex((document) => document.id === id);
    if (index === -1) return null;

    const [removed] = documents.splice(index, 1);
    if (opts.deleteFile) await removeIfPresent(path.join(vaultDir, removed.fileName));
    await removeIfPresent(parsedPath(vaultDir, id));
    await writeManifest(vaultDir, documents);
    return removed;
  });
}

export async function listTransactions(vaultDir: string): Promise<StoredTransaction[]> {
  const documents = await readManifest(vaultDir);
  const parsedStatements = await Promise.all(
    documents.map(async (document) => ({
      document,
      parsed: await loadParsed(vaultDir, document.id),
    }))
  );
  // Overlapping statements for one account repeat the shared days, so drop what a
  // newer statement re-reports. Oldest period first: the earlier statement wins.
  // ponytail: date|amount|description key, same as validate.ts duplicateIssue. Ceiling:
  // two exports of one bank that word descriptions differently will not match; if that
  // bites, normalise the description (or match on referenceNumber) before hashing.
  const ordered = [...parsedStatements].sort((left, right) => {
    const leftFrom = left.document.summary?.statementPeriod.from ?? "\uffff";
    const rightFrom = right.document.summary?.statementPeriod.from ?? "\uffff";
    if (leftFrom !== rightFrom) return leftFrom < rightFrom ? -1 : 1;
    return left.document.importedAt - right.document.importedAt;
  });

  const seenBySource = new Map<string, Map<string, number>>();
  const transactions: { transaction: StoredTransaction; originalOrder: number }[] = [];
  for (const { document, parsed } of ordered) {
    const key = sourceKey(document);
    const seen = seenBySource.get(key) ?? new Map<string, number>();
    seenBySource.set(key, seen);

    const local = new Map<string, number>();
    (parsed?.transactions ?? []).forEach((transaction, originalOrder) => {
      const txnKey = `${transaction.date}|${transaction.amount}|${transaction.description}`;
      const count = (local.get(txnKey) ?? 0) + 1;
      local.set(txnKey, count);
      // Keep only the occurrences beyond what an earlier statement already contributed,
      // so a charge genuinely billed twice in one statement survives.
      if (count > (seen.get(txnKey) ?? 0)) {
        transactions.push({
          transaction: { ...transaction, documentId: document.id },
          originalOrder,
        });
      }
    });
    for (const [txnKey, count] of local) {
      seen.set(txnKey, Math.max(seen.get(txnKey) ?? 0, count));
    }
  }

  transactions.sort((left, right) => {
    if (left.transaction.date !== right.transaction.date) {
      return left.transaction.date < right.transaction.date ? 1 : -1;
    }
    if (left.transaction.documentId !== right.transaction.documentId) {
      return left.transaction.documentId < right.transaction.documentId ? -1 : 1;
    }
    return left.originalOrder - right.originalOrder;
  });
  return transactions.map(({ transaction }) => transaction);
}

export async function findOrphans(vaultDir: string): Promise<DocumentRecord[]> {
  const documents = await readManifest(vaultDir);
  const checks = await Promise.all(
    documents.map(async (document) => {
      try {
        const stat = await fs.stat(path.join(vaultDir, document.fileName));
        return { document, isOrphan: !stat.isFile() };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
        return { document, isOrphan: true };
      }
    })
  );
  return checks.filter(({ isOrphan }) => isOrphan).map(({ document }) => document);
}
