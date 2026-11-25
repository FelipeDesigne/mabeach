import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { LayoutDashboard, LogOut, UserRound } from 'lucide-react'
import { callFn, errorMessage } from '../../lib/firebase'
import { col, useLiveQuery, useNow } from '../../lib/data'
import { duration, tableName, timeOf } from '../../lib/format'
import { readPref } from '../../lib/devicePrefs'
import { Button, Modal, Notice, Spinner } from '../../components/ui'
import { canManage, useAuth } from '../auth/AuthProvider'
import { UpdateBanner } from '../pwa/UpdateBanner'
import { FloorMap, TONE, type MapTable } from '../map/FloorMap'
import type { Area, Table, TableStatus } from '../../types'

const byOrder = (a: Area, b: Area) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR')
const first = (name: string | null | undefined) => (name ?? '').split(' ')[0]

/** Toque do balcão quando uma mesa começa a chamar. */
function beep() {
  try {
    const ctx = new AudioContext()
    ;[0, 0.2, 0.4].forEach((t) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = 660
      g.gain.setValueAtTime(0.2, ctx.currentTime + t)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15)
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + t)
      o.stop(ctx.currentTime + t + 0.15)
    })
  } catch {
    // sem áudio: segue só com o visual
  }
}

/**
 * Balcão: mapa de cada ambiente ao vivo. Mesa chamando pisca em verde; mesa com garçom mostra o nome dele
 * até alguém encerrar a mesa.
 */
