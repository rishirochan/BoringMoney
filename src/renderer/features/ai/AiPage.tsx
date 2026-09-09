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
  const [savingModel, setSavingModel] = useState(false);
  const [modelFeedback, setModelFeedback] = useState("");
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
      if (mounted.current) {
        setStatuses([]);
        setError(cause instanceof Error ? cause.message : "Could not check AI connections.");
      }
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

  async function changeModel(model: string) {
    setSavingModel(true);
    setModelFeedback("");
    setError("");
    try {
      const next = await window.boringmoney.setAiModel(provider, model);
      if (mounted.current) { setStatuses(next); setModelFeedback("Model saved for future questions."); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not save the model.");
    } finally {
      if (mounted.current) setSavingModel(false);
    }
  }

  function selectProvider(name: AiProvider) {
    setProvider(name);
    setModelFeedback("");
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || pending || savingModel || refreshing) return;
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
  const modelLabel = selected?.modelOptions.find((model) => model.id === selected.model)?.label;
  return (
    <div className="ai-page">
      <header className="ai-heading">
        <div><h1>Ask your transactions</h1><p>Find patterns, compare months, and see where your money went.</p></div>
        <a href="#/">View transactions</a>
      </header>
      <div className="ai-workspace">
      <div className="ai-main">
      <form className="glass ai-composer" onSubmit={ask}>
        <label htmlFor="ai-question">What would you like to understand?</label>
        <textarea id="ai-question" rows={3} maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Show my spending by category for August." disabled={pending} required />
        <div className="ai-suggestions">{suggestions.map((suggestion) => <button key={suggestion} type="button" className="btn" onClick={() => setQuestion(suggestion)} disabled={pending}>{suggestion}</button>)}</div>
        <div className="ai-scope"><label>From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} disabled={pending} /></label><label>To<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} disabled={pending} /></label></div>
        <p className="note ai-privacy">Transaction details go to your AI provider. Credentials and statement files stay on this machine.</p>
        <div className="ai-submit">{pending ? <button type="button" className="btn" onClick={cancel}>Stop analysis</button> : <button className="btn btn-primary" type="submit" disabled={selected?.state !== "ready" || refreshing || savingModel || !question.trim()}>Analyze transactions</button>}{modelLabel && <span className="note">Using {modelLabel}</span>}</div>
      </form>
      <div aria-live="polite">{error && <p className="note is-warn" role="alert">{error}</p>}{pending && <p className="note">Analyzing your transaction history…</p>}</div>
      {response && <section className="glass ai-answer" aria-labelledby="ai-answer-title">
        <p className="label">{response.provider === "codex" ? "Codex" : "Claude"} analysis{response.model ? ` · ${statuses.find((status) => status.provider === response.provider)?.modelOptions.find((model) => model.id === response.model)?.label ?? response.model}` : ""}</p><h2 id="ai-answer-title">{asked}</h2>
        <div className="ai-prose">{response.answer.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        {response.charts.map((chart: AiChart, index: number) => <AiChartView key={index} chart={chart} />)}
        <p className="note ai-coverage">Based on {response.coverage.filteredTransactions.toLocaleString()} of {response.coverage.totalTransactions.toLocaleString()} transactions{response.coverage.from && response.coverage.to ? `, ${response.coverage.from} to ${response.coverage.to}` : ""}{response.coverage.rowsOmitted > 0 ? `. ${response.coverage.rowsProvided.toLocaleString()} sent in full, the rest as totals` : ""}.</p>
      </section>}
      </div>
      <aside className="glass ai-connections" aria-labelledby="ai-connection-title">
        <h2 id="ai-connection-title">AI connection</h2>
        <div className="ai-provider-options" role="tablist" aria-label="AI provider">
          {(["codex", "claude"] as const).map((name) => {
            const status = statuses.find((item) => item.provider === name);
            const state = refreshing || !status ? "checking" : status.state === "ready" ? "connected" : "disconnected";
            return <button type="button" key={name} id={`ai-tab-${name}`} role="tab" aria-controls="ai-provider-panel" aria-selected={provider === name} tabIndex={provider === name ? 0 : -1} className={`ai-provider${provider === name ? " is-selected" : ""}`} onClick={() => selectProvider(name)} disabled={pending || savingModel} onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "codex" : event.key === "End" ? "claude" : name === "codex" ? "claude" : "codex";
              selectProvider(next);
              document.getElementById(`ai-tab-${next}`)?.focus();
            }}>
              <span>{name === "codex" ? "Codex" : "Claude"}</span>
              <span className={`ai-provider-state is-${state}`}><span className="ai-status-dot" aria-hidden="true" />{state === "checking" ? refreshing ? "Checking…" : "Unknown" : state === "connected" ? "Connected" : "Not connected"}</span>
            </button>;
          })}
        </div>
        <div id="ai-provider-panel" role="tabpanel" aria-labelledby={`ai-tab-${provider}`} className="ai-connection-detail" tabIndex={0}>
          {selected && <>
            <p className="ai-connection-message">{selected.message}</p>
            {selected.state !== "ready" && <p>Run <code>{selected.loginCommand}</code> in your terminal, then check connections.</p>}
            <label className="ai-model-label" htmlFor="ai-model">Model</label>
            <select id="ai-model" value={selected.model} onChange={(event) => void changeModel(event.target.value)} disabled={pending || refreshing || savingModel}>
              {selected.modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
            <p className="note" role="status">{savingModel ? "Saving…" : modelFeedback}</p>
            {/* ponytail: native <details> keeps the rarely-read lines out of the way */}
            <details className="ai-connection-more">
              <summary>Connection details</summary>
              <p className="note ai-model-id">{selected.model}</p>
              <p className="note">{selected.quotaNote}</p>
              {selected.version && <p className="note">CLI version: {selected.version}</p>}
            </details>
          </>}
        </div>
        <button className="btn ai-check-connection" type="button" onClick={refreshStatus} disabled={refreshing || pending || savingModel}>{refreshing ? "Checking…" : "Check connections"}</button>
      </aside>
      </div>
    </div>
  );
}
