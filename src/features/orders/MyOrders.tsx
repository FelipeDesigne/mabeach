import { useEffect, useRef, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { ChefHat } from 'lucide-react'
import { callFn, db, errorMessage } from '../../lib/firebase'
import { useLiveQuery } from '../../lib/data'
import { duration, tableName } from '../../lib/format'
import { beep } from '../../lib/beep'
import { readPref } from '../../lib/devicePrefs'
import { Button, Notice } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import type { Order } from '../../types'

const summary = (o: Order) => o.lines.map((l) => `${l.qty}x ${l.name}`).join(', ')

/** Pedidos do garçom: prontos para buscar (com aviso) e os que ainda estão na cozinha. */
export function MyOrders({ uid, now }: { uid: string; now: number }) {
  const { ask } = useDialogs()
  const orders = useLiveQuery<Order>(query(collection(db, 'orders'), where('waiterUid', '==', uid), where('status', 'in', ['new', 'ready'])), [uid])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const seenReady = useRef<Set<string> | null>(null)

  const sorted = [...orders.data].sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis())
  const ready = sorted.filter((o) => o.status === 'ready')
  const cooking = sorted.filter((o) => o.status === 'new')

  // Toca quando um pedido fica pronto com a tela aberta (com a tela fechada, quem avisa é o celular).
  useEffect(() => {
    if (orders.loading) return
    const ids = new Set(orders.data.filter((o) => o.status === 'ready').map((o) => o.id))
    if (seenReady.current && readPref('sound') && [...ids].some((id) => !seenReady.current!.has(id))) beep(3, 660)
    seenReady.current = ids
  }, [orders.loading, orders.data])

  async function setStatus(o: Order, status: 'delivered' | 'canceled') {
    if (status === 'canceled') {
      const ok = await ask({
        title: `Cancelar o pedido nº ${o.number}?`,
        message: `${tableName(o.tableLabel)}: ${summary(o)}. A cozinha vê o cancelamento na hora.`,
        confirmLabel: 'Cancelar pedido',
        cancelLabel: 'Voltar',
        tone: 'danger',
      })
      if (!ok) return
    }
    setBusyId(o.id)
    setError('')
    try {
      await callFn('setOrderStatus', { orderId: o.id, status })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  if (!orders.data.length) return null

  return (
    <section className="flex flex-col gap-3">
      {error && <Notice tone="danger">{error}</Notice>}
      {ready.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-bold">Pedidos prontos</h2>
          <ul className="flex flex-col gap-3">
            {ready.map((o) => (
              <li key={o.id} className="flex items-center gap-4 rounded-2xl bg-success p-4 text-white">
                <ChefHat className="size-7 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xl font-bold">{tableName(o.tableLabel)}</p>
                  <p className="text-sm text-white/90">
                    Pedido nº {o.number} · {summary(o)}
                  </p>
                </div>
                <Button variant="secondary" busy={busyId === o.id} onClick={() => setStatus(o, 'delivered')}>
                  Entregue
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cooking.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-bold">Na cozinha</h2>
          <ul className="flex flex-col gap-2">
            {cooking.map((o) => (
              <li key={o.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 pl-4 ring-1 ring-line">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {tableName(o.tableLabel)} <span className="font-normal text-muted">· nº {o.number} · há {duration(Math.max(0, (now - o.createdAt.toMillis()) / 1000))}</span>
                  </p>
                  <p className="truncate text-sm text-muted">{summary(o)}</p>
                </div>
                <Button variant="ghost" busy={busyId === o.id} onClick={() => setStatus(o, 'canceled')}>
                  Cancelar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
