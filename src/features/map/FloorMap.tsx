import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import type { FloorId, Wall } from '../../types'

/** Tamanho do mapa em unidades (cada ambiente usa a mesma folha 1000 x 600, com grade de 20). */
export const MAP_W = 1000
export const MAP_H = 600
export const GRID = 20
/** Metade do espaço que a mesa com as cadeiras ocupa no mapa. */
export const TABLE_R = 46
/** Tamanho de cada "azulejo" da textura do piso no mapa. */
const FLOOR_TILE = 360

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

const short = (label: string) => (label.length > 5 ? `${label.slice(0, 4)}…` : label)

/** Desenho do ambiente: piso, paredes e mesas vistas de cima. Os eventos ficam com quem usa (editor ou balcão). */
export function FloorMap({
  walls,
  tables,
  floor,
  svgRef,
  draft,
  showGrid = false,
  onBackgroundPointerDown,
  onPointerMove,
  onPointerUp,
  onTablePointerDown,
  onTableClick,
  onWallClick,
  wallHit = false,
  className = '',
  children,
}: {
  walls: Wall[]
  tables: MapTable[]
  floor?: FloorId
  svgRef?: RefObject<SVGSVGElement | null>
  draft?: Wall | null
  showGrid?: boolean
  onBackgroundPointerDown?: (e: ReactPointerEvent<SVGSVGElement>) => void
  onPointerMove?: (e: ReactPointerEvent<SVGSVGElement>) => void
  onPointerUp?: (e: ReactPointerEvent<SVGSVGElement>) => void
  onTablePointerDown?: (id: string, e: ReactPointerEvent<SVGGElement>) => void
  onTableClick?: (id: string) => void
  onWallClick?: (index: number) => void
  /** No modo "apagar parede", as paredes ficam fáceis de tocar. */
  wallHit?: boolean
  className?: string
  children?: ReactNode
}) {
  const floorFill = floor ? `url(#piso-${floor})` : '#f4efe4'
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      className={`block h-auto w-full touch-none overflow-hidden rounded-2xl bg-[#f4efe4] select-none ${className}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as Element).getAttribute('data-bg') === '1') onBackgroundPointerDown?.(e)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      role="img"
      aria-label="Mapa do ambiente"
    >
      <defs>
        {floor && (
          <pattern id={`piso-${floor}`} width={FLOOR_TILE} height={FLOOR_TILE} patternUnits="userSpaceOnUse">
            <image href={`/img/pisos/${floor}.webp`} width={FLOOR_TILE} height={FLOOR_TILE} preserveAspectRatio="xMidYMid slice" />
          </pattern>
        )}
        <pattern id="grade" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="rgba(8,16,33,0.12)" strokeWidth="1" />
        </pattern>
        <filter id="sombra-mesa" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#081021" floodOpacity="0.35" />
        </filter>
      </defs>

      <rect data-bg="1" x="0" y="0" width={MAP_W} height={MAP_H} fill={floorFill} />
      {showGrid && <rect data-bg="1" x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#grade)" />}

      {walls.map((w, i) => (
        <g key={i} onClick={onWallClick ? () => onWallClick(i) : undefined} className={onWallClick ? 'cursor-pointer' : undefined}>
          {wallHit && <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="transparent" strokeWidth="26" strokeLinecap="round" />}
          {/* Parede com contorno, para aparecer bem em qualquer piso. */}
          <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="#ffffff" strokeWidth="14" strokeLinecap="round" strokeOpacity="0.9" />
          <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="#081021" strokeWidth="9" strokeLinecap="round" className={wallHit ? 'hover:stroke-danger' : undefined} />
        </g>
      ))}
      {draft && <line x1={draft.x1} y1={draft.y1} x2={draft.x2} y2={draft.y2} stroke="#081021" strokeOpacity="0.6" strokeWidth="9" strokeLinecap="round" strokeDasharray="14 10" />}

      {tables.map((t) => {
        const tone = t.tone ? TONE[t.tone] : null
        const size = TABLE_R * 2
        return (
          <g
            key={t.id}
            transform={`translate(${t.x} ${t.y})`}
            className={onTablePointerDown || onTableClick ? 'cursor-pointer' : undefined}
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
            {t.selected && <circle r={TABLE_R + 4} fill="none" stroke="#081021" strokeWidth="4" strokeDasharray="10 7" />}
            <image
              href={`/img/mesas/${t.shape === 'square' ? 'quadrada' : 'redonda'}.webp`}
              x={-TABLE_R}
              y={-TABLE_R}
              width={size}
              height={size}
              filter="url(#sombra-mesa)"
              preserveAspectRatio="xMidYMid meet"
            />
            {/* Número da mesa num selo no centro. */}
            <circle r="17" fill={tone ? tone.ring : '#081021'} stroke="#ffffff" strokeWidth="3" />
            <text textAnchor="middle" dominantBaseline="central" fontSize={t.label.length > 2 ? 12 : 16} fontWeight="800" fill="#ffffff" fontFamily="Montserrat Variable, sans-serif">
              {short(t.label)}
            </text>
            {t.caption && (
              <g transform={`translate(0 ${TABLE_R + 18})`}>
                <rect x={-(t.caption.length * 5 + 12)} y="-13" width={t.caption.length * 10 + 24} height="26" rx="13" fill="#ffffff" stroke={tone?.ring ?? '#081021'} strokeWidth="2.5" />
                <text textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="700" fill="#081021" fontFamily="Montserrat Variable, sans-serif">
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
