import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { addDoc, collection, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { Circle, Eraser, Minus, MousePointer2, Pencil, Plus, Save, Square, Trash2, WandSparkles } from 'lucide-react'
import { db } from '../../lib/firebase'
import { col, useLiveQuery } from '../../lib/data'
import { tableName } from '../../lib/format'
import { Button, Notice, Spinner } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { useAuth } from '../auth/AuthProvider'
import { PageTitle } from './AdminLayout'
import { sortTables } from './TablesAdmin'
import { FloorMap, MAP_H, MAP_W, TABLE_R, toMapPoint, type MapTable } from '../map/FloorMap'
import { FLOORS, type Area, type FloorId, type Table, type Wall } from '../../types'

type Tool = 'move' | 'wall' | 'erase'
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

function MapEditor({ area, tables, uid }: { area: Area; tables: Table[]; uid: string }) {
  const { ask } = useDialogs()
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [tool, setTool] = useState<Tool>('move')
  const [walls, setWalls] = useState<Wall[]>(area.walls ?? [])
  const [floor, setFloor] = useState<FloorId | undefined>(area.floor)
  const [changes, setChanges] = useState<Record<string, Placement>>({})
  const [draft, setDraft] = useState<Wall | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const dirty = Object.keys(changes).length > 0 || JSON.stringify(walls) !== JSON.stringify(area.walls ?? []) || floor !== area.floor

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

  const setPlace = (id: string, p: Partial<Placement>) => {
    const t = tables.find((x) => x.id === id)!
    setChanges((c) => ({ ...c, [id]: { ...place(t), ...p } }))
    setMsg(null)
  }

  /** Coloca a mesa no mapa, no primeiro espaço livre perto do centro. */
  function putOnMap(t: Table) {
    const taken = onMap.map((m) => place(m))
    let x = MAP_W / 2
    let y = MAP_H / 2
    for (let i = 0; i < 60 && taken.some((p) => Math.abs((p.x ?? 0) - x) < TABLE_R * 2 && Math.abs((p.y ?? 0) - y) < TABLE_R * 2); i++) {
      x = 80 + ((i * 90) % (MAP_W - 160))
      y = 80 + Math.floor((i * 90) / (MAP_W - 160)) * 90
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
      : { x0: pad, y0: pad, x1: MAP_W - pad, y1: MAP_H - pad }

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

  function onBackgroundDown(e: ReactPointerEvent<SVGSVGElement>) {
    setSelected(null)
    if (tool !== 'wall' || !svgRef.current) return
    const p = toMapPoint(svgRef.current, e.clientX, e.clientY)
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraft({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
  }

  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!svgRef.current) return
    const p = toMapPoint(svgRef.current, e.clientX, e.clientY)
    if (draft) {
      // Parede quase reta vira reta (horizontal ou vertical).
      const dx = Math.abs(p.x - draft.x1)
      const dy = Math.abs(p.y - draft.y1)
      const end = dy < dx * 0.15 ? { x: p.x, y: draft.y1 } : dx < dy * 0.15 ? { x: draft.x1, y: p.y } : p
      setDraft({ ...draft, x2: end.x, y2: end.y })
    } else if (drag) {
      const x = Math.min(MAP_W - TABLE_R, Math.max(TABLE_R, p.x - drag.dx))
      const y = Math.min(MAP_H - TABLE_R, Math.max(TABLE_R, p.y - drag.dy))
      setPlace(drag.id, { x, y })
    }
  }

  function onUp() {
    if (draft) {
      if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) >= 20) setWalls((w) => [...w, draft])
      setDraft(null)
    }
    setDrag(null)
  }

  function onTableDown(id: string, e: ReactPointerEvent<SVGGElement>) {
    if (tool !== 'move' || !svgRef.current) return
    e.stopPropagation()
    const t = tables.find((x) => x.id === id)!
    const p = toMapPoint(svgRef.current, e.clientX, e.clientY, 1)
    svgRef.current.setPointerCapture(e.pointerId)
    setSelected(id)
    setDrag({ id, dx: p.x - (place(t).x ?? 0), dy: p.y - (place(t).y ?? 0) })
  }

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const batch = writeBatch(db)
      const stamp = { updatedAt: serverTimestamp(), updatedBy: uid }
      batch.update(doc(db, 'areas', area.id), { walls, ...(floor ? { floor } : {}), ...stamp })
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
  const toolBtn = (t: Tool, label: string, Icon: typeof Minus) => (
    <button
      type="button"
      onClick={() => setTool(t)}
      aria-pressed={tool === t}
      className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${tool === t ? 'bg-navy text-beige' : 'bg-white ring-1 ring-line'}`}
    >
      <Icon className="size-4" aria-hidden /> {label}
    </button>
  )

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_17rem]">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {toolBtn('move', 'Mover mesas', MousePointer2)}
          {toolBtn('wall', 'Desenhar parede', Minus)}
          {toolBtn('erase', 'Apagar parede', Eraser)}
          <Button onClick={save} busy={busy} disabled={!dirty} className="ml-auto">
            <Save className="size-4" /> {dirty ? 'Salvar mapa' : 'Salvo'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Piso do ambiente">
          <span className="text-sm font-semibold">Piso:</span>
          {FLOORS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={floor === f.id}
              title={f.label}
              onClick={() => (setFloor(f.id), setMsg(null))}
              className={`flex items-center gap-2 rounded-xl bg-white p-1 pr-3 text-xs font-semibold ring-1 ${floor === f.id ? 'ring-2 ring-navy' : 'ring-line'}`}
            >
              <img src={`/img/pisos/${f.id}.webp`} alt="" className="size-8 rounded-lg object-cover" />
              {f.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          {tool === 'wall'
            ? 'Arraste no mapa para desenhar uma parede. Linhas quase retas ficam retas sozinhas.'
            : tool === 'erase'
              ? 'Toque numa parede para apagar.'
              : 'Arraste as mesas para o lugar. Toque numa mesa para mudar o formato.'}
        </p>
        <div className="rounded-2xl ring-1 ring-line">
          <FloorMap
            svgRef={svgRef}
            walls={walls}
            tables={mapTables}
            floor={floor}
            draft={draft}
            showGrid
            wallHit={tool === 'erase'}
            onBackgroundPointerDown={onBackgroundDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onTablePointerDown={onTableDown}
            onWallClick={tool === 'erase' ? (i) => setWalls((w) => w.filter((_, j) => j !== i)) : undefined}
            className={tool === 'wall' ? 'cursor-crosshair' : ''}
          />
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </section>

      <aside className="flex flex-col gap-4">
        {sel && place(sel).areaId === area.id && (
          <section className="rounded-2xl bg-white p-3 ring-1 ring-line">
            <p className="mb-2 font-bold">{tableName(sel.label)}</p>
            <div className="mb-2 grid grid-cols-2 gap-1">
              <Button variant={place(sel).shape === 'round' ? 'primary' : 'secondary'} onClick={() => setPlace(sel.id, { shape: 'round' })}>
                <Circle className="size-4" /> Redonda
              </Button>
              <Button variant={place(sel).shape === 'square' ? 'primary' : 'secondary'} onClick={() => setPlace(sel.id, { shape: 'square' })}>
                <Square className="size-4" /> Quadrada
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              <Button variant="ghost" onClick={() => (setPlace(sel.id, { x: null, y: null }), setSelected(null))}>
                Tirar do mapa
              </Button>
              <Button variant="ghost" onClick={() => (setPlace(sel.id, { areaId: null, x: null, y: null }), setSelected(null))}>
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
              (await ask({ title: 'Apagar todas as paredes?', message: 'As mesas continuam no lugar. Nada muda até você tocar em "Salvar mapa".', confirmLabel: 'Apagar paredes', tone: 'danger' })) && setWalls([])
            }
          >
            Apagar todas as paredes
          </Button>
        )}
      </aside>
    </div>
  )
}
