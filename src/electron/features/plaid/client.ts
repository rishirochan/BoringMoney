export type PlaidEnvironment = "sandbox" | "production";

export const PLAID_LINK_SCHEME = "boring-money";
export const PLAID_LINK_URL = `${PLAID_LINK_SCHEME}://plaid-link/`;
const PLAID_REQUEST_TIMEOUT_MS = 30_000;

export type PlaidCredentials = {
  clientId: string;
  secret: string;
  environment: PlaidEnvironment;
};

type JsonObject = Record<string, unknown>;

export class PlaidApiError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "PlaidApiError";
  }
}

export type PlaidTransaction = {
  transactionId: string;
  accountId: string;
  date: string;
  authorizedDate?: string;
  name: string;
  merchantName?: string;
  amount: number;
  currency?: string;
  category?: string;
  categoryDetail?: string;
  pending: boolean;
};

export type PlaidTransactionUpdates = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transactionId: string; accountId: string }[];
  nextCursor: string;
  hasMore: boolean;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${name} is required.`);
  }
  return value.trim();
}

function boundedString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`${name} is invalid.`);
  }
  return value;
}

export function isTrustedPlaidLinkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href === PLAID_LINK_URL;
  } catch {
    return false;
  }
}

export function parsePlaidCredentials(value: unknown): PlaidCredentials {
  if (!isObject(value)) throw new TypeError("Plaid credentials are required.");
  if (value.environment !== "sandbox" && value.environment !== "production") {
    throw new TypeError("Choose Sandbox or Production.");
  }
  return {
    clientId: requiredString(value.clientId, "Client ID", 128),
    secret: requiredString(value.secret, "Secret", 256),
    environment: value.environment,
  };
}

async function plaidPost(
  credentials: PlaidCredentials,
  endpoint: string,
  body: JsonObject,
  fetcher: typeof fetch
): Promise<JsonObject> {
  const response = await fetcher(`https://${credentials.environment}.plaid.com${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(PLAID_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      client_id: credentials.clientId,
      secret: credentials.secret,
      ...body,
    }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isObject(payload) || typeof payload.error_code === "string") {
    const message = isObject(payload)
      ? payload.display_message ?? payload.error_message
      : undefined;
    throw new PlaidApiError(
      typeof message === "string" && message ? message : `Plaid request failed (${response.status}).`,
      isObject(payload) && typeof payload.error_code === "string" ? payload.error_code : undefined
    );
  }
  return payload;
}

export async function createLinkToken(
  credentials: PlaidCredentials,
  clientUserId: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const payload = await plaidPost(
    credentials,
    "/link/token/create",
    {
      client_name: "Boring Money",
      country_codes: ["US"],
      language: "en",
      products: ["transactions"],
      user: { client_user_id: clientUserId },
    },
    fetcher
  );
  return requiredString(payload.link_token, "Plaid link token", 512);
}

export async function exchangePublicToken(
  credentials: PlaidCredentials,
  publicToken: string,
  fetcher: typeof fetch = fetch
): Promise<{ accessToken: string; itemId: string }> {
  const payload = await plaidPost(
    credentials,
    "/item/public_token/exchange",
    { public_token: requiredString(publicToken, "Plaid public token", 512) },
    fetcher
  );
  return {
    accessToken: requiredString(payload.access_token, "Plaid access token", 512),
    itemId: requiredString(payload.item_id, "Plaid item ID", 512),
  };
}

export async function removeItem(
  credentials: PlaidCredentials,
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  await plaidPost(
    credentials,
    "/item/remove",
    { access_token: requiredString(accessToken, "Plaid access token", 512) },
    fetcher
  );
}

function optionalString(value: unknown, name: string, maxLength: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredString(value, name, maxLength);
}

function parseDate(value: unknown, name: string): string {
  const date = requiredString(value, name, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError(`${name} is invalid.`);
  return date;
}

function parseTransaction(value: unknown): PlaidTransaction {
  if (!isObject(value) || !Number.isFinite(value.amount) || typeof value.pending !== "boolean") {
    throw new TypeError("Plaid returned an invalid transaction.");
  }
  const personalCategory = isObject(value.personal_finance_category)
    ? optionalString(value.personal_finance_category.primary, "Plaid category", 128)
    : undefined;
  const categoryDetail = isObject(value.personal_finance_category)
    ? optionalString(value.personal_finance_category.detailed, "Plaid category detail", 128)
    : undefined;
  const currency =
    optionalString(value.iso_currency_code, "Plaid currency", 16) ??
    optionalString(value.unofficial_currency_code, "Plaid currency", 16);
  return {
    transactionId: requiredString(value.transaction_id, "Plaid transaction ID", 512),
    accountId: requiredString(value.account_id, "Plaid account ID", 512),
    date: parseDate(value.date, "Plaid transaction date"),
    authorizedDate:
      value.authorized_date === null || value.authorized_date === undefined
        ? undefined
        : parseDate(value.authorized_date, "Plaid authorized date"),
    name: requiredString(value.name, "Plaid transaction name", 1024),
    merchantName: optionalString(value.merchant_name, "Plaid merchant name", 1024),
    amount: value.amount as number,
    currency: currency?.toUpperCase(),
    category: personalCategory,
    categoryDetail,
    pending: value.pending,
  };
}

function parseTransactionList(value: unknown): PlaidTransaction[] {
  if (!Array.isArray(value)) throw new TypeError("Plaid returned invalid transaction updates.");
  return value.map(parseTransaction);
}

export async function fetchTransactionUpdates(
  credentials: PlaidCredentials,
  accessToken: string,
  cursor?: string,
  fetcher: typeof fetch = fetch
): Promise<PlaidTransactionUpdates> {
  const payload = await plaidPost(
    credentials,
    "/transactions/sync",
    {
      access_token: requiredString(accessToken, "Plaid access token", 512),
      count: 500,
      ...(cursor === undefined ? {} : { cursor: boundedString(cursor, "Plaid cursor", 2048) }),
    },
    fetcher
  );
  if (typeof payload.has_more !== "boolean" || !Array.isArray(payload.removed)) {
    throw new TypeError("Plaid returned invalid transaction updates.");
  }
  return {
    added: parseTransactionList(payload.added),
    modified: parseTransactionList(payload.modified),
    removed: payload.removed.map((removed) => {
      if (!isObject(removed)) throw new TypeError("Plaid returned invalid removed transactions.");
      return {
        transactionId: requiredString(removed.transaction_id, "Plaid transaction ID", 512),
        accountId: requiredString(removed.account_id, "Plaid account ID", 512),
      };
    }),
    nextCursor: boundedString(payload.next_cursor, "Plaid cursor", 2048),
    hasMore: payload.has_more,
  };
}
