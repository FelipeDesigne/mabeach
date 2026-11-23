import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { app, db } from './firebase'

/** Registro do aparelho guardado por conta (duas pessoas no mesmo celular não se misturam). */
const deviceKey = (uid: string) => `mabeach-push:${uid}`
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'default' | 'granted'

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

/** Situação dos avisos neste aparelho. No iPhone, só funcionam com o app instalado na tela de início. */
export function pushState(): PushState {
  if (!vapidKey || !('serviceWorker' in navigator)) return 'unsupported'
  if (isIOS() && !isStandalone()) return 'needs-install'
  if (!('Notification' in window) || !('PushManager' in window)) return 'unsupported'
  return Notification.permission
}

export const pushDeviceId = (uid: string) => {
  try {
    return localStorage.getItem(deviceKey(uid))
  } catch {
    return null
  }
}

async function sha(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

async function messaging() {
  const { getMessaging, isSupported } = await import('firebase/messaging')
  if (!(await isSupported())) throw new Error('unsupported')
  return getMessaging(app)
}

/** Pede permissão (só num toque do usuário) e registra este aparelho para receber os chamados. */
export async function enablePush(uid: string): Promise<PushState> {
  const state = pushState()
  if (state === 'unsupported' || state === 'needs-install' || state === 'denied') return state
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission
  const { getToken } = await import('firebase/messaging')
  const token = await getToken(await messaging(), { vapidKey, serviceWorkerRegistration: await navigator.serviceWorker.ready })
  const id = await sha(token)
  const platform = isIOS() ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'computador'
  await setDoc(doc(db, 'staff', uid, 'devices', id), { token, platform, updatedAt: serverTimestamp() })
  try {
    // Outra conta usava este aparelho: o registro antigo deixa de valer (o servidor apaga no próximo envio).
    Object.keys(localStorage)
      .filter((k) => k.startsWith('mabeach-push:') && k !== deviceKey(uid))
      .forEach((k) => localStorage.removeItem(k))
    localStorage.setItem(deviceKey(uid), id)
  } catch {
    // sem localStorage: o aparelho continua registrado no servidor
  }
  return 'granted'
}

/** Para de receber avisos neste aparelho (ao desativar ou ao sair da conta). */
export async function disablePush(uid: string) {
  const id = pushDeviceId(uid)
  if (id) await deleteDoc(doc(db, 'staff', uid, 'devices', id)).catch(() => undefined)
  try {
    const { deleteToken } = await import('firebase/messaging')
    await deleteToken(await messaging())
  } catch {
    // aparelho sem suporte: nada a apagar
  }
  try {
    localStorage.removeItem(deviceKey(uid))
  } catch {
    // ignora
  }
}
