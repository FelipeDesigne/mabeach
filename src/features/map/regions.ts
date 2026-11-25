import { MAP_H, MAP_W } from './constants'
import type { Fill, Wall } from '../../types'

/**
 * Balde de tinta, como no Paint: o mapa vira uma grade de quadradinhos, as paredes viram "barreira"
 * e a tinta se espalha a partir do ponto tocado até bater nas paredes. Se as paredes não fecham, a tinta vaza.
 * Portas e janelas não contam como buraco: o piso de um cômodo não escapa pela porta.
 */
const CELL = 5
const COLS = MAP_W / CELL
const ROWS = MAP_H / CELL
/** Meia espessura da parede na grade: grossa o bastante para parede inclinada não deixar a tinta passar. */
const HALF = 5.5

export function wallMask(walls: Wall[]) {
  const mask = new Uint8Array(COLS * ROWS)
  for (const w of walls) {
    const dx = w.x2 - w.x1
    const dy = w.y2 - w.y1
    const len = dx * dx + dy * dy || 1
    const c0 = Math.max(0, Math.floor((Math.min(w.x1, w.x2) - HALF) / CELL))
    const c1 = Math.min(COLS - 1, Math.ceil((Math.max(w.x1, w.x2) + HALF) / CELL))
    const r0 = Math.max(0, Math.floor((Math.min(w.y1, w.y2) - HALF) / CELL))
    const r1 = Math.min(ROWS - 1, Math.ceil((Math.max(w.y1, w.y2) + HALF) / CELL))
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = c * CELL + CELL / 2
        const y = r * CELL + CELL / 2
        const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / len))
        if (Math.hypot(x - (w.x1 + t * dx), y - (w.y1 + t * dy)) <= HALF) mask[r * COLS + c] = 1
      }
    }
  }
  return mask
}

const cellOf = (x: number, y: number) => {
  const c = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)))
  const r = Math.min(ROWS - 1, Math.max(0, Math.floor(y / CELL)))
  return r * COLS + c
}

/** Espaço livre em volta do ponto (null se o ponto caiu em cima de uma parede). */
export function floodRegion(mask: Uint8Array, x: number, y: number) {
  const start = cellOf(x, y)
  if (mask[start]) return null
  const region = new Uint8Array(COLS * ROWS)
  const stack = [start]
  region[start] = 1
  while (stack.length) {
    const i = stack.pop()!
    const c = i % COLS
    const next = [c > 0 ? i - 1 : -1, c < COLS - 1 ? i + 1 : -1, i - COLS, i + COLS]
    for (const n of next) {
      if (n < 0 || n >= region.length || region[n] || mask[n]) continue
      region[n] = 1
      stack.push(n)
    }
  }
  // Avança um quadradinho para baixo da parede, para o piso encostar nela sem deixar fresta.
  const grown = region.slice()
  for (let i = 0; i < region.length; i++) {
    if (!region[i]) continue
    const c = i % COLS
    if (c > 0 && mask[i - 1]) grown[i - 1] = 1
    if (c < COLS - 1 && mask[i + 1]) grown[i + 1] = 1
    if (i >= COLS && mask[i - COLS]) grown[i - COLS] = 1
    if (i + COLS < region.length && mask[i + COLS]) grown[i + COLS] = 1
  }
  return grown
}

export const inRegion = (region: Uint8Array, x: number, y: number) => region[cellOf(x, y)] === 1

/** Contorno do espaço pintado como um caminho SVG (faixas horizontais, uma por linha da grade). */
export function regionPath(region: Uint8Array) {
  let d = ''
  for (let r = 0; r < ROWS; r++) {
    let c = 0
    while (c < COLS) {
      if (!region[r * COLS + c]) {
        c++
        continue
      }
      const start = c
      while (c < COLS && region[r * COLS + c]) c++
      d += `M${start * CELL} ${r * CELL}h${(c - start) * CELL}v${CELL}h${-(c - start) * CELL}z`
    }
  }
  return d
}

/** Cada piso pintado com o desenho da área dele. Pintura que caiu em cima de parede é ignorada. */
export function fillShapes(walls: Wall[], fills: Fill[]) {
  if (!fills.length) return []
  const mask = wallMask(walls)
  return fills.flatMap((f) => {
    const region = floodRegion(mask, f.x, f.y)
    return region ? [{ floor: f.floor, d: regionPath(region) }] : []
  })
}
