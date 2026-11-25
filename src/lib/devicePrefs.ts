import { useEffect, useState } from 'react'

/** Preferências deste celular (não vão para o servidor): som com o app aberto e tela sempre acesa. */
export type DevicePref = 'sound' | 'keepAwake'
const DEFAULTS: Record<DevicePref, boolean> = { sound: true, keepAwake: false }
const key = (p: DevicePref) => `mabeach-pref:${p}`

export function readPref(p: DevicePref) {
  try {
    const v = localStorage.getItem(key(p))
    return v === null ? DEFAULTS[p] : v === '1'
  } catch {
    return DEFAULTS[p]
  }
}

export function usePref(p: DevicePref) {
  const [value, setValue] = useState(() => readPref(p))
  const set = (v: boolean) => {
    setValue(v)
    try {
      localStorage.setItem(key(p), v ? '1' : '0')
    } catch {
      // sem localStorage: vale só enquanto a tela estiver aberta
    }
  }
  return [value, set] as const
}

export const wakeLockSupported = () => 'wakeLock' in navigator

/** Mantém a tela acesa enquanto `on` (some sozinho quando o app vai para o fundo; religa ao voltar). */
export function useKeepAwake(on: boolean) {
  useEffect(() => {
    if (!on || !wakeLockSupported()) return
    let lock: WakeLockSentinel | null = null
    let alive = true
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // bateria fraca ou sem permissão: segue sem manter a tela acesa
      }
    }
    const onVisible = () => {
      if (alive && document.visibilityState === 'visible') request()
    }
    request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => undefined)
    }
  }, [on])
}
