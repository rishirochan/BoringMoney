import { useEffect, useState } from "react";
import {
  accountLabel,
  transactionCurrency,
  transactionCategory,
} from "../../../electron/features/analytics/transactions";

type TransactionsTableProps = {
  documents: DocumentRecord[];
  transactions: StoredTransaction[];
  exporting: boolean;
  canExport: boolean;
  onExport: () => void;
};

const PAGE_SIZE = 50;
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? date : dateFormatter.format(parsed);
}

function formatAmount(amount: number, currency: string | undefined): string {
  const code = currency ?? "USD";
  if (!/^[A-Z]{3}$/.test(code)) return `${amount.toLocaleString(undefined, { maximumFractionDigits: 20 })} ${code}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 20, signDisplay: "always" }).format(amount);
}

export default function TransactionsTable({
  documents,
  transactions,
  exporting,
  canExport,
  onExport,
}: TransactionsTableProps) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(transactions.length / PAGE_SIZE);
  const visibleTransactions = transactions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => setPage(0), [transactions]);

  return (
    <section className="glass tx-panel" aria-labelledby="transactions-title">
      <div className="section-heading tx-table-heading">
        <div>
          <h2 id="transactions-title">Transactions</h2>
          <p className="tx-table-count">{transactions.length.toLocaleString()} matching activity</p>
        </div>
        <div className="section-actions">
          <button type="button" className="btn" disabled={exporting || !canExport} onClick={onExport}>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>
      <div className="tx-scroll">
        <table className="tx-table">
          <caption>Transactions imported from your sources</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Description</th>
              <th scope="col">Account</th>
              <th scope="col">Category</th>
              <th scope="col" className="tx-amount">Amount</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions.length === 0 ? <tr><td className="tx-no-results" colSpan={6}>No transactions match these filters.</td></tr> : visibleTransactions.map((transaction, index) => (
              <tr key={`${transaction.documentId}-${transaction.date}-${index}`}>
                <td className="tx-date num">{formatDate(transaction.date)}</td>
                <td className="tx-description">
                  {transaction.merchantName && transaction.merchantName !== transaction.description ? <><span>{transaction.merchantName}</span><span className="tx-raw-description">{transaction.description}</span></> : transaction.description}
                </td>
                <td>{accountLabel(transaction, documents)}</td>
                <td><span className="badge">{transactionCategory(transaction)}</span></td>
                <td className={`tx-amount num ${transaction.amount < 0 ? "is-debit" : "is-credit"}`}>
                  {formatAmount(transaction.amount, transactionCurrency(transaction))}
                </td>
                <td>{transaction.pending ? <span className="badge is-warn">Pending</span> : <span className="tx-cleared">Cleared</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <nav className="tx-pagination" aria-label="Transaction pages">
          <button className="btn" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="label">Page {page + 1} of {pageCount}</span>
          <button className="btn" type="button" disabled={page + 1 === pageCount} onClick={() => setPage(page + 1)}>Next</button>
        </nav>
      )}
    </section>
  );
}
