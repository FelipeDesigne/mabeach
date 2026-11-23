import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { ArrowDown, ArrowUp, Camera, EyeOff, ImagePlus, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { db, getStorageLazy } from '../../lib/firebase'
import { col, useLiveQuery } from '../../lib/data'
import { money, moneyInput, parseMoney } from '../../lib/format'
import { compressImage } from '../../lib/image'
import { Badge, Button, Field, Input, Modal, Notice, Spinner, Switch, Textarea } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { useAuth } from '../auth/AuthProvider'
import { PageTitle } from './AdminLayout'
import type { Category, Item } from '../../types'

const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR')

export function MenuAdmin() {
  const { user } = useAuth()
  const { ask } = useDialogs()
  const uid = user!.uid
  const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: uid })
  const cats = useLiveQuery<Category>(col('categories'), [])
  const items = useLiveQuery<Item>(col('items'), [])
  const categories = useMemo(() => [...cats.data].sort(byOrder), [cats.data])
  const [selected, setSelected] = useState<string>('')
  const [newCat, setNewCat] = useState('')
  const [renaming, setRenaming] = useState<Category | null>(null)
  const [editing, setEditing] = useState<Item | 'new' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!categories.length) return setSelected('')
    if (!categories.some((c) => c.id === selected)) setSelected(categories[0].id)
  }, [categories, selected])

  const current = categories.find((c) => c.id === selected)
  const list = useMemo(() => items.data.filter((i) => i.categoryId === selected).sort(byOrder), [items.data, selected])

  const run = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
    } catch {
      setError('Não foi possível salvar. Confira a internet e tente de novo.')
    }
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault()
    const name = newCat.trim()
    if (!name) return
    await run(async () => {
      const order = (categories.at(-1)?.order ?? 0) + 10
      const ref = await addDoc(collection(db, 'categories'), { name, order, visible: true, ...stamp() })
      setNewCat('')
      setSelected(ref.id)
    })
  }

  async function swap<T extends { id: string; order: number }>(path: string, listOf: T[], index: number, dir: -1 | 1) {
    const a = listOf[index]
    const b = listOf[index + dir]
    if (!a || !b) return
    await run(async () => {
      const batch = writeBatch(db)
      // Ordens iguais (itens antigos): separa antes de trocar.
      const oa = a.order === b.order ? a.order + dir : b.order
      batch.update(doc(db, path, a.id), { order: Math.max(0, oa), ...stamp() })
      batch.update(doc(db, path, b.id), { order: a.order, ...stamp() })
      await batch.commit()
    })
  }

  async function deleteCategory(c: Category) {
    if (items.data.some((i) => i.categoryId === c.id)) return setError('Tire ou apague os itens desta categoria antes de apagá-la.')
    if (!(await ask({ title: `Apagar a categoria "${c.name}"?`, message: 'Ela sai do cardápio na hora.', confirmLabel: 'Apagar', tone: 'danger' }))) return
    await run(() => deleteDoc(doc(db, 'categories', c.id)))
  }

  async function deleteItem(item: Item) {
    if (!(await ask({ title: `Apagar "${item.name}"?`, message: 'O item sai do cardápio na hora, junto com a foto dele. Se for só por hoje, prefira marcar como esgotado.', confirmLabel: 'Apagar', tone: 'danger' }))) return
    await run(async () => {
      await deleteDoc(doc(db, 'items', item.id))
      if (item.photoPath) {
        const { ref, deleteObject } = await import('firebase/storage')
        await deleteObject(ref(await getStorageLazy(), item.photoPath)).catch(() => undefined)
      }
    })
  }

  if (cats.loading || items.loading) return <Spinner />

  return (
    <>
      <PageTitle title="Cardápio" />
      {error && (
        <div className="mb-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[16rem_1fr]">
        <section className="rounded-2xl bg-white p-4 ring-1 ring-line">
          <h2 className="mb-3 font-bold">Categorias</h2>
          <ul className="flex flex-col gap-1">
            {categories.map((c, i) => (
              <li key={c.id} className={`flex items-center gap-1 rounded-xl pr-1 ${selected === c.id ? 'bg-beige-200' : ''}`}>
                <button type="button" onClick={() => setSelected(c.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm font-semibold">
                  <span className="truncate">{c.name}</span>
                  {!c.visible && <EyeOff className="size-4 shrink-0 text-muted" aria-label="Escondida" />}
                  <span className="ml-auto text-xs font-normal text-muted">{items.data.filter((it) => it.categoryId === c.id).length}</span>
                </button>
                <IconBtn label="Subir" onClick={() => swap('categories', categories, i, -1)} disabled={i === 0}>
                  <ArrowUp className="size-4" />
                </IconBtn>
                <IconBtn label="Descer" onClick={() => swap('categories', categories, i, 1)} disabled={i === categories.length - 1}>
                  <ArrowDown className="size-4" />
                </IconBtn>
              </li>
            ))}
          </ul>
          <form onSubmit={addCategory} className="mt-3 flex gap-2">
            <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nova categoria" maxLength={60} aria-label="Nome da nova categoria" />
            <Button type="submit" variant="secondary" aria-label="Adicionar categoria">
              <Plus className="size-4" />
            </Button>
          </form>
        </section>

        <section>
          {!current ? (
            <Notice>Crie a primeira categoria (por exemplo, "Porções" ou "Bebidas") para começar a cadastrar os itens.</Notice>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-line">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{current.name}</h2>
                  <label className="mt-1 flex items-center gap-2 text-sm text-muted">
                    <Switch
                      checked={current.visible}
                      onChange={(v) => run(() => updateDoc(doc(db, 'categories', current.id), { visible: v, ...stamp() }))}
                      label="Categoria aparece no cardápio"
                    />
                    {current.visible ? 'Aparece no cardápio' : 'Escondida do cardápio'}
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setRenaming(current)}>
                    <Pencil className="size-4" /> Renomear
                  </Button>
                  <Button variant="danger" onClick={() => deleteCategory(current)} aria-label="Apagar categoria">
                    <Trash2 className="size-4" />
                  </Button>
                  <Button onClick={() => setEditing('new')}>
                    <Plus className="size-4" /> Novo item
                  </Button>
                </div>
              </div>

              {!list.length && <Notice>Nenhum item nesta categoria ainda.</Notice>}
              <ul className="flex flex-col gap-2">
                {list.map((item, i) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 pl-4 ring-1 ring-line">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{item.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                        <span className="tabular-nums">{money(item.price)}</span>
                        {item.featured && (
                          <Badge tone="navy">
                            <Sparkles className="mr-1 size-3" /> Destaque{item.promoPrice != null ? ` · ${money(item.promoPrice)}` : ''}
                          </Badge>
                        )}
                        {item.photoUrl && (
                          <Badge>
                            <Camera className="mr-1 size-3" /> Foto
                          </Badge>
                        )}
                        {!item.visible && <Badge tone="warning">Escondido</Badge>}
                        {!item.available && <Badge tone="danger">Esgotado</Badge>}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                      <Switch
                        checked={item.available}
                        onChange={(v) => run(() => updateDoc(doc(db, 'items', item.id), { available: v, ...stamp() }))}
                        label={`${item.name} disponível`}
                      />
                      {item.available ? 'Disponível' : 'Esgotado'}
                    </label>
                    <div className="flex items-center">
                      <IconBtn label="Subir" onClick={() => swap('items', list, i, -1)} disabled={i === 0}>
                        <ArrowUp className="size-4" />
                      </IconBtn>
                      <IconBtn label="Descer" onClick={() => swap('items', list, i, 1)} disabled={i === list.length - 1}>
                        <ArrowDown className="size-4" />
                      </IconBtn>
                      <IconBtn label="Editar" onClick={() => setEditing(item)}>
                        <Pencil className="size-4" />
                      </IconBtn>
                      <IconBtn label="Apagar" onClick={() => deleteItem(item)}>
                        <Trash2 className="size-4 text-danger" />
                      </IconBtn>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <RenameModal category={renaming} onClose={() => setRenaming(null)} onSave={(name) => run(() => updateDoc(doc(db, 'categories', renaming!.id), { name, ...stamp() }))} />
      {editing && current && (
        <ItemModal
          item={editing === 'new' ? null : editing}
          categories={categories}
          defaultCategory={current.id}
          nextOrder={(list.at(-1)?.order ?? 0) + 10}
          uid={uid}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="rounded-lg p-2.5 hover:bg-beige-200 disabled:opacity-30">
      {children}
    </button>
  )
}

function RenameModal({ category, onClose, onSave }: { category: Category | null; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  useEffect(() => setName(category?.name ?? ''), [category])
  return (
    <Modal open={!!category} onClose={onClose} title="Renomear categoria">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return
          await onSave(name.trim())
          onClose()
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
        <Button type="submit">Salvar</Button>
      </form>
    </Modal>
  )
}

function ItemModal({
  item,
  categories,
  defaultCategory,
  nextOrder,
  uid,
  onClose,
}: {
  item: Item | null
  categories: Category[]
  defaultCategory: string
  nextOrder: number
  uid: string
  onClose: () => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [price, setPrice] = useState(item ? moneyInput(item.price) : '')
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? defaultCategory)
  const [available, setAvailable] = useState(item?.available ?? true)
  const [visible, setVisible] = useState(item?.visible ?? true)
  const [file, setFile] = useState<File | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [preview, setPreview] = useState<string | null>(item?.photoUrl ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    const cents = parseMoney(price)
    if (!name.trim()) return setError('Digite o nome do item.')
    if (cents === null) return setError('Digite o preço, por exemplo 24,90.')
    setBusy(true)
    try {
      const id = item?.id ?? doc(collection(db, 'items')).id
      let photoPath = removePhoto ? null : (item?.photoPath ?? null)
      let photoUrl = removePhoto ? null : (item?.photoUrl ?? null)
      const oldPath = item?.photoPath ?? null
      const storageMod = file || (removePhoto && oldPath) ? await import('firebase/storage') : null
      const storage = storageMod ? await getStorageLazy() : null
      if (file && storageMod && storage) {
        const blob = await compressImage(file)
        photoPath = `menu/${id}/${Date.now()}.webp`
        const r = storageMod.ref(storage, photoPath)
        await storageMod.uploadBytes(r, blob, { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' })
        photoUrl = await storageMod.getDownloadURL(r)
      }
      await setDoc(doc(db, 'items', id), {
        categoryId,
        name: name.trim(),
        description: description.trim(),
        price: cents,
        photoPath,
        photoUrl,
        available,
        visible,
        order: item && item.categoryId === categoryId ? item.order : nextOrder,
        // Destaque e promoção são cuidados na tela Destaques; aqui só mantém. Se o preço baixar até a promoção, a promoção sai.
        featured: item?.featured ?? false,
        promoPrice: item?.promoPrice != null && item.promoPrice < cents ? item.promoPrice : null,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      })
      if (oldPath && oldPath !== photoPath && storageMod && storage) {
        await storageMod.deleteObject(storageMod.ref(storage, oldPath)).catch(() => undefined)
      }
      onClose()
    } catch (err) {
      const msg = (err as Error).message
      setError(msg === 'not-image' ? 'Escolha uma foto (JPG, PNG ou WebP).' : msg === 'too-big' ? 'A foto é grande demais.' : 'Não foi possível salvar. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={item ? 'Editar item' : 'Novo item'} wide>
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}</Field>
        <Field label="Descrição" hint="Opcional. Ingredientes, tamanho, para quantas pessoas.">
          {(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={3} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Preço (R$)">{(id) => <Input id={id} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="24,90" />}</Field>
          <Field label="Categoria">
            {(id) => (
              <select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="min-h-11 w-full rounded-xl border border-line bg-white px-3">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Foto real</p>
          <p className="text-xs text-muted">No cardápio a foto não aparece direto: o cliente toca em "Ver foto real" para abrir.</p>
          {preview && !removePhoto ? (
            <div className="flex items-end gap-3">
              <img src={preview} alt="" className="h-28 w-28 rounded-xl object-cover ring-1 ring-line" />
              <div className="flex gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-line hover:bg-beige-200">
                  Trocar
                  <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && (setFile(e.target.files[0]), setRemovePhoto(false))} />
                </label>
                <Button type="button" variant="danger" onClick={() => (setFile(null), setRemovePhoto(true))}>
                  Tirar foto
                </Button>
              </div>
            </div>
          ) : (
            <label className="inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-line hover:bg-beige-200">
              <ImagePlus className="size-4" /> Escolher foto
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && (setFile(e.target.files[0]), setRemovePhoto(false))} />
            </label>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-white p-3 ring-1 ring-line">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-semibold">Disponível</span>
              <span className="block text-xs text-muted">Desligado aparece como "Esgotado".</span>
            </span>
            <Switch checked={available} onChange={setAvailable} label="Disponível" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-semibold">Aparece no cardápio</span>
              <span className="block text-xs text-muted">Desligado fica escondido dos clientes.</span>
            </span>
            <Switch checked={visible} onChange={setVisible} label="Aparece no cardápio" />
          </label>
        </div>

        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" busy={busy}>
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  )
}
