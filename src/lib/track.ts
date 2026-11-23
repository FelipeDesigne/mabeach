import { callFn } from './firebase'

type EventType = 'menu_open' | 'review_yes' | 'review_no'

/**
 * Conta um acontecimento para o painel (cardápio aberto, resposta à avaliação). Anônimo: só soma números.
 * "Cardápio aberto" conta no máximo uma vez a cada 30 minutos por celular e mesa.
 * Nunca atrapalha o cliente: roda depois, em segundo plano, e erros são ignorados.
 */
export function track(type: EventType, tableId?: string) {
  if (type === 'menu_open') {
    const key = `mabeach-visto:${tableId ?? 'geral'}`
    try {
      const last = Number(localStorage.getItem(key) ?? 0)
      if (Date.now() - last < 30 * 60 * 1000) return
      localStorage.setItem(key, String(Date.now()))
    } catch {
      // sem localStorage: conta normalmente
    }
  }
  const run = () => callFn('trackEvent', { type, ...(tableId ? { tableId } : {}) }).catch(() => undefined)
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 1500)
}
