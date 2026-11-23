import { useEffect, useState } from 'react'
import { BellRing, Check, Star } from 'lucide-react'
import { callFn, errorMessage } from '../../lib/firebase'
import { countdown, tableName } from '../../lib/format'
import { useNow } from '../../lib/data'
import { Button, Modal } from '../../components/ui'
import type { Table } from '../../types'
import { track } from '../../lib/track'

type Waiter = { name: string; photoUrl: string | null }

const lockKey = (tableId: string) => `mabeach-call:${tableId}`
const readLock = (tableId: string) => {
  try {
    return Number(localStorage.getItem(lockKey(tableId)) ?? 0)
  } catch {
    return 0
  }
}

/**
 * Pedido de avaliação no Google depois de chamar o garçom.
 * Quem já tocou em "Avaliar" não é perguntado de novo neste aparelho; quem tocou em "Agora não" só depois de 1 dia.
 */
const REVIEW_KEY = 'mabeach-review'
const DAY = 24 * 60 * 60 * 1000
function shouldAskReview() {
  try {
    const v = JSON.parse(localStorage.getItem(REVIEW_KEY) ?? '{}') as { done?: boolean; skipUntil?: number }
    return !v.done && !(v.skipUntil && v.skipUntil > Date.now())
  } catch {
    return true
  }
}
function saveReviewAnswer(done: boolean) {
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(done ? { done: true } : { skipUntil: Date.now() + DAY }))
  } catch {
    // sem localStorage: pode perguntar de novo, sem problema
  }
}

/** Barra fixa no rodapé do cardápio: "Chamar garçom", bloqueado depois de chamar até passar o prazo. */
export function CallBar({ table, cooldownMin, reviewUrl }: { table: Table | null; cooldownMin: number; reviewUrl?: string }) {
  const now = useNow(1000)
  const [retryAt, setRetryAt] = useState(() => (table ? readLock(table.id) : 0))
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [justCalled, setJustCalled] = useState(false)
  /** Janela depois de chamar: quem vem atender e, se for o caso, o pedido de avaliação. */
  const [arrived, setArrived] = useState(false)
  const [waiter, setWaiter] = useState<Waiter | null>(null)
  const [askReview, setAskReview] = useState(false)

  useEffect(() => {
    if (table) setRetryAt(readLock(table.id))
  }, [table])

  if (!table) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-beige px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-sm text-muted">
        Este QR code não está ativo. Chame um garçom no salão.
      </div>
    )
  }

  const locked = retryAt > now
  const lock = (at: number) => {
    setRetryAt(at)
    try {
      localStorage.setItem(lockKey(table.id), String(at))
    } catch {
      // sem localStorage: o servidor continua bloqueando chamadas repetidas
    }
  }

  async function call() {
    setBusy(true)
    setError('')
    try {
      const res = await callFn<{ tableId: string }, { retryAt: number; waiter?: Waiter | null }>('callWaiter', { tableId: table!.id })
      lock(res.retryAt)
      setJustCalled(true)
      setConfirm(false)
      setWaiter(res.waiter ?? null)
      setAskReview(!!reviewUrl && shouldAskReview())
      setArrived(true)
    } catch (err) {
      const e = err as { code?: string; details?: { retryAt?: number } }
      if (e.code === 'functions/resource-exhausted' && e.details?.retryAt) {
        lock(e.details.retryAt)
        setJustCalled(true)
        setConfirm(false)
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-beige/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto max-w-2xl">
          {locked ? (
            <div className="flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-white px-4 text-center ring-1 ring-line" role="status" aria-live="polite">
              {waiter?.photoUrl ? (
                <img src={waiter.photoUrl} alt="" className="size-9 shrink-0 rounded-full object-cover" />
              ) : (
                <Check className="size-5 shrink-0 text-success" aria-hidden />
              )}
              <p className="text-sm">
                <span className="font-semibold">{waiter ? `${waiter.name} está a caminho!` : justCalled ? 'Garçom chamado!' : 'O garçom já foi chamado.'}</span>{' '}
                <span className="text-muted">Pode chamar de novo em {countdown(retryAt - now)}.</span>
              </p>
            </div>
          ) : (
            <Button onClick={() => setConfirm(true)} className="min-h-14 w-full rounded-2xl text-base">
              <BellRing className="size-5" aria-hidden />
              Chamar garçom
            </Button>
          )}
        </div>
      </div>

      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Chamar o garçom na ${tableName(table.label)}?`}>
        <p className="text-sm text-muted">
          Alguém da equipe vai até a sua mesa. Depois de chamar, o botão fica bloqueado por {cooldownMin} {cooldownMin === 1 ? 'minuto' : 'minutos'}.
        </p>
        {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancelar
          </Button>
          <Button onClick={call} busy={busy}>
            Chamar
          </Button>
        </div>
      </Modal>

      <Modal
        open={arrived}
        onClose={() => {
          if (askReview) {
            saveReviewAnswer(false)
            track('review_no', table.id)
          }
          setArrived(false)
        }}
        title="Garçom a caminho!"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          {waiter?.photoUrl && <img src={waiter.photoUrl} alt={`Foto de ${waiter.name}`} className="size-28 rounded-full object-cover ring-4 ring-white" />}
          <p className="font-semibold">{waiter ? `${waiter.name} vai até a sua mesa.` : 'Alguém da equipe já vai até a sua mesa.'}</p>
        </div>
        {askReview ? (
          <>
            <p className="mt-4 text-sm text-muted">Enquanto isso, você poderia nos avaliar no Google? Leva menos de um minuto e nos ajuda muito a melhorar.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => (saveReviewAnswer(false), track('review_no', table.id), setArrived(false))}>
                Agora não
              </Button>
              <a
                href={reviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => (saveReviewAnswer(true), track('review_yes', table.id), setArrived(false))}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy px-4 text-sm font-semibold text-beige hover:bg-navy-soft"
              >
                <Star className="size-4" aria-hidden />
                Avaliar
              </a>
            </div>
          </>
        ) : (
          <Button className="mt-5 w-full" onClick={() => setArrived(false)}>
            OK
          </Button>
        )}
      </Modal>
    </>
  )
}
