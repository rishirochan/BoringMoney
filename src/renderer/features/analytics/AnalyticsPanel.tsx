import { useId, useLayoutEffect, useRef, useState } from "react";
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

type FlowSelection = { month: string; direction: "in" | "out" };

function FlowDetail({ month, direction, currency, id }: {
  month: TransactionSummary["monthly"][number];
  direction: FlowSelection["direction"];
  currency: string;
  id: string;
}) {
  const categories = direction === "in" ? month.incomingCategories : month.outgoingCategories;
  const count = categories.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="flow-detail" id={id} role="tooltip">
      <strong>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month.month}-01T00:00:00Z`))}</strong>
      <dl className="flow-totals">
        <div><dt>Money in</dt><dd className="num">{formatMoney(month.moneyIn, currency)}</dd></div>
        <div><dt>Money out</dt><dd className="num">{formatMoney(month.moneyOut, currency)}</dd></div>
        <div><dt>Net change</dt><dd className="num">{formatMoney(month.net, currency)}</dd></div>
      </dl>
      <p className="flow-detail-heading">Money {direction} by category <span>{count} {count === 1 ? "transaction" : "transactions"}</span></p>
      {categories.length ? (
        <ul className="flow-detail-categories">
          {categories.slice(0, MAX_ROWS).map((row) => <li key={row.label}><span>{row.label}</span><span className="num">{formatMoney(row.amount, currency)}</span></li>)}
        </ul>
      ) : <p className="analytics-empty">No money {direction} in this month.</p>}
      {categories.length > MAX_ROWS && <p className="flow-detail-note">Top {MAX_ROWS} shown, {categories.length - MAX_ROWS} more {categories.length - MAX_ROWS === 1 ? "category" : "categories"}.</p>}
      <p className="flow-detail-note">Current filters apply. Includes transfers when present.</p>
    </div>
  );
}

function MonthlyFlow({ summary }: AnalyticsPanelProps) {
  const [hovered, setHovered] = useState<FlowSelection | null>(null);
  const [focused, setFocused] = useState<FlowSelection | null>(null);
  const [detailTop, setDetailTop] = useState<number>();
  const chartRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const detailId = useId();
  const months = summary.monthly.slice(-6);
  const selection = hovered ?? focused;
  const selectedMonth = months.find((month) => month.month === selection?.month);
  useLayoutEffect(() => {
    if (!selectedMonth) return;
    const positionDetail = () => {
      if (!chartRef.current || !detailRef.current) return;
      const topInset = Math.max(8, (document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0) + 8);
      detailRef.current.style.setProperty("--flow-top-inset", `${topInset}px`);
      const chart = chartRef.current.getBoundingClientRect();
      const detailHeight = detailRef.current.getBoundingClientRect().height;
      const preferredTop = chart.bottom + detailHeight <= window.innerHeight - 8 ? chart.height : -detailHeight;
      setDetailTop(Math.max(topInset - chart.top, Math.min(preferredTop, window.innerHeight - 8 - chart.top - detailHeight)));
    };
    positionDetail();
    window.addEventListener("resize", positionDetail);
    window.addEventListener("scroll", positionDetail, true);
    return () => {
      window.removeEventListener("resize", positionDetail);
      window.removeEventListener("scroll", positionDetail, true);
    };
  }, [selection, selectedMonth]);
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
          <div className="flow-chart-container" ref={chartRef} onMouseLeave={() => setHovered(null)} onKeyDown={(event) => {
            if (event.key === "Escape") { setHovered(null); setFocused(null); }
          }}>
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
                    const active = selection?.month === month.month && selection.direction === direction;
                    const show = () => setHovered({ month: month.month, direction });
                    return <g key={direction} className="flow-bar" role="button" tabIndex={0}
                      aria-label={`${label}, money ${direction}: ${formatMoney(amount, summary.currency)}. Show breakdown.`}
                      aria-describedby={active ? detailId : undefined} aria-expanded={active}
                      onMouseEnter={show} onClick={show}
                      onFocus={() => { setHovered(null); setFocused({ month: month.month, direction }); }} onBlur={() => setFocused(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFocused({ month: month.month, direction }); }
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
          {selection && selectedMonth && <div className="flow-detail-anchor" ref={detailRef} style={{ top: detailTop, left: `clamp(0px, ${(months.indexOf(selectedMonth) + 0.5) / months.length * 100}% - 10rem, max(0px, 100% - 20rem))` }}>
            <FlowDetail month={selectedMonth} direction={selection.direction} currency={summary.currency} id={detailId} />
          </div>}
          </div>
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
