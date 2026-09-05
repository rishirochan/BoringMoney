import { useCallback, useEffect, useState } from "react";
import DocumentsList from "./DocumentsList";
import DropZone from "./DropZone";
import ImportResults from "./ImportResults";
import TransactionsTable from "./TransactionsTable";

export default function VaultPage() {
  const [vault, setVault] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [transactions, setTransactions] = useState<StoredTransaction[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    window.boringmoney
      .getVaultPath()
      .then(setVault)
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "Could not load the storage folder.");
      });
  }, []);

  const refreshData = useCallback(async () => {
    const [nextDocuments, nextTransactions] = await Promise.all([
      window.boringmoney.listDocuments(),
      window.boringmoney.listTransactions(),
    ]);
    setDocuments(nextDocuments);
    setTransactions(nextTransactions);
  }, []);

  useEffect(() => {
    if (!vault) {
      setDocuments([]);
      setTransactions([]);
      return;
    }
    let active = true;

    Promise.all([window.boringmoney.listDocuments(), window.boringmoney.listTransactions()])
      .then(([nextDocuments, nextTransactions]) => {
        if (!active) return;
        setDocuments(nextDocuments);
        setTransactions(nextTransactions);
      })
      .catch((error) => {
        if (active) {
          setNotice(error instanceof Error ? error.message : "Could not load statements.");
        }
      });

    return () => {
      active = false;
    };
  }, [vault]);

  async function choose(): Promise<string | null> {
    try {
      const picked = await window.boringmoney.chooseVault();
      if (picked) {
        setVault(picked);
        setNotice("");
      }
      return picked;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not choose a storage folder.");
      return null;
    }
  }

  async function importPaths(paths: string[]) {
    if (!paths.length) return;
    // ponytail: dropping before a folder exists just asks for one, no separate onboarding step
    const target = vault ?? (await choose());
    if (!target) {
      setResults([]);
      setNotice("Choose a storage folder before importing.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      // ponytail: results show the last import only; persist a log if history is ever wanted
      setResults(await window.boringmoney.importFiles(paths));
    } catch (error) {
      setResults([]);
      setNotice(error instanceof Error ? error.message : "Import failed.");
    } finally {
      try {
        await refreshData();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not refresh statements.");
      }
      setBusy(false);
    }
  }

  async function remove(document: DocumentRecord) {
    const confirmed = window.confirm(
      `Remove ${document.fileName} and everything parsed from it? The file moves to the Trash.`
    );
    if (!confirmed) return;

    setRemovingId(document.id);
    setNotice("");
    try {
      await window.boringmoney.deleteDocument(document.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove the statement.");
    } finally {
      try {
        await refreshData();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not refresh statements.");
      }
      setRemovingId(null);
    }
  }

  return (
    <main className="app">
      <header className="masthead">
        <h1>Boring Money</h1>
        <p>Everything stays on this machine.</p>
      </header>

      <section className="vault">
        <div className="vault-text">
          <span className="label">Storage folder</span>
          <span className={vault ? "path" : "path is-unset"}>
            {vault ?? "Not chosen yet"}
          </span>
        </div>
        <button type="button" className="btn" onClick={choose}>
          {vault ? "Change" : "Choose folder"}
        </button>
      </section>

      <DropZone hasVault={!!vault} onFiles={importPaths} />

      <div className="status" aria-live="polite" aria-busy={busy}>
        {busy && <p className="note">Importing…</p>}
        {notice && <p className="note is-warn">{notice}</p>}
        <ImportResults results={results} />
      </div>

      <DocumentsList documents={documents} removingId={removingId} onRemove={remove} />
      <TransactionsTable documents={documents} transactions={transactions} />
    </main>
  );
}
