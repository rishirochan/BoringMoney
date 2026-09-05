import { useEffect, useRef, useState } from "react";
import type { AiChart, AiProvider, AiProviderStatus, AiQueryResponse } from "../../../electron/features/ai/types";
import AiChartView from "./AiChartView";
import "./ai.css";

const suggestions = ["Where did most of my spending go? Show a category chart.", "Compare money in and money out by month.", "Which merchants did I spend the most with?"];

export default function AiPage() {
  const [statuses, setStatuses] = useState<AiProviderStatus[]>([]);
  const [provider, setProvider] = useState<AiProvider>("codex");
  const [question, setQuestion] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<AiQueryResponse | null>(null);
  const [asked, setAsked] = useState("");
  const request = useRef<string | null>(null);
  const mounted = useRef(true);

  async function refreshStatus() {
    setRefreshing(true);
    setError("");
    try {
      const next = await window.boringmoney.getAiStatus();
      if (!mounted.current) return;
      setStatuses(next);
      setProvider((current) => next.find((status) => status.provider === current)?.state === "ready"
        ? current : next.find((status) => status.state === "ready")?.provider ?? current);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not check AI connections.");
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => {
      mounted.current = false;
      if (request.current) void window.boringmoney.cancelAi(request.current);
    };
  }, []);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || pending) return;
    if (from && to && from > to) { setError("The start date must come before the end date."); return; }
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setPending(true);
    setError("");
    setResponse(null);
    setAsked(question.trim());
    try {
      const result = await window.boringmoney.queryAi({requestId, provider, question:question.trim(), filters:{from:from || undefined,to:to || undefined,pending:"exclude"}});
      if (mounted.current && request.current === requestId) setResponse(result);
    } catch (cause) {
      if (mounted.current && request.current === requestId) setError(cause instanceof Error ? cause.message : "The analysis failed. Try again.");
    } finally {
      if (mounted.current && request.current === requestId) { setPending(false); request.current = null; }
    }
  }

  async function cancel() {
    if (!request.current) return;
    try { await window.boringmoney.cancelAi(request.current); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not stop the request."); }
  }

  const selected = statuses.find((status) => status.provider === provider);
  return (
    <div className="ai-page">
      <header className="ai-heading">
        <div><h1>Ask your transactions</h1><p>Find patterns, compare months, and see where your money went.</p></div>
        <a href="#/">View transactions</a>
      </header>
      <section className="glass ai-connections" aria-labelledby="ai-connection-title">
        <div className="section-heading"><h2 id="ai-connection-title">Your AI subscription</h2><button className="btn" type="button" onClick={refreshStatus} disabled={refreshing || pending}>{refreshing ? "Checking…" : "Check connections"}</button></div>
        <div className="ai-provider-options" role="group" aria-label="AI provider">
          {(["codex", "claude"] as const).map((name) => {
            const status = statuses.find((item) => item.provider === name);
            return <button type="button" key={name} className={`btn ai-provider${provider === name ? " is-selected" : ""}`} aria-pressed={provider === name} onClick={() => setProvider(name)} disabled={pending}>
              <span>{name === "codex" ? "Codex" : "Claude Code"}</span><span className="ai-provider-state">{refreshing ? "Checking…" : status?.state === "ready" ? "Connected" : "Setup needed"}</span>
            </button>;
          })}
        </div>
        {selected && <div className="ai-connection-detail"><p>{selected.message}</p>{selected.state !== "ready" && <p>Run <code>{selected.loginCommand}</code> in your terminal, then check connections.</p>}<p className="note">{selected.quotaNote}</p></div>}
      </section>
      <form className="glass ai-composer" onSubmit={ask}>
        <label htmlFor="ai-question">What would you like to understand?</label>
        <textarea id="ai-question" rows={3} maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Show my spending by category for August." disabled={pending} required />
        <div className="ai-suggestions">{suggestions.map((suggestion) => <button key={suggestion} type="button" className="btn" onClick={() => setQuestion(suggestion)} disabled={pending}>{suggestion}</button>)}</div>
        <div className="ai-scope"><label>From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} disabled={pending} /></label><label>To<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} disabled={pending} /></label><span className="note">Leave dates empty to use all posted transactions.</span></div>
        <p className="note ai-privacy">When you ask, transaction details and summaries are sent to the selected AI provider through your signed-in CLI. Your subscription limits apply. Bank credentials and statement files are not included.</p>
        <div className="ai-submit">{pending ? <button type="button" className="btn" onClick={cancel}>Stop analysis</button> : <button className="btn btn-primary" type="submit" disabled={selected?.state !== "ready" || refreshing || !question.trim()}>Analyze transactions</button>}<span className="note">Each question starts a new analysis.</span></div>
      </form>
      <div aria-live="polite">{error && <p className="note is-warn" role="alert">{error}</p>}{pending && <p className="note">Analyzing your transaction history…</p>}</div>
      {response && <section className="glass ai-answer" aria-labelledby="ai-answer-title">
        <p className="label">{response.provider === "codex" ? "Codex" : "Claude Code"} analysis</p><h2 id="ai-answer-title">{asked}</h2>
        <div className="ai-prose">{response.answer.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        {response.charts.map((chart: AiChart, index: number) => <AiChartView key={index} chart={chart} />)}
        <p className="note ai-coverage">Based on {response.coverage.filteredTransactions.toLocaleString()} of {response.coverage.totalTransactions.toLocaleString()} transactions{response.coverage.from && response.coverage.to ? `, ${response.coverage.from} to ${response.coverage.to}` : ""}. {response.coverage.rowsOmitted > 0 ? `${response.coverage.rowsProvided} individual rows were included; the rest are represented in totals.` : "All matching rows were included."} Amounts in different currencies stay separate. Statement currencies are unspecified unless provided.</p>
      </section>}
    </div>
  );
}
