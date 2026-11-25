import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { onIdTokenChanged, signOut as fbSignOut, type User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../../lib/firebase'
import { disablePush } from '../../lib/push'
import type { Role, Staff } from '../../types'

type AuthState = {
  user: User | null
  role: Role | null
  profile: Staff | null
  /** Cadastro da equipe já carregado (ou confirmado que não existe). */
  profileLoaded: boolean
  loading: boolean
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)
const ROLES: Role[] = ['admin', 'manager', 'waiter', 'counter']

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [profile, setProfile] = useState<Staff | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(
    () =>
      onIdTokenChanged(auth, async (u) => {
        setUser(u)
        if (!u) {
          setRole(null)
          setLoading(false)
          return
        }
        const claims = (await u.getIdTokenResult()).claims
        const r = claims.role as Role | undefined
        setRole(r && ROLES.includes(r) ? r : null)
        setLoading(false)
      }),
    [],
  )

  useEffect(() => {
    if (!user || !role) {
      setProfile(null)
      setProfileLoaded(!loading)
      return
    }
    setProfileLoaded(false)
    return onSnapshot(
      doc(db, 'staff', user.uid),
      (snap) => {
        setProfile(snap.exists() ? ({ id: snap.id, ...snap.data() } as Staff) : null)
        setProfileLoaded(true)
      },
      () => {
        setProfile(null)
        setProfileLoaded(true)
      },
    )
  }, [user, role, loading])

  const signOut = async () => {
    if (user) await disablePush(user.uid).catch(() => undefined)
    await fbSignOut(auth)
  }

  return <Ctx.Provider value={{ user, role, profile, profileLoaded, loading, signOut }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}

export const canManage = (role: Role | null) => role === 'admin' || role === 'manager'

/** Tela inicial de cada função. */
export const homeFor = (role: Role | null) =>
  role === 'counter' ? '/balcao' : canManage(role) ? '/admin' : '/garcom'
