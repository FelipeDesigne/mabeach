import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { collection, doc, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore'
import { BellRing, Check, Coffee, LayoutDashboard, LogOut, UserRound } from 'lucide-react'
import { callFn, db, errorMessage } from '../../lib/firebase'
import { beep } from '../../lib/beep'
import { duration, tableName, timeOf } from '../../lib/format'
import { useLiveQuery, useNow } from '../../lib/data'
import { Badge, Button, Notice, Spinner, Switch } from '../../components/ui'
import { useDialogs } from '../../components/dialogs'
import { canManage, useAuth } from '../auth/AuthProvider'
import { pushDeviceId, pushState } from '../../lib/push'
import { readPref, useKeepAwake } from '../../lib/devicePrefs'
import { UpdateBanner } from '../pwa/UpdateBanner'
import { InstallCard } from './InstallCard'
import type { Call, TableStatus } from '../../types'

export function WaiterPage() {
  const { user, role, profile, signOut } = useAuth()
  const { ask } = useDialogs()
  const uid = user!.uid
  const now = useNow(15000)
  const calls = useLiveQuery<Call>(query(collection(db, 'calls'), where('status', '==', 'open'), orderBy('createdAt', 'asc')), [])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [dutyBusy, setDutyBusy] = useState(false)
  const seen = useRef<Set<string> | null>(null)
  /** Mesas que estão "com" esta pessoa (atendidas e ainda não encerradas). */
  const myTables = useLiveQuery<TableStatus>(query(collection(db, 'tableStatus'), where('holderUid', '==', uid)), [uid])
  const [closingId, setClosingId] = useState<string | null>(null)

  async function closeTable(t: TableStatus) {
    const ok = await ask({
      title: `Encerrar a ${tableName(t.tableLabel)}?`,
      message: 'Faça isso quando o cliente for embora. A mesa volta a ficar livre e o próximo chamado segue o rodízio normal.',
      confirmLabel: 'Encerrar mesa',
    })
    if (!ok) return
    setClosingId(t.id)
    setError('')
    try {
      await callFn('closeTable', { tableId: t.id })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setClosingId(null)
    }
  }
  const pushOff = !(pushState() === 'granted' && pushDeviceId(uid))
  const pausedUntil = profile?.pausedUntil?.toMillis() ?? 0
  const paused = !!profile?.onDuty && pausedUntil > now
  // Tela sempre acesa enquanto em serviço, se ligado em Minha conta.
  useKeepAwake(!!profile?.onDuty && readPref('keepAwake'))

  async function setPause(minutes: number | null) {
    setDutyBusy(true)
    try {
      await updateDoc(doc(db, 'staff', uid), { pausedUntil: minutes ? Timestamp.fromMillis(Date.now() + minutes * 60000) : null })
    } catch {
      setError('Não foi possível mudar agora. Tente de novo.')
    } finally {
      setDutyBusy(false)
    }
  }

  useEffect(() => {
    if (calls.loading) return
    const ids = new Set(calls.data.map((c) => c.id))
    if (seen.current && profile?.onDuty && readPref('sound') && [...ids].some((id) => !seen.current!.has(id))) beep()
    seen.current = ids
  }, [calls.data, calls.loading, profile?.onDuty])

  async function setDuty(onDuty: boolean) {
    setDutyBusy(true)
    try {
      await updateDoc(doc(db, 'staff', uid), { onDuty, onDutyAt: serverTimestamp() })
    } catch {
      setError('Não foi possível mudar agora. Tente de novo.')
    } finally {
      setDutyBusy(false)
    }
  }

  async function attend(call: Call) {
    setBusyId(call.id)
    setError('')
    try {
      await callFn('attendCall', { callId: call.id })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const mine = calls.data.filter((c) => c.assignedTo === uid)
  const others = calls.data.filter((c) => c.assignedTo !== uid)

  return (
    <div className="min-h-dvh pb-10">
      <header className="sticky top-0 z-10 bg-navy text-beige">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/logo-branco.svg" alt="MA Beach" className="h-9 w-auto" width={2782} height={1908} />
            <p className="truncate text-sm font-semibold">{profile?.name ?? ''}</p>
          </div>
          <div className="flex items-center gap-1">
            {canManage(role) && (
              <Link to="/admin" className="rounded-full p-2.5 hover:bg-white/10" aria-label="Painel">
                <LayoutDashboard className="size-5" />
              </Link>
            )}
            <Link to="/conta" className="relative rounded-full p-2.5 hover:bg-white/10" aria-label={pushOff ? 'Minha conta (avisos desligados)' : 'Minha conta'}>
              <UserRound className="size-5" />
              {/* Bolinha: os avisos ainda não foram ativados neste celular (ativa em Minha conta). */}
              {pushOff && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-warning ring-2 ring-navy" aria-hidden />}
            </Link>
            <button type="button" onClick={signOut} className="rounded-full p-2.5 hover:bg-white/10" aria-label="Sair">
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 pt-4">
        <UpdateBanner />
        <InstallCard />
        <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 ring-1 ring-line">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-bold">Em serviço</h1>
              <p className="text-sm text-muted">
                {!profile?.onDuty
                  ? 'Ligue para receber os chamados.'
                  : paused
                    ? `Em pausa até ${timeOf(new Date(pausedUntil))}. Depois você volta pro rodízio sozinho.`
                    : 'Você está recebendo os chamados das mesas.'}
              </p>
            </div>
            <Switch checked={!!profile?.onDuty} onChange={setDuty} disabled={dutyBusy || !profile} label="Em serviço" />
          </div>
          {profile?.onDuty &&
            (paused ? (
              <Button variant="secondary" onClick={() => setPause(null)} busy={dutyBusy}>
                Voltar agora
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setPause(15)} busy={dutyBusy} className="self-start px-2">
                <Coffee className="size-4" aria-hidden /> Pausa de 15 min
              </Button>
            ))}
        </section>

        {error && <Notice tone="danger">{error}</Notice>}

        <section>
          <h2 className="mb-2 text-lg font-bold">Mesas chamando</h2>
          {calls.loading && <Spinner />}
          {calls.error && <Notice tone="danger">Não foi possível carregar os chamados. Confira a internet.</Notice>}
          {!calls.loading && !calls.data.length && (
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-white py-12 text-center ring-1 ring-line">
              <Check className="size-8 text-success" aria-hidden />
              <p className="font-semibold">Nenhuma mesa chamando</p>
            </div>
          )}
          <ul className="flex flex-col gap-3">
            {[...mine, ...others].map((c) => {
              const waitSec = (now - c.createdAt.toMillis()) / 1000
              const forMe = c.assignedTo === uid
              return (
                <li key={c.id} className={`flex items-center gap-4 rounded-2xl p-4 ${forMe ? 'bg-navy text-beige' : 'bg-white ring-1 ring-line'}`}>
                  <BellRing className="size-7 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-xl font-bold">{tableName(c.tableLabel)}</p>
                    <p className={`text-sm ${forMe ? 'text-beige/80' : 'text-muted'}`}>
                      há {duration(Math.max(0, waitSec))}
                      {' · '}
                      {forMe ? 'pra você' : c.assignedName ? `pra ${c.assignedName}` : 'pra todos'}
                    </p>
                    {c.escalated && !forMe && (
                      <div className="mt-1">
                        <Badge tone="warning">Sem resposta, aberto pra todos</Badge>
                      </div>
                    )}
                  </div>
                  <Button variant={forMe ? 'secondary' : 'primary'} busy={busyId === c.id} onClick={() => attend(c)}>
                    Atendido
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>

        {myTables.data.some((t) => t.status !== 'free') && (
          <section>
            <h2 className="mb-2 text-lg font-bold">Suas mesas</h2>
            <p className="mb-2 text-xs text-muted">Os próximos chamados destas mesas vêm direto pra você. Encerre quando o cliente for embora.</p>
            <ul className="flex flex-col gap-2">
              {myTables.data
                .filter((t) => t.status !== 'free')
                .sort((a, b) => a.tableLabel.localeCompare(b.tableLabel, 'pt-BR', { numeric: true }))
                .map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 pl-4 ring-1 ring-line">
                    <div>
                      <p className="font-bold">{tableName(t.tableLabel)}</p>
                      {t.since && <p className="text-xs text-muted">desde {timeOf(t.since.toDate())}</p>}
                    </div>
                    <Button variant="secondary" busy={closingId === t.id} onClick={() => closeTable(t)}>
                      Encerrar
                    </Button>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
