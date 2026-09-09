import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveDocument } from "../dist-electron/features/documents/store.js";
import {
  listAllTransactions,
  syncPlaidTransactions,
} from "../dist-electron/features/plaid/transactions.js";

const credentials = {
  clientId: "client-id",
  secret: "sandbox-secret",
  environment: "sandbox",
};

const connection = {
  itemId: "item-one",
  accessToken: "access-one",
  institutionName: "Test Bank",
  accounts: [{ id: "account-one", name: "Checking", mask: "1234", type: "depository" }],
};

function plaidTransaction(overrides = {}) {
  return {
    transaction_id: "transaction-one",
    account_id: "account-one",
    date: "2026-08-03",
    authorized_date: "2026-08-02",
    name: "CARD PURCHASE COFFEE SHOP",
    merchant_name: "Coffee Shop",
    amount: 12.34,
    iso_currency_code: "usd",
    unofficial_currency_code: null,
    pending: true,
    personal_finance_category: { primary: "FOOD_AND_DRINK" },
    ...overrides,
  };
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function syncPage(overrides = {}) {
  return {
    added: [],
    modified: [],
    removed: [],
    next_cursor: "next-cursor",
    has_more: false,
    ...overrides,
  };
}

async function withVault(run) {
  const vault = await mkdtemp(path.join(os.tmpdir(), "boringmoney-plaid-"));
  try {
    await run(vault);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
}

test("syncs every page and merges Plaid with statement transactions without cross-source dedup", async () => {
  await withVault(async (vault) => {
    await saveDocument(
      vault,
      {
        id: "11111111-1111-4111-8111-111111111111",
        fileName: "statement.csv",
        sha256: "abc",
        size: 1,
        importedAt: 1,
        status: "parsed",
        transactionCount: 1,
      },
      {
        summary: {
          statementPeriod: { from: "2026-08-02", to: "2026-08-02" },
          openingBalance: null,
          closingBalance: null,
          totalPurchasesFees: 12.34,
          totalPaymentsCredits: 0,
          accountKind: "bank",
        },
        transactions: [
          {
            date: "2026-08-02",
            description: "Coffee Shop",
            amount: -12.34,
            type: "purchase",
            rawLine: "Coffee Shop",
          },
        ],
        validation: {
          ok: true,
          confidence: 1,
          issues: [],
          checks: { balanceReconciles: null, totalsMatch: null, datesInPeriod: true },
        },
        parser: "test",
      }
    );

    const requests = [];
    const fetcher = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return body.cursor === "page-two"
        ? response(
            syncPage({
              modified: [plaidTransaction({ pending: false, amount: 10 })],
              next_cursor: "saved-cursor",
            })
          )
        : response(
            syncPage({
              added: [plaidTransaction()],
              next_cursor: "page-two",
              has_more: true,
            })
          );
    };

    const { results } = await syncPlaidTransactions(
      vault,
      credentials,
      [connection],
      undefined,
      fetcher
    );
    assert.deepEqual(
      requests.map(({ cursor, count }) => ({ cursor, count })),
      [
        { cursor: undefined, count: 500 },
        { cursor: "page-two", count: 500 },
      ]
    );
    assert.equal(results[0].added, 1);
    assert.equal(results[0].modified, 1);
    assert.equal(results[0].transactionCount, 1);
    assert.equal(typeof results[0].lastSyncedAt, "number");

    const transactions = await listAllTransactions(vault);
    assert.equal(transactions.length, 2);
    const plaid = transactions.find(({ source }) => source === "plaid");
    assert.deepEqual(
      {
        amount: plaid.amount,
        date: plaid.date,
        postedDate: plaid.postedDate,
        description: plaid.description,
        merchantName: plaid.merchantName,
        accountName: plaid.accountName,
        category: plaid.category,
        currency: plaid.currency,
        pending: plaid.pending,
      },
      {
        amount: -10,
        date: "2026-08-02",
        postedDate: "2026-08-03",
        description: "CARD PURCHASE COFFEE SHOP",
        merchantName: "Coffee Shop",
        accountName: "Test Bank · Checking ····1234",
        category: "FOOD_AND_DRINK",
        currency: "USD",
        pending: false,
      }
    );
    assert.equal(transactions.find(({ source }) => source === "statement").source, "statement");

    const removalRequests = [];
    const removal = await syncPlaidTransactions(
      vault,
      credentials,
      [connection],
      undefined,
      async (_url, init) => {
        removalRequests.push(JSON.parse(init.body));
        return response(
          syncPage({
            removed: [{ transaction_id: "transaction-one", account_id: "account-one" }],
            next_cursor: "after-removal",
          })
        );
      }
    );
    assert.equal(removalRequests[0].cursor, "saved-cursor");
    assert.equal(removal.results[0].removed, 1);
    assert.equal(removal.results[0].transactionCount, 0);
    assert.deepEqual((await listAllTransactions(vault)).map(({ source }) => source), ["statement"]);
  });
});

test("restarts changed pagination from the saved cursor and discards partial pages", async () => {
  await withVault(async (vault) => {
    const cursors = [];
    const fetcher = async (_url, init) => {
      const { cursor } = JSON.parse(init.body);
      cursors.push(cursor);
      if (cursors.length === 1) {
        return response(
          syncPage({
            added: [plaidTransaction({ transaction_id: "discard-me" })],
            next_cursor: "unstable-page",
            has_more: true,
          })
        );
      }
      if (cursors.length === 2) {
        return response(
          {
            error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
            error_message: "transactions changed",
          },
          400
        );
      }
      return response(
        syncPage({ added: [plaidTransaction({ transaction_id: "keep-me" })] })
      );
    };

    const { results } = await syncPlaidTransactions(
      vault,
      credentials,
      [connection],
      undefined,
      fetcher
    );
    assert.deepEqual(cursors, [undefined, "unstable-page", undefined]);
    assert.equal(results[0].transactionCount, 1);
    assert.equal((await listAllTransactions(vault))[0].transactionId, "keep-me");
  });
});

test("keeps the last complete snapshot when a later page fails", async () => {
  await withVault(async (vault) => {
    await syncPlaidTransactions(
      vault,
      credentials,
      [connection],
      undefined,
      async () => response(syncPage({ added: [plaidTransaction()] }))
    );

    let call = 0;
    const { results } = await syncPlaidTransactions(
      vault,
      credentials,
      [connection],
      undefined,
      async (_url, init) => {
        call += 1;
        if (call === 1) assert.equal(JSON.parse(init.body).cursor, "next-cursor");
        if (call === 1) {
          return response(
            syncPage({
              modified: [plaidTransaction({ amount: 99 })],
              next_cursor: "second-page",
              has_more: true,
            })
          );
        }
        return response({ error_code: "INSTITUTION_DOWN", error_message: "bank unavailable" }, 500);
      }
    );
    assert.equal(results[0].error, "bank unavailable");
    assert.equal(results[0].transactionCount, 1);
    assert.equal((await listAllTransactions(vault))[0].amount, -12.34);
  });
});

test("stops pagination when Plaid repeats a cursor", async () => {
  await withVault(async (vault) => {
    const { results } = await syncPlaidTransactions(
      vault,
      credentials,
      [connection],
      undefined,
      async () => response(syncPage({ next_cursor: "stuck", has_more: true }))
    );
    assert.equal(results[0].error, "Plaid sync did not advance its cursor.");
  });
});

test("rejects damaged cached transaction metadata", async () => {
  await withVault(async (vault) => {
    const directory = path.join(vault, ".boringmoney");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "plaid-transactions.json"),
      JSON.stringify({
        version: 1,
        items: [
          {
            itemId: "item-one",
            cursor: "cursor",
            transactions: [
              {
                source: "plaid",
                documentId: "plaid:item-one",
                transactionId: "transaction-one",
                accountId: "account-one",
                date: "2026-08-02",
                description: "Coffee",
                amount: -1,
                type: "purchase",
                rawLine: "Coffee",
                category: { primary: "FOOD_AND_DRINK" },
              },
            ],
          },
        ],
      })
    );
    await assert.rejects(listAllTransactions(vault), /cache is damaged/);
  });
});

test("marks only Plaid's explicit credit card repayment category as a transfer", async () => {
  await withVault(async (vault) => {
    const cardPayment = plaidTransaction({
      transaction_id: "card-payment",
      personal_finance_category: {
        primary: "LOAN_PAYMENTS",
        detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      },
    });
    const otherLoanPayment = plaidTransaction({
      transaction_id: "loan-payment",
      personal_finance_category: {
        primary: "LOAN_PAYMENTS",
        detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
      },
    });
    await syncPlaidTransactions(
      vault,
      credentials,
      [connection],
      undefined,
      async () => response(syncPage({ added: [cardPayment, otherLoanPayment] }))
    );

    const transactions = await listAllTransactions(vault);
    assert.equal(transactions.find(({ transactionId }) => transactionId === "card-payment").isTransfer, true);
    assert.equal(transactions.find(({ transactionId }) => transactionId === "loan-payment").isTransfer, false);
  });
});
