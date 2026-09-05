import { useCallback, useEffect, useState } from "react";
import PlaidSection from "../plaid/PlaidSection";
import DocumentsList from "../vault/DocumentsList";
import DropZone from "../vault/DropZone";
import ImportResults from "../vault/ImportResults";
import "./sources.css";

export default function SourcesPage() {
  const [vault, setVault] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"warn" | "ok">("warn");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    window.boringmoney
      .getVaultPath()
      .then(setVault)
      .catch((error) => {
        setNotice(error instanceof Error ? error.message : "Could not load the storage folder.");
      });
  }, []);

  const refreshData = useCallback(async () => {
    setDocuments(await window.boringmoney.listDocuments());
  }, []);

  useEffect(() => {
    if (!vault) {
      setDocuments([]);
      return;
    }
    let active = true;

    window.boringmoney
      .listDocuments()
      .then((nextDocuments) => {
        if (active) setDocuments(nextDocuments);
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

  async function rename(document: DocumentRecord, fileName: string): Promise<boolean> {
    setBusyId(document.id);
    setNotice("");
    try {
      await window.boringmoney.renameDocument(document.id, fileName);
      await refreshData();
      return true;
    } catch (error) {
      setNoticeKind("warn");
      setNotice(error instanceof Error ? error.message : "Could not rename the CSV.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function setAccount(document: DocumentRecord, account: string): Promise<boolean> {
    setBusyId(document.id);
    setNotice("");
    try {
      await window.boringmoney.setDocumentAccount(document.id, account);
      await refreshData();
      return true;
    } catch (error) {
      setNoticeKind("warn");
      setNotice(error instanceof Error ? error.message : "Could not set the account.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="src-page">
      <div className="src-head">
        <h2>Sources</h2>
        <p className="src-dim">
          Statements you drop in and banks you connect. Everything stays on this machine.
        </p>
      </div>

      <div className="src-grid">
        <section className="glass src-panel" aria-labelledby="src-statements-title">
          <h3 id="src-statements-title">Statements</h3>

          <div className="src-folder">
            <div className="src-folder-text">
              <span className="label">Storage folder</span>
              <span className={vault ? "src-path" : "src-path is-unset"}>
                {vault ?? "Not chosen yet"}
              </span>
            </div>
            <button type="button" className="btn" onClick={choose}>
              {vault ? "Change" : "Choose folder"}
            </button>
          </div>

          <DropZone hasVault={!!vault} onFiles={importPaths} />

          <div className="status" aria-live="polite" aria-busy={busy}>
            {busy && <p className="note">Importing…</p>}
            {notice && (
              <p className={`note${noticeKind === "warn" ? " is-warn" : " is-ok"}`}>{notice}</p>
            )}
            <ImportResults results={results} />
          </div>

          <DocumentsList
            documents={documents}
            removingId={removingId}
            busyId={busyId}
            onRemove={remove}
            onRename={rename}
            onSetAccount={setAccount}
          />
        </section>

        <section className="glass src-panel" aria-labelledby="src-banks-title">
          <h3 id="src-banks-title">Banks</h3>
          <PlaidSection />
        </section>
      </div>
    </div>
  );
}
