type TransactionsTableProps = {
  documents: DocumentRecord[];
  transactions: StoredTransaction[];
};

const MAX_VISIBLE_TRANSACTIONS = 200;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeZone: "UTC",
});
const amountFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  signDisplay: "always",
});

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? date : dateFormatter.format(parsed);
}

function formatType(type: StoredTransaction["type"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export default function TransactionsTable({
  documents,
  transactions,
}: TransactionsTableProps) {
  const documentNames = new Map(documents.map(({ id, fileName }) => [id, fileName]));
  // ponytail: pagination later.
  const visibleTransactions = transactions.slice(0, MAX_VISIBLE_TRANSACTIONS);

  return (
    <section className="transactions" aria-labelledby="transactions-title">
      <div className="section-heading">
        <h2 id="transactions-title">Transactions</h2>
        {transactions.length > MAX_VISIBLE_TRANSACTIONS && (
          <span>Showing {MAX_VISIBLE_TRANSACTIONS} of {transactions.length}</span>
        )}
      </div>
      {transactions.length === 0 ? (
        <p className="empty">No transactions yet. Import a statement to see them here.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <caption>Transactions parsed from imported statements</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col" className="amount">Amount</th>
                <th scope="col">Type</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {visibleTransactions.map((transaction, index) => (
                <tr key={`${transaction.documentId}-${index}`}>
                  <td className="transaction-date">{formatDate(transaction.date)}</td>
                  <td>{transaction.description}</td>
                  <td className={`amount ${transaction.amount < 0 ? "is-debit" : "is-credit"}`}>
                    {amountFormatter.format(transaction.amount)}
                  </td>
                  <td>
                    <span className="type-tag">{formatType(transaction.type)}</span>
                  </td>
                  <td className="transaction-source">
                    {documentNames.get(transaction.documentId) ?? "Unknown document"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
