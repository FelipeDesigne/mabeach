import { useEffect, useState } from 'react'
import { applyPwaUpdate, onUpdateReady, updateReady } from '../../lib/pwa'
import { Button } from '../../components/ui'

/** "Nova versão disponível" nas telas da equipe. */
export function UpdateBanner() {
  const [ready, setReady] = useState(updateReady)
  useEffect(() => {
    const off = onUpdateReady(() => setReady(true))
    return () => {
      off()
    }
  }, [])
  if (!ready) return null
  return (
    <div className="no-print flex items-center justify-between gap-3 rounded-2xl bg-navy p-3 pl-4 text-sm text-beige">
      <p>Tem uma versão nova do app.</p>
      <Button variant="secondary" onClick={() => applyPwaUpdate()}>
        Atualizar
      </Button>
    </div>
  )
}
