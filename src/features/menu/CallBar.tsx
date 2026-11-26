import { useEffect, useRef, useState } from 'react'
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

/**
 * Entrada do botão: na primeira visita da mesa (nesta aba), ele aparece no meio da tela quando a pessoa
 * rola uns 50 px (ou depois de 4 s, se ela não rolar) e desce até o rodapé. Assim ninguém deixa de ver.
 */
const INTRO_KEY = (tableId: string) => `mabeach-intro:${tableId}`
const INTRO_SCROLL = 50
const INTRO_FALLBACK_MS = 4000
function introSeen(tableId: string) {
  try {
    return sessionStorage.getItem(INTRO_KEY(tableId)) === '1'
  } catch {
    return false
  }
}
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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
  /** waiting: ainda escondido; intro: animando do meio da tela; done: parado no rodapé. */
  const [stage, setStage] = useState<'waiting' | 'intro' | 'done'>(() =>
    !table || readLock(table.id) > Date.now() || introSeen(table.id) || reducedMotion() ? 'done' : 'waiting',
  )
  const btnRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (table) setRetryAt(readLock(table.id))
  }, [table])

  // Espera a pessoa rolar um pouco (ou o tempo acabar) para mostrar o botão.
  useEffect(() => {
    if (stage !== 'waiting') return
    const start = () => setStage('intro')
    const onScroll = () => window.scrollY > INTRO_SCROLL && start()
    const timer = window.setTimeout(start, INTRO_FALLBACK_MS)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [stage])

  // Aparece no meio da tela, fica um instante e desce suave até o lugar dele no rodapé.
  useEffect(() => {
    if (stage !== 'intro' || !table) return
    try {
      sessionStorage.setItem(INTRO_KEY(table.id), '1')
    } catch {
      // sem sessionStorage: a animação pode repetir, sem problema
    }
    const el = btnRef.current
    if (!el?.animate) return setStage('done')
    const r = el.getBoundingClientRect()
    const dy = window.innerHeight / 2 - (r.top + r.height / 2)
    const anim = el.animate(
      [
        { transform: `translateY(${dy}px) scale(0.8)`, opacity: 0, easing: 'cubic-bezier(.2,.9,.3,1.3)' },
        { transform: `translateY(${dy}px) scale(1.06)`, opacity: 1, offset: 0.2, easing: 'ease-out' },
        { transform: `translateY(${dy}px) scale(1)`, opacity: 1, offset: 0.58, easing: 'cubic-bezier(.45,0,.2,1)' },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ],
      { duration: 2300 },
    )
    anim.onfinish = () => setStage('done')
    anim.oncancel = () => setStage('done')
    return () => {
      anim.oncancel = null
      anim.cancel()
    }
  }, [stage, table])

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
      <div
        className={`fixed inset-x-0 bottom-0 z-20 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-[background-color,border-color] duration-500 ${
          stage === 'done' ? 'border-line bg-beige/95 backdrop-blur' : 'pointer-events-none border-transparent bg-transparent'
        } ${stage === 'waiting' ? 'invisible' : ''}`}
      >
        <div ref={btnRef} className="pointer-events-auto mx-auto max-w-2xl">
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
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className={`inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-call px-4 text-base font-bold text-white transition-colors hover:bg-call/90 active:bg-call/80 ${
                stage === 'intro' ? 'shadow-2xl shadow-call/40' : 'shadow-lg shadow-call/25'
              }`}
            >
              <BellRing className="size-5" aria-hidden />
              Chamar garçom
            </button>
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
