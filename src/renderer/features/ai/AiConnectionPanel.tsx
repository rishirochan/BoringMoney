import { useEffect, useRef, useState } from "react";
import type { AiEffort, AiProvider, AiProviderStatus } from "../../../electron/features/ai/types";
import "./ai.css";

/** AI settings: which CLI to use, which model, and whether it is signed in. Lives on the sources page. */
export default function AiConnectionPanel() {
  const [statuses, setStatuses] = useState<AiProviderStatus[]>([]);
  const [provider, setProvider] = useState<AiProvider>("codex");
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);

  async function refresh() {
    setBusy(true);
    setNotice("");
    try {
      const next = await window.boringmoney.getAiStatus();
      if (!mounted.current) return;
      setStatuses(next);
      setProvider((current) => next.find((status) => status.provider === current)?.state === "ready"
        ? current : next.find((status) => status.state === "ready")?.provider ?? current);
    } catch (cause) {
      if (mounted.current) setNotice(cause instanceof Error ? cause.message : "Could not check AI connections.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, []);

  async function save(patch: { model?: string; effort?: AiEffort }) {
    setBusy(true);
    setNotice("");
    try {
      const next = await window.boringmoney.setAiSettings(provider, patch);
      if (mounted.current) { setStatuses(next); setNotice("Saved."); }
    } catch (cause) {
      if (mounted.current) setNotice(cause instanceof Error ? cause.message : "Could not save the setting.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const selected = statuses.find((status) => status.provider === provider);
  return (
    <>
      <div className="ai-conn-head">
        <h3 id="src-ai-title">AI</h3>
        <div className="ai-conn-head-side">
          <p className="note" role="status">{notice}</p>
          <button className="btn" type="button" onClick={refresh} disabled={busy}>{busy ? "Checking\u2026" : "Check connections"}</button>
        </div>
      </div>
      <div className="ai-conn-body">
        <div id="ai-provider-panel" role="tabpanel" aria-labelledby={`ai-tab-${provider}`} className="ai-connection-detail" tabIndex={0}>
          {selected && <>
            <div className="ai-conn-row">
              <label className="ai-conn-field">Model
                <select value={selected.model} onChange={(event) => void save({ model: event.target.value })} disabled={busy}>
                  {selected.modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              </label>
              <label className="ai-conn-field">Intelligence
                <select value={selected.effort} onChange={(event) => void save({ effort: event.target.value as AiEffort })} disabled={busy}>
                  {selected.effortOptions.map((effort) => <option key={effort.id} value={effort.id}>{effort.label}</option>)}
                </select>
              </label>
            </div>
            {selected.state !== "ready" && <p className="note is-warn">{selected.message} Run <code>{selected.loginCommand}</code>, then check connections.</p>}
            {/* ponytail: native <details> keeps the rarely-read lines out of the way */}
            <details className="ai-connection-more">
              <summary>Connection details</summary>
              <p className="note ai-model-id">{selected.model}</p>
              <p className="note">{selected.quotaNote}</p>
              {selected.version && <p className="note">CLI version: {selected.version}</p>}
            </details>
          </>}
        </div>
        <div className="ai-provider-options" role="tablist" aria-orientation="vertical" aria-label="AI provider">
          {(["codex", "claude"] as const).map((name) => {
            const status = statuses.find((item) => item.provider === name);
            const state = busy || !status ? "checking" : status.state === "ready" ? "connected" : "disconnected";
            const label = name === "codex" ? "Codex" : "Claude";
            const stateText = state === "checking" ? "status unknown" : state === "connected" ? "connected" : "not connected";
            return <button type="button" key={name} id={`ai-tab-${name}`} role="tab" aria-label={`${label}, ${stateText}`} title={`${label}, ${stateText}`} aria-controls="ai-provider-panel" aria-selected={provider === name} tabIndex={provider === name ? 0 : -1} className={`ai-provider${provider === name ? " is-selected" : ""}`} onClick={() => setProvider(name)} onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "codex" : event.key === "End" ? "claude" : name === "codex" ? "claude" : "codex";
              setProvider(next);
              document.getElementById(`ai-tab-${next}`)?.focus();
            }}>
              <span className={`ai-status-dot is-${state}`} aria-hidden="true" />
              <span className="ai-provider-name">{label}</span>
            </button>;
          })}
        </div>
      </div>
    </>
  );
}
