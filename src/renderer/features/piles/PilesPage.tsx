import { useEffect, useMemo, useState } from "react";
import {
  pileBalances,
  routeTransactions,
  summarizePayees,
  type Payee,
  type Pile,
  type PileStore,
} from "../../../electron/features/piles/piles";
import type { AiProvider } from "../../../electron/features/ai/types";
import "./piles.css";

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

function formatMoney(amount: number, currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) return `${amount.toLocaleString(undefined, { maximumFractionDigits: 20 })} ${currency}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 20 }).format(amount);
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? date : dateFormatter.format(parsed);
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function PilesPage() {
  const [vault, setVault] = useState<string | null>(null);
  const [piles, setPiles] = useState<Pile[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [transactions, setTransactions] = useState<StoredTransaction[]>([]);
  const [provider, setProvider] = useState<AiProvider>("codex");
  const [filter, setFilter] = useState("");
  const [openPile, setOpenPile] = useState<string | null>(null);
  const [openPayee, setOpenPayee] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      window.boringmoney.getVaultPath(),
      window.boringmoney.listPiles(),
      window.boringmoney.listTransactions(),
    ])
      .then(([nextVault, store, nextTransactions]) => {
        if (!active) return;
        setVault(nextVault);
        setPiles(store.piles);
        setPayees(store.payees);
        setTransactions(nextTransactions);
      })
      .catch((cause) => { if (active) setError(message(cause, "Could not load piles.")); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const { routed } = useMemo(() => routeTransactions(transactions, piles, payees), [payees, piles, transactions]);
  const balances = useMemo(() => pileBalances(piles, routed), [piles, routed]);
  const entries = useMemo(() => summarizePayees(transactions, payees), [payees, transactions]);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const payeeById = useMemo(() => new Map(payees.map((payee) => [payee.id, payee])), [payees]);
  // ponytail: the first known currency labels every total, so a vault holding two
  // currencies sums them blindly. Group per currency like summarizeTransactions if
  // anyone routes across currencies.
  const currency = transactions.find((row) => row.currency)?.currency ?? "USD";
  const unroutedEntries = entries.filter((entry) => !payeeById.get(entry.id)?.pileId);
  const ungroupedCount = entries.filter((entry) => !entry.grouped).length;
  const query = filter.trim().toLowerCase();
  const visibleEntries = unroutedEntries.filter((entry) =>
    entry.name.toLowerCase().includes(query) || entry.descriptions.some((description) => description.includes(query)));

  async function save(next: PileStore) {
    setBusy(true);
    setError("");
    try {
      const store = await window.boringmoney.savePiles(next);
      setPiles(store.piles);
      setPayees(store.payees);
    } catch (cause) {
      setError(message(cause, "Could not save piles."));
      // A rejected save leaves the screen showing what disk does not have, so go back to disk.
      try {
        const store = await window.boringmoney.listPiles();
        setPiles(store.piles);
        setPayees(store.payees);
      } catch {
        // Keep the save error on screen: it says more than a second failure would.
      }
    } finally {
      setBusy(false);
    }
  }

  function savePayees(next: Payee[]) {
    void save({ piles, payees: next });
  }

  function updatePayee(id: string, change: Partial<Payee>): Payee[] {
    return payees.map((payee) => (payee.id === id ? { ...payee, ...change } : payee));
  }

  /** An unnamed description becomes its own payee, so routing never waits on the AI. */
  function route(entry: { id: string; grouped: boolean; name: string }, pileId: string) {
    if (entry.grouped) savePayees(updatePayee(entry.id, { pileId }));
    else savePayees([...payees, { id: crypto.randomUUID(), name: entry.name.slice(0, 64), descriptions: [entry.name], pileId }]);
  }

  function split(payee: Payee, description: string) {
    savePayees([
      ...payees.map((candidate) => candidate.id === payee.id
        ? { ...candidate, descriptions: candidate.descriptions.filter((item) => item !== description) }
        : candidate),
      { id: crypto.randomUUID(), name: description.slice(0, 64), descriptions: [description] },
    ]);
  }

  function deletePile(id: string) {
    void save({
      piles: piles.filter((pile) => pile.id !== id).map((pile) => pile.fundedBy === id ? { ...pile, fundedBy: undefined } : pile),
      payees: payees.map((payee) => payee.pileId === id ? { ...payee, pileId: undefined } : payee),
    });
  }

  async function group() {
    setBusy(true);
    setError("");
    try {
      const store = await window.boringmoney.groupPayees(provider);
      setPiles(store.piles);
      setPayees(store.payees);
    } catch (cause) {
      setError(message(cause, "Could not group payees."));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <div className="pile-page"><section className="glass"><p className="empty">Loading piles…</p></section></div>;
  if (!vault) {
    return (
      <div className="pile-page">
        <section className="glass tx-empty">
          <p className="empty">No storage folder yet. Pick one and add your first source.</p>
          <a className="btn btn-primary" href="#/sources">Add a source</a>
        </section>
      </div>
    );
  }

  return (
    <div className="pile-page">
      <div aria-live="polite">{error && <p className="note is-warn">{error}</p>}</div>

      <section className="glass pile-panel" aria-labelledby="piles-title">
        <div className="section-heading">
          <h1 id="piles-title">Piles</h1>
          <div className="section-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save({ piles: [...piles, { id: crypto.randomUUID(), name: "New pile" }], payees })}>New pile</button>
          </div>
        </div>
        {piles.length === 0 ? <p className="empty">No piles yet. Make one for each place your money sits.</p> : (
          <ul className="pile-list">
            {piles.map((pile) => {
              const balance = balances.get(pile.id) ?? { moneyIn: 0, moneyOut: 0, net: 0, available: 0 };
              const funder = piles.find((candidate) => candidate.id === pile.fundedBy);
              const showAvailable = Boolean(funder) || piles.some((candidate) => candidate.fundedBy === pile.id);
              const rows = routed.get(pile.id) ?? [];
              const open = openPile === pile.id;
              return (
                <li className="pile-card" key={pile.id}>
                  <div className="pile-row">
                    <button type="button" className="pile-toggle" aria-expanded={open} aria-label={`Show ${pile.name}`} onClick={() => setOpenPile(open ? null : pile.id)}>{open ? "▾" : "▸"}</button>
                    <input
                      className="pile-name"
                      aria-label="Pile name"
                      maxLength={64}
                      value={pile.name}
                      onChange={(event) => setPiles(piles.map((candidate) => candidate.id === pile.id ? { ...candidate, name: event.target.value } : candidate))}
                      onBlur={() => void save({ piles, payees })}
                    />
                    {funder && <span className="badge">funded by {funder.name}</span>}
                    <span className="pile-figure"><span className="num is-up">{formatMoney(balance.moneyIn, currency)}</span><span className="label">In</span></span>
                    <span className="pile-figure"><span className="num is-down">{formatMoney(balance.moneyOut, currency)}</span><span className="label">Out</span></span>
                    <span className="pile-figure"><span className={`num ${balance.net < 0 ? "is-down" : "is-up"}`}>{formatMoney(balance.net, currency)}</span><span className="label">Net</span></span>
                    {showAvailable && <span className="pile-figure"><span className={`num ${balance.available < 0 ? "is-down" : "is-up"}`}>{formatMoney(balance.available, currency)}</span><span className="label">Available</span></span>}
                    <select aria-label="Funded by" value={pile.fundedBy ?? ""} disabled={busy} onChange={(event) => void save({ piles: piles.map((candidate) => candidate.id === pile.id ? { ...candidate, fundedBy: event.target.value || undefined } : candidate), payees })}>
                      <option value="">Funded by nothing</option>
                      {piles.filter((candidate) => candidate.id !== pile.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                    </select>
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => deletePile(pile.id)}>Delete</button>
                  </div>
                  {open && (
                    <div className="pile-details">
                      <ul className="pile-payees">
                        {payees.filter((payee) => payee.pileId === pile.id).length === 0 && <li className="empty">No payees yet. Route one from below.</li>}
                        {payees.filter((payee) => payee.pileId === pile.id).map((payee) => {
                          const entry = entryById.get(payee.id);
                          return (
                            <li key={payee.id}>
                              <span className="pile-match-description">{payee.name}</span>
                              <span className="num is-up">{entry && entry.moneyIn > 0 ? formatMoney(entry.moneyIn, currency) : ""}</span>
                              <span className="num is-down">{entry && entry.moneyOut > 0 ? formatMoney(entry.moneyOut, currency) : ""}</span>
                              <button type="button" className="btn" disabled={busy} onClick={() => savePayees(updatePayee(payee.id, { pileId: undefined }))}>Remove</button>
                            </li>
                          );
                        })}
                      </ul>
                      <ul className="pile-matches">
                        {rows.length === 0 && <li className="empty">Nothing matches yet.</li>}
                        {rows.map((row, rowIndex) => (
                          <li key={`${row.documentId}-${row.date}-${rowIndex}`}>
                            <span className="num">{formatDate(row.date)}</span>
                            <span className="pile-match-description">{row.description}</span>
                            <span className={`num ${row.amount < 0 ? "is-down" : "is-up"}`}>{formatMoney(row.amount, currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="glass pile-panel" aria-labelledby="unrouted-title">
        <div className="section-heading">
          <h2 id="unrouted-title">Unrouted</h2>
          <div className="section-actions">
            <input type="search" aria-label="Filter unrouted" placeholder="Filter" value={filter} onChange={(event) => setFilter(event.target.value)} />
            {ungroupedCount > 0 && <>
              <select aria-label="AI provider" value={provider} disabled={busy} onChange={(event) => setProvider(event.target.value as AiProvider)}>
                <option value="codex">Codex</option><option value="claude">Claude</option>
              </select>
              <button type="button" className="btn" disabled={busy} onClick={() => void group()}>{busy ? "Working…" : "Group with AI"}</button>
            </>}
          </div>
        </div>
        {visibleEntries.length === 0 ? <p className="empty">{unroutedEntries.length === 0 ? "Every transaction is in a pile." : "Nothing matches this filter."}</p> : (
          <ul className="pile-unrouted">
            {visibleEntries.map((entry) => {
              const payee = payeeById.get(entry.id);
              const open = openPayee === entry.id;
              return (
                <li key={entry.id}>
                  <span className="pile-unrouted-name">
                    {payee
                      ? <button type="button" className="pile-toggle" aria-expanded={open} aria-label={`Show ${entry.name}`} onClick={() => setOpenPayee(open ? null : entry.id)}>{open ? "▾" : "▸"}</button>
                      : <span className="pile-toggle" aria-hidden="true" />}
                    {payee
                      ? <input className="pile-name" aria-label="Payee name" maxLength={64} value={payee.name}
                          onChange={(event) => setPayees(updatePayee(payee.id, { name: event.target.value }))}
                          onBlur={() => savePayees(payees)} />
                      : <><span className="pile-match-description">{entry.name}</span><span className="label is-dim">ungrouped</span></>}
                  </span>
                  <span className="num is-up">{entry.moneyIn > 0 ? formatMoney(entry.moneyIn, currency) : ""}</span>
                  <span className="num is-down">{entry.moneyOut > 0 ? formatMoney(entry.moneyOut, currency) : ""}</span>
                  <select aria-label={`Route ${entry.name}`} value="" disabled={busy || piles.length === 0} onChange={(event) => route(entry, event.target.value)}>
                    <option value="">Route to…</option>
                    {piles.map((pile) => <option key={pile.id} value={pile.id}>{pile.name}</option>)}
                  </select>
                  {payee && open && (
                    <ul className="pile-descriptions">
                      {payee.descriptions.map((description) => (
                        <li key={description}>
                          <span className="pile-match-description">{description}</span>
                          {payee.descriptions.length > 1 && <button type="button" className="btn" disabled={busy} onClick={() => split(payee, description)}>Split</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
