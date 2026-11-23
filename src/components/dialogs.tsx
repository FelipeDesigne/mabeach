import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { Button, Field, Input, Modal } from './ui'

type AskOptions = {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** `danger`: ação que apaga ou desfaz algo (botão vermelho). */
  tone?: 'danger' | 'default'
}
type TextOptions = { title: string; label: string; initial?: string; confirmLabel?: string; maxLength?: number; placeholder?: string }
type NoticeOptions = { title: string; message?: ReactNode }

type Pending =
  | { kind: 'ask'; opts: AskOptions; resolve: (v: boolean) => void }
  | { kind: 'text'; opts: TextOptions; resolve: (v: string | null) => void }
  | { kind: 'notice'; opts: NoticeOptions; resolve: () => void }

type Dialogs = {
  /** Pergunta "sim ou não" no visual do app (no lugar do `confirm` do navegador). */
  ask: (opts: AskOptions) => Promise<boolean>
  /** Pede um texto curto (no lugar do `prompt` do navegador). `null` se cancelar. */
  askText: (opts: TextOptions) => Promise<string | null>
  /** Aviso com um botão "OK" (no lugar do `alert` do navegador). */
  notify: (opts: NoticeOptions) => Promise<void>
}

const Ctx = createContext<Dialogs | null>(null)

/** Janelas de confirmação do app. Fica em volta de todas as telas. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [text, setText] = useState('')
  const settled = useRef(false)

  const open = useCallback((p: Pending) => {
    settled.current = false
    if (p.kind === 'text') setText(p.opts.initial ?? '')
    setPending(p)
  }, [])

  const ask = useCallback((opts: AskOptions) => new Promise<boolean>((resolve) => open({ kind: 'ask', opts, resolve })), [open])
  const askText = useCallback((opts: TextOptions) => new Promise<string | null>((resolve) => open({ kind: 'text', opts, resolve })), [open])
  const notify = useCallback((opts: NoticeOptions) => new Promise<void>((resolve) => open({ kind: 'notice', opts, resolve })), [open])

  /** Fecha respondendo uma vez só (fechar no X ou fora conta como "cancelar"). */
  function finish(answer: boolean) {
    if (!pending || settled.current) return
    settled.current = true
    if (pending.kind === 'ask') pending.resolve(answer)
    else if (pending.kind === 'text') pending.resolve(answer && text.trim() ? text.trim() : null)
    else pending.resolve()
    setPending(null)
  }

  const danger = pending?.kind === 'ask' && pending.opts.tone === 'danger'

  return (
    <Ctx.Provider value={{ ask, askText, notify }}>
      {children}
      <Modal open={!!pending} onClose={() => finish(false)} title={pending?.opts.title ?? ''}>
        {pending && (
          <div className="flex flex-col gap-5">
            {pending.kind !== 'text' && pending.opts.message && (
              <div className="flex gap-3 text-sm text-muted">
                {danger ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden /> : <Info className="mt-0.5 size-5 shrink-0" aria-hidden />}
                <div>{pending.opts.message}</div>
              </div>
            )}
            {pending.kind === 'text' && (
              <form
                id="dialog-text"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (text.trim()) finish(true)
                }}
              >
                <Field label={pending.opts.label}>
                  {(id) => (
                    <Input id={id} value={text} onChange={(e) => setText(e.target.value)} maxLength={pending.opts.maxLength ?? 60} placeholder={pending.opts.placeholder} autoFocus />
                  )}
                </Field>
              </form>
            )}
            {pending.kind === 'notice' ? (
              <Button onClick={() => finish(true)} autoFocus>
                OK
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => finish(false)}>
                  {pending.kind === 'ask' ? (pending.opts.cancelLabel ?? 'Cancelar') : 'Cancelar'}
                </Button>
                {pending.kind === 'ask' ? (
                  <Button variant={danger ? 'solidDanger' : 'primary'} onClick={() => finish(true)} autoFocus>
                    {pending.opts.confirmLabel ?? 'Confirmar'}
                  </Button>
                ) : (
                  <Button type="submit" form="dialog-text" disabled={!text.trim()}>
                    {pending.opts.confirmLabel ?? 'Salvar'}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </Ctx.Provider>
  )
}

export function useDialogs() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDialogs fora do DialogProvider')
  return ctx
}
