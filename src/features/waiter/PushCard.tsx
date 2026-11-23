import { useEffect, useState } from 'react'
import { Bell, BellOff, Share } from 'lucide-react'
import { disablePush, enablePush, pushDeviceId, pushState, type PushState } from '../../lib/push'
import { Button } from '../../components/ui'

/** Ativar os avisos dos chamados neste celular (precisa de um toque, por regra dos navegadores). */
export function PushCard({ uid }: { uid: string }) {
  const [state, setState] = useState<PushState>(() => pushState())
  const [registered, setRegistered] = useState(() => !!pushDeviceId(uid))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setState(pushState())
    setRegistered(!!pushDeviceId(uid))
  }, [uid])

  async function enable() {
    setBusy(true)
    setFailed(false)
    try {
      const s = await enablePush(uid)
      setState(s)
      setRegistered(s === 'granted')
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    await disablePush(uid)
    setRegistered(false)
    setBusy(false)
  }

  if (state === 'granted' && registered) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-line">
        <div className="flex items-center gap-3">
          <Bell className="size-5 text-success" aria-hidden />
          <p className="text-sm">Avisos ativos neste aparelho.</p>
        </div>
        <Button variant="ghost" onClick={disable} busy={busy}>
          Desativar
        </Button>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 ring-1 ring-line">
      <div className="flex items-start gap-3">
        <BellOff className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold">Avisos desligados neste aparelho</p>
          {state === 'needs-install' && (
            <p className="mt-1 text-muted">
              No iPhone, instale o app primeiro: toque em <Share className="inline size-4 align-text-bottom" aria-label="Compartilhar" /> e depois em
              "Adicionar à Tela de Início". Abra pelo ícone e ative aqui.
            </p>
          )}
          {state === 'denied' && (
            <p className="mt-1 text-muted">Os avisos foram bloqueados. Libere nas configurações do navegador (cadeado ao lado do endereço) e volte aqui.</p>
          )}
          {state === 'unsupported' && (
            <p className="mt-1 text-muted">Este navegador não recebe avisos. Use o Chrome no Android ou o app instalado no iPhone.</p>
          )}
          {(state === 'default' || state === 'granted') && <p className="mt-1 text-muted">Ative para o celular tocar quando uma mesa chamar, mesmo com o app fechado.</p>}
          {failed && <p className="mt-1 font-medium text-danger">Não foi possível ativar agora. Tente de novo.</p>}
        </div>
      </div>
      {(state === 'default' || state === 'granted') && (
        <Button onClick={enable} busy={busy}>
          Ativar avisos
        </Button>
      )}
    </section>
  )
}
