import { useEffect, useState } from 'react'
import { Download, Share, X } from 'lucide-react'
import { isIOS, isStandalone } from '../../lib/push'
import { Button } from '../../components/ui'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const HIDE_KEY = 'mabeach-install-hide'

/** Convite para instalar o app da equipe (ícone na tela do celular). Some quando já está instalado. */
export function InstallCard({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const [hidden, setHidden] = useState(() => {
    try {
      return isStandalone() || (!alwaysShow && localStorage.getItem(HIDE_KEY) === '1')
    } catch {
      return isStandalone()
    }
  })

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvent(e as InstallEvent)
    }
    const onInstalled = () => setHidden(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (hidden) return null
  const hide = () => {
    setHidden(true)
    try {
      localStorage.setItem(HIDE_KEY, '1')
    } catch {
      // ignora
    }
  }

  return (
    <section className={`relative flex flex-col gap-3 rounded-2xl bg-white p-4 ring-1 ring-line ${alwaysShow ? '' : 'pr-10'}`}>
      {!alwaysShow && (
        <button type="button" onClick={hide} className="absolute top-2 right-2 rounded-full p-2 hover:bg-beige-200" aria-label="Fechar">
          <X className="size-4" />
        </button>
      )}
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold">Instale o app no celular</p>
          {isIOS() ? (
            <p className="mt-1 text-muted">
              Toque em <Share className="inline size-4 align-text-bottom" aria-label="Compartilhar" /> e depois em "Adicionar à Tela de Início". Abra sempre pelo ícone.
            </p>
          ) : event ? (
            <p className="mt-1 text-muted">Fica com ícone na tela, abre direto nos chamados e recebe os avisos.</p>
          ) : (
            <p className="mt-1 text-muted">No Chrome, toque no menu (⋮) e em "Instalar app" ou "Adicionar à tela inicial".</p>
          )}
        </div>
      </div>
      {event && !isIOS() && (
        <Button
          onClick={async () => {
            await event.prompt()
            const { outcome } = await event.userChoice
            if (outcome === 'accepted') setHidden(true)
            setEvent(null)
          }}
        >
          Instalar
        </Button>
      )}
    </section>
  )
}
