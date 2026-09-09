import { useId, useState } from "react";
import type { ChartSelection, TransactionSummary } from "../../../electron/features/analytics/transactions";
import "./analytics.css";

type AnalyticsPanelProps = {
  summary: TransactionSummary;
  selectedSelection: ChartSelection | null;
  onSelect: (selection: ChartSelection) => void;
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
  selectedSelection,
  onSelect,
  selectionFor,
}: {
  title: string;
  rows: TransactionSummary["categories"];
  currency: string;
  selectedSelection: ChartSelection | null;
  onSelect: (selection: ChartSelection) => void;
  selectionFor: (label: string) => ChartSelection;
}) {
  const visibleRows = rows.slice(0, MAX_ROWS);
  const maximum = Math.max(...visibleRows.map((row) => row.amount), 1);

  return (
    <section className="analytics-breakdown" aria-labelledby={`${title}-title`}>
      <h3 id={`${title}-title`}>{title}{rows.length > MAX_ROWS && <span className="label"> Top {MAX_ROWS} of {rows.length}</span>}</h3>
      {visibleRows.length ? (
        <table className="analytics-table">
          <caption>Top {title.toLowerCase()} by spending</caption>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  <button
                    type="button"
                    className="analytics-select"
                    aria-pressed={selectedSelection?.direction === "spending" && Object.entries(selectionFor(row.label)).every(([key, value]) => selectedSelection[key as keyof ChartSelection] === value)}
                    onClick={() => onSelect(selectionFor(row.label))}
                  >
                    <span>{row.label}</span>
                    <span className="analytics-bar" aria-hidden="true">
                      <span style={{ width: `${(row.amount / maximum) * 100}%` }} />
                    </span>
                  </button>
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

type FlowSelection = { month: string; direction: "in" | "out" };

function FlowDetail({ month, direction, currency, id, selectedSelection, onSelect }: {
  month: TransactionSummary["monthly"][number];
  direction: FlowSelection["direction"];
  currency: string;
  id: string;
  selectedSelection: ChartSelection | null;
  onSelect: (selection: ChartSelection) => void;
}) {
  const categories = direction === "in" ? month.incomingCategories : month.outgoingCategories;
  const count = categories.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="flow-detail" id={id}>
      <p className="flow-detail-title">
        <strong>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month.month}-01T00:00:00Z`))}</strong>
        <span className={`flow-detail-direction is-${direction}`}><i className={`flow-dot flow-dot-${direction}`} /> Money {direction}</span>
      </p>
      <p className={`flow-detail-amount num is-${direction}`}>{formatMoney(direction === "in" ? month.moneyIn : month.moneyOut, currency)}</p>
      <dl className="flow-totals">
        <div><dt>Net change</dt><dd className="num">{formatMoney(month.net, currency)}</dd></div>
        <div><dt>Transactions</dt><dd className="num">{count.toLocaleString()}</dd></div>
      </dl>
      {categories.length ? (
        <>
          <p className="flow-detail-heading">By category</p>
          <ul className="flow-detail-categories">
            {categories.slice(0, MAX_ROWS).map((row) => {
              const selection = { month: month.month, category: row.label, direction };
              const isSelected = selectedSelection?.month === selection.month && selectedSelection.category === selection.category && selectedSelection.direction === selection.direction;
              return <li key={row.label}><button type="button" className="flow-detail-category" aria-pressed={isSelected} onClick={() => onSelect(selection)}><span>{row.label}</span><span className="num">{formatMoney(row.amount, currency)}</span></button></li>;
            })}
          </ul>
          {categories.length > MAX_ROWS && <p className="flow-detail-note">+{categories.length - MAX_ROWS} more</p>}
        </>
      ) : <p className="analytics-empty">No money {direction} in this month.</p>}
    </div>
  );
}

function MonthlyFlow({ summary, selectedSelection, onSelect }: AnalyticsPanelProps) {
  // Keep the preview visible while moving from a bar to its category buttons.
  const [hovered, setHovered] = useState<FlowSelection | null>(null);
  const detailId = useId();
  const months = summary.monthly.slice(-6);
  const fallback: FlowSelection | null = months.length
    ? { month: months[months.length - 1].month, direction: "out" }
    : null;
  const selectedFlow = selectedSelection?.month && (selectedSelection.direction === "in" || selectedSelection.direction === "out")
    ? { month: selectedSelection.month, direction: selectedSelection.direction }
    : null;
  const isVisibleMonth = (candidate: FlowSelection | null): candidate is FlowSelection => Boolean(candidate && months.some((month) => month.month === candidate.month));
  const selection = (isVisibleMonth(hovered) ? hovered : null) ?? (isVisibleMonth(selectedFlow) ? selectedFlow : null) ?? fallback;
  const selectedMonth = months.find((month) => month.month === selection?.month);
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
        <span className="label">Last 6 months with activity</span>
      </div>
      {months.length && selectedMonth && selection ? (
        <div className="flow-layout" onMouseLeave={() => setHovered(null)} onKeyDown={(event) => {
            if (event.key === "Escape") { setHovered(null); }
          }}>
          <div className="flow-chart-area">
            <svg className="flow-chart" viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Monthly money in and money out. Hover or focus a bar for its breakdown.">
              <title>Monthly flow</title>
              <desc>{months.map((month) => `${monthLabel(month.month)}: ${formatMoney(month.moneyIn, summary.currency)} in and ${formatMoney(Math.abs(month.moneyOut), summary.currency)} out`).join(". ")}</desc>
              {months.map((month, index) => {
                const x = index * slot + slot * 0.22;
                const label = monthLabel(month.month);
                return (
                  <g key={month.month}>
                    {(["in", "out"] as const).map((direction) => {
                      const amount = direction === "in" ? month.moneyIn : month.moneyOut;
                      const barHeight = (amount / maximum) * chartHeight;
                      const barX = x + (direction === "out" ? slot * 0.28 : 0);
                      const active = selection.month === month.month && selection.direction === direction;
                      const isSelected = selectedFlow?.month === month.month && selectedFlow.direction === direction;
                      const select = () => setHovered({ month: month.month, direction });
                      return <g key={direction} className={active ? "flow-bar is-active" : "flow-bar"} role="button" tabIndex={0}
                        aria-label={`${label}, money ${direction}: ${formatMoney(amount, summary.currency)}. Show related transactions.`}
                        aria-describedby={active ? detailId : undefined} aria-pressed={isSelected}
                        onMouseEnter={select}
                        onClick={() => onSelect({ month: month.month, direction })}
                        onFocus={select}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect({ month: month.month, direction }); }
                        }}>
                        <rect className="flow-hit-area" x={barX - 2} y={0} width={slot * 0.22 + 4} height={chartHeight + 4} rx="3" />
                        <rect className={`flow-${direction}`} x={barX} y={chartHeight - barHeight} width={slot * 0.22} height={barHeight} rx="2" />
                      </g>;
                    })}
                    <text x={index * slot + slot / 2} y={height - 10} textAnchor="middle">{label}</text>
                  </g>
                );
              })}
            </svg>
            <div className="flow-key">
              <span><i className="flow-dot flow-dot-in" aria-hidden="true" /> Money in</span>
              <span><i className="flow-dot flow-dot-out" aria-hidden="true" /> Money out</span>
              
            </div>
          </div>
          <FlowDetail month={selectedMonth} direction={selection.direction} currency={summary.currency} id={detailId} selectedSelection={selectedSelection} onSelect={onSelect} />
        </div>
      ) : (
        <p className="analytics-empty">No dated activity in this view.</p>
      )}
    </section>
  );
}

export default function AnalyticsPanel({ summary, selectedSelection, onSelect }: AnalyticsPanelProps) {
  return (
    <section className="glass analytics-panel" aria-label="Spending analysis">
      <MonthlyFlow summary={summary} selectedSelection={selectedSelection} onSelect={onSelect} />
      <div className="analytics-breakdowns">
        <Breakdown title="Categories" rows={summary.categories} currency={summary.currency} selectedSelection={selectedSelection} onSelect={onSelect} selectionFor={(category) => ({ category, direction: "spending" })} />
        <Breakdown title="Merchants" rows={summary.merchants} currency={summary.currency} selectedSelection={selectedSelection} onSelect={onSelect} selectionFor={(merchant) => ({ merchant, direction: "spending" })} />
        <Breakdown title="Accounts" rows={summary.accounts} currency={summary.currency} selectedSelection={selectedSelection} onSelect={onSelect} selectionFor={(accountLabel) => ({ accountLabel, direction: "spending" })} />
      </div>
    </section>
  );
}
