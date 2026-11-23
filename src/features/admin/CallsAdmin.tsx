import { useMemo, useState } from 'react'
import { collection, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useLiveQuery } from '../../lib/data'
import { duration, tableName, timeOf } from '../../lib/format'
import { Badge, Input, Notice, Spinner } from '../../components/ui'
import { PageTitle } from './AdminLayout'
import type { Call } from '../../types'

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Histórico do dia: quem atendeu cada mesa e em quanto tempo. */
export function CallsAdmin() {
  const [day, setDay] = useState(todayStr)
  const range = useMemo(() => {
    const [y, m, d] = day.split('-').map(Number)
    const start = new Date(y, m - 1, d)
    return [Timestamp.fromDate(start), Timestamp.fromDate(new Date(y, m - 1, d + 1))] as const
  }, [day])
  const calls = useLiveQuery<Call>(
    query(collection(db, 'calls'), where('createdAt', '>=', range[0]), where('createdAt', '<', range[1]), orderBy('createdAt', 'desc')),
    [range],
  )

  const stats = useMemo(() => {
    const attended = calls.data.filter((c) => c.status === 'attended' && typeof c.responseSec === 'number')
    const avg = attended.length ? attended.reduce((s, c) => s + (c.responseSec ?? 0), 0) / attended.length : 0
    const byPerson = new Map<string, { name: string; count: number; total: number }>()
    for (const c of attended) {
      const k = c.attendedBy ?? '?'
      const cur = byPerson.get(k) ?? { name: c.attendedByName ?? '—', count: 0, total: 0 }
      cur.count++
      cur.total += c.responseSec ?? 0
      byPerson.set(k, cur)
    }
    return { total: calls.data.length, attended: attended.length, avg, people: [...byPerson.values()].sort((a, b) => b.count - a.count) }
  }, [calls.data])

  return (
    <>
      <PageTitle title="Histórico de chamados">
        <Input type="date" value={day} max={todayStr()} onChange={(e) => e.target.value && setDay(e.target.value)} className="w-auto" aria-label="Dia" />
      </PageTitle>

      {calls.loading ? (
        <Spinner />
      ) : calls.error ? (
        <Notice tone="danger">Não foi possível carregar o histórico.</Notice>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <Stat label="Chamados" value={String(stats.total)} />
            <Stat label="Atendidos" value={String(stats.attended)} />
            <Stat label="Tempo médio" value={stats.attended ? duration(stats.avg) : '—'} />
          </div>

          {stats.people.length > 0 && (
            <section className="mb-6 rounded-2xl bg-white p-4 ring-1 ring-line">
              <h2 className="mb-3 font-bold">Por pessoa</h2>
              <ul className="divide-y divide-line text-sm">
                {stats.people.map((p) => (
                  <li key={p.name} className="flex justify-between gap-3 py-2">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-muted">
                      {p.count} {p.count === 1 ? 'atendimento' : 'atendimentos'} · média {duration(p.total / p.count)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!calls.data.length ? (
            <Notice>Nenhum chamado neste dia.</Notice>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-line">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Hora</th>
                    <th className="px-4 py-3 font-semibold">Mesa</th>
                    <th className="px-4 py-3 font-semibold">Situação</th>
                    <th className="px-4 py-3 font-semibold">Atendido por</th>
                    <th className="px-4 py-3 font-semibold">Tempo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {calls.data.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3 tabular-nums">{timeOf(c.createdAt.toDate())}</td>
                      <td className="px-4 py-3 font-semibold">{tableName(c.tableLabel)}</td>
                      <td className="px-4 py-3">
                        {c.status === 'attended' ? <Badge tone="success">Atendido</Badge> : c.status === 'open' ? <Badge tone="warning">Aberto</Badge> : <Badge>Encerrado</Badge>}
                      </td>
                      <td className="px-4 py-3">{c.attendedByName ?? (c.assignedName ? <span className="text-muted">pra {c.assignedName}</span> : '—')}</td>
                      <td className="px-4 py-3 tabular-nums">{typeof c.responseSec === 'number' ? duration(c.responseSec) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}
