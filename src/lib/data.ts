import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, query, type DocumentData, type Query } from 'firebase/firestore'
import { db } from './firebase'
import { DEFAULT_BANNER, DEFAULT_OPS, DEFAULT_PUBLIC, type Banner, type OpsSettings, type PublicSettings } from '../types'

type State<T> = { data: T; loading: boolean; error: boolean }

/** Lista em tempo real (painel e garçom). */
export function useLiveQuery<T>(q: Query<DocumentData> | null, deps: unknown[]): State<T[]> {
  const [state, setState] = useState<State<T[]>>({ data: [], loading: true, error: false })
  useEffect(() => {
    if (!q) return
    setState((s) => ({ ...s, loading: true }))
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T), loading: false, error: false }),
      () => setState({ data: [], loading: false, error: true }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export const col = (name: string) => query(collection(db, name))

/** Documento em tempo real com valores padrão. */
export function useLiveDoc<T extends object>(path: string, fallback: T, enabled = true): State<T> {
  const [state, setState] = useState<State<T>>({ data: fallback, loading: true, error: false })
  useEffect(() => {
    if (!enabled) return
    return onSnapshot(
      doc(db, path),
      (snap) => setState({ data: { ...fallback, ...(snap.data() as Partial<T> | undefined) }, loading: false, error: false }),
      () => setState({ data: fallback, loading: false, error: true }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled])
  return state
}

export const usePublicSettings = () => useLiveDoc<PublicSettings>('settings/public', DEFAULT_PUBLIC)
export const useBanner = () => useLiveDoc<Banner>('settings/banner', DEFAULT_BANNER)
export const useOpsSettings =(enabled = true) => useLiveDoc<OpsSettings>('settings/ops', DEFAULT_OPS, enabled)

/** Re-renderiza a cada `ms` (relógios "há 3 min"). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
