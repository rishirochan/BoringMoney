# Boring Money

A local desktop app for statement imports, Plaid transactions, spending charts, and questions about your transaction history.

## Run

Requires Node.js, pnpm, and macOS, Windows, or Linux supported by Electron.

```sh
pnpm install
pnpm dev
```

`pnpm check` checks TypeScript. `pnpm test` builds the app and runs the tests. `pnpm package` creates a desktop package.

## Add transactions

Choose a storage folder in **Sources**. Import CSV statements, or enter your own Plaid client ID and secret and connect a bank. Sandbox and Production are separate environments. Production access depends on your Plaid account.

Connect starts the first transaction sync. Use **Sync transactions** in Sources to pull subsequent changes. Plaid can take time to prepare initial history; sync again if a new connection has no transactions. The app handles paginated additions, edits, removals, and pending transactions becoming posted. It saves the completed transaction batch and cursor together so a failed page cannot skip history. Each connection shows its last sync and any failure.

**Transactions** has date presets, custom dates, account and category filters, merchant search, currency selection, and pending status. Filters apply to totals, charts, the table, and CSV export. Monthly flow shows incoming and outgoing activity. Category, merchant, and account breakdowns show debits excluding known transfers. Positive amounts can include payments, refunds, and transfers, so money in is not labelled income.

Imported statements currently have unspecified currency. They stay separate from known Plaid currencies. Filter by account when comparing statement amounts whose currency is unspecified. PDF import is disabled in the current import flow. Statement overlap deduplication works within matched statement accounts; statement imports and Plaid rows are not automatically deduplicated against each other. Avoid adding the same account history through both sources when comparing totals.

## Ask AI

Install and sign in to either supported CLI before opening **Ask AI**:

- [Codex CLI](https://developers.openai.com/codex/cli), signed in with your ChatGPT subscription.
- [Claude Code](https://code.claude.com/docs/en/overview), signed in with your Claude subscription.

The app invokes the installed CLIs and reuses their login. It does not request an API key or fall back to metered API billing. Subscription quotas still apply. Each question starts a separate analysis, and Stop analysis cancels the active request.

Questions are translated into validated transaction filters. The app calculates totals and chart values locally, then asks the selected provider to explain them. Charts contain local data, not generated executable code. The writing prompt incorporates Unslop rules for direct, specific explanations.

When you ask a question, transaction details and summaries are sent to the selected provider. Statement files, Plaid secrets, and access tokens are not included. Your data stays in your chosen folder between requests; provider processing is remote. Answers show which transactions and dates were covered and whether individual rows were omitted from the prompt.

## Storage

Statement files and parsed results are stored in your chosen folder. Plaid transaction history and sync cursors are in `.boringmoney/plaid-transactions.json` there. Plaid credentials and access tokens are encrypted with Electron's operating-system-backed secure storage in the app's user-data directory.

The CLI integration follows the local-provider approach used by [T3 Code](https://github.com/pingdotgg/t3code). No shared backend is required.
