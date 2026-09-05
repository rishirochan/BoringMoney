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

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${name} is required.`);
  }
  return value.trim();
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
    throw new Error(
      typeof message === "string" && message ? message : `Plaid request failed (${response.status}).`
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
