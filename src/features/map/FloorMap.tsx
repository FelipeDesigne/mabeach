import { useId, useMemo, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import type { Fill, FloorId, Opening, Wall } from '../../types'
import { fillShapes } from './regions'
import { GRID, MAP_H, MAP_W, TABLE_R } from './constants'

export { GRID, MAP_H, MAP_W, TABLE_R }
/** Tamanho de cada "azulejo" da textura do piso no mapa. */
const FLOOR_TILE = 360
const NAVY = '#081021'

/** Cores das mesas no balcão (semáforo): livre, com garçom, chamando. */
export const TONE = {
  free: { ring: '#16a34a', glow: 'rgba(22,163,74,0.20)', label: 'Livre' },
  busy: { ring: '#ea580c', glow: 'rgba(234,88,12,0.25)', label: 'Com garçom' },
  calling: { ring: '#dc2626', glow: 'rgba(220,38,38,0.35)', label: 'Chamando' },
} as const

export type MapTable = {
  id: string
  label: string
  x: number
  y: number
  shape: 'round' | 'square'
  /** Situação no balcão. Sem `tone` (editor): mesa sem cor de situação. */
  tone?: keyof typeof TONE
  selected?: boolean
  /** Nome do garçom embaixo da mesa. */
  caption?: string
}

export type OpeningRef = { wall: number; idx: number }

const short = (label: string) => (label.length > 5 ? `${label.slice(0, 4)}…` : label)

type P = { x: number; y: number }

/** Divide a parede em trechos cheios e vãos (portas e janelas), em distância a partir da ponta 1. */
export function wallLayout(w: Wall) {
  const dx = w.x2 - w.x1
  const dy = w.y2 - w.y1
  const len = Math.hypot(dx, dy) || 1
  const u = { x: dx / len, y: dy / len }
  const at = (d: number): P => ({ x: w.x1 + u.x * d, y: w.y1 + u.y * d })
  const gaps = (w.openings ?? [])
    .map((o, idx) => {
      const half = Math.min(o.w, len) / 2
      const c = Math.min(len - half, Math.max(half, o.t * len))
      return { o, idx, s: c - half, e: c + half }
    })
    .sort((a, b) => a.s - b.s)
  const solid: [number, number][] = []
  let cur = 0
  for (const g of gaps) {
    if (g.s > cur) solid.push([cur, g.s])
    cur = Math.max(cur, g.e)
  }
  if (len > cur) solid.push([cur, len])
  return { len, u, at, gaps, solid }
}

/** Símbolo de porta (folha aberta e o arco por onde ela passa) ou de janela (vidro), como numa planta. */
function OpeningSymbol({ o, a, b, u }: { o: Opening; a: P; b: P; u: P }) {
  if (o.kind === 'window') {
    return (
      <g pointerEvents="none">
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={NAVY} strokeWidth="12" />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d6eefa" strokeWidth="8" />
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={NAVY} strokeWidth="1.5" />
      </g>
    )
  }
  const flip = o.flip ?? 0
  const hinge = flip & 2 ? b : a
  const other = flip & 2 ? a : b
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const side = flip & 1 ? -1 : 1
  const n = { x: -u.y * side, y: u.x * side }
  const leaf = { x: hinge.x + n.x * len, y: hinge.y + n.y * len }
  const cross = (leaf.x - hinge.x) * (other.y - hinge.y) - (leaf.y - hinge.y) * (other.x - hinge.x)
  return (
    <g pointerEvents="none">
      <path d={`M ${leaf.x} ${leaf.y} A ${len} ${len} 0 0 ${cross > 0 ? 1 : 0} ${other.x} ${other.y}`} fill="none" stroke={NAVY} strokeWidth="1.5" strokeDasharray="5 4" strokeOpacity="0.7" />
      <line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} stroke="#ffffff" strokeWidth="7" strokeLinecap="round" />
      <line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} stroke={NAVY} strokeWidth="4" strokeLinecap="round" />
    </g>
  )
}

