import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { collection, documentId, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { Download, RefreshCw } from 'lucide-react'
import { db } from '../../lib/firebase'
import { col, useLiveQuery, useOpsSettings } from '../../lib/data'
import { duration, tableName } from '../../lib/format'
import { Button, Notice, Spinner } from '../../components/ui'
import { PageTitle } from './AdminLayout'
import { BarList, ColumnChart, DataTable, Heatmap, type Column } from './charts'
import type { Area, Call } from '../../types'

type Session = { id: string; tableId: string; tableLabel: string; areaId: string | null; holderName: string; startAt: Timestamp; endAt: Timestamp | null; durationMin: number | null; calls: number; autoClosed?: boolean }
type DayStats = { id: string; menuOpens?: number; menuOpensByHour?: Record<string, number>; menuOpensByArea?: Record<string, number>; reviewYes?: number; reviewNo?: number }
type Metric = 'calls' | 'opens' | 'sessions'

const PERIODS = [
  { id: 1, label: 'Hoje' },
  { id: 7, label: '7 dias' },
  { id: 30, label: '30 dias' },
  { id: 90, label: '90 dias' },
] as const
const WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const WEEK_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const METRIC_LABEL: Record<Metric, string> = { calls: 'Chamados', opens: 'Cardápios abertos', sessions: 'Mesas atendidas' }

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

/** Painel do ADM: movimento por hora e dia, equipe, mesas e ambientes. Tudo calculado a partir do que o app coleta. */
export function ReportsAdmin() {
  const [days, setDays] = useState<number>(7)
  const [areaId, setAreaId] = useState('all')
  const [metric, setMetric] = useState<Metric>('calls')
  const [data, setData] = useState<{ calls: Call[]; sessions: Session[]; stats: DayStats[]; capped: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const areas = useLiveQuery<Area>(col('areas'), [])
  const ops = useOpsSettings()
  const areaName = useMemo(() => new Map(areas.data.map((a) => [a.id, a.name])), [areas.data])

  const start = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - (days - 1))
    return d
  }, [days])

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const since = Timestamp.fromDate(start)
      const MAX = 6000
      const [c, s, st] = await Promise.all([
        getDocs(query(collection(db, 'calls'), where('createdAt', '>=', since), orderBy('createdAt', 'asc'), limit(MAX))),
        getDocs(query(collection(db, 'sessions'), where('startAt', '>=', since), orderBy('startAt', 'asc'), limit(MAX))),
        getDocs(query(collection(db, 'stats'), where(documentId(), '>=', dayKey(start)), where(documentId(), '<=', dayKey(new Date())))),
      ])
      setData({
        calls: c.docs.map((d) => ({ id: d.id, ...d.data() }) as Call),
        sessions: s.docs.map((d) => ({ id: d.id, ...d.data() }) as Session),
        stats: st.docs.map((d) => ({ id: d.id, ...d.data() }) as DayStats),
        capped: c.size >= MAX || s.size >= MAX,
      })
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [start])

  useEffect(() => {
    load()
  }, [load])

  const r = useMemo(() => (data ? compute(data, areaId, start, days) : null), [data, areaId, start, days])

  function exportCsv() {
    if (!data) return
    const rows = data.calls.filter((c) => areaId === 'all' || c.areaId === areaId)
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [
      ['Data', 'Hora', 'Mesa', 'Ambiente', 'Situação', 'Recebido por', 'Atendido por', 'Tempo até a mesa (s)'].map(esc).join(';'),
      ...rows.map((c) => {
        const d = c.createdAt.toDate()
        return [
          d.toLocaleDateString('pt-BR'),
          d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          c.tableLabel,
          c.areaId ? (areaName.get(c.areaId) ?? '') : '',
          { open: 'Aberto', attended: 'Atendido', expired: 'Sem resposta', closed: 'Encerrado sem atender' }[c.status] ?? c.status,
          c.assignedName ?? (c.routing === 'all' ? 'Todos' : ''),
          c.attendedByName ?? '',
          c.responseSec ?? '',
        ]
          .map(esc)
          .join(';')
      }),
    ]
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chamados-${dayKey(start)}-a-${dayKey(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const series: Column[] = r ? HOURS.map((h) => ({ label: `${h}h`, hint: `das ${h}h às ${h + 1}h`, value: r.byHour[metric][h] })) : []
  const peak = r ? argMax(r.byHour[metric]) : -1
  const calm = r ? argMinActive(r.byHour[metric]) : -1
  // Só as horas em que o lugar teve movimento (o resto é horário fechado).
  const hourCols = (r?.activeHours ?? []).map((h) => ({ ...series[h], tag: h === peak ? 'pico' : h === calm && calm !== peak ? 'calmo' : undefined }))
  const weekCols: Column[] = r ? WEEK_SHORT.map((w, i) => ({ label: w, hint: `média por ${WEEK[i].toLowerCase()}`, value: r.byWeekday[metric][i] })) : []
  const bestDay = r ? argMax(r.byWeekday[metric]) : -1
  const weekTagged = weekCols.map((c, i) => ({ ...c, tag: i === bestDay ? 'melhor' : undefined }))

  return (
    <>
      <PageTitle title="Relatórios">
        <Button variant="secondary" onClick={load} busy={loading}>
          <RefreshCw className="size-4" /> Atualizar
        </Button>
        <Button variant="secondary" onClick={exportCsv} disabled={!data?.calls.length}>
          <Download className="size-4" /> Baixar planilha
        </Button>
      </PageTitle>

      {/* Filtros: valem para tudo abaixo. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setDays(p.id)}
            aria-pressed={days === p.id}
            className={`min-h-10 rounded-full px-4 text-sm font-semibold ${days === p.id ? 'bg-navy text-beige' : 'bg-white ring-1 ring-line'}`}
          >
            {p.label}
          </button>
        ))}
        {areas.data.length > 0 && (
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Ambiente" className="min-h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold">
            <option value="all">Todos os ambientes</option>
            {[...areas.data]
              .sort((a, b) => a.order - b.order)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        )}
      </div>

      {error && <Notice tone="danger">Não foi possível carregar os dados. Confira a internet e toque em Atualizar.</Notice>}
      {!data && loading && <Spinner label="Juntando os números" />}

      {r && (
        <div className={`flex flex-col gap-5 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {data?.capped && <Notice>Período muito longo: mostrando só uma parte. Escolha um período menor para ver tudo.</Notice>}

          <Summary r={r} days={days} metric={metric} peak={peak} calm={calm} bestDay={bestDay} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Chamados" value={r.total} />
            <Stat label="Atendidos" value={`${pct(r.attended, r.total)}%`} sub={`${r.attended} de ${r.total}`} />
            <Stat label="Tempo médio até a mesa" value={r.attended ? duration(r.avgResponse) : '—'} sub={r.attended ? `${pct(r.within2, r.attended)}% em até 2 min` : undefined} />
            <Stat label="Sem resposta" value={r.unanswered} sub={r.escalated ? `${r.escalated} precisaram ir pra todos` : undefined} />
            <Stat label="Mesas atendidas" value={r.sessions} sub={r.sessions ? `${fmt1(r.callsPerSession)} chamados por mesa` : undefined} />
            <Stat label="Permanência média" value={r.avgStay ? duration(r.avgStay * 60) : '—'} sub="da 1ª chamada até encerrar" />
            <Stat label="Cardápios abertos" value={r.opens} sub={areaId !== 'all' ? 'neste ambiente' : 'pelo QR das mesas e pelo link'} />
            <Stat label="Avaliação no Google" value={r.reviewYes} sub={r.reviewYes + r.reviewNo ? `${pct(r.reviewYes, r.reviewYes + r.reviewNo)}% tocaram em "Avaliar"` : 'cliques em "Avaliar"'} />
          </div>

          <Card
            title="Movimento por hora do dia"
            right={
              <div className="flex flex-wrap gap-1">
                {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMetric(m)}
                    aria-pressed={metric === m}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${metric === m ? 'bg-navy text-beige' : 'bg-beige ring-1 ring-line'}`}
                  >
                    {METRIC_LABEL[m]}
                  </button>
                ))}
              </div>
            }
            note={metric === 'opens' && areaId !== 'all' ? 'Por hora, os cardápios abertos contam todos os ambientes.' : `${METRIC_LABEL[metric]} somados no período.`}
          >
            <ColumnChart data={hourCols} ariaLabel={`${METRIC_LABEL[metric]} por hora do dia`} />
            <DataTable head={['Hora', METRIC_LABEL[metric]]} rows={series.filter((c) => c.value > 0).map((c) => [c.hint ?? c.label, c.value])} />
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Movimento por dia da semana" note={`Média de ${METRIC_LABEL[metric].toLowerCase()} por dia. ${days < 14 ? 'Fica mais confiável com 30 dias ou mais.' : ''}`}>
              <ColumnChart data={weekTagged} height={260} width={560} ariaLabel={`${METRIC_LABEL[metric]} por dia da semana`} />
              <DataTable head={['Dia', 'Média por dia', 'Dias no período']} rows={WEEK.map((w, i) => [w, r.byWeekday[metric][i], r.weekdayCount[i]])} />
            </Card>
            <Card title="Dia da semana × hora" note={`Quanto mais escuro, mais ${METRIC_LABEL[metric].toLowerCase()}. Bom para decidir horário de abertura e escala.`}>
              <Heatmap
                rows={WEEK_SHORT}
                cols={r.activeHours.map((h) => `${h}h`)}
                values={WEEK_SHORT.map((_, wd) => r.activeHours.map((h) => r.grid[metric][wd][h]))}
                ariaLabel="Mapa de calor por dia da semana e hora"
              />
            </Card>
          </div>

          {days > 1 && (
            <Card title="Dia a dia" note={`${METRIC_LABEL[metric]} em cada dia do período.`}>
              <ColumnChart
                data={r.daily.map((d) => ({ label: d.label, hint: d.hint, value: d[metric] }))}
                height={170}
                ariaLabel={`${METRIC_LABEL[metric]} por dia`}
              />
              <DataTable head={['Dia', 'Chamados', 'Cardápios abertos', 'Mesas atendidas']} rows={r.daily.map((d) => [d.hint, d.calls, d.opens, d.sessions])} />
            </Card>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            <Card
              title="Equipe"
              note={
                ops.data.routing === 'round_robin'
                  ? 'No rodízio cada um recebe mais ou menos a mesma quantidade de chamados. Compare o tempo até a mesa.'
                  : 'Com "todos recebem", quem atende mais aparece no topo. O tempo até a mesa mostra a agilidade.'
              }
            >
              {!r.team.length ? (
                <p className="text-sm text-muted">Nenhum chamado atendido no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-muted">
                      <tr>
                        <th className="py-2 pr-3 font-semibold">Pessoa</th>
                        <th className="py-2 pr-3 font-semibold">Atendeu</th>
                        <th className="py-2 pr-3 font-semibold">Recebeu</th>
                        <th className="py-2 pr-3 font-semibold">Tempo médio</th>
                        <th className="py-2 font-semibold">Em até 2 min</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {r.team.map((p) => (
                        <tr key={p.name}>
                          <td className="py-2 pr-3 font-semibold">{p.name}</td>
                          <td className="py-2 pr-3 tabular-nums">{p.attended}</td>
                          <td className="py-2 pr-3 tabular-nums">{p.received || '—'}</td>
                          <td className="py-2 pr-3 tabular-nums">{duration(p.avg)}</td>
                          <td className="py-2 tabular-nums">{pct(p.within2, p.attended)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Mesas que mais chamaram" note="Ajuda a ver onde precisa de mais atenção (perto da quadra, do bar...).">
              {!r.topTables.length ? (
                <p className="text-sm text-muted">Nenhum chamado no período.</p>
              ) : (
                <BarList items={r.topTables.map((t) => ({ label: tableName(t.label), value: t.calls, extra: t.avg ? `média ${duration(t.avg)}` : undefined }))} />
              )}
            </Card>
          </div>

          {areaId === 'all' && r.byArea.length > 1 && (
            <Card title="Ambientes">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-2 pr-3 font-semibold">Ambiente</th>
                      <th className="py-2 pr-3 font-semibold">Chamados</th>
                      <th className="py-2 pr-3 font-semibold">Mesas atendidas</th>
                      <th className="py-2 pr-3 font-semibold">Tempo médio até a mesa</th>
                      <th className="py-2 font-semibold">Cardápios abertos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {r.byArea.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2 pr-3 font-semibold">{a.id === '_none' ? 'Sem ambiente' : (areaName.get(a.id) ?? 'Ambiente apagado')}</td>
                        <td className="py-2 pr-3 tabular-nums">{a.calls}</td>
                        <td className="py-2 pr-3 tabular-nums">{a.sessions}</td>
                        <td className="py-2 pr-3 tabular-nums">{a.avg ? duration(a.avg) : '—'}</td>
                        <td className="py-2 tabular-nums">{a.opens || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  )
}

const fmt1 = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

function argMax(a: number[]) {
  let best = -1
  a.forEach((v, i) => {
    if (v > 0 && (best < 0 || v > a[best])) best = i
  })
  return best
}
/** Hora mais calma entre as que tiveram algum movimento (horário fechado não conta). */
function argMinActive(a: number[]) {
  let best = -1
  a.forEach((v, i) => {
    if (v > 0 && (best < 0 || v < a[best])) best = i
  })
  return best
}

function compute(data: { calls: Call[]; sessions: Session[]; stats: DayStats[] }, areaId: string, start: Date, days: number) {
  const inArea = (a: string | null | undefined) => areaId === 'all' || a === areaId
  const calls = data.calls.filter((c) => inArea(c.areaId))
  const sessions = data.sessions.filter((s) => inArea(s.areaId))
  const zeros24 = () => HOURS.map(() => 0)
  const grid = () => WEEK.map(() => zeros24())

  // Dias do período (para médias por dia da semana).
  const dayList: Date[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    dayList.push(d)
  }
  const weekdayCount = WEEK.map((_, wd) => dayList.filter((d) => d.getDay() === wd).length)

  const byHour = { calls: zeros24(), opens: zeros24(), sessions: zeros24() }
  const g = { calls: grid(), opens: grid(), sessions: grid() }
  const perDay = new Map(dayList.map((d) => [dayKey(d), { calls: 0, opens: 0, sessions: 0 }]))

  for (const c of calls) {
    const d = c.createdAt.toDate()
    byHour.calls[d.getHours()]++
    g.calls[d.getDay()][d.getHours()]++
    const pd = perDay.get(dayKey(d))
    if (pd) pd.calls++
  }
  for (const s of sessions) {
    const d = s.startAt.toDate()
    byHour.sessions[d.getHours()]++
    g.sessions[d.getDay()][d.getHours()]++
    const pd = perDay.get(dayKey(d))
    if (pd) pd.sessions++
  }
  let opens = 0
  let reviewYes = 0
  let reviewNo = 0
  const opensByArea = new Map<string, number>()
  for (const st of data.stats) {
    const wd = fromKey(st.id).getDay()
    const dayOpens = areaId === 'all' ? (st.menuOpens ?? 0) : (st.menuOpensByArea?.[areaId] ?? 0)
    opens += dayOpens
    reviewYes += st.reviewYes ?? 0
    reviewNo += st.reviewNo ?? 0
    for (const [h, n] of Object.entries(st.menuOpensByHour ?? {})) {
      byHour.opens[Number(h)] += n
      g.opens[wd][Number(h)] += n
    }
    for (const [a, n] of Object.entries(st.menuOpensByArea ?? {})) opensByArea.set(a, (opensByArea.get(a) ?? 0) + n)
    const pd = perDay.get(st.id)
    if (pd) pd.opens += dayOpens
  }

  const attendedCalls = calls.filter((c) => c.status === 'attended' && typeof c.responseSec === 'number')
  const avgResponse = attendedCalls.length ? attendedCalls.reduce((a, c) => a + (c.responseSec ?? 0), 0) / attendedCalls.length : 0
  const within2 = attendedCalls.filter((c) => (c.responseSec ?? 0) <= 120).length
  const finished = sessions.filter((s) => typeof s.durationMin === 'number' && !s.autoClosed)
  const avgStay = finished.length ? finished.reduce((a, s) => a + (s.durationMin ?? 0), 0) / finished.length : 0

  // Equipe: quem atendeu, quantos recebeu (rodízio), tempo médio.
  const team = new Map<string, { name: string; attended: number; received: number; total: number; within2: number }>()
  const person = (name: string) => team.get(name) ?? team.set(name, { name, attended: 0, received: 0, total: 0, within2: 0 }).get(name)!
  for (const c of calls) if (c.assignedName) person(c.assignedName).received++
  for (const c of attendedCalls) {
    const p = person(c.attendedByName ?? '—')
    p.attended++
    p.total += c.responseSec ?? 0
    if ((c.responseSec ?? 0) <= 120) p.within2++
  }

  // Mesas que mais chamaram.
  const tables = new Map<string, { label: string; calls: number; total: number; n: number }>()
  for (const c of calls) {
    const t = tables.get(c.tableId) ?? tables.set(c.tableId, { label: c.tableLabel, calls: 0, total: 0, n: 0 }).get(c.tableId)!
    t.calls++
    if (typeof c.responseSec === 'number') {
      t.total += c.responseSec
      t.n++
    }
  }

  // Ambientes.
  const areas = new Map<string, { id: string; calls: number; sessions: number; total: number; n: number; opens: number }>()
  const area = (id: string | null | undefined) => {
    const k = id ?? '_none'
    return areas.get(k) ?? areas.set(k, { id: k, calls: 0, sessions: 0, total: 0, n: 0, opens: opensByArea.get(k) ?? 0 }).get(k)!
  }
  for (const c of calls) {
    const a = area(c.areaId)
    a.calls++
    if (typeof c.responseSec === 'number') {
      a.total += c.responseSec
      a.n++
    }
  }
  for (const s of sessions) area(s.areaId).sessions++

  const sumAll = (m: Metric) => byHour[m].reduce((a, b) => a + b, 0)
  const activeHours = HOURS.filter((h) => byHour.calls[h] + byHour.opens[h] + byHour.sessions[h] > 0)
  const span = activeHours.length ? HOURS.slice(Math.min(...activeHours), Math.max(...activeHours) + 1) : HOURS.slice(10, 24)

  return {
    total: calls.length,
    attended: attendedCalls.length,
    avgResponse,
    within2,
    unanswered: calls.filter((c) => c.status === 'expired' || c.status === 'closed').length,
    escalated: calls.filter((c) => c.escalated).length,
    sessions: sessions.length,
    callsPerSession: sessions.length ? sessions.reduce((a, s) => a + (s.calls ?? 1), 0) / sessions.length : 0,
    avgStay,
    opens,
    reviewYes,
    reviewNo,
    byHour,
    grid: g,
    byWeekday: {
      calls: WEEK.map((_, wd) => (weekdayCount[wd] ? g.calls[wd].reduce((a, b) => a + b, 0) / weekdayCount[wd] : 0)),
      opens: WEEK.map((_, wd) => (weekdayCount[wd] ? g.opens[wd].reduce((a, b) => a + b, 0) / weekdayCount[wd] : 0)),
      sessions: WEEK.map((_, wd) => (weekdayCount[wd] ? g.sessions[wd].reduce((a, b) => a + b, 0) / weekdayCount[wd] : 0)),
    },
    weekdayCount,
    activeHours: span,
    daily: dayList.map((d) => {
      const v = perDay.get(dayKey(d))!
      return { label: `${d.getDate()}/${d.getMonth() + 1}`, hint: `${WEEK[d.getDay()]}, ${d.toLocaleDateString('pt-BR')}`, ...v }
    }),
    team: [...team.values()].filter((p) => p.attended > 0).map((p) => ({ ...p, avg: p.total / p.attended })).sort((a, b) => b.attended - a.attended || a.avg - b.avg),
    topTables: [...tables.values()].map((t) => ({ ...t, avg: t.n ? t.total / t.n : 0 })).sort((a, b) => b.calls - a.calls).slice(0, 10),
    byArea: [...areas.values()].map((a) => ({ ...a, avg: a.n ? a.total / a.n : 0 })).sort((a, b) => b.calls - a.calls),
    totals: { calls: sumAll('calls'), opens: sumAll('opens'), sessions: sumAll('sessions') },
  }
}

type Result = ReturnType<typeof compute>

/** Resumo em texto: o que o dono quer saber de cara. */
function Summary({ r, days, metric, peak, calm, bestDay }: { r: Result; days: number; metric: Metric; peak: number; calm: number; bestDay: number }) {
  const worstDay = (() => {
    let w = -1
    r.byWeekday[metric].forEach((v, i) => {
      if (r.weekdayCount[i] && (w < 0 || v < r.byWeekday[metric][w])) w = i
    })
    return w
  })()
  if (!r.totals[metric]) {
    return <Notice>Ainda não há {METRIC_LABEL[metric].toLowerCase()} neste período. Os números aparecem conforme o app for usado.</Notice>
  }
  const items: ReactNode[] = []
  if (peak >= 0) items.push(<>Horário de pico: <strong>das {peak}h às {peak + 1}h</strong></>)
  if (calm >= 0 && calm !== peak) items.push(<>Horário mais calmo (com movimento): <strong>das {calm}h às {calm + 1}h</strong></>)
  if (days >= 7 && bestDay >= 0) items.push(<>Dia mais forte: <strong>{WEEK[bestDay].toLowerCase()}</strong></>)
  if (days >= 7 && worstDay >= 0 && worstDay !== bestDay) items.push(<>Dia mais fraco: <strong>{WEEK[worstDay].toLowerCase()}</strong></>)
  if (r.attended) items.push(<>A equipe chega na mesa em <strong>{duration(r.avgResponse)}</strong>, em média</>)
  return (
    <section className="rounded-2xl bg-navy p-4 text-beige sm:p-5">
      <h2 className="mb-2 font-bold">Resumo do período</h2>
      <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
      {days < 28 && <p className="mt-3 text-xs opacity-75">Com poucas semanas de dados, dia e horário podem mudar bastante. Depois de 1 a 2 meses, as conclusões ficam bem mais seguras.</p>}
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  )
}

function Card({ title, note, right, children }: { title: string; note?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-line sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">{title}</h2>
          {note && <p className="text-xs text-muted">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}
