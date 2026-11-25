import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { addDoc, collection, deleteField, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { AppWindow, Check, Circle, DoorOpen, Eraser, FlipHorizontal2, Hand, Maximize2, Minus, MousePointer2, PaintBucket, PenLine, Pencil, Plus, Redo2, Save, Square, Trash2, Undo2, WandSparkles } from 'lucide-react'
import { db } from '../../lib/firebase'
import { col, useLiveQuery } from '../../lib/data'
import { tableName } from '../../lib/format'
import { Button, Notice, Spinner } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { useAuth } from '../auth/AuthProvider'
import { PageTitle } from './AdminLayout'
import { sortTables } from './TablesAdmin'
import { FloorMap, MAP_H, MAP_W, TABLE_R, toMapPoint, wallLayout, type MapTable, type OpeningRef } from '../map/FloorMap'
import { floodRegion, inRegion, wallMask } from '../map/regions'
import { BASE_W } from '../map/constants'
import { clampView, contentView, viewBoxOf, viewH, zoomAt, type View } from '../map/view'
import { snapPoint, wallEnds, wallJoints, type Guide, type Pt } from '../map/snap'
import { FLOORS, type Area, type Fill, type FloorId, type Opening, type Table, type Wall } from '../../types'

type Tool = 'move' | 'pan' | 'wall' | 'door' | 'window' | 'paint' | 'erase'
type Placement = { areaId: string | null; x: number | null; y: number | null; shape: 'round' | 'square' }

const byOrder = (a: Area, b: Area) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR')

/** Ambientes (Salão, Varanda, Quadras...) e o desenho de cada um, com as mesas no lugar. */
export function AreasAdmin() {
  const { user } = useAuth()
  const { ask, askText } = useDialogs()
  const uid = user!.uid
  const areas = useLiveQuery<Area>(col('areas'), [])
  const tables = useLiveQuery<Table>(col('tables'), [])
  const list = useMemo(() => [...areas.data].sort(byOrder), [areas.data])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!list.length) return setSelected('')
    if (!list.some((a) => a.id === selected)) setSelected(list[0].id)
  }, [list, selected])

  const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: uid })

  async function addArea() {
    const name = await askText({ title: 'Novo ambiente', label: 'Nome', placeholder: 'Ex.: Salão, Varanda, Quadras', confirmLabel: 'Criar', maxLength: 40 })
    if (!name) return
    try {
      const ref = await addDoc(collection(db, 'areas'), { name: name.slice(0, 40), order: (list.at(-1)?.order ?? 0) + 10, walls: [], ...stamp() })
      setSelected(ref.id)
    } catch {
      setError('Não foi possível criar o ambiente.')
    }
  }

  async function renameArea(a: Area) {
    const name = await askText({ title: 'Renomear ambiente', label: 'Nome', initial: a.name, maxLength: 40 })
    if (!name || name === a.name) return
    await updateDoc(doc(db, 'areas', a.id), { name: name.slice(0, 40), ...stamp() }).catch(() => setError('Não foi possível renomear.'))
  }

  async function removeArea(a: Area) {
    const inside = tables.data.filter((t) => t.areaId === a.id)
    const ok = await ask({
      title: `Apagar o ambiente "${a.name}"?`,
      message: inside.length ? `As ${inside.length} mesas dele ficam sem ambiente e saem do mapa, mas continuam funcionando.` : 'O desenho dele é apagado.',
      confirmLabel: 'Apagar ambiente',
      tone: 'danger',
    })
    if (!ok) return
    try {
      const batch = writeBatch(db)
      inside.forEach((t) => batch.update(doc(db, 'tables', t.id), { areaId: null, x: null, y: null, ...stamp() }))
      batch.delete(doc(db, 'areas', a.id))
      await batch.commit()
    } catch {
      setError('Não foi possível apagar.')
    }
  }

  if (areas.loading || tables.loading) return <Spinner />
  const current = list.find((a) => a.id === selected)

  return (
    <>
      <PageTitle title="Ambientes e mapa">
        <Button onClick={addArea}>
          <Plus className="size-4" /> Novo ambiente
        </Button>
      </PageTitle>
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {!list.length ? (
        <Notice>
          Crie os ambientes do MA Beach (por exemplo Salão, Varanda e Quadras). Depois, em cada um, desenhe as paredes e coloque as mesas no lugar. O
          balcão vê esse mapa ao vivo, com as mesas piscando quando chamam.
        </Notice>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {list.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelected(a.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${a.id === selected ? 'bg-navy text-beige' : 'bg-white ring-1 ring-line'}`}
              >
                {a.name} <span className="font-normal opacity-70">({tables.data.filter((t) => t.areaId === a.id).length})</span>
              </button>
            ))}
            {current && (
              <span className="ml-auto flex gap-1">
                <Button variant="ghost" onClick={() => renameArea(current)}>
                  <Pencil className="size-4" /> Renomear
                </Button>
                <Button variant="ghost" onClick={() => removeArea(current)} aria-label="Apagar ambiente">
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </span>
            )}
          </div>
          {current && <MapEditor key={current.id} area={current} tables={tables.data} uid={uid} />}
        </>
      )}
    </>
  )
}

/** Parede mais curta que isso não entra (evita risquinho por toque sem querer). */
const MIN_WALL = 20
const MAX_WALLS = 500
/** Cor das linhas guia e do ímã: aparece bem em qualquer piso. */
const GUIDE = '#e8467c'

type Snapshot = { walls: Wall[]; changes: Record<string, Placement>; fills: Fill[] }
type Chain = { start: Pt; last: Pt; count: number }
type Press = { at: Pt; sx: number; sy: number; dragging: boolean }
type Drag =
  | { kind: 'table'; id: string; dx: number; dy: number; moved: boolean }
  | { kind: 'joint'; refs: string[]; from: Pt | null; moved: boolean }
  | { kind: 'opening'; ref: OpeningRef; moved: boolean }
type Overlay = { guides: Guide[]; magnet: Pt | null }
/** Gesto de navegação: arrastar o quadro (mãozinha) ou pinça com dois dedos. "done": acabou a pinça, falta soltar o outro dedo. */
type Gesture = { kind: 'pan'; sx: number; sy: number; start: View } | { kind: 'pinch'; d0: number; px: number; py: number; start: View } | { kind: 'done' }
const isField = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y
const MAX_FILLS = 60
/** Largura inicial (unidades do mapa; uma mesa com cadeiras ocupa 92). */
const OPENING_W = { door: 50, window: 70 } as const
const OPENING_MIN = 30
const TOOLS: { id: Tool; label: string; Icon: typeof Minus }[] = [
  { id: 'move', label: 'Mover', Icon: MousePointer2 },
  { id: 'pan', label: 'Mão', Icon: Hand },
  { id: 'wall', label: 'Parede', Icon: PenLine },
  { id: 'door', label: 'Porta', Icon: DoorOpen },
  { id: 'window', label: 'Janela', Icon: AppWindow },
  { id: 'paint', label: 'Piso', Icon: PaintBucket },
  { id: 'erase', label: 'Apagar', Icon: Eraser },
]

function MapEditor({ area, tables, uid }: { area: Area; tables: Table[]; uid: string }) {
  const { ask } = useDialogs()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [tool, setToolState] = useState<Tool>('move')
  const [walls, setWalls] = useState<Wall[]>(area.walls ?? [])
  const [fills, setFills] = useState<Fill[]>(area.fills ?? [])
  const [paint, setPaint] = useState<FloorId | null>(area.fills?.at(-1)?.floor ?? area.floor ?? 'cimento')
  const [selOpening, setSelOpening] = useState<OpeningRef | null>(null)
  const [view, setView] = useState<View>(() =>
    contentView(
      area.walls ?? [],
      tables.filter((t) => t.areaId === area.id && t.x != null && t.y != null).map((t) => ({ x: t.x!, y: t.y! })),
    ),
  )
  const [panning, setPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const pointers = useRef(new Map<number, Pt>())
  const gesture = useRef<Gesture | null>(null)
  const overMap = useRef(false)
  const [changes, setChanges] = useState<Record<string, Placement>>({})
  const [chain, setChain] = useState<Chain | null>(null)
  const [press, setPress] = useState<Press | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [undo, setUndo] = useState<Snapshot[]>([])
  const [redo, setRedo] = useState<Snapshot[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const dirty = Object.keys(changes).length > 0 || JSON.stringify(walls) !== JSON.stringify(area.walls ?? []) || JSON.stringify(fills) !== JSON.stringify(area.fills ?? [])

  // Avisa antes de sair da página com mudanças não salvas.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const place = (t: Table): Placement => changes[t.id] ?? { areaId: t.areaId ?? null, x: t.x ?? null, y: t.y ?? null, shape: t.shape ?? 'round' }
  const mine = tables.filter((t) => place(t).areaId === area.id).sort(sortTables)
  const onMap = mine.filter((t) => place(t).x != null && place(t).y != null)
  const offMap = mine.filter((t) => place(t).x == null || place(t).y == null)
  const noArea = tables.filter((t) => !place(t).areaId).sort(sortTables)
  const joints = useMemo(() => wallJoints(walls), [walls])

  /** Guarda como estava, para o "Desfazer". Chamar antes de cada mudança. */
  function remember() {
    setUndo((u) => [...u.slice(-79), { walls, changes, fills }])
    setRedo([])
    setMsg(null)
  }
  function restore(s: Snapshot) {
    setWalls(s.walls)
    setChanges(s.changes)
    setFills(s.fills)
    setChain(null)
    setSelected(null)
    setSelOpening(null)
  }
  function doUndo() {
    const prev = undo.at(-1)
    if (!prev) return
    setRedo((r) => [...r, { walls, changes, fills }])
    setUndo((u) => u.slice(0, -1))
    restore(prev)
  }
  function doRedo() {
    const next = redo.at(-1)
    if (!next) return
    setUndo((u) => [...u, { walls, changes, fills }])
    setRedo((r) => r.slice(0, -1))
    restore(next)
  }
  function finishChain() {
    setChain(null)
    setPress(null)
    setOverlay(null)
  }
  function setTool(t: Tool) {
    finishChain()
    setSelOpening(null)
    setCursor(null)
    setToolState(t)
  }

  // Teclado: Esc termina a parede, Ctrl+Z desfaz, Ctrl+Y (ou Ctrl+Shift+Z) refaz.
  const keys = useRef({ doUndo, doRedo, finishChain })
  keys.current = { doUndo, doRedo, finishChain }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.key === 'Escape') keys.current.finishChain()
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) keys.current.doRedo()
        else keys.current.doUndo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        keys.current.doRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setPlace = (id: string, p: Partial<Placement>) => {
    const t = tables.find((x) => x.id === id)!
    setChanges((c) => ({ ...c, [id]: { ...place(t), ...p } }))
    setMsg(null)
  }

  /** Coloca a mesa no mapa, no primeiro espaço livre perto do centro. */
  function putOnMap(t: Table) {
    remember()
    const taken = onMap.map((m) => place(m))
    const span = Math.max(180, view.w - 160)
    let x = Math.round((view.x + view.w / 2) / 10) * 10
    let y = Math.round((view.y + viewH(view) / 2) / 10) * 10
    for (let i = 0; i < 60 && taken.some((p) => Math.abs((p.x ?? 0) - x) < TABLE_R * 2 && Math.abs((p.y ?? 0) - y) < TABLE_R * 2); i++) {
      x = Math.round((view.x + 80 + ((i * 90) % span)) / 10) * 10
      y = Math.round((view.y + 80 + Math.floor((i * 90) / span) * 90) / 10) * 10
    }
    setPlace(t.id, { areaId: area.id, x, y })
    setSelected(t.id)
    setTool('move')
  }

  /**
   * "Colocar mesas automaticamente": espalha as mesas que estão fora do mapa em fileiras, pela ordem do número,
   * dentro das paredes do ambiente, sem encostar nas mesas que já estão no lugar nem nas paredes.
   * Nada é salvo sozinho: a pessoa confere, ajusta e toca em "Salvar mapa".
   */
  async function autoPlace() {
    let pending = [...offMap]
    if (
      noArea.length &&
      (await ask({
        title: 'Mesas sem ambiente',
        message: `Trazer também as ${noArea.length} mesas que ainda não têm ambiente para "${area.name}"?`,
        confirmLabel: 'Trazer',
        cancelLabel: 'Só deste ambiente',
      }))
    )
      pending = [...pending, ...noArea]
    pending.sort(sortTables)
    if (!pending.length) return setMsg({ tone: 'success', text: 'Todas as mesas já estão no mapa.' })

    // Área útil: dentro das paredes (ou o mapa todo, se ainda não tem paredes), com folga.
    const xs = walls.flatMap((w) => [w.x1, w.x2])
    const ys = walls.flatMap((w) => [w.y1, w.y2])
    const pad = TABLE_R + 16
    const box = walls.length
      ? { x0: Math.min(...xs) + pad, y0: Math.min(...ys) + pad, x1: Math.max(...xs) - pad, y1: Math.max(...ys) - pad }
      : { x0: view.x + pad, y0: view.y + pad, x1: Math.min(MAP_W, view.x + view.w) - pad, y1: Math.min(MAP_H, view.y + viewH(view)) - pad }

    const nearWall = (x: number, y: number) =>
      walls.some((w) => {
        const dx = w.x2 - w.x1
        const dy = w.y2 - w.y1
        const len = dx * dx + dy * dy || 1
        const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / len))
        return Math.hypot(x - (w.x1 + t * dx), y - (w.y1 + t * dy)) < TABLE_R + 10
      })
    const taken = onMap.map((m) => ({ x: place(m).x!, y: place(m).y! }))

    // Tenta um espaçamento confortável; se não couber, aperta um pouco.
    for (const gap of [TABLE_R * 2 + 40, TABLE_R * 2 + 24, TABLE_R * 2 + 10]) {
      const spots: { x: number; y: number }[] = []
      for (let y = box.y0; y <= box.y1 && spots.length < pending.length; y += gap) {
        for (let x = box.x0; x <= box.x1 && spots.length < pending.length; x += gap) {
          const free = [...taken, ...spots].every((p) => Math.hypot(p.x - x, p.y - y) >= TABLE_R * 2 + 6)
          if (free && !nearWall(x, y)) spots.push({ x: Math.round(x), y: Math.round(y) })
        }
      }
      if (spots.length === pending.length || gap === TABLE_R * 2 + 10) {
        remember()
        spots.forEach((p, i) => setPlace(pending[i].id, { areaId: area.id, x: p.x, y: p.y }))
        const left = pending.length - spots.length
        setTool('move')
        setSelected(null)
        return setMsg(
          left > 0
            ? { tone: 'danger', text: `${spots.length} mesas colocadas. Não couberam ${left}: aumente o espaço entre as paredes ou coloque à mão.` }
            : { tone: 'success', text: `${spots.length} mesas colocadas. Ajuste o que precisar e toque em "Salvar mapa".` },
        )
      }
    }
  }

  // ---------- Ponteiro (mouse e dedo) ----------
  const rawPoint = (e: ReactPointerEvent) => toMapPoint(svgRef.current!, e.clientX, e.clientY, 1)
  /** Distância do ímã e das guias: uns 10 px na tela (18 px no dedo), seja qual for o tamanho do mapa. */
  const tolFor = (e: ReactPointerEvent) => ((e.pointerType === 'touch' ? 18 : 10) * view.w) / (svgRef.current?.getBoundingClientRect().width || view.w)

  // ---------- Zoom e mãozinha ----------
  /** Ponto do mapa embaixo de uma posição da tela. */
  const screenToMap = (cx: number, cy: number, v: View) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: v.x + ((cx - r.left) * v.w) / r.width, y: v.y + ((cy - r.top) * v.w) / r.width }
  }
  const zoomBy = (f: number) => setView((v) => zoomAt(v, f, v.x + v.w / 2, v.y + viewH(v) / 2))
  const fitView = () => setView(contentView(walls, onMap.map((t) => ({ x: place(t).x!, y: place(t).y! }))))

  /** Antes das ferramentas: dois dedos fazem zoom; mãozinha, espaço ou botão do meio arrastam o quadro. */
  function onAnyDown(e: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) {
      e.stopPropagation()
      if (pointers.current.size === 2 && svgRef.current) {
        const [a, b] = [...pointers.current.values()]
        const mid = screenToMap((a.x + b.x) / 2, (a.y + b.y) / 2, view)
        gesture.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, px: mid.x, py: mid.y, start: view }
        svgRef.current.setPointerCapture(e.pointerId)
        // Cancela o que o primeiro dedo tinha começado.
        setPress(null)
        setDrag(null)
        setOverlay(null)
        setCursor(null)
        if (chain && chain.count === 0) setChain(null)
      }
      return
    }
    if ((tool === 'pan' || spaceHeld || e.button === 1) && svgRef.current) {
      e.stopPropagation()
      e.preventDefault()
      svgRef.current.setPointerCapture(e.pointerId)
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, start: view }
      setPanning(true)
    }
  }

  /** Move o quadro durante o gesto. Devolve true quando o movimento era de navegação. */
  function gestureMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g || !svgRef.current) return false
    const r = svgRef.current.getBoundingClientRect()
    if (g.kind === 'pan') {
      const k = g.start.w / r.width
      setView(clampView({ ...g.start, x: g.start.x - (e.clientX - g.sx) * k, y: g.start.y - (e.clientY - g.sy) * k }))
    } else if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const w = Math.min(MAP_W, Math.max(1, (g.start.w * g.d0) / (Math.hypot(a.x - b.x, a.y - b.y) || 1)))
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      setView(clampView({ w, x: g.px - ((mx - r.left) * w) / r.width, y: g.py - ((my - r.top) * w) / r.width }))
    }
    return true
  }

  /** Fim do toque. Devolve true quando era um gesto de navegação (as ferramentas não fazem nada). */
  function gestureUp(e: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (!g) return false
    if (g.kind === 'pinch' && pointers.current.size === 1) gesture.current = { kind: 'done' }
    if (pointers.current.size === 0) {
      gesture.current = null
      setPanning(false)
    }
    return true
  }

  // Roda do mouse (e pinça do touchpad): zoom para onde o cursor aponta.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))
      setView((v) => zoomAt(v, factor, v.x + ((e.clientX - r.left) * v.w) / r.width, v.y + ((e.clientY - r.top) * v.w) / r.width))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // Barra de espaço segurada (com o mouse em cima do mapa): mãozinha temporária, como no Photoshop.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !overMap.current || isField(e.target)) return
      e.preventDefault()
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (overMap.current && !isField(e.target)) e.preventDefault()
      setSpaceHeld(false)
    }
    const blur = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  const wallTargets = () => (chain ? [...wallEnds(walls), chain.start] : wallEnds(walls))

  function addWall(a: Pt, b: Pt) {
    if (walls.length >= MAX_WALLS) {
      setMsg({ tone: 'danger', text: 'Este ambiente já tem o máximo de paredes.' })
      return false
    }
    const dup = walls.some((w) => (same({ x: w.x1, y: w.y1 }, a) && same({ x: w.x2, y: w.y2 }, b)) || (same({ x: w.x1, y: w.y1 }, b) && same({ x: w.x2, y: w.y2 }, a)))
    if (dup) return true
    remember()
    setWalls((w) => [...w, { x1: a.x, y1: a.y, x2: b.x, y2: b.y }])
    return true
  }

  /** De onde sai a parede que está sendo desenhada agora. */
  function drawingFrom(p: Press | null, tol: number): Pt | null {
    if (p?.dragging && (!chain || Math.hypot(p.at.x - chain.last.x, p.at.y - chain.last.y) > tol)) return p.at
    return chain?.last ?? null
  }

  function onBackgroundDown(e: ReactPointerEvent<SVGSVGElement>) {
    setSelected(null)
    setSelOpening(null)
    if (tool === 'paint' && svgRef.current) return paintAt(rawPoint(e))
    if (tool !== 'wall' || !svgRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const tol = tolFor(e)
    const at = snapPoint(rawPoint(e), wallTargets(), tol)
    setPress({ at: { x: at.x, y: at.y }, sx: e.clientX, sy: e.clientY, dragging: false })
    if (!chain) setChain({ start: { x: at.x, y: at.y }, last: { x: at.x, y: at.y }, count: 0 })
    setOverlay({ guides: at.guides, magnet: at.magnet ? at : null })
  }

  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!svgRef.current || gestureMove(e)) return
    const raw = rawPoint(e)
    const tol = tolFor(e)

    if (tool === 'wall') {
      let p = press
      if (p && !p.dragging && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) {
        p = { ...p, dragging: true }
        setPress(p)
      }
      const s = snapPoint(raw, wallTargets(), tol, drawingFrom(p, tol))
      setCursor({ x: s.x, y: s.y })
      setOverlay({ guides: s.guides, magnet: s.magnet ? s : null })
      return
    }

    if (!drag) return
    if (!drag.moved) {
      remember()
      setDrag({ ...drag, moved: true })
    }
    if (drag.kind === 'opening') {
      const w = walls[drag.ref.wall]
      const o = w?.openings?.[drag.ref.idx]
      if (!o) return
      const l = wallLayout(w)
      const d = (raw.x - w.x1) * l.u.x + (raw.y - w.y1) * l.u.y
      setOpening(drag.ref, { t: fitT(Math.round(d / 5) * 5 / l.len, o.w, l.len) })
      return
    }
    if (drag.kind === 'table') {
      const others = onMap.filter((t) => t.id !== drag.id).map((t) => ({ x: place(t).x!, y: place(t).y! }))
      const s = snapPoint({ x: raw.x - drag.dx, y: raw.y - drag.dy }, others, tol, null, { magnet: false, bounds: TABLE_R })
      setPlace(drag.id, { x: s.x, y: s.y })
      setOverlay({ guides: s.guides, magnet: null })
    } else {
      const skip = new Set(drag.refs)
      const s = snapPoint(raw, wallEnds(walls, skip), tol, drag.from)
      setWalls((ws) =>
        ws.map((w, i) => ({
          ...w,
          ...(skip.has(`${i}a`) ? { x1: s.x, y1: s.y } : {}),
          ...(skip.has(`${i}b`) ? { x2: s.x, y2: s.y } : {}),
        })),
      )
      setOverlay({ guides: s.guides, magnet: s.magnet ? s : null })
    }
  }

  function onUp(e: ReactPointerEvent<SVGSVGElement>) {
    if (gestureUp(e)) return
    if (tool === 'wall' && press && chain && svgRef.current) {
      const tol = tolFor(e)
      const from = drawingFrom(press, tol)!
      const end = snapPoint(rawPoint(e), wallTargets(), tol, from)
      const q = { x: end.x, y: end.y }
      const long = Math.hypot(q.x - from.x, q.y - from.y) >= MIN_WALL
      if (from !== chain.last) {
        // Arrastou a partir de outro lugar: parede nova, e o desenho continua da ponta dela.
        if (long && addWall(from, q)) setChain({ start: from, last: q, count: 1 })
      } else if (long) {
        if (addWall(from, q)) {
          // Voltou ao primeiro ponto: ambiente fechado, termina o desenho.
          if (chain.count >= 1 && same(q, chain.start)) finishChain()
          else setChain({ ...chain, last: q, count: chain.count + 1 })
        }
      } else if (!press.dragging && chain.count >= 1 && same(q, chain.last)) {
        // Tocou de novo no último ponto: termina.
        finishChain()
      }
      setPress(null)
      if (e.pointerType === 'touch') setCursor(null)
      return
    }
    if (drag?.kind === 'joint' && drag.moved) {
      // Parede que ficou com as duas pontas no mesmo lugar some.
      setWalls((ws) => ws.filter((w) => w.x1 !== w.x2 || w.y1 !== w.y2))
    }
    setDrag(null)
    setOverlay(null)
  }

  function onTableDown(id: string, e: ReactPointerEvent<SVGGElement>) {
    if (!svgRef.current) return
    e.stopPropagation()
    const t = tables.find((x) => x.id === id)!
    const p = toMapPoint(svgRef.current, e.clientX, e.clientY, 1)
    svgRef.current.setPointerCapture(e.pointerId)
    setSelected(id)
    setSelOpening(null)
    setDrag({ kind: 'table', id, dx: p.x - (place(t).x ?? 0), dy: p.y - (place(t).y ?? 0), moved: false })
  }

  function onJointDown(j: Pt & { refs: string[] }, e: ReactPointerEvent<SVGGElement>) {
    if (!svgRef.current) return
    e.stopPropagation()
    svgRef.current.setPointerCapture(e.pointerId)
    setSelected(null)
    setSelOpening(null)
    // Ponta solta (só uma parede): trava o ângulo em relação à outra ponta dessa parede.
    let from: Pt | null = null
    if (j.refs.length === 1) {
      const i = Number(j.refs[0].slice(0, -1))
      const w = walls[i]
      from = j.refs[0].endsWith('a') ? { x: w.x2, y: w.y2 } : { x: w.x1, y: w.y1 }
    }
    setDrag({ kind: 'joint', refs: j.refs, from, moved: false })
  }

  /** Balde: pinta o espaço fechado em volta do ponto (troca o piso que já estava ali). */
  function paintAt(p: Pt) {
    const region = floodRegion(wallMask(walls), p.x, p.y)
    if (!region) return
    const rest = fills.filter((f) => !inRegion(region, f.x, f.y))
    const next = paint ? [...rest, { x: p.x, y: p.y, floor: paint }] : rest
    if (JSON.stringify(next) === JSON.stringify(fills)) return
    if (next.length > MAX_FILLS) return setMsg({ tone: 'danger', text: 'Este ambiente já tem pisos demais. Apague alguns com "Sem piso".' })
    remember()
    setFills(next)
  }

  /** Centro da porta ou janela dentro da parede, sem passar das pontas. */
  const fitT = (t: number, w: number, len: number) => Math.min(1 - w / 2 / len, Math.max(w / 2 / len, t))

  function setOpening(ref: OpeningRef, patch: Partial<Opening> | null) {
    setWalls((ws) =>
      ws.map((w, i) => {
        if (i !== ref.wall) return w
        const openings = (w.openings ?? []).flatMap((o, j) => (j !== ref.idx ? [o] : patch ? [{ ...o, ...patch }] : []))
        const { openings: _old, ...rest } = w
        return openings.length ? { ...rest, openings } : rest
      }),
    )
  }

  function addOpening(i: number, e: ReactPointerEvent<SVGLineElement>) {
    if ((tool !== 'door' && tool !== 'window') || !svgRef.current) return
    e.stopPropagation()
    const w = walls[i]
    const l = wallLayout(w)
    const width = OPENING_W[tool]
    if (l.len < width + 10) return setMsg({ tone: 'danger', text: 'Essa parede é curta demais. Escolha uma parede maior.' })
    const p = rawPoint(e)
    const d = (p.x - w.x1) * l.u.x + (p.y - w.y1) * l.u.y
    const o: Opening = { kind: tool, t: fitT(Math.round(d / 5) * 5 / l.len, width, l.len), w: width, ...(tool === 'door' ? { flip: 0 } : {}) }
    remember()
    setWalls((ws) => ws.map((x, k) => (k === i ? { ...x, openings: [...(x.openings ?? []), o] } : x)))
    setSelected(null)
    setSelOpening({ wall: i, idx: w.openings?.length ?? 0 })
  }

  function onOpeningDown(ref: OpeningRef, e: ReactPointerEvent<SVGLineElement>) {
    if (!svgRef.current) return
    e.stopPropagation()
    svgRef.current.setPointerCapture(e.pointerId)
    setSelected(null)
    setSelOpening(ref)
    setDrag({ kind: 'opening', ref, moved: false })
  }

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const batch = writeBatch(db)
      const stamp = { updatedAt: serverTimestamp(), updatedBy: uid }
      batch.update(doc(db, 'areas', area.id), { walls, fills, ...(area.floor && fills.length ? { floor: deleteField() } : {}), ...stamp })
      Object.entries(changes).forEach(([id, p]) => batch.update(doc(db, 'tables', id), { areaId: p.areaId, x: p.x, y: p.y, shape: p.shape, ...stamp }))
      await batch.commit()
      setChanges({})
      setMsg({ tone: 'success', text: 'Mapa salvo.' })
    } catch {
      setMsg({ tone: 'danger', text: 'Não foi possível salvar. Tente de novo.' })
    } finally {
      setBusy(false)
    }
  }

  const mapTables: MapTable[] = onMap.map((t) => {
    const p = place(t)
    return { id: t.id, label: t.label, x: p.x!, y: p.y!, shape: p.shape, selected: t.id === selected }
  })
  const sel = selected ? tables.find((t) => t.id === selected) : undefined
  const previewFrom = tool === 'wall' ? drawingFrom(press, 0) : null
  const draft = previewFrom && cursor && !same(previewFrom, cursor) ? { x1: previewFrom.x, y1: previewFrom.y, x2: cursor.x, y2: cursor.y } : null
  // Porta ou janela selecionada: largura e lado.
  const opWall = selOpening ? walls[selOpening.wall] : undefined
  const opSel = selOpening ? opWall?.openings?.[selOpening.idx] : undefined
  const opLen = opWall ? wallLayout(opWall).len : 0
  const opMax = Math.max(OPENING_MIN, Math.floor((opLen - 10) / 5) * 5)
  const resize = (w: number) => {
    if (!selOpening || !opSel) return
    const nw = Math.min(opMax, Math.max(OPENING_MIN, w))
    setOpening(selOpening, { w: nw, t: fitT(opSel.t, nw, opLen) })
  }
  const hint: Record<Tool, string> = {
    move: 'Arraste mesas, portas, janelas e as bolinhas nas pontas das paredes. Toque numa mesa, porta ou janela para ajustar.',
    wall: chain
      ? 'Toque no próximo canto. Para terminar, toque de novo no último ponto ou em "Concluir". Tocar no primeiro ponto fecha o ambiente.'
      : 'Toque em cada canto para desenhar as paredes emendadas. As pontas grudam nas paredes e a linha rosa mostra quando está alinhado.',
    door: 'Toque numa parede para colocar uma porta. Depois ajuste a largura e o lado em que ela abre.',
    window: 'Toque numa parede para colocar uma janela. Depois ajuste a largura.',
    pan: 'Arraste para mover o quadro. Zoom: roda do mouse, dois dedos ou os botões no canto. Dica: segurar a barra de espaço também vira a mãozinha.',
    paint: '',
    erase: 'Toque numa parede, porta ou janela para apagar. Para tirar um piso, use o Piso com "Sem piso".',
  }
  const iconBtn = 'inline-flex size-10 items-center justify-center rounded-xl text-navy hover:bg-beige-200 disabled:text-navy/30 disabled:hover:bg-transparent'

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_17rem]">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="toolbar" aria-label="Ferramentas do mapa" className="flex flex-wrap items-center gap-1 rounded-2xl bg-white p-1 ring-1 ring-line">
            {TOOLS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                aria-pressed={tool === id}
                title={label}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold transition-colors ${tool === id ? 'bg-navy text-beige' : 'text-navy hover:bg-beige-200'}`}
              >
                <Icon className="size-4" aria-hidden />
                <span className="max-sm:sr-only">{label}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={doUndo} disabled={!undo.length} aria-label="Desfazer" title="Desfazer (Ctrl+Z)" className={iconBtn}>
              <Undo2 className="size-4" />
            </button>
            <button type="button" onClick={doRedo} disabled={!redo.length} aria-label="Refazer" title="Refazer (Ctrl+Y)" className={iconBtn}>
              <Redo2 className="size-4" />
            </button>
            <Button onClick={save} busy={busy} disabled={!dirty} className="ml-1">
              <Save className="size-4" /> {dirty ? 'Salvar mapa' : 'Salvo'}
            </Button>
          </div>
        </div>

        <div className="flex min-h-11 flex-wrap items-center gap-2">
          {tool === 'paint' ? (
            <div role="radiogroup" aria-label="Piso" className="flex flex-1 flex-wrap items-center gap-1.5">
              {FLOORS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={paint === f.id}
                  aria-label={f.label}
                  title={f.label}
                  onClick={() => setPaint(f.id)}
                  className={`size-10 overflow-hidden rounded-lg ${paint === f.id ? 'ring-2 ring-navy ring-offset-2' : 'ring-1 ring-line'}`}
                >
                  <img src={`/img/pisos/${f.id}.webp`} alt="" className="size-full object-cover" />
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={paint === null}
                aria-label="Sem piso"
                title="Sem piso"
                onClick={() => setPaint(null)}
                className={`flex size-10 items-center justify-center rounded-lg bg-white ${paint === null ? 'ring-2 ring-navy ring-offset-2' : 'ring-1 ring-line'}`}
              >
                <Eraser className="size-4" aria-hidden />
              </button>
              <span className="ml-1 text-xs text-muted">
                <strong className="text-navy">{paint ? FLOORS.find((f) => f.id === paint)!.label : 'Sem piso'}</strong>: toque dentro do ambiente.
              </span>
            </div>
          ) : (
            <p className="flex-1 text-xs text-muted">{hint[tool]}</p>
          )}
          {tool === 'wall' && chain && (
            <Button variant="secondary" onClick={finishChain}>
              <Check className="size-4" /> Concluir
            </Button>
          )}
        </div>

        <div
          className="relative rounded-2xl ring-1 ring-line"
          onPointerEnter={() => (overMap.current = true)}
          onPointerLeave={() => (overMap.current = false)}
        >
          <FloorMap
            svgRef={svgRef}
            viewBox={viewBoxOf(view)}
            onPointerDownCapture={onAnyDown}
            walls={walls}
            tables={mapTables}
            fills={fills}
            floor={area.floor}
            draft={draft}
            showGrid
            wallHit={tool === 'erase' || tool === 'door' || tool === 'window'}
            onBackgroundPointerDown={onBackgroundDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onTablePointerDown={tool === 'move' ? onTableDown : undefined}
            onWallClick={tool === 'erase' ? (i) => (remember(), setSelOpening(null), setWalls((w) => w.filter((_, j) => j !== i))) : undefined}
            onWallPointerDown={tool === 'door' || tool === 'window' ? addOpening : undefined}
            onOpeningPointerDown={tool === 'move' || tool === 'door' || tool === 'window' ? onOpeningDown : undefined}
            onOpeningClick={tool === 'erase' ? (ref) => (remember(), setSelOpening(null), setOpening(ref, null)) : undefined}
            selectedOpening={selOpening}
            className={panning ? 'cursor-grabbing' : tool === 'pan' || spaceHeld ? 'cursor-grab' : tool === 'wall' || tool === 'paint' ? 'cursor-crosshair' : ''}
          >
            {/* Pontas das paredes: no desenho, mostram onde o ímã gruda; no "Mover", viram alças para arrastar. */}
            {tool === 'wall' &&
              joints.map((j) => <circle key={`${j.x},${j.y}`} cx={j.x} cy={j.y} r="5" fill="#ffffff" stroke="#081021" strokeWidth="2" pointerEvents="none" />)}
            {tool === 'wall' && chain && chain.count >= 1 && (
              <circle cx={chain.start.x} cy={chain.start.y} r="11" fill="none" stroke="#081021" strokeWidth="2.5" strokeDasharray="4 4" pointerEvents="none" />
            )}
            {tool === 'move' &&
              joints.map((j) => (
                <g key={`${j.x},${j.y}`} onPointerDown={(e) => onJointDown(j, e)} className="cursor-move">
                  <circle cx={j.x} cy={j.y} r="22" fill="transparent" />
                  <circle cx={j.x} cy={j.y} r="9" fill="#ffffff" stroke="#081021" strokeWidth="3" />
                </g>
              ))}
            {overlay?.guides.map((g, i) => (
              <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke={GUIDE} strokeWidth="2" strokeDasharray="6 6" pointerEvents="none" />
            ))}
            {overlay?.magnet && <circle cx={overlay.magnet.x} cy={overlay.magnet.y} r="13" fill="none" stroke={GUIDE} strokeWidth="3" pointerEvents="none" />}
            {tool === 'wall' && cursor && !overlay?.magnet && <circle cx={cursor.x} cy={cursor.y} r="5" fill={GUIDE} pointerEvents="none" />}
          </FloorMap>
          <div className="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-xl bg-white/95 p-1 shadow-sm ring-1 ring-line">
            <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="Afastar" title="Afastar" className={iconBtn}>
              <Minus className="size-4" />
            </button>
            <span className="w-12 text-center text-xs font-semibold tabular-nums" aria-label="Zoom">
              {Math.round((BASE_W / view.w) * 100)}%
            </span>
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="Aproximar" title="Aproximar" className={iconBtn}>
              <Plus className="size-4" />
            </button>
            <button type="button" onClick={fitView} aria-label="Enquadrar o desenho" title="Enquadrar o desenho" className={iconBtn}>
              <Maximize2 className="size-4" />
            </button>
          </div>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </section>

      <aside className="flex flex-col gap-4">
        {selOpening && opSel && (
          <section className="rounded-2xl bg-white p-3 ring-1 ring-line">
            <p className="mb-3 font-bold">{opSel.kind === 'door' ? 'Porta' : 'Janela'}</p>
            <label className="mb-1 block text-sm font-semibold" htmlFor="largura-abertura">
              Largura
            </label>
            <div className="mb-3 flex items-center gap-2">
              <button type="button" className={`${iconBtn} ring-1 ring-line`} aria-label="Diminuir" onClick={() => (remember(), resize(opSel.w - 10))} disabled={opSel.w <= OPENING_MIN}>
                <Minus className="size-4" />
              </button>
              <input
                id="largura-abertura"
                type="range"
                min={OPENING_MIN}
                max={opMax}
                step={5}
                value={Math.min(opSel.w, opMax)}
                onPointerDown={remember}
                onKeyDown={remember}
                onChange={(e) => resize(Number(e.target.value))}
                className="min-w-0 flex-1 accent-navy"
              />
              <button type="button" className={`${iconBtn} ring-1 ring-line`} aria-label="Aumentar" onClick={() => (remember(), resize(opSel.w + 10))} disabled={opSel.w >= opMax}>
                <Plus className="size-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {opSel.kind === 'door' && (
                <Button variant="secondary" onClick={() => (remember(), setOpening(selOpening, { flip: ((opSel.flip ?? 0) + 1) % 4 }))}>
                  <FlipHorizontal2 className="size-4" /> Virar a porta
                </Button>
              )}
              <Button variant="ghost" onClick={() => (remember(), setOpening(selOpening, null), setSelOpening(null))}>
                <Trash2 className="size-4 text-danger" /> Apagar {opSel.kind === 'door' ? 'porta' : 'janela'}
              </Button>
            </div>
          </section>
        )}

        {sel && place(sel).areaId === area.id && (
          <section className="rounded-2xl bg-white p-3 ring-1 ring-line">
            <p className="mb-2 font-bold">{tableName(sel.label)}</p>
            <div className="mb-2 grid grid-cols-2 gap-1">
              <Button variant={place(sel).shape === 'round' ? 'primary' : 'secondary'} onClick={() => place(sel).shape !== 'round' && (remember(), setPlace(sel.id, { shape: 'round' }))}>
                <Circle className="size-4" /> Redonda
              </Button>
              <Button variant={place(sel).shape === 'square' ? 'primary' : 'secondary'} onClick={() => place(sel).shape !== 'square' && (remember(), setPlace(sel.id, { shape: 'square' }))}>
                <Square className="size-4" /> Quadrada
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              <Button variant="ghost" onClick={() => (remember(), setPlace(sel.id, { x: null, y: null }), setSelected(null))}>
                Tirar do mapa
              </Button>
              <Button variant="ghost" onClick={() => (remember(), setPlace(sel.id, { areaId: null, x: null, y: null }), setSelected(null))}>
                Tirar deste ambiente
              </Button>
            </div>
          </section>
        )}

        {(offMap.length > 0 || noArea.length > 0) && (
          <Button onClick={autoPlace}>
            <WandSparkles className="size-4" /> Colocar mesas automaticamente
          </Button>
        )}
        <section className="rounded-2xl bg-white p-3 ring-1 ring-line">
          <p className="mb-2 text-sm font-bold">Deste ambiente, fora do mapa ({offMap.length})</p>
          {!offMap.length ? (
            <p className="text-xs text-muted">Todas as mesas deste ambiente já estão no mapa.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {offMap.map((t) => (
                <button key={t.id} type="button" onClick={() => putOnMap(t)} className="rounded-lg bg-beige px-2.5 py-1.5 text-sm font-semibold hover:bg-beige-200">
                  + {t.label}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-3 ring-1 ring-line">
          <p className="mb-2 text-sm font-bold">Mesas sem ambiente ({noArea.length})</p>
          {!noArea.length ? (
            <p className="text-xs text-muted">Nenhuma. Mesas de outros ambientes ficam no mapa delas.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted">Toque para trazer para este ambiente e colocar no mapa.</p>
              <div className="flex max-h-60 flex-wrap gap-1 overflow-y-auto">
                {noArea.map((t) => (
                  <button key={t.id} type="button" onClick={() => putOnMap(t)} className="rounded-lg bg-beige px-2.5 py-1.5 text-sm font-semibold hover:bg-beige-200">
                    + {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
        {walls.length > 0 && (
          <Button
            variant="ghost"
            onClick={async () =>
              (await ask({ title: 'Apagar todas as paredes?', message: 'As mesas continuam no lugar. Nada muda até você tocar em "Salvar mapa".', confirmLabel: 'Apagar paredes', tone: 'danger' })) && (remember(), setWalls([]), finishChain())
            }
          >
            Apagar todas as paredes
          </Button>
        )}
      </aside>
    </div>
  )
}
