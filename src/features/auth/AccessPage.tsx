import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { callFn } from '../../lib/firebase'
import { markStaffDevice } from '../../lib/staffDevice'
import { enableStaffManifest } from '../../lib/pwa'
import { Spinner } from '../../components/ui'
import { NotFound } from '../NotFound'

type Result = { status: 'ok'; login: string } | { status: 'expired' } | { status: 'invalid' }

/** /acesso/{código}: link enviado pelo ADM. Libera este aparelho e leva para o login já preenchido. */
export function AccessPage() {
  const { token = '' } = useParams()
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    enableStaffManifest()
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return setResult({ status: 'invalid' })
    callFn<{ token: string }, Result>('redeemInvite', { token })
      .then((r) => {
        if (r.status === 'ok') markStaffDevice()
        setResult(r)
      })
      .catch(() => setResult({ status: 'invalid' }))
  }, [token])

  if (!result) return <Spinner label="Conferindo o link" />
  if (result.status === 'ok') return <Navigate to={`/entrar?login=${encodeURIComponent(result.login)}`} replace />
  if (result.status === 'expired') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
        <img src="/logo.svg" alt="MA Beach" className="w-40" width={2782} height={1908} />
        <h1 className="text-xl font-bold">Este link não vale mais</h1>
        <p className="text-muted">Ele já foi usado ou passou de 48 horas. Peça um link novo para o administrador.</p>
      </main>
    )
  }
  return <NotFound />
}
