import { FormEvent, useEffect, useState } from "react";

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Plaid could not complete the request.";
}

export default function PlaidSection() {
  const [status, setStatus] = useState<PlaidStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [isError, setIsError] = useState(false);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [environment, setEnvironment] = useState<PlaidEnvironment>("sandbox");
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (!window.boringmoney) {
      setStatus({ configured: false, environment: "sandbox", connections: [] });
      return;
    }
    window.boringmoney
      .getPlaidStatus()
      .then((nextStatus) => {
        setStatus(nextStatus);
        setEnvironment(nextStatus.environment);
      })
      .catch((error) => {
        setNotice(errorMessage(error));
        setIsError(true);
      });
  }, []);

  async function connect() {
    setBusy(true);
    setNotice("");
    try {
      const result = await window.boringmoney.connectPlaid();
      if (result.status === "connected") {
        setStatus(await window.boringmoney.getPlaidStatus());
        setNotice(`${result.connection.institutionName} is connected.`);
        setIsError(false);
      }
    } catch (error) {
      setNotice(errorMessage(error));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }

  async function saveAndConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const nextStatus = await window.boringmoney.savePlaidCredentials({
        clientId,
        secret,
        environment,
      });
      setStatus(nextStatus);
      setEditing(false);
      setClientId("");
      setSecret("");
      setShowSecret(false);
      setBusy(false);
      await connect();
    } catch (error) {
      setNotice(errorMessage(error));
      setIsError(true);
      setBusy(false);
    }
  }

  async function editCredentials() {
    setNotice("");
    try {
      const credentials = await window.boringmoney.getPlaidCredentials();
      setClientId(credentials.clientId);
      setSecret(credentials.secret);
      setEnvironment(credentials.environment);
      setShowSecret(false);
      setEditing(true);
      setIsError(false);
    } catch (error) {
      setNotice(errorMessage(error));
      setIsError(true);
    }
  }

  async function disconnect(connection: PlaidConnection) {
    if (!window.confirm(`Disconnect ${connection.institutionName} from Plaid?`)) return;
    setDisconnectingId(connection.id);
    setNotice("");
    try {
      setStatus(await window.boringmoney.disconnectPlaid(connection.id));
      setNotice(`${connection.institutionName} is disconnected.`);
      setIsError(false);
    } catch (error) {
      setNotice(errorMessage(error));
      setIsError(true);
    } finally {
      setDisconnectingId(null);
    }
  }

  const showForm = status?.configured !== true || editing;

  return (
    <div className="src-plaid">
      <div className="src-intro">
        <span className="label">Plaid · bring your own keys</span>
        <p className="src-dim">
          Your client ID and secret are encrypted by your operating system and sent only to Plaid.
        </p>
      </div>

      {showForm ? (
        <form className="src-form" onSubmit={saveAndConnect}>
          <p className="src-dim">Find both values under Developers, then Keys in your Plaid dashboard.</p>
          <label className="src-field">
            <span className="label">Client ID</span>
            <input
              name="clientId"
              required
              autoComplete="off"
              spellCheck={false}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            />
          </label>
          <div className="src-field">
            <label className="label" htmlFor="plaid-secret">
              Secret
            </label>
            <div className="src-secret-input">
              <input
                id="plaid-secret"
                name="secret"
                type={showSecret ? "text" : "password"}
                required
                autoComplete="off"
                spellCheck={false}
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
              <button
                className="src-secret-toggle"
                type="button"
                aria-label={showSecret ? "Hide secret" : "Show secret"}
                aria-pressed={showSecret}
                onClick={() => setShowSecret((visible) => !visible)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                  <circle cx="12" cy="12" r="2.5" />
                  {showSecret && <path d="m4 4 16 16" />}
                </svg>
              </button>
            </div>
          </div>
          <label className="src-field">
            <span className="label">Environment</span>
            <select
              name="environment"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value as PlaidEnvironment)}
            >
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </select>
            <span className="src-hint">
              Sandbox uses test banks. Production connects real accounts and requires Plaid access.
            </span>
          </label>
          <div className="src-actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Connecting..." : "Save keys and connect"}
            </button>
            {status?.configured && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setClientId("");
                  setSecret("");
                  setShowSecret(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="src-configured">
          <div className="src-configured-text">
            <span className="label">Configured</span>
            <span className="src-mono">
              {status.environment === "sandbox" ? "Sandbox" : "Production"} · client ID ····
              {status.clientIdLast4}
            </span>
          </div>
          <div className="src-actions">
            {status.connections.length === 0 && (
              <button className="btn" type="button" onClick={editCredentials}>
                Edit keys
              </button>
            )}
            <button className="btn btn-primary" type="button" disabled={busy} onClick={connect}>
              {busy ? "Opening Plaid..." : "Connect a bank"}
            </button>
          </div>
        </div>
      )}

      <div className="status" aria-live="polite" aria-busy={busy}>
        {notice && <p className={`note ${isError ? "is-warn" : "is-ok"}`}>{notice}</p>}
      </div>

      {status?.configured && (
        <section className="src-banks" aria-labelledby="src-connected-title">
          <div className="section-heading">
            <span className="label" id="src-connected-title">
              Connected banks
            </span>
            <span className="num">{status.connections.length}</span>
          </div>
          {status.connections.length === 0 ? (
            <p className="empty">No bank connected yet. Sandbox is the safest place to test.</p>
          ) : (
            <ul className="src-bank-list">
              {status.connections.map((connection) => (
                <li key={connection.id}>
                  <div className="src-bank-info">
                    <strong>{connection.institutionName}</strong>
                    {connection.accounts.length > 0 && (
                      <span className="src-dim">
                        {connection.accounts
                          .map((account) => `${account.name}${account.mask ? ` ····${account.mask}` : ""}`)
                          .join(", ")}
                      </span>
                    )}
                    <span className="src-dim">
                      Connected {dateFormatter.format(connection.connectedAt)}
                    </span>
                  </div>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={disconnectingId === connection.id}
                    onClick={() => disconnect(connection)}
                  >
                    {disconnectingId === connection.id ? "Disconnecting..." : "Disconnect"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
