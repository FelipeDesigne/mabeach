import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { loginToEmail } from '../../lib/login'
import { enableStaffManifest } from '../../lib/pwa'
import { Button, Field, Input, Notice } from '../../components/ui'
import { homeFor, useAuth } from './AuthProvider'

export function LoginPage() {
  const { user, role, loading } = useAuth()
  const [params] = useSearchParams()
  const [login, setLogin] = useState(() => (params.get('login') ?? '').slice(0, 100))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { enableStaffManifest() }, [])

  if (!loading && user && role) {
    const back = params.get('voltar')
    const safeBack = back && /^\/(garcom|admin|balcao|conta)(\/|$)/.test(back) ? back : null
    return <Navigate to={safeBack ?? homeFor(role)} replace />
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!login.trim() || !password) return setError('Preencha o usuário e a senha.')
    setBusy(true)
    try {
      await signInWithEmailAndPassword(auth, loginToEmail(login), password)
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(
        code === 'auth/too-many-requests'
          ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
          : code === 'auth/network-request-failed'
            ? 'Sem conexão. Confira a internet.'
            : code === 'auth/user-disabled'
              ? 'Esta conta está desativada. Fale com o administrador.'
              : 'Usuário ou senha incorretos.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <img src="/logo.svg" alt="MA Beach" className="mx-auto w-48" width={2782} height={1908} />
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-3xl bg-white p-5 ring-1 ring-line">
        <h1 className="text-xl font-bold">Entrar na equipe</h1>
        <Field label="Usuário ou e-mail">
          {(id) => <Input id={id} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} />}
        </Field>
        <Field label="Senha">
          {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />}
        </Field>
        {user && !role && !loading && <Notice tone="danger">Sua conta ainda não tem acesso. Fale com o administrador.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" busy={busy} className="mt-1">
          Entrar
        </Button>
        <p className="text-center text-xs text-muted">Esqueceu a senha? Peça uma nova ao administrador.</p>
      </form>
    </main>
  )
}
