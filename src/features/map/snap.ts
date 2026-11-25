import { GRID, MAP_H, MAP_W } from './constants'
import type { Wall } from '../../types'

export type Pt = { x: number; y: number }
export type Guide = { x1: number; y1: number; x2: number; y2: number }
export type Snapped = Pt & { guides: Guide[]; magnet: boolean }

const STEP = GRID / 2
/** Quanto o ângulo pode fugir de reto ou de 45° e ainda travar. */
const ANGLE_TOLERANCE = (7 * Math.PI) / 180

const key = (p: Pt) => `${p.x},${p.y}`

/** Pontas das paredes, sem repetir os cantos onde duas paredes se encontram. `skip` tira pontas específicas ("3a", "3b"). */
export function wallEnds(walls: Wall[], skip?: Set<string>): Pt[] {
  const seen = new Map<string, Pt>()
  walls.forEach((w, i) => {
    if (!skip?.has(`${i}a`)) seen.set(key({ x: w.x1, y: w.y1 }), { x: w.x1, y: w.y1 })
    if (!skip?.has(`${i}b`)) seen.set(key({ x: w.x2, y: w.y2 }), { x: w.x2, y: w.y2 })
  })
  return [...seen.values()]
}

/** Cantos que dá para arrastar: cada ponto com a lista das pontas de parede que estão nele. */
export function wallJoints(walls: Wall[]) {
  const joints = new Map<string, Pt & { refs: string[] }>()
  walls.forEach((w, i) => {
    for (const [end, p] of [['a', { x: w.x1, y: w.y1 }], ['b', { x: w.x2, y: w.y2 }]] as const) {
      const j = joints.get(key(p)) ?? { ...p, refs: [] }
      j.refs.push(`${i}${end}`)
      joints.set(key(p), j)
    }
  })
  return [...joints.values()]
}

function closest(points: Pt[], axis: 'x' | 'y', value: number, tol: number) {
  let best: Pt | null = null
  let bestD = tol
  for (const p of points) {
    const d = Math.abs(p[axis] - value)
    if (d <= bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

/**
 * Ajusta o ponto do dedo ou do mouse, nesta ordem:
 * 1. ímã: gruda numa ponta que já existe;
 * 2. ângulo: a partir de `from`, trava em reto (horizontal ou vertical) ou em 45°;
 * 3. guia: alinha com outra ponta na mesma linha ou coluna (e devolve a linha tracejada para mostrar);
 * 4. grade: o que sobrar cai na grade.
 */
export function snapPoint(raw: Pt, points: Pt[], tol: number, from: Pt | null = null, opts: { magnet?: boolean; bounds?: number } = {}): Snapped {
  const { magnet = true, bounds = 0 } = opts
  const clamp = (p: Pt) => ({ x: Math.min(MAP_W - bounds, Math.max(bounds, p.x)), y: Math.min(MAP_H - bounds, Math.max(bounds, p.y)) })

  if (magnet) {
    let best: Pt | null = null
    let bestD = tol * 1.2
    for (const p of points) {
      const d = Math.hypot(p.x - raw.x, p.y - raw.y)
      if (d <= bestD) {
        bestD = d
        best = p
      }
    }
    if (best) return { ...best, guides: [], magnet: true }
  }

  let x = raw.x
  let y = raw.y
  // Direção travada: (1,0) horizontal, (0,1) vertical, (±1,±1) diagonal de 45°.
  let dir: Pt | null = null
  if (from) {
    const dx = raw.x - from.x
    const dy = raw.y - from.y
    if (Math.hypot(dx, dy) > 0) {
      const angle = Math.atan2(dy, dx)
      const locked = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
      if (Math.abs(angle - locked) < ANGLE_TOLERANCE) {
        const ux = Math.round(Math.cos(locked))
        const uy = Math.round(Math.sin(locked))
        const t = (dx * ux + dy * uy) / (ux * ux + uy * uy)
        x = from.x + t * ux
        y = from.y + t * uy
        dir = { x: ux, y: uy }
      }
    }
  }
  const diagonal = !!dir && dir.x !== 0 && dir.y !== 0
  const moveX = !dir || dir.x !== 0
  const moveY = !dir || (dir.y !== 0 && !diagonal)
  const onDiagonal = (nx: number) => from!.y + ((nx - from!.x) / dir!.x) * dir!.y

  let alignX: Pt | null = null
  let alignY: Pt | null = null
  if (moveX) {
    alignX = closest(points, 'x', x, tol)
    if (alignX) {
      x = alignX.x
      if (diagonal) y = onDiagonal(x)
    } else {
      x = Math.round(x / STEP) * STEP
      if (diagonal) y = onDiagonal(x)
    }
  }
  if (moveY) {
    alignY = closest(points, 'y', y, tol)
    y = alignY ? alignY.y : Math.round(y / STEP) * STEP
  }

  const p = clamp({ x: Math.round(x), y: Math.round(y) })
  const guides: Guide[] = []
  if (alignX) guides.push({ x1: alignX.x, y1: alignX.y, x2: p.x, y2: p.y })
  if (alignY) guides.push({ x1: alignY.x, y1: alignY.y, x2: p.x, y2: p.y })
  return { ...p, guides, magnet: false }
}
