import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth'
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'

const env = import.meta.env

export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})

export const useEmulators = env.DEV && env.VITE_USE_EMULATORS === 'true'

// Proteção contra robôs: só liga quando a chave do reCAPTCHA Enterprise estiver configurada.
if (!useEmulators && env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
}

export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] })
auth.languageCode = 'pt-BR'

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}

/** Cloud Functions, carregado só quando necessário (chamar garçom, painel). */
export async function getFunctionsLazy() {
  const { getFunctions, connectFunctionsEmulator } = await import('firebase/functions')
  const functions = getFunctions(app, 'southamerica-east1')
  if (useEmulators && !(functions as unknown as { emulatorOrigin?: string }).emulatorOrigin) {
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  }
  return functions
}

/** Chama uma função do servidor pelo nome. */
export async function callFn<T = unknown, R = unknown>(name: string, data: T): Promise<R> {
  const { httpsCallable } = await import('firebase/functions')
  const res = await httpsCallable<T, R>(await getFunctionsLazy(), name)(data)
  return res.data
}

/** Cloud Storage, carregado só no painel (fotos do cardápio). */
export async function getStorageLazy() {
  const { getStorage, connectStorageEmulator } = await import('firebase/storage')
  const storage = getStorage(app)
  if (useEmulators && !(storage as unknown as { _customUrlOrRegion?: string })._customUrlOrRegion) {
    connectStorageEmulator(storage, '127.0.0.1', 9199)
  }
  return storage
}

/** Mensagem curta para o usuário a partir de um erro do Firebase (o detalhe técnico não aparece). */
export function errorMessage(err: unknown, fallback = 'Não foi possível concluir agora. Tente novamente.') {
  const e = err as { code?: string; message?: string }
  const code = e?.code ?? ''
  if (code === 'functions/unavailable' || code === 'unavailable') return 'Sem conexão. Confira a internet e tente de novo.'
  if (code.startsWith('functions/') && e.message && !/internal/i.test(code)) return e.message
  if (code === 'permission-denied') return 'Você não tem permissão para isso.'
  return fallback
}
