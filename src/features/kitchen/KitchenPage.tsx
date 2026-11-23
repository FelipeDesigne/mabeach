import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { collection, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { Check, LayoutDashboard, LogOut, Printer, UserRound } from 'lucide-react'
import { callFn, db, errorMessage } from '../../lib/firebase'
import { useLiveQuery, useNow } from '../../lib/data'
import { duration, tableName, timeOf } from '../../lib/format'
import { beep } from '../../lib/beep'
import { usePref, useKeepAwake } from '../../lib/devicePrefs'
import { Button, Notice, Spinner, Switch } from '../../components/ui'
import { canManage, useAuth } from '../auth/AuthProvider'
import type { Order } from '../../types'

/** Pedidos já impressos neste computador (não imprime de novo ao recarregar a tela). */
const PRINTED_KEY = 'mabeach-impressos'
function loadPrinted(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PRINTED_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
function savePrinted(list: string[]) {
  try {
    localStorage.setItem(PRINTED_KEY, JSON.stringify(list.slice(-400)))
  } catch {
    // sem armazenamento: pode imprimir de novo se a tela recarregar
  }
}

type Ticket = { order: Order; canceled: boolean }

/**
 * Cozinha: pedidos chegando ao vivo, em letra grande. Cada pedido novo toca e sai na impressora térmica;
 * cancelamentos também saem impressos. "Pronto" avisa o garçom que anotou.
 */
export function KitchenPage() {
  const { role, signOut } = useAuth()
  const now = useNow(30000)
  // Pedidos das últimas 14 horas (um expediente).
  const since = useMemo(() => Timestamp.fromMillis(Date.now() - 14 * 3600 * 1000), [])
  const orders = useLiveQuery<Order>(query(collection(db, 'orders'), where('createdAt', '>=', since), orderBy('createdAt', 'asc')), [since])
  const [autoPrint, setAutoPrint] = usePref('autoPrint')
  const [sound, setSound] = usePref('sound')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const printed = useRef<Set<string>>(new Set(loadPrinted()))
  const seen = useRef<Set<string> | null>(null)
  useKeepAwake(true)

  const todo = orders.data.filter((o) => o.status === 'new')
  const done = orders.data.filter((o) => o.status === 'ready' || o.status === 'delivered').slice(-12).reverse()
  const canceled = orders.data.filter((o) => o.status === 'canceled' && o.canceledAt && now - o.canceledAt.toMillis() < 30 * 60 * 1000).reverse()

  // Som ao chegar pedido novo.
  useEffect(() => {
    if (orders.loading) return
    const ids = new Set(orders.data.filter((o) => o.status === 'new').map((o) => o.id))
    if (seen.current && sound && [...ids].some((id) => !seen.current!.has(id))) beep(3, 990)
    seen.current = ids
  }, [orders.loading, orders.data, sound])

  // Fila de impressão: um papel por vez. Pedido novo sai uma vez; cancelamento sai se o pedido tinha sido impresso aqui.
  const queue = useMemo<Ticket[]>(() => {
    if (!autoPrint || orders.loading) return []
    const out: Ticket[] = []
    for (const o of orders.data) {
      if (o.status === 'new' && !printed.current.has(o.id)) out.push({ order: o, canceled: false })
      if (o.status === 'canceled' && printed.current.has(o.id) && !printed.current.has(`${o.id}:c`)) out.push({ order: o, canceled: true })
    }
    return out
    // `ticket` entra para recalcular depois de cada impressão.
  }, [autoPrint, orders.loading, orders.data, ticket])

  useEffect(() => {
    if (!ticket && queue.length) setTicket(queue[0])
  }, [queue, ticket])

  useEffect(() => {
    if (!ticket) return
    // Espera o papel aparecer na página e manda imprimir. No computador da cozinha a impressão sai direto.
    const t = setTimeout(() => {
      window.print()
      printed.current.add(ticket.canceled ? `${ticket.order.id}:c` : ticket.order.id)
      savePrinted([...printed.current])
      setTicket(null)
    }, 300)
    return () => clearTimeout(t)
  }, [ticket])

  function reprint(o: Order) {
    if (!ticket) setTicket({ order: o, canceled: o.status === 'canceled' })
  }

  async function markReady(o: Order) {
    setBusyId(o.id)
    setError('')
    try {
      await callFn('setOrderStatus', { orderId: o.id, status: 'ready' })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <style>{`@media print { @page { size: 80mm auto; margin: 0; } }`}</style>
      <div className="no-print min-h-dvh pb-10">
        <header className="sticky top-0 z-10 bg-navy text-beige">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <img src="/logo-branco.svg" alt="MA Beach" className="h-9 w-auto" width={2782} height={1908} />
              <h1 className="text-xl font-bold">Cozinha</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-full bg-beige py-1 pr-3 pl-1.5 text-sm font-semibold text-navy">
                <Switch checked={autoPrint} onChange={setAutoPrint} label="Imprimir os pedidos sozinho" />
                Imprimir sozinho
              </label>
              <label className="flex items-center gap-2 rounded-full bg-beige py-1 pr-3 pl-1.5 text-sm font-semibold text-navy">
                <Switch checked={sound} onChange={setSound} label="Som" />
                Som
              </label>
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
          </div>
        </header>

        <main className="grid gap-6 px-4 pt-4 lg:grid-cols-[1fr_20rem]">
          <section>
            {error && (
              <div className="mb-3">
                <Notice tone="danger">{error}</Notice>
              </div>
            )}
            {canceled.length > 0 && (
              <ul className="mb-4 flex flex-col gap-2">
                {canceled.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-danger p-4 text-white">
                    <p className="text-xl font-bold">CANCELADO · nº {o.number} · {tableName(o.tableLabel)}</p>
                    <p className="text-sm text-white/90">{o.lines.map((l) => `${l.qty}x ${l.name}`).join(', ')}</p>
                  </li>
                ))}
              </ul>
            )}
            <h2 className="mb-3 text-2xl font-bold">
              A fazer <span className="text-muted">({todo.length})</span>
            </h2>
            {orders.loading && <Spinner />}
            {orders.error && <Notice tone="danger">Não foi possível carregar os pedidos. Confira a internet.</Notice>}
            {!orders.loading && !todo.length && (
              <div className="flex flex-col items-center gap-2 rounded-2xl bg-white py-16 text-center ring-1 ring-line">
                <Check className="size-10 text-success" aria-hidden />
                <p className="text-lg font-semibold">Nenhum pedido esperando</p>
              </div>
            )}
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {todo.map((o) => {
                const waitMin = (now - o.createdAt.toMillis()) / 60000
                return (
                  <li key={o.id} className={`flex flex-col gap-3 rounded-2xl bg-white p-4 ring-2 ${waitMin >= 20 ? 'ring-warning' : 'ring-line'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-3xl leading-none font-bold">{tableName(o.tableLabel)}</p>
                        <p className="mt-1 text-sm text-muted">
                          nº {o.number} · {o.waiterName.split(' ')[0]} · {timeOf(o.createdAt.toDate())}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${waitMin >= 20 ? 'bg-warning text-white' : 'bg-beige-200'}`}>
                        {duration(Math.max(0, waitMin * 60))}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-2 border-t border-line pt-3">
                      {o.lines.map((l, i) => (
                        <li key={i}>
                          <p className="text-xl leading-snug">
                            <strong>{l.qty}x</strong> {l.name}
                          </p>
                          {l.note && <p className="ml-8 text-lg font-semibold text-danger">→ {l.note}</p>}
                        </li>
                      ))}
                    </ul>
                    {o.note && <p className="rounded-xl bg-beige p-3 text-base font-semibold">Obs.: {o.note}</p>}
                    <div className="mt-auto flex gap-2">
                      <Button variant="success" onClick={() => markReady(o)} busy={busyId === o.id} className="min-h-14 flex-1 text-lg">
                        <Check className="size-6" /> Pronto
                      </Button>
                      <Button variant="secondary" onClick={() => reprint(o)} aria-label={`Imprimir de novo o pedido ${o.number}`} className="min-h-14">
                        <Printer className="size-5" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          <aside>
            <h2 className="mb-3 text-lg font-bold">Prontos</h2>
            {!done.length ? (
              <p className="text-sm text-muted">Nenhum ainda.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {done.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 rounded-xl bg-white p-3 ring-1 ring-line">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {tableName(o.tableLabel)} <span className="font-normal text-muted">· nº {o.number}</span>
                      </p>
                      <p className="truncate text-xs text-muted">{o.status === 'delivered' ? 'Entregue' : `Pronto ${o.readyAt ? timeOf(o.readyAt.toDate()) : ''}`}</p>
                    </div>
                    <button type="button" onClick={() => reprint(o)} className="rounded-lg p-2.5 hover:bg-beige-200" aria-label={`Imprimir de novo o pedido ${o.number}`}>
                      <Printer className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </main>
      </div>

      {ticket && <PrintTicket ticket={ticket} />}
    </>
  )
}

/** Papel da impressora térmica (80 mm): só aparece na impressão. */
function PrintTicket({ ticket: { order: o, canceled } }: { ticket: Ticket }) {
  return (
    <div className="hidden w-[72mm] px-[2mm] py-[3mm] font-sans text-black print:block">
      <p className="text-center text-[11pt] font-bold tracking-widest">MA BEACH</p>
      {canceled && <p className="my-[2mm] border-y-2 border-black py-[1mm] text-center text-[16pt] font-black">*** CANCELADO ***</p>}
      <p className="mt-[2mm] text-center text-[22pt] leading-none font-black">{tableName(o.tableLabel).toUpperCase()}</p>
      <p className="mt-[1mm] text-center text-[12pt] font-bold">Pedido nº {o.number}</p>
      <p className="text-center text-[9pt]">
        {o.waiterName} · {timeOf(o.createdAt.toDate())}
      </p>
      <div className="my-[2mm] border-t border-dashed border-black" />
      {o.lines.map((l, i) => (
        <div key={i} className="mb-[1.5mm]">
          <p className="text-[13pt] leading-tight font-bold">
            {l.qty}x {l.name}
          </p>
          {l.note && <p className="pl-[4mm] text-[11pt] leading-tight">&gt; {l.note}</p>}
        </div>
      ))}
      {o.note && (
        <>
          <div className="my-[2mm] border-t border-dashed border-black" />
          <p className="text-[11pt] font-bold">Obs.: {o.note}</p>
        </>
      )}
      <div className="mt-[2mm] border-t border-dashed border-black" />
    </div>
  )
}
