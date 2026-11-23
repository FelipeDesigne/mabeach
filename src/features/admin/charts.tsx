import { useState, type ReactNode } from 'react'

/**
 * Gráficos do painel, em SVG/HTML simples (sem biblioteca): uma série por gráfico, na cor da marca,
 * barras finas com ponta arredondada, grade discreta, dica ao passar o dedo/mouse e tabela com os números.
 */

const NAVY = '#081021'
const NAVY_SOFT = '#55607a'
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('pt-BR') : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }))

/** Topo do eixo arredondado (1, 2, 5, 10, 20...). */
function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}

export type Column = { label: string; value: number; hint?: string; tag?: string }

/** Colunas verticais (hora do dia, dia da semana, dia a dia). A coluna marcada com `tag` ganha destaque e rótulo. */
export function ColumnChart({
  data,
  height = 180,
  unit = '',
  ariaLabel,
  width = 1000,
}: {
  data: Column[]
  height?: number
  unit?: string
  ariaLabel: string
  /** Largura do desenho: gráficos em meia coluna usam um valor menor para o texto não ficar miúdo. */
  width?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = width
  const H = height
  const top = 22
  const bottom = 26
  const left = 36
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)))
  const slot = (W - left) / Math.max(1, data.length)
  const bar = Math.min(24 * (W / 700), slot * 0.62)
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max)
  const ticks = [0, max / 2, max]
  const showEvery = data.length > 16 ? Math.ceil(data.length / 12) : 1
  const h = hover !== null ? data[hover] : null

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="#e4ddcf" strokeWidth="1" />
            <text x={left - 6} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize="13" fill="#5b6273">
              {fmt(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = left + slot * i + slot / 2
          const yTop = y(d.value)
          const hgt = Math.max(0, H - bottom - yTop)
          const r = Math.min(4 * (W / 700), bar / 2, hgt)
          const path =
            hgt > 0
              ? `M${cx - bar / 2},${H - bottom} V${yTop + r} Q${cx - bar / 2},${yTop} ${cx - bar / 2 + r},${yTop} H${cx + bar / 2 - r} Q${cx + bar / 2},${yTop} ${cx + bar / 2},${yTop + r} V${H - bottom} Z`
              : ''
          return (
            <g key={i}>
              {path && <path d={path} fill={d.tag ? NAVY : NAVY_SOFT} opacity={hover === null || hover === i ? 1 : 0.55} />}
              {d.tag && d.value > 0 && (
                <text x={cx} y={yTop - 7} textAnchor="middle" fontSize="13" fontWeight="700" fill={NAVY}>
                  {d.tag}
                </text>
              )}
              {i % showEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="13" fill="#5b6273">
                  {d.label}
                </text>
              )}
              {/* Área de toque maior que a barra. */}
              <rect
                x={left + slot * i}
                y={top}
                width={slot}
                height={H - top - bottom}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.hint ?? d.label}: ${fmt(d.value)}${unit}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="cursor-default outline-none"
              />
            </g>
          )
        })}
        <line x1={left} x2={W} y1={H - bottom} y2={H - bottom} stroke="#cfc6b4" strokeWidth="1" />
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg bg-navy px-2.5 py-1.5 text-xs whitespace-nowrap text-beige shadow-lg"
          style={{ left: `${((left + slot * hover + slot / 2) / W) * 100}%` }}
        >
          <span className="text-sm font-bold">
            {fmt(h.value)}
            {unit}
          </span>{' '}
          <span className="opacity-80">{h.hint ?? h.label}</span>
        </div>
      )}
    </figure>
  )
}

/** Mapa de calor (linhas x colunas), uma cor só: mais escuro = mais movimento. */
export function Heatmap({ rows, cols, values, ariaLabel }: { rows: string[]; cols: string[]; values: number[][]; ariaLabel: string }) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null)
  const max = Math.max(1, ...values.flat())
  const shade = (v: number) => (v <= 0 ? '#f1ece1' : `rgba(8,16,33,${(0.12 + 0.88 * (v / max)).toFixed(3)})`)
  return (
    <div className="relative" aria-label={ariaLabel} role="img">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: `2.6rem repeat(${cols.length}, minmax(0, 1fr))` }} onPointerLeave={() => setHover(null)}>
        <span />
        {cols.map((c, i) => (
          <span key={c} className="pb-1 text-center text-[10px] text-muted">
            {i % 2 === 0 ? c : ''}
          </span>
        ))}
        {rows.map((r, ri) => (
          <Row key={r}>
            <span className="pr-1 text-right text-xs leading-6 text-muted">{r}</span>
            {cols.map((c, ci) => (
              <span
                key={c}
                tabIndex={0}
                aria-label={`${r} ${c}: ${values[ri][ci]}`}
                onPointerEnter={() => setHover({ r: ri, c: ci })}
                onFocus={() => setHover({ r: ri, c: ci })}
                className={`h-6 rounded-[3px] outline-none ${hover?.r === ri && hover?.c === ci ? 'ring-2 ring-warning' : ''}`}
                style={{ background: shade(values[ri][ci]) }}
              />
            ))}
          </Row>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
        <span>
          {hover ? (
            <>
              <strong className="text-navy">{fmt(values[hover.r][hover.c])}</strong> · {rows[hover.r]}, {cols[hover.c]}
            </>
          ) : (
            'Passe o dedo ou o mouse nos quadradinhos.'
          )}
        </span>
        <span className="inline-flex items-center gap-1">
          menos
          {[0.12, 0.4, 0.7, 1].map((a) => (
            <span key={a} className="size-3 rounded-[2px]" style={{ background: `rgba(8,16,33,${a})` }} />
          ))}
          mais
        </span>
      </div>
    </div>
  )
}
const Row = ({ children }: { children: ReactNode }) => <>{children}</>

/** Lista com barras horizontais (ranking). */
export function BarList({ items, unit = '' }: { items: { label: string; value: number; extra?: string }[]; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate font-semibold">{i.label}</span>
          <span className="h-3 rounded-r-[4px] bg-navy-soft" style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          <span className="text-right tabular-nums">
            <strong>{fmt(i.value)}</strong>
            {unit}
            {i.extra && <span className="ml-2 text-xs text-muted">{i.extra}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** "Ver os números": a mesma informação do gráfico em tabela. */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-semibold text-muted">Ver os números</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-xl ring-1 ring-line">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-beige-200 text-xs">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="px-3 py-1.5 tabular-nums">
                    {typeof c === 'number' ? fmt(c) : c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
