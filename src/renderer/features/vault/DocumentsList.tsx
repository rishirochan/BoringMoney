import { FormEvent, useState } from "react";
import { sourceKey, sourceLabel } from "./sourceGroups";

type DocumentsListProps = {
  documents: DocumentRecord[];
  removingId: string | null;
  busyId: string | null;
  onRemove: (document: DocumentRecord) => void;
  onRename: (document: DocumentRecord, fileName: string) => Promise<boolean>;
  onSetAccount: (document: DocumentRecord, account: string) => Promise<boolean>;
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

function documentFacts(document: DocumentRecord): string[] {
  const summary = document.summary;
  const account = summary
    ? [summary.institution, accountKind(summary.accountKind)].filter(Boolean).join(" · ")
    : "";
  const period = summary
    ? `${formatDate(summary.statementPeriod.from)} – ${formatDate(summary.statementPeriod.to)}`
    : "";
  const count = `${document.transactionCount} ${document.transactionCount === 1 ? "transaction" : "transactions"}`;
  return [account, period, count].filter(Boolean);
}

function reviewLabel(document: DocumentRecord): string {
  if (document.status !== "parsed") return document.error ?? "The statement could not be parsed.";
  if (document.validation?.ok && document.validation.checks.balanceReconciles === true) {
    return "Reconciled";
  }
  return `Needs review · ${Math.round((document.validation?.confidence ?? 0) * 100)}% confidence`;
}

export default function DocumentsList({
  documents,
  removingId,
  busyId,
  onRemove,
  onRename,
  onSetAccount,
}: DocumentsListProps) {
  // ponytail: one form open at a time, so one {id, mode} beats a state per action
  const [editing, setEditing] = useState<{ id: string; mode: "name" | "account" } | null>(null);
  const [value, setValue] = useState("");
  const groups = new Map<string, DocumentRecord[]>();
  for (const document of documents) {
    const key = sourceKey(document);
    groups.set(key, [...(groups.get(key) ?? []), document]);
  }
  const accountOptions = [...new Set(documents.map((document) => sourceLabel(document)))];

  async function submit(event: FormEvent, document: DocumentRecord) {
    event.preventDefault();
    const saved =
      editing?.mode === "account"
        ? await onSetAccount(document, value.trim())
        : await onRename(document, value);
    if (saved) setEditing(null);
  }

  return (
    <section className="src-docs" aria-labelledby="documents-title">
      <span className="label" id="documents-title">In your folder</span>
      {documents.length === 0 ? (
        <p className="empty">Empty for now. Import a CSV and it will stay here as an ordinary file.</p>
      ) : (
        <ul className="src-groups">
          {[...groups.values()].map((group, colorIndex) => (
            <li className={`src-group source-${colorIndex % 6}`} key={sourceKey(group[0])}>
              <div className="src-group-title">{sourceLabel(group[0])}</div>
              <ul className="src-doc-list">
                {group.map((document) => {
                  const isEditing = editing?.id === document.id;
                  const isReconciled =
                    document.status === "parsed" &&
                    document.validation?.ok === true &&
                    document.validation.checks.balanceReconciles === true;
                  return (
                    <li key={document.id}>
                      <div className="src-doc-heading">
                        {isEditing ? (
                          <form className="src-rename" onSubmit={(event) => submit(event, document)}>
                            <input
                              autoFocus
                              list={editing?.mode === "account" ? "src-account-options" : undefined}
                              aria-label={
                                editing?.mode === "account"
                                  ? `Account for ${document.fileName}`
                                  : `New name for ${document.fileName}`
                              }
                              placeholder={editing?.mode === "account" ? sourceLabel(document) : undefined}
                              value={value}
                              onChange={(event) => setValue(event.target.value)}
                            />
                            <button className="btn" disabled={busyId === document.id}>Save</button>
                            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
                          </form>
                        ) : (
                          <>
                            <span className="src-doc-name">{document.fileName}</span>
                            <span className={`badge ${document.status === "parsed" ? "is-ok" : "is-bad"}`}>
                              {document.status === "parsed" ? "Parsed" : "Couldn't parse"}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="src-doc-facts">
                        {documentFacts(document).map((fact) => <span key={fact}>{fact}</span>)}
                      </div>
                      <div className={isReconciled ? "src-doc-validation" : "src-doc-validation is-warn"}>
                        {reviewLabel(document)}
                      </div>
                      <div className="src-doc-actions">
                        {!isEditing && document.fileName.toLowerCase().endsWith(".csv") && (
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setEditing({ id: document.id, mode: "name" });
                              setValue(document.fileName.replace(/\.csv$/i, ""));
                            }}
                          >
                            Rename
                          </button>
                        )}
                        {!isEditing && (
                          <button
                            type="button"
                            className="btn"
                            aria-label={`Set account for ${document.fileName}`}
                            onClick={() => {
                              setEditing({ id: document.id, mode: "account" });
                              setValue(document.account ?? "");
                            }}
                          >
                            Account
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-danger"
                          aria-label={`Remove ${document.fileName}`}
                          disabled={removingId === document.id}
                          onClick={() => onRemove(document)}
                        >
                          {removingId === document.id ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {documents.length > 0 && (
        <>
          <p className="src-hint">
            Statements in the same account are checked for overlapping transactions.
          </p>
          <datalist id="src-account-options">
            {accountOptions.map((option) => <option key={option} value={option} />)}
          </datalist>
        </>
      )}
    </section>
  );
}
