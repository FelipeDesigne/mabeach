import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { LoaderCircle, X } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'solidDanger' | 'success'
const VARIANT: Record<Variant, string> = {
  success: 'bg-success text-white hover:bg-success/90 disabled:bg-success/40',
  primary: 'bg-navy text-beige hover:bg-navy-soft disabled:bg-navy/40',
  secondary: 'bg-white text-navy ring-1 ring-line hover:bg-beige-200 disabled:text-navy/40',
  ghost: 'text-navy hover:bg-beige-200 disabled:text-navy/40',
  danger: 'bg-white text-danger ring-1 ring-danger/30 hover:bg-danger/5 disabled:text-danger/40',
  solidDanger: 'bg-danger text-white hover:bg-danger/90 disabled:bg-danger/40',
}

export function Button({
  variant = 'primary',
  busy = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
    >
      {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </div>
  )
}

const inputClass = 'min-h-11 w-full rounded-xl border border-line bg-white px-3 text-base text-navy placeholder:text-muted/70 focus:border-navy focus:outline-none'

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={`${inputClass} ${props.className ?? ''}`} />
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={`${inputClass} py-2.5 ${props.className ?? ''}`} />
)
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={`${inputClass} ${props.className ?? ''}`} />

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-navy' : 'bg-line'}`}
    >
      <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted" role="status">
      <LoaderCircle className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </div>
  )
}

/** Janela sobre a tela (folha que sobe no celular, caixa centralizada no computador). */
export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-0 mt-auto w-full max-w-none rounded-t-3xl bg-beige p-0 text-navy backdrop:bg-navy/50 sm:m-auto sm:rounded-3xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
    >
      {open && (
        <div className="max-h-[88dvh] overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} className="-m-2 rounded-full p-2 hover:bg-beige-200" aria-label="Fechar">
              <X className="size-5" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'navy' | 'success' | 'danger' | 'warning' }) {
  const t = {
    neutral: 'bg-beige-200 text-navy',
    navy: 'bg-navy text-beige',
    success: 'bg-success/10 text-success',
    danger: 'bg-danger/10 text-danger',
    warning: 'bg-warning/10 text-warning',
  }[tone]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>
}

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'danger' | 'success' }) {
  const t = { neutral: 'bg-white ring-line', danger: 'bg-danger/5 ring-danger/20 text-danger', success: 'bg-success/5 ring-success/20 text-success' }[tone]
  return <div className={`rounded-xl p-3 text-sm ring-1 ${t}`}>{children}</div>
}
