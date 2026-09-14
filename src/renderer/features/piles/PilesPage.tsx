import { useEffect, useMemo, useState } from "react";
import { accountKey, accountLabel } from "../../../electron/features/analytics/transactions";
import { pileBalances, routeTransactions, type Pile, type PileRule } from "../../../electron/features/piles/piles";
import { groupUnrouted, type PileSuggestion } from "../../../electron/features/piles/suggest";
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
  const [transactions, setTransactions] = useState<StoredTransaction[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [suggestions, setSuggestions] = useState<PileSuggestion[]>([]);
  const [provider, setProvider] = useState<AiProvider>("codex");
  const [filter, setFilter] = useState("");
  const [openPile, setOpenPile] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      window.boringmoney.getVaultPath(),
      window.boringmoney.listPiles(),
      window.boringmoney.listTransactions(),
      window.boringmoney.listDocuments(),
    ])
      .then(([nextVault, nextPiles, nextTransactions, nextDocuments]) => {
        if (!active) return;
        setVault(nextVault);
        setPiles(nextPiles);
        setTransactions(nextTransactions);
        setDocuments(nextDocuments);
      })
      .catch((cause) => { if (active) setError(message(cause, "Could not load piles.")); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  const { routed, unrouted } = useMemo(() => routeTransactions(transactions, piles, documents), [documents, piles, transactions]);
  const balances = useMemo(() => pileBalances(piles, routed), [piles, routed]);
  const groups = useMemo(() => groupUnrouted(unrouted), [unrouted]);
  const accounts = useMemo(() => {
    const labels = new Map<string, string>();
    transactions.forEach((row) => labels.set(accountKey(row, documents), accountLabel(row, documents)));
    return [...labels].sort(([, left], [, right]) => left.localeCompare(right));
  }, [documents, transactions]);
  // ponytail: the first known currency labels every total, so a vault holding two
  // currencies sums them blindly. Group per currency like summarizeTransactions if
  // anyone routes across currencies.
  const currency = transactions.find((row) => row.currency)?.currency ?? "USD";
  const visibleGroups = groups.filter((group) => group.description.includes(filter.trim().toLowerCase()));

  async function save(next: Pile[]) {
    setBusy(true);
    setError("");
    try {
      setPiles(await window.boringmoney.savePiles(next));
    } catch (cause) {
      setError(message(cause, "Could not save piles."));
      // A rejected save leaves the screen showing what disk does not have, so go back to disk.
      try {
        setPiles(await window.boringmoney.listPiles());
      } catch {
        // Keep the save error on screen: it says more than a second failure would.
      }
    } finally {
      setBusy(false);
    }
  }

  function updatePile(id: string, change: Partial<Pile>): Pile[] {
    return piles.map((pile) => (pile.id === id ? { ...pile, ...change } : pile));
  }

  function addRule(id: string, rule: PileRule) {
    const pile = piles.find((candidate) => candidate.id === id);
    if (pile) void save(updatePile(id, { rules: [...pile.rules, rule] }));
  }

  function move(index: number, by: number) {
    const next = [...piles];
    const [pile] = next.splice(index, 1);
    next.splice(index + by, 0, pile);
    void save(next);
  }

  async function suggest() {
    setBusy(true);
    setError("");
    try {
      const result = await window.boringmoney.suggestPileRules(provider);
      setSuggestions(result.suggestions);
      if (result.suggestions.length === 0) setError("No rules to suggest for what is left.");
    } catch (cause) {
      setError(message(cause, "Could not suggest rules."));
    } finally {
      setBusy(false);
    }
  }

  function accept(suggestion: PileSuggestion) {
    setSuggestions((current) => current.filter((item) => item !== suggestion));
    addRule(suggestion.pileId, { pattern: suggestion.pattern, ...(suggestion.direction ? { direction: suggestion.direction } : {}) });
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
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save([...piles, { id: crypto.randomUUID(), name: "New pile", rules: [] }])}>New pile</button>
          </div>
        </div>
        {piles.length === 0 ? <p className="empty">No piles yet. Make one for each place your money sits.</p> : (
          <ul className="pile-list">
            {piles.map((pile, index) => {
              const balance = balances.get(pile.id) ?? { moneyIn: 0, moneyOut: 0, net: 0, available: 0 };
              const funder = piles.find((candidate) => candidate.id === pile.fundedBy);
              const showAvailable = Boolean(funder) || piles.some((candidate) => candidate.fundedBy === pile.id);
              const rows = routed.get(pile.id) ?? [];
              const open = openPile === pile.id;
              return (
                <li className="pile-card" key={pile.id}>
                  <div className="pile-row">
                    <button type="button" className="pile-toggle" aria-expanded={open} onClick={() => setOpenPile(open ? null : pile.id)}>{open ? "▾" : "▸"}</button>
                    <input
                      className="pile-name"
                      aria-label="Pile name"
                      maxLength={64}
                      value={pile.name}
                      onChange={(event) => setPiles(updatePile(pile.id, { name: event.target.value }))}
                      onBlur={() => void save(piles)}
                    />
                    {funder && <span className="badge">funded by {funder.name}</span>}
                    <span className="pile-figure"><span className="num is-up">{formatMoney(balance.moneyIn, currency)}</span><span className="label">In</span></span>
                    <span className="pile-figure"><span className="num is-down">{formatMoney(balance.moneyOut, currency)}</span><span className="label">Out</span></span>
                    <span className="pile-figure"><span className={`num ${balance.net < 0 ? "is-down" : "is-up"}`}>{formatMoney(balance.net, currency)}</span><span className="label">Net</span></span>
                    {showAvailable && <span className="pile-figure"><span className={`num ${balance.available < 0 ? "is-down" : "is-up"}`}>{formatMoney(balance.available, currency)}</span><span className="label">Available</span></span>}
                    <select aria-label="Funded by" value={pile.fundedBy ?? ""} disabled={busy} onChange={(event) => void save(updatePile(pile.id, { fundedBy: event.target.value || undefined }))}>
                      <option value="">Funded by nothing</option>
                      {piles.filter((candidate) => candidate.id !== pile.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                    </select>
                    <button type="button" className="btn" disabled={busy || index === 0} aria-label="Move up" onClick={() => move(index, -1)}>↑</button>
                    <button type="button" className="btn" disabled={busy || index === piles.length - 1} aria-label="Move down" onClick={() => move(index, 1)}>↓</button>
                    <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void save(piles.filter((candidate) => candidate.id !== pile.id).map((candidate) => candidate.fundedBy === pile.id ? { ...candidate, fundedBy: undefined } : candidate))}>Delete</button>
                  </div>
                  {open && (
                    <div className="pile-details">
                      <ul className="pile-rules">
                        {pile.rules.length === 0 && <li className="empty">No rules yet. Route something from below.</li>}
                        {pile.rules.map((rule, ruleIndex) => {
                          const replace = (change: Partial<PileRule>) =>
                            save(updatePile(pile.id, { rules: pile.rules.map((item, i) => i === ruleIndex ? { ...item, ...change } : item) }));
                          return (
                            <li className="pile-rule" key={ruleIndex}>
                              <input
                                aria-label="Rule text"
                                maxLength={120}
                                value={rule.pattern}
                                onChange={(event) => setPiles(updatePile(pile.id, { rules: pile.rules.map((item, i) => i === ruleIndex ? { ...item, pattern: event.target.value } : item) }))}
                                onBlur={() => void save(piles)}
                              />
                              <select aria-label="Direction" value={rule.direction ?? ""} disabled={busy} onChange={(event) => void replace({ direction: (event.target.value || undefined) as PileRule["direction"] })}>
                                <option value="">Any direction</option><option value="in">Money in</option><option value="out">Money out</option>
                              </select>
                              <select aria-label="Account" value={rule.account ?? ""} disabled={busy} onChange={(event) => void replace({ account: event.target.value || undefined })}>
                                <option value="">All accounts</option>
                                {accounts.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                              </select>
                              <button type="button" className="btn" disabled={busy} onClick={() => void save(updatePile(pile.id, { rules: pile.rules.filter((_, i) => i !== ruleIndex) }))}>Remove</button>
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
            <select aria-label="AI provider" value={provider} disabled={busy} onChange={(event) => setProvider(event.target.value as AiProvider)}>
              <option value="codex">Codex</option><option value="claude">Claude</option>
            </select>
            <button type="button" className="btn" disabled={busy || piles.length === 0 || groups.length === 0} onClick={() => void suggest()}>{busy ? "Working…" : "Suggest with AI"}</button>
          </div>
        </div>
        {suggestions.length > 0 && (
          <ul className="pile-suggestions">
            {suggestions.map((suggestion, index) => (
              <li key={index}>
                <span className="badge">{piles.find((pile) => pile.id === suggestion.pileId)?.name}</span>
                <span className="pile-match-description">{suggestion.pattern}</span>
                {suggestion.direction && <span className="label">{suggestion.direction === "in" ? "Money in" : "Money out"}</span>}
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => accept(suggestion)}>Accept</button>
                <button type="button" className="btn" onClick={() => setSuggestions((current) => current.filter((item) => item !== suggestion))}>Dismiss</button>
              </li>
            ))}
          </ul>
        )}
        {visibleGroups.length === 0 ? <p className="empty">{groups.length === 0 ? "Every transaction is in a pile." : "Nothing matches this filter."}</p> : (
          <ul className="pile-unrouted">
            {visibleGroups.map((group) => (
              <li key={group.description}>
                <span className="pile-match-description">{group.description}</span>
                <span className="label">{group.count}×</span>
                <span className="num is-up">{group.moneyIn > 0 ? formatMoney(group.moneyIn, currency) : ""}</span>
                <span className="num is-down">{group.moneyOut > 0 ? formatMoney(group.moneyOut, currency) : ""}</span>
                <select aria-label={`Route ${group.description}`} value="" disabled={busy || piles.length === 0} onChange={(event) => addRule(event.target.value, { pattern: group.description })}>
                  <option value="">Route to…</option>
                  {piles.map((pile) => <option key={pile.id} value={pile.id}>{pile.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
