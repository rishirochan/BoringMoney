import { promises as fs } from "node:fs";
import path from "node:path";
import { listTransactions } from "../documents/store.js";
import { classifyTransaction, cleanDescription } from "../statements/classify.js";
import type { AccountKind, StoredTransaction } from "../statements/types.js";
import {
  fetchTransactionUpdates,
  PlaidApiError,
  type PlaidCredentials,
  type PlaidTransaction,
} from "./client.js";

export type PlaidSyncAccount = {
  id: string;
  name: string;
  mask: string | null;
  type: string | null;
};

export type PlaidSyncConnection = {
  itemId: string;
  accessToken: string;
  institutionName: string;
  accounts: PlaidSyncAccount[];
};

export type PlaidSyncResult = {
  itemId: string;
  institutionName: string;
  added: number;
  modified: number;
  removed: number;
  transactionCount: number;
  lastSyncedAt?: number;
  error?: string;
};

type CachedItem = {
  itemId: string;
  cursor: string;
  transactions: StoredTransaction[];
  lastSyncedAt?: number;
  lastSyncError?: string;
};

type PlaidCache = { version: 1; items: CachedItem[] };

type SyncUpdate = {
  cursor: string;
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transactionId: string }[];
};

const CACHE_VERSION = 1;
const MAX_PAGINATION_RESTARTS = 3;
const TRANSACTION_TYPES = new Set(["purchase", "payment", "fee", "refund", "interest"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const syncQueues = new Map<string, Promise<void>>();

function cachePath(vaultDir: string): string {
  return path.join(vaultDir, ".boringmoney", "plaid-transactions.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isCachedTransaction(value: unknown): value is StoredTransaction {
  return (
    isObject(value) &&
    value.source === "plaid" &&
    typeof value.documentId === "string" &&
    typeof value.transactionId === "string" &&
    typeof value.accountId === "string" &&
    typeof value.date === "string" &&
    ISO_DATE.test(value.date) &&
    (value.postedDate === undefined ||
      (typeof value.postedDate === "string" && ISO_DATE.test(value.postedDate))) &&
    typeof value.description === "string" &&
    typeof value.amount === "number" &&
    Number.isFinite(value.amount) &&
    typeof value.type === "string" &&
    TRANSACTION_TYPES.has(value.type) &&
    isOptionalString(value.referenceNumber) &&
    (value.balance === undefined ||
      (typeof value.balance === "number" && Number.isFinite(value.balance))) &&
    typeof value.rawLine === "string" &&
    isOptionalString(value.accountName) &&
    isOptionalString(value.category) &&
    isOptionalString(value.currency) &&
    isOptionalBoolean(value.pending) &&
    isOptionalBoolean(value.isTransfer) &&
    isOptionalString(value.merchantName)
  );
}

function isCachedItem(value: unknown): value is CachedItem {
  return (
    isObject(value) &&
    typeof value.itemId === "string" &&
    typeof value.cursor === "string" &&
    Array.isArray(value.transactions) &&
    value.transactions.every(isCachedTransaction) &&
    (value.lastSyncedAt === undefined || typeof value.lastSyncedAt === "number") &&
    (value.lastSyncError === undefined || typeof value.lastSyncError === "string")
  );
}

async function readCache(vaultDir: string): Promise<PlaidCache> {
  let raw: string;
  try {
    raw = await fs.readFile(cachePath(vaultDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: CACHE_VERSION, items: [] };
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (!isObject(value) || value.version !== CACHE_VERSION || !Array.isArray(value.items)) {
    throw new Error("Plaid transaction cache is damaged.");
  }
  if (!value.items.every(isCachedItem)) throw new Error("Plaid transaction cache is damaged.");
  return { version: CACHE_VERSION, items: value.items };
}

async function writeCache(vaultDir: string, cache: PlaidCache): Promise<void> {
  const filePath = cachePath(vaultDir);
  const temporaryPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function withSyncLock<T>(vaultDir: string, action: () => Promise<T>): Promise<T> {
  const key = path.resolve(vaultDir);
  const previous = syncQueues.get(key) ?? Promise.resolve();
  const operation = previous.then(action, action);
  const tail = operation.then(
    () => undefined,
    () => undefined
  );
  syncQueues.set(key, tail);
  try {
    return await operation;
  } finally {
    if (syncQueues.get(key) === tail) syncQueues.delete(key);
  }
}

function accountKind(type: string | null | undefined): AccountKind {
  if (type === "credit") return "credit_card";
  if (type === "depository") return "bank";
  return "unknown";
}

function normalizeTransaction(
  transaction: PlaidTransaction,
  connection: PlaidSyncConnection
): StoredTransaction {
  const account = connection.accounts.find(({ id }) => id === transaction.accountId);
  const amount = -transaction.amount;
  const description = cleanDescription(transaction.name);
  const authorizedDate = transaction.authorizedDate;
  const accountName = account
    ? `${connection.institutionName} · ${account.name}${account.mask ? ` ····${account.mask}` : ""}`
    : connection.institutionName;
  return {
    documentId: `plaid:${connection.itemId}`,
    source: "plaid",
    transactionId: transaction.transactionId,
    accountId: transaction.accountId,
    accountName,
    category: transaction.category,
    currency: transaction.currency,
    pending: transaction.pending,
    isTransfer:
      transaction.category === "TRANSFER_IN" ||
      transaction.category === "TRANSFER_OUT" ||
      transaction.categoryDetail === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    merchantName: transaction.merchantName,
    date: authorizedDate ?? transaction.date,
    postedDate: authorizedDate && authorizedDate !== transaction.date ? transaction.date : undefined,
    description,
    amount,
    type: classifyTransaction(description, amount, accountKind(account?.type)),
    referenceNumber: transaction.transactionId,
    rawLine: transaction.name,
  };
}

async function pullUpdates(
  credentials: PlaidCredentials,
  connection: PlaidSyncConnection,
  startingCursor: string | undefined,
  fetcher: typeof fetch
): Promise<SyncUpdate> {
  let restartCount = 0;
  while (true) {
    let cursor = startingCursor;
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: { transactionId: string }[] = [];
    const seenCursors = new Set(cursor === undefined ? [] : [cursor]);
    try {
      while (true) {
        const page = await fetchTransactionUpdates(credentials, connection.accessToken, cursor, fetcher);
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed);
        if (page.hasMore && seenCursors.has(page.nextCursor)) {
          throw new Error("Plaid sync did not advance its cursor.");
        }
        cursor = page.nextCursor;
        if (!page.hasMore) return { cursor, added, modified, removed };
        seenCursors.add(cursor);
      }
    } catch (error) {
      if (
        error instanceof PlaidApiError &&
        error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
        restartCount < MAX_PAGINATION_RESTARTS
      ) {
        restartCount += 1;
        continue;
      }
      throw error;
    }
  }
}

function applyUpdates(
  current: StoredTransaction[],
  update: SyncUpdate,
  connection: PlaidSyncConnection
): StoredTransaction[] {
  const transactions = new Map(
    current.flatMap((transaction) =>
      transaction.transactionId ? [[transaction.transactionId, transaction] as const] : []
    )
  );
  for (const transaction of [...update.added, ...update.modified]) {
    transactions.set(transaction.transactionId, normalizeTransaction(transaction, connection));
  }
  for (const transaction of update.removed) transactions.delete(transaction.transactionId);
  return [...transactions.values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Plaid sync failed.";
}

export async function syncPlaidTransactions(
  vaultDir: string,
  credentials: PlaidCredentials,
  connections: PlaidSyncConnection[],
  itemId?: string,
  fetcher: typeof fetch = fetch
): Promise<{ results: PlaidSyncResult[] }> {
  if (itemId !== undefined && !connections.some((connection) => connection.itemId === itemId)) {
    throw new Error("Plaid connection not found.");
  }
  const selected = itemId
    ? connections.filter((connection) => connection.itemId === itemId)
    : connections;
  return withSyncLock(vaultDir, async () => {
    const cache = await readCache(vaultDir);
    const attempts = await Promise.allSettled(
      selected.map(async (connection) => {
        const cached = cache.items.find((item) => item.itemId === connection.itemId);
        return {
          connection,
          update: await pullUpdates(credentials, connection, cached?.cursor, fetcher),
        };
      })
    );
    const results = attempts.map((attempt, index): PlaidSyncResult => {
      const connection = selected[index];
      const existingIndex = cache.items.findIndex((item) => item.itemId === connection.itemId);
      const existing = cache.items[existingIndex];
      if (attempt.status === "rejected") {
        const failed: CachedItem = existing ?? {
          itemId: connection.itemId,
          cursor: "",
          transactions: [],
        };
        failed.lastSyncError = errorMessage(attempt.reason);
        if (existingIndex === -1) cache.items.push(failed);
        return {
          itemId: connection.itemId,
          institutionName: connection.institutionName,
          added: 0,
          modified: 0,
          removed: 0,
          transactionCount: failed.transactions.length,
          lastSyncedAt: failed.lastSyncedAt,
          error: failed.lastSyncError,
        };
      }
      const lastSyncedAt = Date.now();
      const item: CachedItem = {
        itemId: connection.itemId,
        cursor: attempt.value.update.cursor,
        transactions: applyUpdates(existing?.transactions ?? [], attempt.value.update, connection),
        lastSyncedAt,
      };
      if (existingIndex === -1) cache.items.push(item);
      else cache.items[existingIndex] = item;
      return {
        itemId: connection.itemId,
        institutionName: connection.institutionName,
        added: attempt.value.update.added.length,
        modified: attempt.value.update.modified.length,
        removed: attempt.value.update.removed.length,
        transactionCount: item.transactions.length,
        lastSyncedAt,
      };
    });
    await writeCache(vaultDir, cache);
    return { results };
  });
}

export async function removePlaidTransactions(vaultDir: string, itemId: string): Promise<void> {
  await withSyncLock(vaultDir, async () => {
    const cache = await readCache(vaultDir);
    const items = cache.items.filter((item) => item.itemId !== itemId);
    if (items.length !== cache.items.length) await writeCache(vaultDir, { ...cache, items });
  });
}

export async function plaidSyncStatus(
  vaultDir: string
): Promise<Map<string, { lastSyncedAt?: number; syncError?: string; transactionCount: number }>> {
  const cache = await readCache(vaultDir);
  return new Map(
    cache.items.map((item) => [
      item.itemId,
      {
        lastSyncedAt: item.lastSyncedAt,
        syncError: item.lastSyncError,
        transactionCount: item.transactions.length,
      },
    ])
  );
}

export async function listAllTransactions(vaultDir: string): Promise<StoredTransaction[]> {
  const [statements, cache] = await Promise.all([listTransactions(vaultDir), readCache(vaultDir)]);
  const transactions = [
    ...statements.map((transaction) => ({ ...transaction, source: "statement" as const })),
    ...cache.items.flatMap((item) => item.transactions),
  ];
  return transactions.sort((left, right) => {
    if (left.date !== right.date) return left.date < right.date ? 1 : -1;
    const leftId = left.transactionId ?? `${left.documentId}:${left.referenceNumber ?? ""}`;
    const rightId = right.transactionId ?? `${right.documentId}:${right.referenceNumber ?? ""}`;
    return leftId.localeCompare(rightId);
  });
}
