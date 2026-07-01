import { type ReactNode } from "react";

/**
 * Radial gauge — the house style for "share of a whole" / "score out of max"
 * analytics. Reads at a glance: a ring fills to the value, the figure sits in
 * the middle. Prefer this over bars for proportions and rates.
 */
export function RadialGauge({
  value, max = 100, color = "#c6ff34", track = "var(--card-2)",
  size = 96, thickness = 9, display, label,
}: {
  value: number;
  max?: number;
  color?: string;
  track?: string;
  size?: number;
  thickness?: number;
  /** Centre figure. Defaults to the rounded percentage. */
  display?: ReactNode;
  /** Small caption under the figure. */
  label?: ReactNode;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const r = (size - thickness) / 2 - 1;
  const circ = 2 * Math.PI * r;
  const c = size / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={c} cy={c} r={r} fill="none" stroke={track} strokeWidth={thickness} />
        <circle
          cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          style={{ transition: "stroke-dashoffset .6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <span className="stat-num font-display font-semibold" style={{ fontSize: size * 0.22 }}>
          {display ?? `${Math.round(pct * 100)}%`}
        </span>
        {label && <span className="mt-1 px-1 text-[10px] leading-tight text-[var(--muted)]">{label}</span>}
      </div>
    </div>
  );
}

/**
 * Multi-segment donut — proportions of a labelled set (e.g. pass / average /
 * fail) in one ring. Centre shows a headline figure.
 */
export function SegmentDonut({
  segments, size = 96, thickness = 10, centerTop, centerMain,
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerTop?: ReactNode;
  centerMain?: ReactNode;
}) {
  const r = (size - thickness) / 2 - 1;
  const circ = 2 * Math.PI * r;
  const c = size / 2;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--card-2)" strokeWidth={thickness} />
        {segments.filter((s) => s.value > 0).map((s, i) => {
          const len = (s.value / total) * circ;
          const dash = Math.max(0, len - gap);
          const el = (
            <circle
              key={i} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        {centerTop && <span className="text-[10px] text-[var(--muted)]">{centerTop}</span>}
        {centerMain && <span className="stat-num font-display font-semibold" style={{ fontSize: size * 0.2 }}>{centerMain}</span>}
      </div>
    </div>
  );
}

/**
 * Compact trend line (area + line) — the house style for "value over time"
 * series. A calm, glanceable alternative to a bar chart for time data.
 */
export function TrendLine({
  data, color = "#c6ff34", height = 120, yMax,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  /** Fixed top of the y-axis; defaults to the data max (min 1). */
  yMax?: number;
}) {
  const w = 320, padL = 22, padB = 20, padT = 10;
  const top = yMax ?? Math.max(1, ...data.map((d) => d.value));
  const innerH = height - padT - padB;
  const stepX = (w - padL) / Math.max(1, data.length - 1);
  const x = (i: number) => padL + i * stepX;
  const y = (v: number) => padT + (1 - v / top) * innerH;
  const line = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const area = `${line} ${x(data.length - 1)},${height - padB} ${x(0)},${height - padB}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="mt-2 w-full">
      {[0, 0.5, 1].map((g) => {
        const yy = padT + g * innerH;
        return <line key={g} x1={padL} x2={w} y1={yy} y2={yy} stroke="var(--border)" />;
      })}
      <polygon points={area} fill={color} fillOpacity={0.12} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r={2.5} fill={color} stroke="var(--card)" strokeWidth={1.5} />)}
      {data.map((d, i) => (
        <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className="fill-[var(--muted)]" fontSize="8">
          {d.label.length > 7 ? d.label.slice(0, 6) + "…" : d.label}
        </text>
      ))}
    </svg>
  );
}
