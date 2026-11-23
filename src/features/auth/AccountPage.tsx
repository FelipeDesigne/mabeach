import { useMemo } from 'react'
import { Link } from 'react-router'
import { collection, query, Timestamp, where } from 'firebase/firestore'
import { ArrowLeft } from 'lucide-react'
import { db } from '../../lib/firebase'
import { useLiveQuery, useOpsSettings } from '../../lib/data'
import { duration } from '../../lib/format'
import { usePref, wakeLockSupported } from '../../lib/devicePrefs'
import { Switch } from '../../components/ui'
import type { Call } from '../../types'
import { homeFor, useAuth } from './AuthProvider'
import { ChangePasswordForm } from './ChangePasswordForm'
import { displayLogin } from '../../lib/login'
import { ROLE_LABEL, servesTables } from '../../types'
import { PushCard } from '../waiter/PushCard'
import { InstallCard } from '../waiter/InstallCard'

/** Minha conta: resumo do dia, avisos e opções deste celular, instalar o app e trocar a senha. A foto só o ADM troca. */
export function AccountPage() {
  const { user, role, profile } = useAuth()
  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-6">
      <Link to={homeFor(role)} className="inline-flex items-center gap-2 text-sm font-semibold">
        <ArrowLeft className="size-4" /> Voltar
      </Link>
      <h1 className="text-2xl font-bold">Minha conta</h1>
      <section className="flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-line">
        <Avatar name={profile?.name ?? ''} photoUrl={profile?.photoUrl} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-bold">{profile?.name}</p>
          <p className="text-sm text-muted">
            {displayLogin(profile?.login ?? user?.email ?? '')} · {role ? ROLE_LABEL[role] : ''}
          </p>
        </div>
      </section>
      {role && servesTables(role) && (
        <>
          <MyDay uid={user!.uid} />
          <section className="flex flex-col gap-3">
            <h2 className="font-bold">Este celular</h2>
            <PushCard uid={user!.uid} />
            <DevicePrefs />
            <InstallCard alwaysShow />
          </section>
        </>
      )}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-line">
        <h2 className="mb-4 font-bold">Trocar senha</h2>
        <ChangePasswordForm />
      </section>
    </main>
  )
}

/** Foto da pessoa da equipe, ou a inicial do nome quando não tem foto. */
export function Avatar({ name, photoUrl, size = 'md' }: { name: string; photoUrl?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const cls = { sm: 'size-9 text-sm', md: 'size-12 text-base', lg: 'size-16 text-xl' }[size]
  if (photoUrl) return <img src={photoUrl} alt={`Foto de ${name}`} className={`${cls} shrink-0 rounded-full object-cover ring-2 ring-white`} />
  return (
    <span className={`${cls} inline-flex shrink-0 items-center justify-center rounded-full bg-navy font-bold text-beige`} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/** Começo do turno atual: o último "fim de expediente" automático (padrão 5h) ou a meia-noite, se estiver desligado. */
function shiftStart(hour: number) {
  const d = new Date()
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.max(0, hour))
  if (start > d) start.setDate(start.getDate() - 1)
  return start
}

/** Meu dia: mesas que a pessoa atendeu neste turno e o tempo médio até a mesa. */
function MyDay({ uid }: { uid: string }) {
  const ops = useOpsSettings()
  const since = useMemo(() => Timestamp.fromDate(shiftStart(ops.data.autoOffDutyHour)), [ops.data.autoOffDutyHour])
  const calls = useLiveQuery<Call>(
    ops.loading ? null : query(collection(db, 'calls'), where('attendedBy', '==', uid), where('createdAt', '>=', since)),
    [uid, since.toMillis(), ops.loading],
  )
  const times = calls.data.map((c) => c.responseSec).filter((n): n is number => typeof n === 'number')
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0
  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-line">
      <h2 className="mb-3 font-bold">Meu dia</h2>
      {calls.loading ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : calls.error ? (
        <p className="text-sm text-muted">Não foi possível carregar agora.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-beige p-3">
            <p className="text-xs text-muted">Mesas atendidas</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{calls.data.length}</p>
          </div>
          <div className="rounded-xl bg-beige p-3">
            <p className="text-xs text-muted">Tempo médio até a mesa</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{times.length ? duration(avg) : '—'}</p>
          </div>
        </div>
      )}
    </section>
  )
}

/** Opções que valem só neste celular. */
function DevicePrefs() {
  const [sound, setSound] = usePref('sound')
  const [keepAwake, setKeepAwake] = usePref('keepAwake')
  return (
    <div className="flex flex-col divide-y divide-line rounded-2xl bg-white ring-1 ring-line">
      <label className="flex items-center justify-between gap-4 p-4">
        <span>
          <span className="block text-sm font-semibold">Som com o app aberto</span>
          <span className="block text-xs text-muted">Bipe e vibração quando chega chamado com a tela do app aberta.</span>
        </span>
        <Switch checked={sound} onChange={setSound} label="Som com o app aberto" />
      </label>
      {wakeLockSupported() && (
        <label className="flex items-center justify-between gap-4 p-4">
          <span>
            <span className="block text-sm font-semibold">Tela sempre acesa</span>
            <span className="block text-xs text-muted">Enquanto estiver em serviço com o app aberto, a tela não apaga. Gasta mais bateria.</span>
          </span>
          <Switch checked={keepAwake} onChange={setKeepAwake} label="Tela sempre acesa" />
        </label>
      )}
    </div>
  )
}
