import { useEffect, useState, type FormEvent } from 'react'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { Download } from 'lucide-react'
import { db } from '../../lib/firebase'
import { useOpsSettings, usePublicSettings } from '../../lib/data'
import { download, qrDataUrl } from '../../lib/qr'
import { Button, Field, Input, Notice, Spinner, Switch } from '../../components/ui'
import { useAuth } from '../auth/AuthProvider'
import { PageTitle } from './AdminLayout'
import type { OpsSettings, PublicSettings } from '../../types'

const isHttps = (v: string) => v === '' || /^https:\/\/\S+$/.test(v)

export function SettingsAdmin() {
  const { user } = useAuth()
  const pub = usePublicSettings()
  const ops = useOpsSettings()
  const [p, setP] = useState<PublicSettings | null>(null)
  const [o, setO] = useState<OpsSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [reviewQr, setReviewQr] = useState('')

  useEffect(() => {
    if (!pub.loading && !p) setP(pub.data)
  }, [pub.loading, pub.data, p])
  useEffect(() => {
    if (!ops.loading && !o) setO(ops.data)
  }, [ops.loading, ops.data, o])
  useEffect(() => {
    const url = pub.data.googleReviewUrl
    if (url) qrDataUrl(url).then(setReviewQr)
    else setReviewQr('')
  }, [pub.data.googleReviewUrl])

  if (!p || !o) return <Spinner />

  async function save(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    const base = o!.qrBaseUrl.trim().replace(/\/+$/, '')
    if (base && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(base)) return setMsg({ tone: 'danger', text: 'Domínio: use só o endereço, por exemplo https://mabeach.com.br' })
    if (!isHttps(p!.googleReviewUrl ?? '') || !isHttps(p!.instagramUrl ?? '')) return setMsg({ tone: 'danger', text: 'Os links precisam começar com https://' })
    setBusy(true)
    try {
      const stamp = { updatedAt: serverTimestamp(), updatedBy: user!.uid }
      await Promise.all([
        setDoc(doc(db, 'settings/public'), {
          callCooldownMin: p!.callCooldownMin,
          googleReviewUrl: (p!.googleReviewUrl ?? '').trim(),
          instagramUrl: (p!.instagramUrl ?? '').trim(),
          askReviewAfterCall: p!.askReviewAfterCall !== false,
          ...stamp,
        }),
        setDoc(doc(db, 'settings/ops'), {
          routing: o!.routing,
          escalateAfterMin: o!.escalateAfterMin,
          ownerAfterMin: o!.ownerAfterMin,
          qrBaseUrl: base,
          autoOffDutyHour: o!.autoOffDutyHour,
          ...stamp,
        }),
      ])
      setMsg({ tone: 'success', text: 'Configurações salvas.' })
    } catch {
      setMsg({ tone: 'danger', text: 'Não foi possível salvar. Confira os valores e tente de novo.' })
    } finally {
      setBusy(false)
    }
  }

  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)))

  return (
    <>
      <PageTitle title="Configurações" />
      <form onSubmit={save} className="flex max-w-2xl flex-col gap-6">
        <Section title="Chamar garçom">
          <Field label="Tempo de espera entre chamadas da mesma mesa (minutos)" hint="Depois de chamar, o botão da mesa fica bloqueado por esse tempo.">
            {(id) => <Input id={id} type="number" min={1} max={60} value={p.callCooldownMin} onChange={(e) => setP({ ...p, callCooldownMin: num(e.target.value, 1, 60) })} className="max-w-32" />}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-semibold">Quem recebe o chamado</legend>
            {(
              [
                ['round_robin', 'Um garçom por vez (rodízio)', 'Cada chamado vai para o próximo garçom em serviço, revezando.'],
                ['all', 'Todos os garçons em serviço', 'Todo mundo recebe; quem estiver mais perto atende.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className={`flex cursor-pointer gap-3 rounded-xl bg-white p-3 ring-1 ${o.routing === value ? 'ring-2 ring-navy' : 'ring-line'}`}>
                <input type="radio" name="routing" checked={o.routing === value} onChange={() => setO({ ...o, routing: value })} className="mt-1 accent-navy" />
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label="Se ninguém atender, avisar todos em serviço depois de (minutos)" hint="0 = desligado.">
            {(id) => <Input id={id} type="number" min={0} max={60} value={o.escalateAfterMin} onChange={(e) => setO({ ...o, escalateAfterMin: num(e.target.value, 0, 60) })} className="max-w-32" />}
          </Field>
          <Field label="Avisar o ADM se a mesa esperar mais de (minutos)" hint="0 = desligado.">
            {(id) => <Input id={id} type="number" min={0} max={120} value={o.ownerAfterMin} onChange={(e) => setO({ ...o, ownerAfterMin: num(e.target.value, 0, 120) })} className="max-w-32" />}
          </Field>
          <Field label='Tirar todo mundo de "Em serviço" automaticamente às' hint="Todo dia, depois do fechamento. No dia seguinte cada garçom liga de novo ao chegar. Evita receber chamado em casa.">
            {(id) => (
              <select id={id} value={o.autoOffDutyHour} onChange={(e) => setO({ ...o, autoOffDutyHour: Number(e.target.value) })} className="min-h-11 w-full max-w-48 rounded-xl border border-line bg-white px-3">
                <option value={-1}>Desligado</option>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            )}
          </Field>
        </Section>

        <Section title="Endereço do cardápio">
          <Field label="Domínio" hint="Endereço do site que vai nos QR codes das mesas.">
            {(id) => <Input id={id} value={o.qrBaseUrl} onChange={(e) => setO({ ...o, qrBaseUrl: e.target.value })} placeholder="https://" inputMode="url" />}
          </Field>
        </Section>

        <Section title="Avaliações e redes">
          <Field label="Link de avaliação do Google" hint="Aparece no fim do cardápio e gera um QR code para imprimir.">
            {(id) => <Input id={id} value={p.googleReviewUrl ?? ''} onChange={(e) => setP({ ...p, googleReviewUrl: e.target.value })} placeholder="https://g.page/r/..." inputMode="url" />}
          </Field>
          <label className="flex items-center justify-between gap-4 rounded-xl bg-white p-3 ring-1 ring-line">
            <span>
              <span className="block text-sm font-semibold">Pedir avaliação depois de chamar o garçom</span>
              <span className="block text-xs text-muted">
                Quando o cliente chama, aparece "Você poderia nos avaliar no Google?". Só funciona com o link de avaliação preenchido.
              </span>
            </span>
            <Switch checked={p.askReviewAfterCall !== false} onChange={(v) => setP({ ...p, askReviewAfterCall: v })} label="Pedir avaliação depois de chamar o garçom" />
          </label>
          <Field label="Instagram">
            {(id) => <Input id={id} value={p.instagramUrl ?? ''} onChange={(e) => setP({ ...p, instagramUrl: e.target.value })} placeholder="https://instagram.com/..." inputMode="url" />}
          </Field>
          {reviewQr && (
            <div className="flex items-center gap-4 rounded-xl bg-white p-3 ring-1 ring-line">
              <img src={reviewQr} alt="QR code da avaliação no Google" className="size-28" />
              <div className="flex flex-col gap-2">
                <p className="text-sm">QR code para avaliar no Google (do link salvo).</p>
                <Button type="button" variant="secondary" onClick={() => download(reviewQr, 'qr-avaliacao-google.png')}>
                  <Download className="size-4" /> Baixar PNG
                </Button>
              </div>
            </div>
          )}
        </Section>

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Button type="submit" busy={busy} className="self-start">
          Salvar configurações
        </Button>
      </form>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-beige-200/60 p-4 sm:p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  )
}
