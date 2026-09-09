import { useEffect, useRef, useState } from "react";
import type { AiChart, AiProvider, AiProviderStatus, AiQueryResponse } from "../../../electron/features/ai/types";
import AiChartView from "./AiChartView";
import "./ai.css";

const suggestions = ["Where did most of my spending go? Show a category chart.", "Compare money in and money out by month.", "Which merchants did I spend the most with?"];

type Turn = { question: string; response?: AiQueryResponse; error?: string };

export default function AiPage() {
  const [statuses, setStatuses] = useState<AiProviderStatus[]>([]);
  const [provider, setProvider] = useState<AiProvider>("codex");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<string | null>(null);
  const mounted = useRef(true);
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    window.boringmoney.getAiStatus().then((next) => {
      if (!mounted.current) return;
      setStatuses(next);
      // Keep a provider the user picked while the check was still running.
      setProvider((current) => next.some((status) => status.provider === current && status.state === "ready")
        ? current
        : next.find((status) => status.state === "ready")?.provider ?? "codex");
    }).catch((cause) => {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not check AI connections.");
    });
    return () => {
      mounted.current = false;
      if (request.current) void window.boringmoney.cancelAi(request.current);
    };
  }, []);

  useEffect(() => {
    feed.current?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [turns, pending]);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    const asked = question.trim();
    // ponytail: one guard here covers both the button and the Enter key.
    if (!asked || pending || statuses.find((status) => status.provider === provider)?.state !== "ready") return;
    if (from && to && from > to) { setError("The start date must come before the end date."); return; }
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setPending(true);
    setError("");
    setQuestion("");
    setTurns((current) => [...current, { question: asked }]);
    const settle = (patch: Partial<Turn>) =>
      setTurns((current) => current.map((turn, index) => index === current.length - 1 ? { ...turn, ...patch } : turn));
    try {
      const result = await window.boringmoney.queryAi({requestId, provider, question: asked, filters:{from: from || undefined, to: to || undefined, pending:"exclude"}});
      if (mounted.current && request.current === requestId) settle({ response: result });
    } catch (cause) {
      if (mounted.current && request.current === requestId) settle({ error: cause instanceof Error ? cause.message : "The analysis failed. Try again." });
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
      <div className="ai-feed" ref={feed} aria-live="polite">
        {!turns.length && <div className="ai-empty">
          <h1>Ask your transactions</h1>
          <p className="note">Find patterns, compare months, and see where your money went.</p>
          <div className="ai-suggestions">{suggestions.map((suggestion) => <button key={suggestion} type="button" className="btn" onClick={() => setQuestion(suggestion)}>{suggestion}</button>)}</div>
        </div>}
        {turns.map((turn, index) => <div className="ai-turn" key={index}>
          <p className="ai-bubble is-you">{turn.question}</p>
          {turn.error && <p className="ai-bubble is-ai note is-warn" role="alert">{turn.error}</p>}
          {turn.response && <div className="ai-bubble is-ai">
            <div className="ai-prose">{turn.response.answer.split(/\n\s*\n/).filter(Boolean).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>
            {turn.response.charts.map((chart: AiChart, i: number) => <AiChartView key={i} chart={chart} />)}
            <p className="note ai-coverage">Based on {turn.response.coverage.filteredTransactions.toLocaleString()} of {turn.response.coverage.totalTransactions.toLocaleString()} transactions{turn.response.coverage.from && turn.response.coverage.to ? `, ${turn.response.coverage.from} to ${turn.response.coverage.to}` : ""}{turn.response.coverage.rowsOmitted > 0 ? `. ${turn.response.coverage.rowsProvided.toLocaleString()} sent in full, the rest as totals` : ""}.</p>
          </div>}
          {pending && index === turns.length - 1 && !turn.response && !turn.error && <p className="ai-bubble is-ai note">Analyzing your transaction history…</p>}
        </div>)}
      </div>

      <form className="glass ai-composer" onSubmit={ask}>
        <textarea rows={2} maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(event); }
        }} placeholder="Show my spending by category for August." aria-label="Question" required />
        <div className="ai-composer-bar">
          {/* ponytail: model and sign-in live on the sources page; here only what changes per question */}
          <select value={provider} onChange={(event) => setProvider(event.target.value as AiProvider)} disabled={pending} aria-label="AI provider">
            {(["codex", "claude"] as const).map((name) => <option key={name} value={name}>{name === "codex" ? "Codex" : "Claude"}</option>)}
          </select>
          <label>From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} disabled={pending} /></label>
          <label>To<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} disabled={pending} /></label>
          <span className="ai-composer-spacer" />
          {pending
            ? <button type="button" className="btn" onClick={cancel}>Stop</button>
            : <button className="btn btn-primary" type="submit" disabled={!question.trim() || selected?.state !== "ready"}>Ask</button>}
        </div>
        {error && <p className="note is-warn" role="alert">{error}</p>}
        {selected && selected.state !== "ready" && <p className="note is-warn">{selected.label} is not connected. <a href="#/sources">Open settings</a>.</p>}
        <p className="note ai-privacy">Transaction details go to your AI provider. Credentials and statement files stay on this machine.</p>
      </form>
    </div>
  );
}
