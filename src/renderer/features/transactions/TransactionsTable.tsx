import { sourceKey, sourceLabel } from "../vault/sourceGroups";

type TransactionsTableProps = {
  documents: DocumentRecord[];
  transactions: StoredTransaction[];
  exporting: boolean;
  onExport: () => void;
};

const MAX_VISIBLE_TRANSACTIONS = 200;
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
const amountFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  signDisplay: "always",
});

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? date : dateFormatter.format(parsed);
}

export default function TransactionsTable({
  documents,
  transactions,
  exporting,
  onExport,
}: TransactionsTableProps) {
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const groupIndex = new Map<string, number>();
  documents.forEach((document) => {
    const key = sourceKey(document);
    if (!groupIndex.has(key)) groupIndex.set(key, groupIndex.size);
  });
  const visibleTransactions = transactions.slice(0, MAX_VISIBLE_TRANSACTIONS);

  return (
    <section className="glass tx-panel" aria-labelledby="transactions-title">
      <div className="section-heading">
        <h2 id="transactions-title">Transactions</h2>
        <div className="section-actions">
          {transactions.length > MAX_VISIBLE_TRANSACTIONS && (
            <span className="label">
              Showing {MAX_VISIBLE_TRANSACTIONS} of {transactions.length}
            </span>
          )}
          <button type="button" className="btn" disabled={exporting} onClick={onExport}>
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
              <th scope="col" className="tx-amount">Amount</th>
              <th scope="col">Type</th>
            </tr>
          </thead>
          <tbody>
            {visibleTransactions.map((transaction, index) => {
              const document = documentById.get(transaction.documentId);
              const label = document ? sourceLabel(document) : "Unknown source";
              const key = document ? sourceKey(document) : transaction.documentId;
              return (
                <tr
                  className={`tx-row source-${(groupIndex.get(key) ?? 0) % 6}`}
                  key={`${transaction.documentId}-${index}`}
                  title={label}
                  aria-label={`Source: ${label}`}
                >
                  <td className="tx-date num">{formatDate(transaction.date)}</td>
                  <td className="tx-description">{transaction.description}</td>
                  <td
                    className={`tx-amount num ${transaction.amount < 0 ? "is-debit" : "is-credit"}`}
                  >
                    {amountFormatter.format(transaction.amount)}
                  </td>
                  <td>
                    <span className="badge">
                      {transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
