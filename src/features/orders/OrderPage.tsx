import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { collection, query, where } from 'firebase/firestore'
import { ArrowLeft, CheckCircle2, Minus, Plus, Search, Send, X } from 'lucide-react'
import { callFn, db, errorMessage } from '../../lib/firebase'
import { col, useLiveQuery } from '../../lib/data'
import { money, tableName } from '../../lib/format'
import { Button, Notice, Spinner } from '../../components/ui'
import { useAuth } from '../auth/AuthProvider'
import { currentPrice, type Area, type Category, type Item, type Table, type TableStatus } from '../../types'

type Line = { qty: number; note: string }
type Draft = { tableId: string | null; lines: Record<string, Line>; note: string }
type Step = 'mesa' | 'itens' | 'revisar' | 'enviado'

// Rascunho do pedido neste aparelho (some ao fechar o navegador): não perde o que já anotou se a tela recarregar.
const DRAFT_KEY = 'mabeach-pedido'
const EMPTY: Draft = { tableId: null, lines: {}, note: '' }
function loadDraft(): Draft {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null
    if (d && typeof d === 'object' && d.lines && typeof d.lines === 'object') return { ...EMPTY, ...d }
  } catch {
    // rascunho ilegível: começa do zero
  }
  return EMPTY
}

const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR')
const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true })
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Comanda no celular do garçom: escolhe a mesa, toca nos itens, revisa e envia para a cozinha. */
export function OrderPage() {
  const { user } = useAuth()
  const uid = user!.uid
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [draft, setDraft] = useState<Draft>(() => {
    const d = loadDraft()
    const mesa = params.get('mesa')
    return mesa && /^[A-Za-z0-9]{10,40}$/.test(mesa) ? { ...d, tableId: mesa } : d
  })
  const [step, setStep] = useState<Step>(() => (draft.tableId ? 'itens' : 'mesa'))
  const [sent, setSent] = useState<{ number: number; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const tables = useLiveQuery<Table>(col('tables'), [])
  const statuses = useLiveQuery<TableStatus>(col('tableStatus'), [])
  const areas = useLiveQuery<Area>(col('areas'), [])
  const cats = useLiveQuery<Category>(query(collection(db, 'categories'), where('visible', '==', true)), [])
  const items = useLiveQuery<Item>(query(collection(db, 'items'), where('visible', '==', true)), [])

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // sem armazenamento: o rascunho vale só enquanto a tela estiver aberta
    }
  }, [draft])

  const table = tables.data.find((t) => t.id === draft.tableId && t.active) ?? null
  const itemById = useMemo(() => new Map(items.data.map((i) => [i.id, i])), [items.data])
  // Linhas válidas (item ainda no cardápio), na ordem em que foram adicionadas.
  const lines = Object.entries(draft.lines)
    .map(([id, l]) => ({ item: itemById.get(id), ...l, id }))
    .filter((l): l is { item: Item; qty: number; note: string; id: string } => !!l.item && l.qty > 0)
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const total = lines.reduce((s, l) => s + l.qty * currentPrice(l.item), 0)

  const setQty = (id: string, qty: number) =>
    setDraft((d) => {
      const next = { ...d.lines }
      if (qty <= 0) delete next[id]
      else next[id] = { qty: Math.min(50, qty), note: next[id]?.note ?? '' }
      return { ...d, lines: next }
    })
  const setNote = (id: string, note: string) => setDraft((d) => ({ ...d, lines: { ...d.lines, [id]: { ...d.lines[id], note: note.slice(0, 140) } } }))

  async function send() {
    setError('')
    if (!table) {
      setError('Escolha a mesa antes de enviar.')
      return setStep('mesa')
    }
    if (!lines.length) return setError('Adicione pelo menos um item.')
    setBusy(true)
    try {
      const res = await callFn<unknown, { orderId: string; number: number }>('createOrder', {
        tableId: table.id,
        lines: lines.map((l) => ({ itemId: l.id, qty: l.qty, ...(l.note.trim() ? { note: l.note.trim() } : {}) })),
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      })
      setSent({ number: res.number, label: table.label })
      setDraft((d) => ({ ...d, lines: {}, note: '' }))
      setStep('enviado')
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível enviar. Confira a internet e tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  function exit() {
    try {
      sessionStorage.removeItem(DRAFT_KEY)
    } catch {
      // nada a limpar
    }
    navigate('/garcom')
  }

  const back = step === 'revisar' ? () => setStep('itens') : step === 'itens' && !count ? () => setStep('mesa') : null
  const title = step === 'mesa' ? 'Escolha a mesa' : step === 'revisar' ? 'Revisar pedido' : step === 'enviado' ? 'Pedido enviado' : 'Novo pedido'

  if (tables.loading || items.loading || cats.loading) return <Spinner />

  return (
    <div className="min-h-dvh pb-32">
      <header className="sticky top-0 z-20 bg-navy text-beige">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-2 py-2">
          {back ? (
            <button type="button" onClick={back} className="rounded-full p-3 hover:bg-white/10" aria-label="Voltar">
              <ArrowLeft className="size-6" />
            </button>
          ) : (
            <Link to="/garcom" className="rounded-full p-3 hover:bg-white/10" aria-label="Voltar aos chamados">
              <ArrowLeft className="size-6" />
            </Link>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
          {table && step !== 'mesa' && step !== 'enviado' && (
            <button type="button" onClick={() => setStep('mesa')} className="min-h-11 shrink-0 rounded-full bg-beige px-4 text-base font-bold text-navy">
              {tableName(table.label)}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pt-4">
        {error && (
          <div className="mb-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}

        {step === 'mesa' && (
          <TablePicker
            tables={tables.data.filter((t) => t.active).sort(byLabel)}
            statuses={statuses.data}
            areas={[...areas.data].sort(byOrder)}
            uid={uid}
            current={draft.tableId}
            onPick={(id) => {
              setDraft((d) => ({ ...d, tableId: id }))
              setError('')
              setStep(count ? 'revisar' : 'itens')
            }}
          />
        )}

        {step === 'itens' && <ItemsStep categories={[...cats.data].sort(byOrder)} items={[...items.data].sort(byOrder)} lines={draft.lines} onQty={setQty} />}

        {step === 'revisar' && (
          <div className="flex flex-col gap-4">
            {!lines.length ? (
              <Notice>Nenhum item no pedido ainda.</Notice>
            ) : (
              <ul className="flex flex-col gap-3">
                {lines.map((l) => (
                  <li key={l.id} className="flex flex-col gap-3 rounded-2xl bg-white p-4 ring-1 ring-line">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-semibold">{l.item.name}</p>
                        <p className="text-sm text-muted tabular-nums">
                          {money(currentPrice(l.item))} cada · {money(currentPrice(l.item) * l.qty)}
                        </p>
                        {!l.item.available && <p className="mt-1 text-sm font-semibold text-danger">Esgotado agora. Tire do pedido.</p>}
                      </div>
                      <Stepper qty={l.qty} onChange={(q) => setQty(l.id, q)} name={l.item.name} />
                    </div>
                    <input
                      value={l.note}
                      onChange={(e) => setNote(l.id, e.target.value)}
                      placeholder="Observação (ex.: sem cebola)"
                      aria-label={`Observação de ${l.item.name}`}
                      maxLength={140}
                      className="min-h-12 w-full rounded-xl border border-line bg-beige px-3 text-base focus:border-navy focus:outline-none"
                    />
                  </li>
                ))}
              </ul>
            )}
            <Button variant="secondary" onClick={() => setStep('itens')} className="min-h-14 text-base">
              <Plus className="size-5" /> Adicionar mais itens
            </Button>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Observação do pedido</span>
              <textarea
                value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value.slice(0, 200) }))}
                rows={2}
                maxLength={200}
                placeholder="Opcional (ex.: trazer tudo junto)"
                className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-base focus:border-navy focus:outline-none"
              />
            </label>
          </div>
        )}

        {step === 'enviado' && sent && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="size-16 text-success" aria-hidden />
            <p className="text-2xl font-bold">Pedido nº {sent.number} enviado</p>
            <p className="text-muted">{tableName(sent.label)} · a cozinha já recebeu.</p>
            <div className="mt-6 flex w-full flex-col gap-3">
              <Button onClick={() => setStep('itens')} className="min-h-14 text-base">
                <Plus className="size-5" /> Outro pedido na {tableName(sent.label)}
              </Button>
              <Button variant="secondary" onClick={exit} className="min-h-14 text-base">
                Voltar aos chamados
              </Button>
            </div>
          </div>
        )}
      </main>

      {(step === 'itens' || step === 'revisar') && count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-beige px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-xl">
            {step === 'itens' ? (
              <Button onClick={() => setStep('revisar')} className="min-h-14 w-full text-base">
                Revisar pedido · {count} {count === 1 ? 'item' : 'itens'} · {money(total)}
              </Button>
            ) : (
              <Button onClick={send} busy={busy} className="min-h-14 w-full text-base">
                <Send className="size-5" /> Enviar para a cozinha · {money(total)}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stepper({ qty, onChange, name }: { qty: number; onChange: (q: number) => void; name: string }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        aria-label={qty === 1 ? `Tirar ${name}` : `Um a menos de ${name}`}
        className="flex size-12 items-center justify-center rounded-xl bg-white ring-1 ring-line active:bg-beige-200"
      >
        {qty === 1 ? <X className="size-5 text-danger" /> : <Minus className="size-5" />}
      </button>
      <span className="w-9 text-center text-xl font-bold tabular-nums" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        onClick={() => onChange(qty + 1)}
        aria-label={`Mais um ${name}`}
        className="flex size-12 items-center justify-center rounded-xl bg-navy text-beige active:bg-navy-soft"
      >
        <Plus className="size-5" />
      </button>
    </div>
  )
}

function TablePicker({
  tables,
  statuses,
  areas,
  uid,
  current,
  onPick,
}: {
  tables: Table[]
  statuses: TableStatus[]
  areas: Area[]
  uid: string
  current: string | null
  onPick: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const [area, setArea] = useState('')
  const status = new Map(statuses.map((s) => [s.id, s]))
  const q = norm(search.trim())
  const list = tables.filter((t) => (!area || t.areaId === area) && (!q || norm(t.label).includes(q)))
  // Mesas que já estão com este garçom aparecem primeiro.
  const mine = list.filter((t) => status.get(t.id)?.holderUid === uid && status.get(t.id)?.status !== 'free')
  const rest = list.filter((t) => !mine.includes(t))

  const btn = (t: Table) => {
    const s = status.get(t.id)
    const isMine = s?.holderUid === uid && s.status !== 'free'
    const other = s && s.status !== 'free' && s.holderUid && s.holderUid !== uid ? s.holderName?.split(' ')[0] : null
    const hint = isMine ? 'sua mesa' : other ? `com ${other}` : s?.status === 'calling' ? 'chamando' : 'livre'
    return (
      <li key={t.id}>
        <button
          type="button"
          aria-label={`${tableName(t.label)}, ${hint}`}
          onClick={() => onPick(t.id)}
          aria-pressed={current === t.id}
          className={`flex min-h-20 w-full flex-col items-center justify-center rounded-2xl px-1 text-center ${
            isMine ? 'bg-navy text-beige' : 'bg-white ring-1 ring-line active:bg-beige-200'
          } ${current === t.id ? 'ring-4 ring-sun' : ''}`}
        >
          <span className="text-2xl leading-none font-bold">{t.label}</span>
          <span className={`mt-1 truncate text-xs ${isMine ? 'text-beige/80' : 'text-muted'}`}>
            {hint}
          </span>
        </button>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Número ou nome da mesa"
          aria-label="Procurar mesa"
          inputMode="search"
          className="min-h-14 w-full rounded-2xl border border-line bg-white pr-3 pl-12 text-lg focus:border-navy focus:outline-none"
        />
      </div>
      {areas.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {[{ id: '', name: 'Todas' }, ...areas].map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setArea(a.id)}
              aria-pressed={area === a.id}
              className={`min-h-11 shrink-0 rounded-full px-5 text-base font-semibold ${area === a.id ? 'bg-navy text-beige' : 'bg-white ring-1 ring-line'}`}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
      {!list.length && <Notice>Nenhuma mesa encontrada.</Notice>}
      {mine.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">Suas mesas</h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{mine.map(btn)}</ul>
        </section>
      )}
      {rest.length > 0 && (
        <section>
          {mine.length > 0 && <h2 className="mb-2 font-bold">Outras mesas</h2>}
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{rest.map(btn)}</ul>
        </section>
      )}
    </div>
  )
}

function ItemsStep({
  categories,
  items,
  lines,
  onQty,
}: {
  categories: Category[]
  items: Item[]
  lines: Record<string, Line>
  onQty: (id: string, qty: number) => void
}) {
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState('')
  const q = norm(search.trim())
  const visibleCats = categories.filter((c) => items.some((i) => i.categoryId === c.id))
  const groups = (q ? [{ id: 'busca', name: 'Resultado', order: 0, visible: true }] : visibleCats.filter((c) => !cat || c.id === cat)).map((c) => ({
    ...c,
    items: q ? items.filter((i) => visibleCats.some((vc) => vc.id === i.categoryId) && norm(i.name).includes(q)) : items.filter((i) => i.categoryId === c.id),
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Procurar no cardápio"
          aria-label="Procurar no cardápio"
          inputMode="search"
          className="min-h-14 w-full rounded-2xl border border-line bg-white pr-3 pl-12 text-lg focus:border-navy focus:outline-none"
        />
      </div>
      {!q && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {[{ id: '', name: 'Tudo' }, ...visibleCats].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCat(c.id)}
              aria-pressed={cat === c.id}
              className={`min-h-11 shrink-0 rounded-full px-5 text-base font-semibold whitespace-nowrap ${cat === c.id ? 'bg-navy text-beige' : 'bg-white ring-1 ring-line'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.id}>
          <h2 className="mb-2 text-lg font-bold">{g.name}</h2>
          {!g.items.length ? (
            <p className="text-muted">Nada encontrado.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {g.items.map((i) => {
                const qty = lines[i.id]?.qty ?? 0
                return (
                  <li key={i.id} className={`flex min-h-16 items-center gap-3 rounded-2xl bg-white p-3 pl-4 ring-1 ${qty ? 'ring-2 ring-navy' : 'ring-line'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-base leading-snug font-semibold">{i.name}</p>
                      <p className="text-sm tabular-nums">
                        {i.promoPrice != null ? (
                          <>
                            <span className="text-muted line-through">{money(i.price)}</span> <strong>{money(i.promoPrice)}</strong>
                          </>
                        ) : (
                          <span className="text-muted">{money(i.price)}</span>
                        )}
                        {!i.available && <span className="ml-2 font-semibold text-danger">Esgotado</span>}
                      </p>
                    </div>
                    {!i.available ? null : qty ? (
                      <Stepper qty={qty} onChange={(n) => onQty(i.id, n)} name={i.name} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onQty(i.id, 1)}
                        aria-label={`Adicionar ${i.name}`}
                        className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-navy text-beige active:bg-navy-soft"
                      >
                        <Plus className="size-6" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
