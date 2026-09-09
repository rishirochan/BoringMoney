import type { TransactionSummary } from "../../../electron/features/analytics/transactions";
import "./analytics.css";

type AnalyticsPanelProps = {
  summary: TransactionSummary;
};

const MAX_ROWS = 5;

function formatMoney(amount: number, currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) return `${amount.toLocaleString(undefined, { maximumFractionDigits: 20 })} ${currency}`;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 20,
  }).format(amount);
}

function Breakdown({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: TransactionSummary["categories"];
  currency: string;
}) {
  const visibleRows = rows.slice(0, MAX_ROWS);
  const maximum = Math.max(...visibleRows.map((row) => row.amount), 1);

  return (
    <section className="analytics-breakdown" aria-labelledby={`${title}-title`}>
      <h3 id={`${title}-title`}>{title} <span className="label">Top {MAX_ROWS}</span></h3>
      {visibleRows.length ? (
        <table className="analytics-table">
          <caption>Top {title.toLowerCase()} by spending</caption>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  <span>{row.label}</span>
                  <span className="analytics-bar" aria-hidden="true">
                    <span style={{ width: `${(row.amount / maximum) * 100}%` }} />
                  </span>
                </th>
                <td className="num">{formatMoney(row.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="analytics-empty">No spending in this view.</p>
      )}
    </section>
  );
}

function MonthlyFlow({ summary }: AnalyticsPanelProps) {
  const months = summary.monthly.slice(-6);
  const maximum = Math.max(
    ...months.flatMap((month) => [month.moneyIn, Math.abs(month.moneyOut)]),
    1,
  );
  const width = 600;
  const height = 132;
  const chartHeight = 96;
  const slot = width / Math.max(months.length, 1);
  const monthLabel = (month: string) => new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <section className="analytics-flow" aria-labelledby="flow-title">
      <div className="section-heading">
        <h2 id="flow-title">Monthly flow</h2>
        <span className="label">Last 6 months with activity, money in / money out</span>
      </div>
      {months.length ? (
        <>
          <svg className="flow-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly money in and money out">
            <title>Monthly flow</title>
            <desc>{months.map((month) => `${monthLabel(month.month)}: ${formatMoney(month.moneyIn, summary.currency)} in and ${formatMoney(Math.abs(month.moneyOut), summary.currency)} out`).join(". ")}</desc>
            {months.map((month, index) => {
              const inHeight = (month.moneyIn / maximum) * chartHeight;
              const outHeight = (Math.abs(month.moneyOut) / maximum) * chartHeight;
              const x = index * slot + slot * 0.22;
              const label = monthLabel(month.month);
              return (
                <g key={month.month}>
                  <title>{`${monthLabel(month.month)}: ${formatMoney(month.moneyIn, summary.currency)} in, ${formatMoney(Math.abs(month.moneyOut), summary.currency)} out`}</title>
                  <rect className="flow-in" x={x} y={chartHeight - inHeight} width={slot * 0.22} height={inHeight} rx="2" />
                  <rect className="flow-out" x={x + slot * 0.28} y={chartHeight - outHeight} width={slot * 0.22} height={outHeight} rx="2" />
                  <text x={index * slot + slot / 2} y={height - 10} textAnchor="middle">{label}</text>
                </g>
              );
            })}
          </svg>
          <div className="flow-key" aria-hidden="true">
            <span><i className="flow-dot flow-dot-in" /> Money in</span>
            <span><i className="flow-dot flow-dot-out" /> Money out</span>
          </div>
        </>
      ) : (
        <p className="analytics-empty">No dated activity in this view.</p>
      )}
    </section>
  );
}

export default function AnalyticsPanel({ summary }: AnalyticsPanelProps) {
  return (
    <section className="glass analytics-panel" aria-label="Spending analysis">
      <MonthlyFlow summary={summary} />
      <div className="analytics-breakdowns">
        <Breakdown title="Categories" rows={summary.categories} currency={summary.currency} />
        <Breakdown title="Merchants" rows={summary.merchants} currency={summary.currency} />
        <Breakdown title="Accounts" rows={summary.accounts} currency={summary.currency} />
      </div>
    </section>
  );
}
