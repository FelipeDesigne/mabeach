import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { collection, deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { Download, Plus, Printer, QrCode, Trash2 } from 'lucide-react'
import { db } from '../../lib/firebase'
import { col, useLiveQuery, useOpsSettings } from '../../lib/data'
import { tableName } from '../../lib/format'
import { download, qrDataUrl, tableUrl } from '../../lib/qr'
import { Button, Field, Input, Modal, Notice, Spinner, Switch } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { useAuth } from '../auth/AuthProvider'
import { PageTitle } from './AdminLayout'
import type { Area, Table } from '../../types'

export const sortTables = (a: Table, b: Table) => a.number - b.number || a.label.localeCompare(b.label, 'pt-BR', { numeric: true })

export function TablesAdmin() {
  const { user } = useAuth()
  const { ask } = useDialogs()
  const uid = user!.uid
  const tables = useLiveQuery<Table>(col('tables'), [])
  const areas = useLiveQuery<Area>(col('areas'), [])
  const areaList = useMemo(() => [...areas.data].sort((a, b) => a.order - b.order), [areas.data])
  const ops = useOpsSettings()
  const list = useMemo(() => [...tables.data].sort(sortTables), [tables.data])
  const [adding, setAdding] = useState(false)
  const [qrFor, setQrFor] = useState<Table | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const toggleSel = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function remove(t: Table) {
    const ok = await ask({
      title: `Apagar a ${tableName(t.label)}?`,
      message: 'O QR code impresso dela para de funcionar. Se for só por um tempo, prefira desligar a mesa no botão ao lado do nome.',
      confirmLabel: 'Apagar mesa',
      tone: 'danger',
    })
    if (!ok) return
    await deleteDoc(doc(db, 'tables', t.id)).catch(() => setError('Não foi possível apagar. Tente de novo.'))
  }

  async function removeSelected() {
    const ids = list.filter((t) => selected.has(t.id))
    if (!ids.length) return
    const ok = await ask({
      title: `Apagar ${ids.length} ${ids.length === 1 ? 'mesa' : 'mesas'}?`,
      message: `${ids.map((t) => t.label).join(', ')}. Os QR codes impressos delas param de funcionar.`,
      confirmLabel: 'Apagar',
      tone: 'danger',
    })
    if (!ok) return
    try {
      for (let i = 0; i < ids.length; i += 400) {
        const batch = writeBatch(db)
        ids.slice(i, i + 400).forEach((t) => batch.delete(doc(db, 'tables', t.id)))
        await batch.commit()
      }
      setSelected(new Set())
    } catch {
      setError('Não foi possível apagar. Tente de novo.')
    }
  }

  function print() {
    const ids = selected.size ? list.filter((t) => selected.has(t.id)).map((t) => t.id) : list.filter((t) => t.active).map((t) => t.id)
    navigate(`/admin/mesas/imprimir?ids=${ids.join(',')}`)
  }

  if (tables.loading) return <Spinner />

  return (
    <>
      <PageTitle title="Mesas e QR codes">
        {selected.size > 0 && (
          <Button variant="danger" onClick={removeSelected}>
            <Trash2 className="size-4" /> Apagar {selected.size} {selected.size === 1 ? 'selecionada' : 'selecionadas'}
          </Button>
        )}
        <Button variant="secondary" onClick={print} disabled={!list.length}>
          <Printer className="size-4" /> {selected.size ? `Imprimir ${selected.size} QR` : 'Imprimir todos os QR'}
        </Button>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" /> Adicionar mesas
        </Button>
      </PageTitle>

      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      {!list.length ? (
        <Notice>Nenhuma mesa cadastrada. Toque em "Adicionar mesas" para criar, por exemplo, da 1 à 90 de uma vez.</Notice>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((t) => (
            <li key={t.id} className={`flex flex-col gap-3 rounded-2xl bg-white p-3 ring-1 ${selected.has(t.id) ? 'ring-2 ring-navy' : 'ring-line'}`}>
              <div className="flex items-start justify-between gap-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSel(t.id)} className="size-4 accent-navy" aria-label={`Selecionar ${tableName(t.label)}`} />
                  <span className="font-bold">{tableName(t.label)}</span>
                </label>
                <Switch
                  checked={t.active}
                  label={`${tableName(t.label)} ativa`}
                  onChange={(v) => updateDoc(doc(db, 'tables', t.id), { active: v, updatedAt: serverTimestamp(), updatedBy: uid }).catch(() => setError('Não foi possível salvar.'))}
                />
              </div>
              <p className="text-xs text-muted">{t.active ? 'QR funcionando' : 'QR desativado'}</p>
              {areaList.length > 0 && (
                <select
                  aria-label={`Ambiente da ${tableName(t.label)}`}
                  value={t.areaId ?? ''}
                  onChange={(e) =>
                    updateDoc(doc(db, 'tables', t.id), {
                      areaId: e.target.value || null,
                      // Mudou de ambiente: sai do mapa antigo (é colocada de novo no mapa do novo ambiente).
                      ...(e.target.value !== (t.areaId ?? '') ? { x: null, y: null } : {}),
                      updatedAt: serverTimestamp(),
                      updatedBy: uid,
                    }).catch(() => setError('Não foi possível salvar.'))
                  }
                  className="min-h-9 w-full rounded-lg border border-line bg-white px-2 text-sm"
                >
                  <option value="">Sem ambiente</option>
                  {areaList.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex gap-1">
                <Button variant="secondary" className="flex-1" onClick={() => setQrFor(t)}>
                  <QrCode className="size-4" /> QR
                </Button>
                <Button variant="ghost" onClick={() => remove(t)} aria-label={`Apagar ${tableName(t.label)}`}>
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddTablesModal open={adding} onClose={() => setAdding(false)} existing={list} uid={uid} areas={areaList} />
      <QrModal table={qrFor} base={ops.data.qrBaseUrl} onClose={() => setQrFor(null)} />
    </>
  )
}

function AddTablesModal({ open, onClose, existing, uid, areas }: { open: boolean; onClose: () => void; existing: Table[]; uid: string; areas: Area[] }) {
  const [areaId, setAreaId] = useState('')
  const [mode, setMode] = useState<'range' | 'single'>('range')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('10')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const taken = new Set(existing.map((t) => t.label.toLowerCase()))
    let labels: string[] = []
    if (mode === 'range') {
      const a = Number(from)
      const b = Number(to)
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || b > 9999) return setError('Use números inteiros, do menor para o maior.')
      if (b - a + 1 > 300) return setError('No máximo 300 mesas por vez.')
      labels = Array.from({ length: b - a + 1 }, (_, i) => String(a + i))
    } else {
      const l = label.trim()
      if (!l) return setError('Digite o nome ou número da mesa.')
      labels = [l]
    }
    const fresh = labels.filter((l) => !taken.has(l.toLowerCase()))
    if (!fresh.length) return setError('Essas mesas já existem.')
    setBusy(true)
    try {
      const batch = writeBatch(db)
      for (const l of fresh) {
        // O id aleatório do documento é o código que vai no QR.
        batch.set(doc(collection(db, 'tables')), {
          label: l.slice(0, 20),
          number: /^\d+$/.test(l) ? Number(l) : 100000,
          active: true,
          areaId: areaId || null,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        })
      }
      await batch.commit()
      onClose()
    } catch {
      setError('Não foi possível criar as mesas. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Adicionar mesas">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-beige-200 p-1 text-sm font-semibold">
          {(['range', 'single'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`min-h-10 rounded-lg ${mode === m ? 'bg-white shadow-sm' : ''}`}>
              {m === 'range' ? 'Várias numeradas' : 'Uma com nome'}
            </button>
          ))}
        </div>
        {mode === 'range' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Da mesa">{(id) => <Input id={id} value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" />}</Field>
            <Field label="Até a mesa">{(id) => <Input id={id} value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" />}</Field>
          </div>
        ) : (
          <Field label="Nome ou número" hint='Ex.: "91", "Varanda 2", "Quadra 1".'>
            {(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} />}
          </Field>
        )}
        {areas.length > 0 && (
          <Field label="Ambiente">
            {(id) => (
              <select id={id} value={areaId} onChange={(e) => setAreaId(e.target.value)} className="min-h-11 w-full rounded-xl border border-line bg-white px-3">
                <option value="">Sem ambiente</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <p className="text-xs text-muted">Mesas que já existem são puladas. Cada mesa ganha um QR code próprio.</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" busy={busy}>
          Criar
        </Button>
      </form>
    </Modal>
  )
}

function QrModal({ table, base, onClose }: { table: Table | null; base: string; onClose: () => void }) {
  const [src, setSrc] = useState('')
  const url = table ? tableUrl(base, table.id) : ''
  useEffect(() => {
    setSrc('')
    if (url) qrDataUrl(url).then(setSrc)
  }, [url])
  return (
    <Modal open={!!table} onClose={onClose} title={table ? tableName(table.label) : ''}>
      {table && (
        <div className="flex flex-col items-center gap-4">
          {src ? <img src={src} alt={`QR code da ${tableName(table.label)}`} className="w-64 rounded-xl bg-white p-2 ring-1 ring-line" /> : <Spinner />}
          <p className="text-center text-xs break-all text-muted">{url}</p>
          <div className="grid w-full grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => window.open(url, '_blank', 'noopener')}>
              Testar
            </Button>
            <Button onClick={() => src && download(src, `qr-${table.label}.png`)} disabled={!src}>
              <Download className="size-4" /> Baixar PNG
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
