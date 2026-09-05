import { useEffect, useState } from "react";
import DropZone from "./DropZone";

type Result = { name: string; ok: boolean; error?: string };
type VaultFile = { name: string; size: number; importedAt: number };

const size = (n: number) =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
    maximumFractionDigits: 1,
  }).format(n);

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function VaultPage() {
  const [vault, setVault] = useState<string | null>(null);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.boringmoney.getVaultPath().then(setVault);
  }, []);

  useEffect(() => {
    if (vault) window.boringmoney.listFiles().then(setFiles);
  }, [vault]);

  async function choose() {
    const picked = await window.boringmoney.chooseVault();
    if (picked) {
      setVault(picked);
      setNotice("");
    }
    return picked;
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
      setFiles(await window.boringmoney.listFiles());
    } catch (e) {
      setResults([]);
      setNotice(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
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
        {results.length > 0 && (
          <ul className="results">
            {results.map((result, index) => (
              <li key={index} className={result.ok ? "ok" : "bad"}>
                <span className="mark" aria-hidden="true">
                  {result.ok ? "✓" : "✕"}
                </span>
                <span className="name">{result.name}</span>
                <span className="detail">{result.ok ? "imported" : result.error ?? "failed"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <section className="vault-files">
        <h2>In your folder</h2>
        {files.length === 0 ? (
          <p className="empty">
            Empty for now. Anything you import lands in that folder as an ordinary
            file you can open yourself.
          </p>
        ) : (
          <ul className="filelist">
            {files.map((file) => (
              <li key={file.name}>
                <span className="name">{file.name}</span>
                <span className="meta">
                  {size(file.size)} · {when(file.importedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
