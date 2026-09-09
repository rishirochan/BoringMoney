Personal Finance Dashboard — an open-source, desktop app (Electron + React) for consolidating and understanding your financial life on your own terms.
Drop in bank statement PDFs, connect live accounts via Plaid (BYOK), & get a fully customizable dashboard with AI-powered categorization and natural language spending queries.
Users bring their own Plaid and Claude/OpenAI Subscriptions — no cloud dependency, no shared infrastructure.

## Running the app

The user runs `pnpm dev` themselves and keeps it open. Never start it, restart it, or ask for it.
Verify with `pnpm check` and `pnpm test`.

## Design

Minimal and easy to read. Show the information the user asked for and nothing else: no explanatory
paragraphs beside a control that already explains itself, no status text a coloured dot can carry, no
duplicated numbers next to a chart. Prefer one flexible surface over several fixed ones, so the same
view still works when the data grows. When in doubt, cut it.
