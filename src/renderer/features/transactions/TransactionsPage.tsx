import { useEffect, useMemo, useState } from "react";
import {
  accountKey,
  accountLabel,
  filterTransactions,
  summarizeTransactions,
  transactionCurrency,
  transactionCategory,
  type TransactionFilters,
} from "../../../electron/features/analytics/transactions";
import AnalyticsPanel from "../analytics/AnalyticsPanel";
import TransactionsTable from "./TransactionsTable";
import "./transactions.css";

type DatePreset = "all" | "month" | "30-days" | "90-days" | "year" | "custom";

const EMPTY_FILTERS: TransactionFilters = { pending: "exclude" };

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateBefore(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDate(date);
}

function presetRange(preset: Exclude<DatePreset, "custom">): Pick<TransactionFilters, "from" | "to"> {
  const today = localDate(new Date());
  if (preset === "all") return {};
  if (preset === "30-days") return { from: dateBefore(29), to: today };
  if (preset === "90-days") return { from: dateBefore(89), to: today };
  const year = new Date().getFullYear();
  return { from: preset === "month" ? `${today.slice(0, 7)}-01` : `${year}-01-01`, to: today };
}

function formatMoney(amount: number, currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) return `${amount.toLocaleString(undefined, { maximumFractionDigits: 20 })} ${currency}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 20 }).format(amount);
}

export default function TransactionsPage() {
  const [vault, setVault] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [transactions, setTransactions] = useState<StoredTransaction[]>([]);
  const [filters, setFilters] = useState<TransactionFilters>(EMPTY_FILTERS);
  const [preset, setPreset] = useState<DatePreset>("all");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"warn" | "ok">("warn");
  const [exporting, setExporting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      window.boringmoney.getVaultPath(),
      window.boringmoney.listDocuments(),
      window.boringmoney.listTransactions(),
    ])
      .then(([nextVault, nextDocuments, nextTransactions]) => {
        if (!active) return;
        setVault(nextVault);
        setDocuments(nextDocuments);
        setTransactions(nextTransactions);
      })
      .catch((error) => {
        if (!active) return;
        setNoticeKind("warn");
        setNotice(error instanceof Error ? error.message : "Could not load transactions.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => { active = false; };
  }, []);

  const accounts = useMemo(() => {
    const labels = new Map<string, string>();
    transactions.forEach((transaction) => labels.set(accountKey(transaction, documents), accountLabel(transaction, documents)));
    return [...labels.entries()].sort(([, left], [, right]) => left.localeCompare(right));
  }, [documents, transactions]);
  const categories = useMemo(
    () => [...new Set(transactions.map(transactionCategory))].sort((left, right) => left.localeCompare(right)),
    [transactions],
  );
  const currencies = useMemo(
    () => [...new Set(transactions.map(transactionCurrency))].sort(),
    [transactions],
  );
  const selectedCurrency = filters.currency && currencies.includes(filters.currency)
    ? filters.currency
    : currencies[0] ?? "USD";
  const activeFilters = useMemo(
    () => ({ ...filters, currency: selectedCurrency }),
    [filters, selectedCurrency],
  );
  const hasInvalidRange = Boolean(activeFilters.from && activeFilters.to && activeFilters.from > activeFilters.to);
  const filteredTransactions = useMemo(
    () => hasInvalidRange ? [] : filterTransactions(transactions, activeFilters, documents),
    [activeFilters, documents, hasInvalidRange, transactions],
  );
  const summary = useMemo(
    () => ({ ...summarizeTransactions(filteredTransactions, documents), currency: selectedCurrency }),
    [documents, filteredTransactions, selectedCurrency],
  );

  function changeFilter(change: Partial<TransactionFilters>) {
    setFilters((current) => ({ ...current, ...change }));
  }

  function changePreset(nextPreset: DatePreset) {
    setPreset(nextPreset);
    if (nextPreset !== "custom") {
      const range = presetRange(nextPreset);
      setFilters((current) => ({ ...current, from: range.from, to: range.to }));
    }
  }

  async function exportTransactions() {
    setExporting(true);
    setNotice("");
    try {
      const result = await window.boringmoney.exportTransactions(activeFilters);
      if (result.ok) {
        setNoticeKind("ok");
        const name = result.path.split(/[/\\]/).pop() ?? result.path;
        setNotice(`Exported ${filteredTransactions.length} transactions to ${name}.`);
      }
    } catch (error) {
      setNoticeKind("warn");
      setNotice(error instanceof Error ? error.message : "Could not export transactions.");
    } finally {
      setExporting(false);
    }
  }

  const tiles = [
    { key: "count", label: "Transactions", value: summary.count.toLocaleString(), tone: "" },
    { key: "in", label: "Money in", value: formatMoney(summary.moneyIn, summary.currency), tone: "is-up" },
    { key: "out", label: "Money out", value: formatMoney(Math.abs(summary.moneyOut), summary.currency), tone: "is-down" },
    { key: "net", label: "Net activity", value: formatMoney(summary.net, summary.currency), tone: summary.net < 0 ? "is-down" : "is-up" },
  ];

  return (
    <div className="tx-page">
      <div aria-live="polite">{notice && <p className={`note${noticeKind === "warn" ? " is-warn" : " is-ok"}`}>{notice}</p>}</div>
      {!loaded ? (
        <section className="glass tx-empty"><p className="empty">Loading transactions…</p></section>
      ) : !vault || transactions.length === 0 ? (
        <section className="glass tx-empty">
          <p className="empty">
            {vault ? "No transactions yet. Import a statement or connect a bank to see them here." : "No storage folder yet. Pick one and add your first source."}
          </p>
          <a className="btn btn-primary" href="#/sources">Add a source</a>
        </section>
      ) : (
        <>
          <section className="glass tx-filters" aria-labelledby="filter-title">
            <div className="section-heading">
              <div>
                <h1 id="filter-title">Activity</h1>
                <p className="tx-filter-note">Known transfers count in activity. Spending excludes them. Unspecified currencies stay separate from known currencies. Filter by account to compare statements with unspecified currency.</p>
              </div>
              <button type="button" className="btn" onClick={() => { setFilters(EMPTY_FILTERS); setPreset("all"); }}>Clear filters</button>
            </div>
            <div className="tx-filter-grid">
              <label>Period
                <select value={preset} onChange={(event) => changePreset(event.target.value as DatePreset)}>
                  <option value="all">All activity</option><option value="month">This month</option><option value="30-days">Last 30 days</option><option value="90-days">Last 90 days</option><option value="year">Year to date</option><option value="custom">Custom range</option>
                </select>
              </label>
              {preset === "custom" && <><label>From<input type="date" value={filters.from ?? ""} onChange={(event) => changeFilter({ from: event.target.value || undefined })} /></label><label>To<input type="date" value={filters.to ?? ""} onChange={(event) => changeFilter({ to: event.target.value || undefined })} /></label></>}
              <label>Account<select value={filters.account ?? ""} onChange={(event) => changeFilter({ account: event.target.value || undefined })}><option value="">All accounts</option>{accounts.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label>Category<select value={filters.category ?? ""} onChange={(event) => changeFilter({ category: event.target.value || undefined })}><option value="">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
              <label>Currency<select value={selectedCurrency} onChange={(event) => changeFilter({ currency: event.target.value })}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
              <label>Pending<select value={filters.pending ?? "exclude"} onChange={(event) => changeFilter({ pending: event.target.value as TransactionFilters["pending"] })}><option value="exclude">Exclude pending</option><option value="include">Include pending</option><option value="only">Pending only</option></select></label>
              <label className="tx-search">Search descriptions and merchants<input type="search" value={filters.query ?? ""} placeholder="Search activity" onChange={(event) => changeFilter({ query: event.target.value || undefined })} /></label>
            </div>
            {hasInvalidRange && <p className="note is-warn">Choose an end date on or after the start date.</p>}
          </section>
          <section className="tx-stats" aria-label="Filtered transaction totals">
            {tiles.map((tile) => <div className="glass tx-stat" key={tile.key}><span className={`tx-stat-value num ${tile.tone}`}>{tile.value}</span><span className="label">{tile.label}</span></div>)}
          </section>
          <AnalyticsPanel summary={summary} />
          <TransactionsTable documents={documents} transactions={filteredTransactions} exporting={exporting} canExport={!hasInvalidRange} onExport={exportTransactions} />
        </>
      )}
    </div>
  );
}
