import { collection, query, where } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useLiveQuery } from '../../lib/data'
import { money, timeOf } from '../../lib/format'
import { Spinner } from '../../components/ui'
import type { Order } from '../../types'

const STATUS: Record<Order['status'], string> = { new: 'na cozinha', ready: 'pronto', delivered: 'entregue', canceled: 'cancelado' }

/** Tudo o que a mesa pediu nesta visita, com o total (para lançar no caixa). */
export function TableOrders({ sessionId }: { sessionId: string }) {
  const orders = useLiveQuery<Order>(query(collection(db, 'orders'), where('sessionId', '==', sessionId)), [sessionId])
  if (orders.loading) return <Spinner />
  const list = [...orders.data].sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis())
  const total = list.filter((o) => o.status !== 'canceled').reduce((s, o) => s + o.total, 0)
  if (!list.length) return <p className="text-sm text-muted">Nenhum pedido nesta mesa ainda.</p>

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto">
        {list.map((o) => (
          <li key={o.id} className={`rounded-xl bg-beige p-3 ${o.status === 'canceled' ? 'opacity-60' : ''}`}>
            <p className="text-xs text-muted">
              Pedido nº {o.number} · {timeOf(o.createdAt.toDate())} · {o.waiterName.split(' ')[0]} · {STATUS[o.status]}
            </p>
            <ul className={`mt-1 flex flex-col gap-0.5 text-sm ${o.status === 'canceled' ? 'line-through' : ''}`}>
              {o.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    {l.qty}x {l.name}
                    {l.note && <span className="text-muted"> ({l.note})</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">{money(l.qty * l.unitPrice)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="flex items-center justify-between rounded-xl bg-navy px-4 py-3 text-beige">
        <span className="font-semibold">Total da mesa</span>
        <span className="text-xl font-bold tabular-nums">{money(total)}</span>
      </p>
    </div>
  )
}
