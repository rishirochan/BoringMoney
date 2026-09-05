import assert from "node:assert/strict";
import test from "node:test";
import {
  createLinkToken,
  exchangePublicToken,
  parsePlaidCredentials,
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
