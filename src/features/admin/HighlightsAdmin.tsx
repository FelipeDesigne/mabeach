import { useMemo, useState, type FormEvent } from 'react'
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { ImagePlus, Pencil, Plus, Search, X } from 'lucide-react'
import { db, getStorageLazy } from '../../lib/firebase'
import { col, useBanner, useLiveQuery } from '../../lib/data'
import { money, moneyInput, parseMoney } from '../../lib/format'
import { compressImage } from '../../lib/image'
import { Badge, Button, Field, Input, Modal, Notice, Spinner, Switch } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { useAuth } from '../auth/AuthProvider'
import { PageTitle } from './AdminLayout'
import type { Category, Item } from '../../types'

const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR')

/** Destaques do cardápio: a arte do topo e os produtos em promoção logo abaixo dela. */
export function HighlightsAdmin() {
  const { user } = useAuth()
  const { ask } = useDialogs()
  const uid = user!.uid
  const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: uid })
  const banner = useBanner()
  const items = useLiveQuery<Item>(col('items'), [])
  const cats = useLiveQuery<Category>(col('categories'), [])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Item | 'new' | null>(null)

  // Mesma ordem do cardápio: categoria, depois o item.
  const ordered = useMemo(() => {
    const catOrder = new Map([...cats.data].sort(byOrder).map((c, i) => [c.id, i]))
    return [...items.data].sort((a, b) => (catOrder.get(a.categoryId) ?? 999) - (catOrder.get(b.categoryId) ?? 999) || byOrder(a, b))
  }, [items.data, cats.data])
  const featured = ordered.filter((i) => i.featured)
  const catName = (id: string) => cats.data.find((c) => c.id === id)?.name ?? ''

  const run = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
    } catch {
      setError('Não foi possível salvar. Confira a internet e tente de novo.')
    }
  }

  async function uploadBanner(file: File) {
    setError('')
    setUploading(true)
    try {
      const { ref, uploadBytes, getDownloadURL, deleteObject } = await import('firebase/storage')
      const storage = await getStorageLazy()
      const blob = await compressImage(file, 1920, 0.85)
      const imagePath = `banner/${Date.now()}.webp`
      const r = ref(storage, imagePath)
      await uploadBytes(r, blob, { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' })
      const imageUrl = await getDownloadURL(r)
      const old = banner.data.imagePath
      await setDoc(doc(db, 'settings/banner'), { imageUrl, imagePath, visible: true, ...stamp() })
      if (old) await deleteObject(ref(storage, old)).catch(() => undefined)
    } catch (err) {
      const msg = (err as Error).message
      setError(msg === 'not-image' ? 'Escolha uma imagem (JPG, PNG ou WebP).' : msg === 'too-big' ? 'A imagem é grande demais.' : 'Não foi possível enviar a arte. Tente de novo.')
    } finally {
      setUploading(false)
    }
  }

  async function removeBanner() {
    if (!(await ask({ title: 'Tirar a arte do cardápio?', message: 'Ela sai do topo do cardápio na hora.', confirmLabel: 'Tirar', tone: 'danger' }))) return
    await run(async () => {
      const old = banner.data.imagePath
      await setDoc(doc(db, 'settings/banner'), { imageUrl: null, imagePath: null, visible: false, ...stamp() })
      if (old) {
        const { ref, deleteObject } = await import('firebase/storage')
        await deleteObject(ref(await getStorageLazy(), old)).catch(() => undefined)
      }
    })
  }

  async function unfeature(item: Item) {
    await run(() => updateDoc(doc(db, 'items', item.id), { featured: false, promoPrice: null, ...stamp() }))
  }

  async function clearAll() {
    if (!(await ask({ title: 'Tirar todos os destaques?', message: 'Os produtos voltam ao preço normal e saem do topo do cardápio. Nenhum produto é apagado.', confirmLabel: 'Tirar todos', tone: 'danger' }))) return
    await run(async () => {
      const batch = writeBatch(db)
      featured.forEach((i) => batch.update(doc(db, 'items', i.id), { featured: false, promoPrice: null, ...stamp() }))
      await batch.commit()
    })
  }

  if (banner.loading || items.loading || cats.loading) return <Spinner />
  const hasImage = !!banner.data.imageUrl

  return (
    <>
      <PageTitle title="Destaques" />
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <div className="flex flex-col gap-6">
        <section className="rounded-2xl bg-white p-4 ring-1 ring-line sm:p-5">
          <h2 className="text-lg font-bold">Arte do topo</h2>
          <p className="mt-1 text-sm text-muted">Fica no topo do cardápio, antes de tudo. Tamanho ideal: 1920 × 1080 (formato 16:9, deitado).</p>

          <div className="mt-4 max-w-xl">
            {hasImage ? (
              <img src={banner.data.imageUrl!} alt="Arte do topo do cardápio" className="w-full rounded-xl bg-beige-200 ring-1 ring-line" />
            ) : (
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-sm text-muted">
                <ImagePlus className="size-6" aria-hidden />
                Nenhuma arte
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm font-semibold ${
                hasImage ? 'bg-white ring-1 ring-line hover:bg-beige-200' : 'bg-navy text-beige hover:bg-navy-soft'
              } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
            >
              <ImagePlus className="size-4" aria-hidden />
              {uploading ? 'Enviando…' : hasImage ? 'Trocar arte' : 'Escolher arte'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) uploadBanner(f)
                }}
              />
            </label>
            {hasImage && (
              <>
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <Switch
                    checked={banner.data.visible}
                    onChange={(v) => run(() => setDoc(doc(db, 'settings/banner'), { imageUrl: banner.data.imageUrl, imagePath: banner.data.imagePath, visible: v, ...stamp() }))}
                    label="Mostrar a arte no cardápio"
                  />
                  {banner.data.visible ? 'Aparecendo no cardápio' : 'Escondida do cardápio'}
                </label>
                <Button variant="danger" onClick={removeBanner} className="sm:ml-auto">
                  <X className="size-4" /> Tirar arte
                </Button>
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-line sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Produtos em destaque</h2>
            <div className="flex flex-wrap gap-2">
              {featured.length > 1 && (
                <Button variant="secondary" onClick={clearAll}>
                  Tirar todos
                </Button>
              )}
              <Button onClick={() => setEditing('new')}>
                <Plus className="size-4" /> Adicionar produto
              </Button>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted">Aparecem logo abaixo da arte, com cor de destaque. O preço de promoção é opcional.</p>

          {!featured.length ? (
            <p className="mt-4 rounded-xl bg-beige p-4 text-sm text-muted">Nenhum produto em destaque. Toque em "Adicionar produto" para escolher as promoções do dia.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2">
              {featured.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-beige p-3 pl-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{item.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="text-muted">{catName(item.categoryId)}</span>
                      <span aria-hidden className="text-muted">·</span>
                      {item.promoPrice != null ? (
                        <>
                          <span className="text-muted tabular-nums line-through">{money(item.price)}</span>
                          <strong className="tabular-nums">{money(item.promoPrice)}</strong>
                        </>
                      ) : (
                        <span className="tabular-nums">{money(item.price)}</span>
                      )}
                      {!item.visible && <Badge tone="warning">Escondido do cardápio</Badge>}
                      {!item.available && <Badge tone="danger">Esgotado</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setEditing(item)}>
                      <Pencil className="size-4" /> Preço
                    </Button>
                    <Button variant="ghost" onClick={() => unfeature(item)}>
                      Tirar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editing && (
        <PromoModal
          item={editing === 'new' ? null : editing}
          options={ordered.filter((i) => !i.featured)}
          catName={catName}
          onClose={() => setEditing(null)}
          onSave={(item, promoPrice) => updateDoc(doc(db, 'items', item.id), { featured: true, promoPrice, ...stamp() })}
        />
      )}
    </>
  )
}

function PromoModal({
  item,
  options,
  catName,
  onClose,
  onSave,
}: {
  item: Item | null
  options: Item[]
  catName: (id: string) => string
  onClose: () => void
  onSave: (item: Item, promoPrice: number | null) => Promise<void>
}) {
  const [picked, setPicked] = useState<Item | null>(item)
  const [search, setSearch] = useState('')
  const [promo, setPromo] = useState(item?.promoPrice != null ? moneyInput(item.promoPrice) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const found = useMemo(() => {
    const q = norm(search.trim())
    return q ? options.filter((i) => norm(i.name).includes(q) || norm(catName(i.categoryId)).includes(q)) : options
  }, [options, search, catName])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!picked) return
    setError('')
    let cents: number | null = null
    if (promo.trim()) {
      cents = parseMoney(promo)
      if (cents === null) return setError('Digite o preço de promoção, por exemplo 24,90.')
      if (cents >= picked.price) return setError(`O preço de promoção precisa ser menor que o normal (${money(picked.price)}).`)
    }
    setBusy(true)
    try {
      await onSave(picked, cents)
      onClose()
    } catch {
      setError('Não foi possível salvar. Confira a internet e tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={item ? 'Promoção' : 'Adicionar produto ao destaque'} wide>
      {!picked ? (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar produto" aria-label="Procurar produto" className="pl-9" autoFocus />
          </div>
          <ul className="flex max-h-[55vh] flex-col overflow-y-auto rounded-xl bg-white ring-1 ring-line">
            {found.map((i) => (
              <li key={i.id} className="border-b border-line last:border-0">
                <button type="button" onClick={() => setPicked(i)} className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-beige-200">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{i.name}</span>
                    <span className="block text-xs text-muted">{catName(i.categoryId)}</span>
                  </span>
                  <span className="text-sm tabular-nums">{money(i.price)}</span>
                </button>
              </li>
            ))}
            {!found.length && <li className="p-4 text-sm text-muted">Nenhum produto encontrado.</li>}
          </ul>
        </div>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 pl-4 ring-1 ring-line">
            <div className="min-w-0">
              <p className="truncate font-semibold">{picked.name}</p>
              <p className="text-sm text-muted">
                {catName(picked.categoryId)} · preço normal <span className="tabular-nums">{money(picked.price)}</span>
              </p>
            </div>
            {!item && (
              <Button type="button" variant="ghost" onClick={() => setPicked(null)}>
                Trocar
              </Button>
            )}
          </div>
          <Field label="Preço de promoção (R$)" hint="Opcional. Vazio = destaca o produto com o preço normal.">
            {(id) => <Input id={id} value={promo} onChange={(e) => setPromo(e.target.value)} inputMode="decimal" placeholder="Ex.: 29,90" />}
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" busy={busy}>
              {item ? 'Salvar' : 'Destacar'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
