function resultDetail(result: ImportResult): string {
  if (!result.ok) return result.error ?? "failed";
  if (result.status === "failed") {
    return `imported, couldn't parse: ${result.error ?? "unknown error"}`;
  }
  if (result.status === "parsed") {
    const count = result.transactionCount ?? 0;
    const validation = result.validationOk ? "reconciled" : "needs review";
    return `${count} ${count === 1 ? "transaction" : "transactions"} · ${validation}`;
  }
  return "imported";
}

export default function ImportResults({ results }: { results: ImportResult[] }) {
  if (results.length === 0) return null;
  return (
    <ul className="results">
      {results.map((result, index) => (
        <li key={`${result.name}-${index}`} className={result.ok ? "ok" : "bad"}>
          <span className="mark" aria-hidden="true">
            {result.ok ? "✓" : "✕"}
          </span>
          <span className="name">{result.name}</span>
          <span className="detail">{resultDetail(result)}</span>
        </li>
      ))}
    </ul>
  );
}
