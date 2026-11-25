import { registerSW } from 'virtual:pwa-register'

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null
const listeners = new Set<() => void>()
export let updateReady = false

/**
 * Registra o service worker (avisos dos chamados e abertura rápida).
 * Versão nova: nas telas da equipe aparece "Atualizar"; no cardápio, aplica quando a pessoa sai da página.
 */
export function initPwa() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady = true
      listeners.forEach((l) => l())
      const isStaffPage = /^\/(garcom|admin|balcao|conta|equipe|entrar)/.test(location.pathname)
      if (!isStaffPage) {
        document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && applyUpdate?.(false), { once: true })
      }
    },
  })
}

export const onUpdateReady = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const applyPwaUpdate = () => applyUpdate?.(true)

/** Liga o manifesto (instalar o app) só nas telas da equipe. */
export function enableStaffManifest() {
  if (document.querySelector('link[rel="manifest"]')) return
  const link = document.createElement('link')
  link.rel = 'manifest'
  link.href = '/manifest.webmanifest'
  document.head.appendChild(link)
}
