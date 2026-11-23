import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { Copy, ImagePlus, KeyRound, Link2, MessageCircle, Pencil, Plus } from 'lucide-react'
import { callFn, db, errorMessage, getStorageLazy } from '../../lib/firebase'
import { col, useLiveQuery, useOpsSettings } from '../../lib/data'
import { displayLogin } from '../../lib/login'
import { compressImage } from '../../lib/image'
import { Badge, Button, Field, Input, Modal, Notice, Select, Spinner } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { useAuth } from '../auth/AuthProvider'
import { Avatar } from '../auth/AccountPage'
import { PageTitle } from './AdminLayout'
import { ROLE_LABEL, servesTables, type Area, type Role, type Staff } from '../../types'

const ROLE_HINT: Record<Role, string> = {
  admin: 'Tudo: cardápio, mesas, equipe, configurações e histórico.',
  manager: 'Cardápio, mesas, histórico e chamados. Não mexe na equipe nem nas configurações.',
  waiter: 'Chamados das mesas e pedidos para a cozinha.',
  counter: 'Só a tela do balcão: mapa ao vivo das mesas, pedidos de cada mesa e encerrar mesas. Não recebe chamados.',
  kitchen: 'Só a tela da cozinha: recebe e imprime os pedidos e avisa o garçom quando fica pronto.',
}

/** Envia (ou tira) a foto da pessoa. Só o ADM pode. */
async function savePhoto(person: { id: string; photoPath?: string | null }, file: File | null, by: string) {
  const { ref, uploadBytes, getDownloadURL, deleteObject } = await import('firebase/storage')
  const storage = await getStorageLazy()
  let photoPath: string | null = null
  let photoUrl: string | null = null
  if (file) {
    const blob = await compressImage(file, 600, 0.85)
    photoPath = `staff/${person.id}/${Date.now()}.webp`
    const r = ref(storage, photoPath)
    await uploadBytes(r, blob, { contentType: 'image/webp', cacheControl: 'public, max-age=31536000' })
    photoUrl = await getDownloadURL(r)
  }
  await updateDoc(doc(db, 'staff', person.id), { photoPath, photoUrl, updatedAt: serverTimestamp(), updatedBy: by })
  if (person.photoPath && person.photoPath !== photoPath) await deleteObject(ref(storage, person.photoPath)).catch(() => undefined)
}

export function TeamAdmin() {
  const { user } = useAuth()
  const staff = useLiveQuery<Staff>(col('staff'), [])
  const areas = useLiveQuery<Area>(col('areas'), [])
  const areaName = new Map(areas.data.map((a) => [a.id, a.name]))
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Staff | null>(null)
  const [password, setPassword] = useState<Staff | null>(null)
  const [invite, setInvite] = useState<Staff | null>(null)
  const sorted = useMemo(
    () => [...staff.data].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR')),
    [staff.data],
  )

  if (staff.loading) return <Spinner />

  return (
    <>
      <PageTitle title="Equipe">
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> Cadastrar usuário
        </Button>
      </PageTitle>
      {staff.error && <Notice tone="danger">Não foi possível carregar a equipe.</Notice>}
      <ul className="flex flex-col gap-2">
        {sorted.map((s) => (
          <li key={s.id} className={`flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 pl-4 ring-1 ring-line ${s.active ? '' : 'opacity-60'}`}>
            <Avatar name={s.name} photoUrl={s.photoUrl} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {s.name} {s.id === user?.uid && <span className="text-xs font-normal text-muted">(você)</span>}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                <span>{displayLogin(s.login)}</span>
                <Badge tone={s.role === 'admin' ? 'navy' : 'neutral'}>{ROLE_LABEL[s.role]}</Badge>
                {!s.active && <Badge tone="danger">Desativado</Badge>}
                {s.active && s.onDuty && <Badge tone="success">Em serviço</Badge>}
                {s.active && s.mustChangePassword && <Badge tone="warning">Ainda não criou a senha</Badge>}
                {servesTables(s.role) && !!areas.data.length && (
                  <span className="text-xs">{s.areas?.length ? s.areas.map((a) => areaName.get(a) ?? '?').join(', ') : 'Todos os ambientes'}</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {s.active && (
                <Button variant="ghost" onClick={() => setInvite(s)}>
                  <Link2 className="size-4" /> Link de acesso
                </Button>
              )}
              <Button variant="ghost" onClick={() => setPassword(s)}>
                <KeyRound className="size-4" /> Senha
              </Button>
              <Button variant="secondary" onClick={() => setEditing(s)}>
                <Pencil className="size-4" /> Editar
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {creating && (
        <CreateModal
          by={user!.uid}
          areas={areas.data}
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false)
            setInvite(p)
          }}
        />
      )}
      {editing && <EditModal person={editing} isSelf={editing.id === user?.uid} by={user!.uid} areas={areas.data} onClose={() => setEditing(null)} />}
      {password && <PasswordModal person={password} onClose={() => setPassword(null)} />}
      {invite && <InviteModal person={invite} onClose={() => setInvite(null)} />}
    </>
  )
}

function RoleSelect({ value, onChange, disabled }: { value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <Field label="Função" hint={ROLE_HINT[value]}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value as Role)} disabled={disabled}>
          <option value="waiter">Garçom</option>
          <option value="manager">Gerente</option>
          <option value="counter">Balcão</option>
          <option value="kitchen">Cozinha</option>
          <option value="admin">ADM</option>
        </Select>
      )}
    </Field>
  )
}