/** Desenho do ambiente: piso, paredes (com portas e janelas) e mesas vistas de cima. Os eventos ficam com quem usa (editor ou balcão). */
export function FloorMap({
  walls,
  tables,
  fills = [],
  floor,
  svgRef,
  draft,
  showGrid = false,
  onBackgroundPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerDownCapture,
  viewBox = `0 0 ${MAP_W} ${MAP_H}`,
  onTablePointerDown,
  onTableClick,
  onWallClick,
  onWallPointerDown,
  onOpeningPointerDown,
  onOpeningClick,
  selectedOpening,
  wallHit = false,
  className = '',
  children,
}: {
  walls: Wall[]
  tables: MapTable[]
  /** Pisos pintados com o balde. */
  fills?: Fill[]
  /** Formato antigo: piso no mapa todo, usado só se não tem nada pintado. */
  floor?: FloorId
  svgRef?: RefObject<SVGSVGElement | null>
  draft?: Wall | null
  showGrid?: boolean
  onBackgroundPointerDown?: (e: ReactPointerEvent<SVGSVGElement>) => void
  onPointerMove?: (e: ReactPointerEvent<SVGSVGElement>) => void
  onPointerUp?: (e: ReactPointerEvent<SVGSVGElement>) => void
  /** Vê todo toque antes das mesas e paredes (zoom com dois dedos, mãozinha). */
  onPointerDownCapture?: (e: ReactPointerEvent<SVGSVGElement>) => void
  /** Pedaço da folha que aparece ("x y largura altura"). Padrão: a folha toda. */
  viewBox?: string
  onTablePointerDown?: (id: string, e: ReactPointerEvent<SVGGElement>) => void
  onTableClick?: (id: string) => void
  onWallClick?: (index: number) => void
  onWallPointerDown?: (index: number, e: ReactPointerEvent<SVGLineElement>) => void
  onOpeningPointerDown?: (ref: OpeningRef, e: ReactPointerEvent<SVGLineElement>) => void
  onOpeningClick?: (ref: OpeningRef) => void
  selectedOpening?: OpeningRef | null
  /** Paredes fáceis de tocar (apagar, colocar porta ou janela). */
  wallHit?: boolean
  className?: string
  children?: ReactNode
}) {
  const uid = useId().replace(/:/g, '')
  const shapes = useMemo(() => fillShapes(walls, fills), [walls, fills])
  const legacy = !fills.length && floor
  const usedFloors = [...new Set([...shapes.map((s) => s.floor), ...(legacy ? [legacy] : [])])]
  const layouts = useMemo(() => walls.map(wallLayout), [walls])
  const pattern = (f: FloorId) => `url(#piso-${uid}-${f})`

  const wallStroke = (color: string, width: number) => (
    <g pointerEvents="none">
      {layouts.map((l, i) => (
        <g key={i}>
          {l.solid.map(([s, e], k) => {
            const a = l.at(s)
            const b = l.at(e)
            return <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} />
          })}
          {/* Pontas arredondadas, para os cantos emendarem bonito. */}
          <circle cx={walls[i].x1} cy={walls[i].y1} r={width / 2} fill={color} />
          <circle cx={walls[i].x2} cy={walls[i].y2} r={width / 2} fill={color} />
        </g>
      ))}
    </g>
  )

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      className={`block h-auto w-full touch-none overflow-hidden rounded-2xl bg-[#f4efe4] select-none ${className}`}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as Element).getAttribute('data-bg') === '1') onBackgroundPointerDown?.(e)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label="Mapa do ambiente"
    >
      <defs>
        {usedFloors.map((f) => (
          <pattern key={f} id={`piso-${uid}-${f}`} width={FLOOR_TILE} height={FLOOR_TILE} patternUnits="userSpaceOnUse">
            <image href={`/img/pisos/${f}.webp`} width={FLOOR_TILE} height={FLOOR_TILE} preserveAspectRatio="xMidYMid slice" />
          </pattern>
        ))}
        <pattern id={`grade-${uid}`} width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="rgba(8,16,33,0.12)" strokeWidth="1" />
        </pattern>
        <filter id={`sombra-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor={NAVY} floodOpacity="0.35" />
        </filter>
      </defs>

      <rect data-bg="1" x="0" y="0" width={MAP_W} height={MAP_H} fill={legacy ? pattern(legacy) : '#f4efe4'} />
      {shapes.map((s, i) => (
        <path key={i} data-bg="1" d={s.d} fill={pattern(s.floor)} />
      ))}
      {showGrid && <rect data-bg="1" x="0" y="0" width={MAP_W} height={MAP_H} fill={`url(#grade-${uid})`} />}

      {/* Parede com contorno branco, para aparecer bem em qualquer piso. */}
      {wallStroke('#ffffff', 14)}
      {wallStroke(NAVY, 9)}
      {layouts.map((l, i) =>
        l.gaps.map((g) => <OpeningSymbol key={`${i}-${g.idx}`} o={g.o} a={l.at(g.s)} b={l.at(g.e)} u={l.u} />),
      )}

      {/* Camada de toque das paredes (apagar, colocar porta ou janela). */}
      {wallHit &&
        walls.map((w, i) => (
          <line
            key={i}
            x1={w.x1}
            y1={w.y1}
            x2={w.x2}
            y2={w.y2}
            stroke="transparent"
            strokeWidth="26"
            strokeLinecap="round"
            className="cursor-pointer"
            onClick={onWallClick ? () => onWallClick(i) : undefined}
            onPointerDown={onWallPointerDown ? (e) => onWallPointerDown(i, e) : undefined}
          />
        ))}
      {layouts.map((l, i) =>
        l.gaps.map((g) => {
          const a = l.at(g.s)
          const b = l.at(g.e)
          const sel = selectedOpening?.wall === i && selectedOpening.idx === g.idx
          const interactive = !!(onOpeningPointerDown || onOpeningClick)
          return (
            <g key={`hit-${i}-${g.idx}`}>
              {sel && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e8467c" strokeWidth="24" strokeOpacity="0.35" strokeLinecap="round" pointerEvents="none" />}
              {interactive && (
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth="28"
                  strokeLinecap="round"
                  className="cursor-pointer"
                  onPointerDown={onOpeningPointerDown ? (e) => onOpeningPointerDown({ wall: i, idx: g.idx }, e) : undefined}
                  onClick={onOpeningClick ? () => onOpeningClick({ wall: i, idx: g.idx }) : undefined}
                />
              )}
            </g>
          )
        }),
      )}
      {draft && <line x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} stroke={NAVY} strokeOpacity="0.6" strokeWidth="9" strokeLinecap="round" strokeDasharray="14 10" pointerEvents="none" />}

      {tables.map((t) => {
        const tone = t.tone ? TONE[t.tone] : null
        const size = TABLE_R * 2
        return (
          <g
            key={t.id}
            transform={`translate(${t.x} ${t.y})`}
            className={onTablePointerDown || onTableClick ? 'cursor-pointer' : undefined}
            style={onTablePointerDown || onTableClick ? undefined : { pointerEvents: 'none' }}
            onPointerDown={onTablePointerDown ? (e) => onTablePointerDown(t.id, e) : undefined}
            onClick={onTableClick ? () => onTableClick(t.id) : undefined}
          >
            {tone && (
              <>
                <circle r={TABLE_R + 6} fill={tone.glow} className={t.tone === 'calling' ? 'mesa-pulso' : undefined} />
                <circle r={TABLE_R + 2} fill="none" stroke={tone.ring} strokeWidth="6" className={t.tone === 'calling' ? 'mesa-pisca' : undefined} />
              </>
            )}
            {/* Fundo claro sob a mesa: ela aparece bem em qualquer piso (inclusive no deck de madeira). */}
            <circle r={TABLE_R} fill="rgba(255,255,255,0.82)" />
            {t.selected && <circle r={TABLE_R + 4} fill="none" stroke={NAVY} strokeWidth="4" strokeDasharray="10 7" />}
            <image
              href={`/img/mesas/${t.shape === 'square' ? 'quadrada' : 'redonda'}.webp`}
              x={-TABLE_R}
              y={-TABLE_R}
              width={size}
              height={size}
              filter={`url(#sombra-${uid})`}
              preserveAspectRatio="xMidYMid meet"
            />
            {/* Número da mesa num selo no centro. */}
            <circle r="17" fill={tone ? tone.ring : NAVY} stroke="#ffffff" strokeWidth="3" />
            <text textAnchor="middle" dominantBaseline="central" fontSize={t.label.length > 2 ? 12 : 16} fontWeight="800" fill="#ffffff" fontFamily="Montserrat Variable, sans-serif">
              {short(t.label)}
            </text>
            {t.caption && (
              <g transform={`translate(0 ${TABLE_R + 18})`}>
                <rect x={-(t.caption.length * 5 + 12)} y="-13" width={t.caption.length * 10 + 24} height="26" rx="13" fill="#ffffff" stroke={tone?.ring ?? NAVY} strokeWidth="2.5" />
                <text textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="700" fill={NAVY} fontFamily="Montserrat Variable, sans-serif">
                  {t.caption}
                </text>
              </g>
            )}
          </g>
        )
      })}
      {children}
    </svg>
  )
}

/** Converte a posição do dedo ou mouse para coordenadas do mapa, presa na grade. */
export function toMapPoint(svg: SVGSVGElement, clientX: number, clientY: number, snap = GRID / 2) {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
  const s = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v / snap) * snap))
  return { x: s(p.x, MAP_W), y: s(p.y, MAP_H) }
}
