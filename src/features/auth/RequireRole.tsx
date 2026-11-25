import { useEffect, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { canManage, homeFor, useAuth } from './AuthProvider'
import { Spinner, Button } from '../../components/ui'
import { enableStaffManifest } from '../../lib/pwa'
import { ROLE_LABEL, type Role } from '../../types'
import { ChangePasswordForm } from './ChangePasswordForm'

/** Tela da equipe: exige login com uma das funções. Liga o manifesto para poder instalar o app. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, role, profile, profileLoaded, loading, signOut } = useAuth()
  const location = useLocation()
  useEffect(() => {
    enableStaffManifest()
  }, [])

  if (loading) return <Spinner />
  if (!user) return <Navigate to={`/entrar?voltar=${encodeURIComponent(location.pathname)}`} replace />
  // Garçom ou balcão numa tela que não é a sua: vai direto para a tela certa.
  if (role && !roles.includes(role) && !canManage(role)) return <Navigate to={homeFor(role)} replace />
  if (!role || !roles.includes(role)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-bold">Acesso restrito</h1>
        {role ? (
          <p className="text-muted">
            Você entrou como <span className="font-semibold text-navy">{profile?.name ?? 'equipe'}</span> ({ROLE_LABEL[role]}), que não tem acesso a esta
            tela. Para usar outra conta neste navegador, troque de conta.
          </p>
        ) : (
          <p className="text-muted">Sua conta ainda não tem acesso. Fale com o administrador do MA Beach.</p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {role && !canManage(role) && (
            <Link to={homeFor(role)} className="inline-flex min-h-11 items-center rounded-xl bg-navy px-4 text-sm font-semibold text-beige">
              {role === 'counter' ? 'Abrir o balcão' : 'Abrir chamados'}
            </Link>
          )}
          <Button variant={role && !canManage(role) ? 'secondary' : 'primary'} onClick={signOut}>
            Trocar de conta
          </Button>
        </div>
      </main>
    )
  }
  if (!profileLoaded) return <Spinner />
  if (profile?.mustChangePassword) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10">
        <img src="/logo.svg" alt="MA Beach" className="mx-auto w-40" width={2782} height={1908} />
        <div className="rounded-3xl bg-white p-5 ring-1 ring-line">
          <h1 className="text-xl font-bold">Crie a sua senha</h1>
          <p className="mt-1 mb-4 text-sm text-muted">
            Olá, {profile.name.split(' ')[0]}! A senha que você recebeu é provisória. Crie uma só sua para continuar.
          </p>
          <ChangePasswordForm firstAccess />
        </div>
        <button type="button" onClick={signOut} className="text-sm font-semibold text-muted underline underline-offset-4">
          Sair
        </button>
      </main>
    )
  }
  return <>{children}</>
}

/**
 * /equipe: por onde o app instalado abre. Leva cada um para a sua tela (garçom nos chamados,
 * balcão no mapa, ADM e gerente no painel) ou para o login, se ninguém entrou ainda.
 */
export function StaffHome() {
  const { user, role, loading } = useAuth()
  useEffect(() => {
    enableStaffManifest()
  }, [])
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/entrar" replace />
  return <Navigate to={homeFor(role)} replace />
}