export function CounterPage() {
  const { role, signOut } = useAuth()
  const now = useNow(10000)
  const areas = useLiveQuery<Area>(col('areas'), [])
  const tables = useLiveQuery<Table>(col('tables'), [])
  const statuses = useLiveQuery<TableStatus>(col('tableStatus'), [])
  const list = useMemo(() => [...areas.data].sort(byOrder), [areas.data])
  const [areaId, setAreaId] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (list.length && !list.some((a) => a.id === areaId)) setAreaId(list[0].id)
  }, [list, areaId])

  const statusOf = useMemo(() => new Map(statuses.data.map((s) => [s.id, s])), [statuses.data])
  const calling = statuses.data.filter((s) => s.status === 'calling').sort((a, b) => (a.callAt?.toMillis() ?? 0) - (b.callAt?.toMillis() ?? 0))
  const busyList = statuses.data.filter((s) => s.status === 'busy').sort((a, b) => a.tableLabel.localeCompare(b.tableLabel, 'pt-BR', { numeric: true }))

  // Toca quando aparece uma mesa nova chamando.
  useEffect(() => {
    if (statuses.loading) return
    const ids = new Set(calling.map((s) => `${s.id}:${s.callId}`))
    if (seen.current && readPref('sound') && [...ids].some((id) => !seen.current!.has(id))) beep()
    seen.current = ids
  }, [statuses.loading, calling])

  const area = list.find((a) => a.id === areaId)
  const mapTables: MapTable[] = tables.data
    .filter((t) => t.areaId === areaId && t.x != null && t.y != null)
    .map((t) => {
      const s = statusOf.get(t.id)
      const tone = s?.status === 'calling' ? 'calling' : s?.status === 'busy' ? 'busy' : 'free'
      const who = first(s?.holderName ?? s?.assignedName)
      return { id: t.id, label: t.label, x: t.x!, y: t.y!, shape: t.shape ?? 'round', tone, caption: tone !== 'free' && who ? who : undefined }
    })
  const callingIn = (id: string) => calling.filter((s) => s.areaId === id).length

  async function close(tableId: string) {
    setBusy(true)
    setError('')
    try {
      await callFn('closeTable', { tableId })
      setSelected(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (areas.loading || tables.loading || statuses.loading) return <Spinner />
  const sel = selected ? (statusOf.get(selected) ?? null) : null
  const selTable = selected ? tables.data.find((t) => t.id === selected) : undefined

  const Row = ({ s }: { s: TableStatus }) => (
    <li>
      <button
        type="button"
        onClick={() => setSelected(s.id)}
        className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left ${s.status === 'calling' ? 'bg-[#dc2626]/10' : 'bg-[#ea580c]/10'}`}
      >
        <span className="font-bold">{tableName(s.tableLabel)}</span>
        <span className="text-right text-xs text-muted">
          {s.status === 'calling'
            ? `chamando há ${duration(Math.max(0, (now - (s.callAt?.toMillis() ?? now)) / 1000))}${s.holderName || s.assignedName ? ` · ${first(s.holderName ?? s.assignedName)}` : ''}`
            : `${first(s.holderName)}${s.since ? ` · desde ${timeOf(s.since.toDate())}` : ''}`}
        </span>
      </button>
    </li>
  )

  return (
    <div className="min-h-dvh">
      <header className="bg-navy text-beige">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/logo-branco.svg" alt="MA Beach" className="h-9 w-auto" width={2782} height={1908} />
            <h1 className="font-bold">Balcão</h1>
          </div>
          <div className="flex items-center gap-1">
            {canManage(role) && (
              <Link to="/admin" className="rounded-full p-2.5 hover:bg-white/10" aria-label="Painel">
                <LayoutDashboard className="size-5" />
              </Link>
            )}
            <Link to="/conta" className="rounded-full p-2.5 hover:bg-white/10" aria-label="Minha conta">
              <UserRound className="size-5" />
            </Link>
            <button type="button" onClick={signOut} className="rounded-full p-2.5 hover:bg-white/10" aria-label="Sair">
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="grid gap-4 p-4 lg:grid-cols-[1fr_20rem]">
        <section className="flex min-w-0 flex-col gap-3">
          <UpdateBanner />
          {!list.length ? (
            <Notice>Nenhum ambiente desenhado ainda. No painel, em "Ambientes e mapa", crie os ambientes e coloque as mesas no lugar.</Notice>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {list.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAreaId(a.id)}
                    className={`relative rounded-full px-4 py-2 text-sm font-semibold ${a.id === areaId ? 'bg-navy text-beige' : 'bg-white ring-1 ring-line'}`}
                  >
                    {a.name}
                    {callingIn(a.id) > 0 && (
                      <span className="mesa-pisca ml-2 inline-flex size-5 items-center justify-center rounded-full bg-[#dc2626] text-xs text-white">{callingIn(a.id)}</span>
                    )}
                  </button>
                ))}
              </div>
              {area && <FloorMap walls={area.walls ?? []} floor={area.floor} tables={mapTables} onTableClick={(id) => statusOf.get(id)?.status !== 'free' && setSelected(id)} className="ring-1 ring-line" />}
              <p className="flex flex-wrap gap-4 text-xs text-muted">
                {(['calling', 'busy', 'free'] as const).map((k) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className="size-3 rounded-full" style={{ background: TONE[k].ring }} /> {TONE[k].label}
                  </span>
                ))}
              </p>
            </>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl bg-white p-3 ring-1 ring-line">
            <h2 className="mb-2 font-bold">Chamando ({calling.length})</h2>
            {!calling.length ? <p className="text-sm text-muted">Nenhuma mesa chamando.</p> : <ul className="flex flex-col gap-1">{calling.map((s) => <Row key={s.id} s={s} />)}</ul>}
          </section>
          <section className="rounded-2xl bg-white p-3 ring-1 ring-line">
            <h2 className="mb-2 font-bold">Com garçom ({busyList.length})</h2>
            {!busyList.length ? <p className="text-sm text-muted">Nenhuma mesa ocupada.</p> : <ul className="flex flex-col gap-1">{busyList.map((s) => <Row key={s.id} s={s} />)}</ul>}
          </section>
        </aside>
      </main>

      <Modal open={!!sel} onClose={() => setSelected(null)} title={sel ? tableName(sel.tableLabel) : ''}>
        {sel && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              {sel.status === 'calling' ? (
                <>
                  <strong>Chamando</strong> há {duration(Math.max(0, (now - (sel.callAt?.toMillis() ?? now)) / 1000))}.
                  {(sel.holderName || sel.assignedName) && <> Vai para {first(sel.holderName ?? sel.assignedName)}.</>}
                </>
              ) : (
                <>
                  Com <strong>{sel.holderName}</strong>
                  {sel.since && <> desde {timeOf(sel.since.toDate())}</>}.
                </>
              )}
            </p>
            {selTable && !selTable.areaId && <p className="text-xs text-muted">Esta mesa não está em nenhum ambiente do mapa.</p>}
            {error && <Notice tone="danger">{error}</Notice>}
            <p className="text-xs text-muted">Encerre quando o cliente for embora: a mesa volta a ficar livre e o próximo chamado segue o rodízio normal.</p>
            <Button variant="danger" busy={busy} onClick={() => close(sel.id)}>
              Encerrar mesa
            </Button>
          </div>
        )}
      </Modal>
    </div>
  )
}
