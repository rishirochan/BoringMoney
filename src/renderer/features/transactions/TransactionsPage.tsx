import { useEffect, useState } from "react";
import TransactionsTable from "./TransactionsTable";
import "./transactions.css";

const currency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default function TransactionsPage() {
  const [vault, setVault] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [transactions, setTransactions] = useState<StoredTransaction[]>([]);
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
    return () => {
      active = false;
    };
  }, []);

  async function exportTransactions() {
    setExporting(true);
    setNotice("");
    try {
      const result = await window.boringmoney.exportTransactions();
      if (result.ok) {
        setNoticeKind("ok");
        const name = result.path.split(/[/\\]/).pop() ?? result.path;
        setNotice(`Exported ${transactions.length} transactions to ${name}.`);
      }
    } catch (error) {
      setNoticeKind("warn");
      setNotice(error instanceof Error ? error.message : "Could not export transactions.");
    } finally {
      setExporting(false);
    }
  }

  // ponytail: recomputed each render; a few hundred rows is nothing, memoize when it isn't
  const moneyIn = transactions.reduce((sum, t) => (t.amount > 0 ? sum + t.amount : sum), 0);
  const moneyOut = transactions.reduce((sum, t) => (t.amount < 0 ? sum + t.amount : sum), 0);
  // ponytail: a parsed-but-corrupt file whose rows never stored counts as "hidden" here too;
  // split the two only if the miscount ever confuses someone
  const hidden =
    documents.reduce((sum, d) => (d.status === "parsed" ? sum + d.transactionCount : sum), 0) -
    transactions.length;

  const tiles = [
    { key: "count", label: "Transactions", value: transactions.length.toLocaleString(), tone: "" },
    { key: "in", label: "Money in", value: currency.format(moneyIn), tone: "is-up" },
    { key: "out", label: "Money out", value: currency.format(Math.abs(moneyOut)), tone: "is-down" },
    {
      key: "net",
      label: "Net",
      value: currency.format(moneyIn + moneyOut),
      tone: moneyIn + moneyOut < 0 ? "is-down" : "is-up",
    },
  ];

  return (
    <div className="tx-page">
      <section className="tx-stats" aria-label="Transaction totals">
        {tiles.map((tile) => (
          <div className="glass tx-stat" key={tile.key}>
            <span className={`tx-stat-value num ${tile.tone}`}>{tile.value}</span>
            <span className="label">{tile.label}</span>
          </div>
        ))}
      </section>

      {hidden > 0 && (
        <p className="tx-hidden">
          <span className="num">{hidden.toLocaleString()}</span> overlapping duplicates hidden
        </p>
      )}

      <div aria-live="polite">
        {notice && (
          <p className={`note${noticeKind === "warn" ? " is-warn" : " is-ok"}`}>{notice}</p>
        )}
      </div>

      {!loaded ? null : !vault || transactions.length === 0 ? (
        <section className="glass tx-empty">
          <p className="empty">
            {vault
              ? "No transactions yet. Import a statement or connect a bank to see them here."
              : "No storage folder yet. Pick one and add your first source."}
          </p>
          <a className="btn btn-primary" href="#/sources">
            Add a source
          </a>
        </section>
      ) : (
        <TransactionsTable
          documents={documents}
          transactions={transactions}
          exporting={exporting}
          onExport={exportTransactions}
        />
      )}
    </div>
  );
}
