type DocumentsListProps = {
  documents: DocumentRecord[];
  removingId: string | null;
  onRemove: (document: DocumentRecord) => void;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? date : dateFormatter.format(parsed);
}

function accountKind(kind: StatementSummary["accountKind"]): string | null {
  if (kind === "credit_card") return "Credit card";
  if (kind === "bank") return "Bank";
  return null;
}

function accountLabel(summary?: StatementSummary): string | null {
  if (!summary) return null;
  return [summary.institution, accountKind(summary.accountKind)].filter(Boolean).join(" · ") || null;
}

function periodLabel(summary?: StatementSummary): string | null {
  if (!summary) return null;
  return `${formatDate(summary.statementPeriod.from)} – ${formatDate(summary.statementPeriod.to)}`;
}

function reviewLabel(document: DocumentRecord): string {
  if (document.status !== "parsed") return document.error ?? "The statement could not be parsed.";
  if (document.validation?.ok && document.validation.checks.balanceReconciles === true) {
    return "Reconciled";
  }
  const confidence = Math.round((document.validation?.confidence ?? 0) * 100);
  return `Needs review · ${confidence}% confidence`;
}

function statusLabel(status: DocumentRecord["status"]): string {
  return status === "parsed" ? "Parsed" : "Couldn't parse";
}

export default function DocumentsList({
  documents,
  removingId,
  onRemove,
}: DocumentsListProps) {
  return (
    <section className="vault-files" aria-labelledby="documents-title">
      <h2 id="documents-title">In your folder</h2>
      {documents.length === 0 ? (
        <p className="empty">
          Empty for now. Anything you import lands in that folder as an ordinary file you can
          open yourself.
        </p>
      ) : (
        <ul className="document-list">
          {documents.map((document) => {
            const account = accountLabel(document.summary);
            const period = periodLabel(document.summary);
            const isReconciled =
              document.status === "parsed" &&
              document.validation?.ok === true &&
              document.validation.checks.balanceReconciles === true;
            return (
              <li key={document.id}>
                <div className="document-heading">
                  <span className="name">{document.fileName}</span>
                  <span className={`badge is-${document.status}`}>
                    {statusLabel(document.status)}
                  </span>
                </div>
                <div className="document-facts">
                  {account && <span>{account}</span>}
                  {period && <span>{period}</span>}
                  <span>
                    {document.transactionCount}{" "}
                    {document.transactionCount === 1 ? "transaction" : "transactions"}
                  </span>
                </div>
                <div
                  className={isReconciled ? "validation" : "validation is-warn"}
                >
                  {reviewLabel(document)}
                </div>
                <button
                  type="button"
                  className="btn btn-remove"
                  aria-label={`Remove ${document.fileName}`}
                  disabled={removingId === document.id}
                  onClick={() => onRemove(document)}
                >
                  {removingId === document.id ? "Removing…" : "Remove"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
