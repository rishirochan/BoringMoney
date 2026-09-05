import { useId } from "react";
import type { AiChart } from "../../../electron/features/ai/types";

export default function AiChartView({ chart }: { chart: AiChart }) {
  const id = useId();
  const values = chart.series.flatMap((series) => series.points.map((point) => point.value));
  const max = Math.max(...values.map(Math.abs), 1);
  const format = (value: number) => value.toLocaleString(undefined, {maximumFractionDigits:20});
  return <figure className="ai-chart" aria-labelledby={id}>
    <figcaption id={id}>{chart.title}</figcaption>
    {chart.series.map((series, index) => <div key={index} className="ai-chart-series">
      <h3>{series.name}</h3>
      {chart.type === "line" && series.points.length > 1 && <svg className="ai-line-chart" viewBox="0 0 640 150" role="img" aria-label={`${series.name}. Exact values are in the table below.`}>
        <line x1="10" y1="75" x2="630" y2="75" className="ai-chart-axis" />
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={series.points.map((point, i) => `${10 + i / (series.points.length-1)*620},${75-point.value/max*65}`).join(" ")} />
        {series.points.map((point,i) => <circle key={i} cx={10+i/(series.points.length-1)*620} cy={75-point.value/max*65} r="3"><title>{point.label}: {format(point.value)}</title></circle>)}
      </svg>}
      {chart.type === "donut" && series.points.every((point) => point.value >= 0) && series.points.some((point) => point.value > 0) && <svg className="ai-donut-chart" viewBox="0 0 120 120" role="img" aria-label={`${series.name} shares. Exact values are in the table below.`}>
        {series.points.map((point, i) => {
          const total = series.points.reduce((sum,p) => sum+p.value,0);
          const offset = series.points.slice(0,i).reduce((sum,p) => sum+p.value,0)/total*100;
          return <circle key={i} cx="60" cy="60" r="42" fill="none" stroke={`var(--source-color-${i%6})`} strokeWidth="15" pathLength="100" strokeDasharray={`${point.value/total*100} 100`} strokeDashoffset={-offset} transform="rotate(-90 60 60)"><title>{point.label}: {format(point.value)}</title></circle>;
        })}
      </svg>}
      <table><caption>{chart.title}, {series.name}</caption><thead><tr><th scope="col">{chart.dataset === "monthly" ? "Month" : "Group"}</th><th scope="col">{chart.metric === "count" ? "Transactions" : "Amount"}</th></tr></thead><tbody>
        {series.points.map((point,i) => <tr key={i}><th scope="row">{point.label}{chart.type === "bar" && <span className="ai-data-bar" aria-hidden="true" style={{width:`${Math.abs(point.value)/max*100}%`}} />}</th><td className="num">{format(point.value)}</td></tr>)}
      </tbody></table>
    </div>)}
  </figure>;
}
