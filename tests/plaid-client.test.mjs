import assert from "node:assert/strict";
import test from "node:test";
import {
  createLinkToken,
  exchangePublicToken,
  fetchTransactionUpdates,
  isTrustedPlaidLinkUrl,
  parsePlaidCredentials,
  PLAID_LINK_URL,
  removeItem,
} from "../dist-electron/features/plaid/client.js";

const credentials = {
  clientId: "client-id",
  secret: "sandbox-secret",
  environment: "sandbox",
};

test("validates credentials at the IPC boundary", () => {
  assert.deepEqual(parsePlaidCredentials({ ...credentials, clientId: " client-id " }), credentials);
  assert.throws(
    () => parsePlaidCredentials({ ...credentials, environment: "development" }),
    /Sandbox or Production/
  );
});

test("creates and exchanges Plaid tokens without exposing credentials to the renderer", async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    const body = url.endsWith("/link/token/create")
      ? { link_token: "link-sandbox-test" }
      : { access_token: "access-sandbox-test", item_id: "item-test" };
    return new Response(JSON.stringify(body), { status: 200 });
  };

  assert.equal(await createLinkToken(credentials, "local-user", fetcher), "link-sandbox-test");
  assert.deepEqual(await exchangePublicToken(credentials, "public-test", fetcher), {
    accessToken: "access-sandbox-test",
    itemId: "item-test",
  });
  await removeItem(credentials, "access-sandbox-test", fetcher);
  assert.equal(requests[0].url, "https://sandbox.plaid.com/link/token/create");
  assert.equal(requests[0].body.user.client_user_id, "local-user");
  assert.deepEqual(requests[0].body.products, ["transactions"]);
  assert.equal(requests[1].body.public_token, "public-test");
  assert.equal(requests[2].url, "https://sandbox.plaid.com/item/remove");
  assert.equal(requests[2].body.access_token, "access-sandbox-test");
});

test("uses Plaid's API error message", async () => {
  const fetcher = async () =>
    new Response(JSON.stringify({ error_code: "INVALID_API_KEYS", error_message: "bad keys" }), {
      status: 400,
    });
  await assert.rejects(createLinkToken(credentials, "local-user", fetcher), /bad keys/);
});

test("times out stalled Plaid requests", async () => {
  const timeout = AbortSignal.timeout;
  let timeoutMs;
  AbortSignal.timeout = (milliseconds) => {
    timeoutMs = milliseconds;
    return AbortSignal.abort(new DOMException("timed out", "TimeoutError"));
  };
  try {
    const fetcher = async (_url, init) => {
      init.signal.throwIfAborted();
    };
    await assert.rejects(createLinkToken(credentials, "local-user", fetcher), /timed out/);
    assert.equal(timeoutMs, 30_000);
  } finally {
    AbortSignal.timeout = timeout;
  }
});

test("trusts only the Plaid Link document for navigation and callbacks", () => {
  assert.equal(isTrustedPlaidLinkUrl(`${PLAID_LINK_URL}#token=link-test`), true);
  assert.equal(isTrustedPlaidLinkUrl("https://example.com/"), false);
  assert.equal(isTrustedPlaidLinkUrl("boring-money://plaid-link/redirect"), false);
  assert.equal(isTrustedPlaidLinkUrl("boring-money://plaid-link/?redirect=1"), false);
  assert.equal(isTrustedPlaidLinkUrl("not a URL"), false);
});

test("sync tolerates removals without account_id and blank optional fields", async () => {
  const fetcher = async () =>
    new Response(
      JSON.stringify({
        added: [
          {
            transaction_id: "tx-1",
            account_id: "acct-1",
            date: "2026-01-02",
            name: "Coffee",
            merchant_name: "",
            iso_currency_code: "",
            personal_finance_category: { primary: "", detailed: "" },
            amount: 4.5,
            pending: false,
          },
        ],
        modified: [],
        removed: [{ transaction_id: "tx-0" }],
        next_cursor: "cursor-1",
        has_more: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const updates = await fetchTransactionUpdates(credentials, "access-token", undefined, fetcher);
  assert.deepEqual(updates.removed, [{ transactionId: "tx-0" }]);
  assert.equal(updates.added[0].merchantName, undefined);
  assert.equal(updates.added[0].currency, undefined);
  assert.equal(updates.added[0].category, undefined);
});