/** Ambientes em que a pessoa trabalha. Nenhum marcado = recebe chamados de todos. */
function AreaPicker({ areas, value, onChange }: { areas: Area[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!areas.length) return null
  const list = [...areas].sort((a, b) => a.order - b.order)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">Ambientes</legend>
      <p className="-mt-1 text-xs text-muted">Recebe só os chamados das mesas destes ambientes. Nenhum marcado = todos.</p>
      <div className="flex flex-wrap gap-2">
        {list.map((a) => {
          const on = value.includes(a.id)
          return (
            <label key={a.id} className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-semibold ring-1 ${on ? 'bg-navy text-beige ring-navy' : 'bg-white ring-line'}`}>
              <input type="checkbox" className="sr-only" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== a.id) : [...value, a.id])} />
              {a.name}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

async function saveAreas(uid: string, areas: string[], by: string) {
  await updateDoc(doc(db, 'staff', uid), { areas, updatedAt: serverTimestamp(), updatedBy: by })
}

/** Escolher, trocar ou tirar a foto (mostrada ao cliente quando chama o garçom). */
function PhotoPicker({ current, file, onFile, removed, onRemove }: { current?: string | null; file: File | null; onFile: (f: File) => void; removed: boolean; onRemove: () => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const shown = preview ?? (removed ? null : current)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">Foto</p>
      <p className="text-xs text-muted">Aparece para o cliente quando ele chama e esta pessoa é quem vai atender. Use uma foto do rosto, com a autorização dela.</p>
      <div className="flex items-center gap-3">
        {shown ? <img src={shown} alt="" className="size-20 rounded-full object-cover ring-1 ring-line" /> : <span className="size-20 rounded-full bg-beige-200" />}
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-line hover:bg-beige-200">
          <ImagePlus className="size-4" /> {shown ? 'Trocar' : 'Escolher foto'}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {shown && (
          <Button type="button" variant="ghost" onClick={onRemove}>
            Tirar
          </Button>
        )}
      </div>
    </div>
  )
}

function CreateModal({ by, areas, onClose, onCreated }: { by: string; areas: Area[]; onClose: () => void; onCreated: (p: Staff) => void }) {
  const { notify } = useDialogs()
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('waiter')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const l = login.trim().toLowerCase()
    if (name.trim().length < 2) return setError('Digite o nome.')
    if (!(l.includes('@') ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l) : /^[a-z0-9][a-z0-9._-]{2,29}$/.test(l)))
      return setError('Login: um e-mail, ou um usuário com 3 a 30 letras minúsculas, números, ponto ou traço (ex.: joao).')
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.')
    setBusy(true)
    try {
      const { uid } = await callFn<unknown, { uid: string }>('adminCreateUser', { name: name.trim(), login: l, password, role })
      if (picked.length && servesTables(role)) await saveAreas(uid, picked, by).catch(() => undefined)
      if (file) {
        // A pessoa já foi cadastrada: se só a foto falhar, avisa e segue para o link (a foto pode ser posta em Editar).
        await savePhoto({ id: uid }, file, by).catch(() =>
          notify({ title: 'A foto não foi salva', message: 'O usuário foi cadastrado normalmente. Coloque a foto de novo em Editar.' }),
        )
      }
      onCreated({ id: uid, name: name.trim(), login: l, role, active: true, onDuty: false, mustChangePassword: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Cadastrar usuário">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
        <Field label="Login" hint="Um usuário simples (ex.: joao) ou um e-mail.">
          {(id) => <Input id={id} value={login} onChange={(e) => setLogin(e.target.value)} autoCapitalize="none" spellCheck={false} maxLength={100} />}
        </Field>
        <Field label="Senha provisória" hint="Pelo menos 8 caracteres (ex.: 123mabeach). No primeiro acesso a pessoa cria a senha dela.">
          {(id) => <Input id={id} type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" maxLength={100} />}
        </Field>
        <RoleSelect value={role} onChange={setRole} />
        {servesTables(role) && <AreaPicker areas={areas} value={picked} onChange={setPicked} />}
        {servesTables(role) && <PhotoPicker file={file} onFile={setFile} removed={false} onRemove={() => setFile(null)} />}
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" busy={busy}>
          Cadastrar e gerar link de acesso
        </Button>
      </form>
    </Modal>
  )
}

function EditModal({ person, isSelf, by, areas, onClose }: { person: Staff; isSelf: boolean; by: string; areas: Area[]; onClose: () => void }) {
  const { ask } = useDialogs()
  const [picked, setPicked] = useState<string[]>(person.areas ?? [])
  const [name, setName] = useState(person.name)
  const [role, setRole] = useState<Role>(person.role)
  const [file, setFile] = useState<File | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(patch: { name?: string; role?: Role; active?: boolean }) {
    setBusy(true)
    setError('')
    try {
      if (Object.keys(patch).length) await callFn('adminUpdateUser', { uid: person.id, ...patch })
      if (file || removePhoto) await savePhoto(person, file, by)
      if (JSON.stringify([...picked].sort()) !== JSON.stringify([...(person.areas ?? [])].sort())) await saveAreas(person.id, picked, by)
      onClose()
    } catch (err) {
      const msg = (err as Error).message
      setError(msg === 'not-image' ? 'Escolha uma foto (JPG, PNG ou WebP).' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Editar ${person.name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim().length < 2) return setError('Digite o nome.')
          save({ ...(name.trim() !== person.name ? { name: name.trim() } : {}), ...(role !== person.role ? { role } : {}) })
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
        <RoleSelect value={role} onChange={setRole} disabled={isSelf} />
        {isSelf && <p className="text-xs text-muted">Você não pode mudar a sua própria função.</p>}
        {servesTables(role) && <AreaPicker areas={areas} value={picked} onChange={setPicked} />}
        <PhotoPicker
          current={person.photoUrl}
          file={file}
          onFile={(f) => (setFile(f), setRemovePhoto(false))}
          removed={removePhoto}
          onRemove={() => (setFile(null), setRemovePhoto(true))}
        />
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" busy={busy}>
          Salvar
        </Button>
        {!isSelf && (
          <Button
            type="button"
            variant={person.active ? 'danger' : 'secondary'}
            busy={busy}
            onClick={async () => {
              if (
                person.active &&
                !(await ask({
                  title: `Desativar ${person.name}?`,
                  message: 'A pessoa sai do app na hora, em todos os aparelhos, e não consegue mais entrar. O histórico dela continua guardado.',
                  confirmLabel: 'Desativar',
                  tone: 'danger',
                }))
              )
                return
              save({ active: !person.active })
            }}
          >
            {person.active ? 'Desativar acesso' : 'Reativar acesso'}
          </Button>
        )}
      </form>
    </Modal>
  )
}

function PasswordModal({ person, onClose }: { person: Staff; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal open onClose={onClose} title={`Senha provisória para ${person.name}`}>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.')
          setBusy(true)
          setError('')
          try {
            await callFn('adminSetPassword', { uid: person.id, password })
            onClose()
          } catch (err) {
            setError(errorMessage(err))
          } finally {
            setBusy(false)
          }
        }}
        className="flex flex-col gap-4"
      >
        <Field label="Senha provisória" hint="A pessoa sai dos aparelhos e, ao entrar com esta senha, cria uma nova.">
          {(id) => <Input id={id} type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" maxLength={100} />}
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" busy={busy}>
          Salvar senha
        </Button>
      </form>
    </Modal>
  )
}

/** Gera o link de acesso (48 h, uso único) e oferece copiar ou mandar pelo WhatsApp. */
function InviteModal({ person, onClose }: { person: Staff; onClose: () => void }) {
  const ops = useOpsSettings()
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (ops.loading) return
    callFn<{ uid: string }, { token: string }>('adminCreateInvite', { uid: person.id })
      .then(({ token }) => setLink(`${(ops.data.qrBaseUrl || location.origin).replace(/\/$/, '')}/acesso/${token}`))
      .catch((err) => setError(errorMessage(err)))
    // gera uma vez ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops.loading, person.id])

  const first = person.name.split(' ')[0]
  const message = `Oi, ${first}! Este é o seu acesso ao app da equipe do MA Beach: ${link}\nAbra no seu celular, entre com o seu login (${displayLogin(person.login)}) e a senha provisória que eu te passei. Depois é só criar a sua senha. O link vale por 48 horas.`

  return (
    <Modal open onClose={onClose} title={`Link de acesso de ${person.name}`}>
      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : !link ? (
        <Spinner label="Gerando o link" />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Mande este link para a pessoa abrir <strong className="text-navy">no celular dela</strong>. Ele libera aquele aparelho, vale por 48 horas e funciona uma vez só.
            Passe a senha provisória por outro caminho (pessoalmente ou falando).
          </p>
          <p className="rounded-xl bg-white p-3 text-xs break-all ring-1 ring-line">{link}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                navigator.clipboard?.writeText(link).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              <Copy className="size-4" /> {copied ? 'Copiado!' : 'Copiar'}
            </Button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy px-4 text-sm font-semibold text-beige"
            >
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          </div>
          <p className="text-xs text-muted">Gerar um link novo cancela o anterior desta pessoa.</p>
        </div>
      )}
    </Modal>
  )
}
