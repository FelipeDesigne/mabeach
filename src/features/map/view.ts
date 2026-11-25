import { BASE_W, MAP_H, MAP_W, TABLE_R } from './constants'
import type { Wall } from '../../types'

/** Pedaço da folha que aparece na tela (unidades do mapa). A altura segue a proporção da folha. */
export type View = { x: number; y: number; w: number }
export const ASPECT = MAP_H / MAP_W
/** Zoom máximo: mostra só 300 unidades de largura (umas 3 mesas). */
export const MIN_VIEW_W = 300

export const viewH = (v: View) => v.w * ASPECT
export const viewBoxOf = (v: View) => `${v.x} ${v.y} ${v.w} ${viewH(v)}`

/** Mantém a visão dentro da folha e entre o zoom mínimo e o máximo. */
export function clampView(v: View): View {
  const w = Math.min(MAP_W, Math.max(MIN_VIEW_W, v.w))
  const h = w * ASPECT
  return { w, x: Math.min(MAP_W - w, Math.max(0, v.x)), y: Math.min(MAP_H - h, Math.max(0, v.y)) }
}

/**
 * Enquadra o que está desenhado (paredes e mesas), com uma folga em volta.
 * Nunca fica mais perto que `minW` (para um cômodo pequeno não aparecer gigante). Sem nada desenhado: o meio da folha.
 */
export function contentView(walls: Wall[], tables: { x: number; y: number }[], minW = BASE_W): View {
  const xs = [...walls.flatMap((w) => [w.x1, w.x2]), ...tables.flatMap((t) => [t.x - TABLE_R, t.x + TABLE_R])]
  const ys = [...walls.flatMap((w) => [w.y1, w.y2]), ...tables.flatMap((t) => [t.y - TABLE_R, t.y + TABLE_R])]
  if (!xs.length) return clampView({ x: (MAP_W - minW) / 2, y: (MAP_H - minW * ASPECT) / 2, w: minW })
  const pad = 40
  const x0 = Math.min(...xs) - pad
  const x1 = Math.max(...xs) + pad
  const y0 = Math.min(...ys) - pad
  const y1 = Math.max(...ys) + pad
  const w = Math.max(minW, x1 - x0, (y1 - y0) / ASPECT)
  return clampView({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - (w * ASPECT) / 2, w })
}

/** Zoom mantendo parado o ponto (px, py) do mapa. `factor` > 1 aproxima. */
export function zoomAt(v: View, factor: number, px: number, py: number): View {
  const w = Math.min(MAP_W, Math.max(MIN_VIEW_W, v.w / factor))
  const k = w / v.w
  return clampView({ w, x: px - (px - v.x) * k, y: py - (py - v.y) * k })
}
