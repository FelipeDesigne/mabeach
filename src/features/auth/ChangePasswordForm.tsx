import { useState, type FormEvent } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../lib/firebase'
import { Button, Field, Input, Notice } from '../../components/ui'

/**
 * Troca da própria senha: confirma a atual (exigência do Firebase para mudar a senha) e grava a nova.
 * No primeiro acesso, também desliga o aviso de "senha provisória".
 */
export function ChangePasswordForm({ firstAccess = false, onDone }: { firstAccess?: boolean; onDone?: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setOk(false)
    const user = auth.currentUser
    if (!user?.email) return setError('Entre de novo e tente outra vez.')
    if (next.length < 8) return setError('A senha nova precisa ter pelo menos 8 caracteres.')
    if (next !== confirm) return setError('As duas senhas novas não são iguais.')
    if (next === current) return setError('A senha nova precisa ser diferente da atual.')
    setBusy(true)
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current))
      await updatePassword(user, next)
      if (firstAccess) await updateDoc(doc(db, 'staff', user.uid), { mustChangePassword: false })
      setCurrent('')
      setNext('')
      setConfirm('')
      setOk(true)
      onDone?.()
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(
        code === 'auth/invalid-credential' || code === 'auth/wrong-password'
          ? 'A senha atual está errada.'
          : code === 'auth/too-many-requests'
            ? 'Muitas tentativas. Aguarde alguns minutos.'
            : code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements'
              ? 'Escolha uma senha mais forte.'
              : 'Não foi possível trocar a senha. Tente de novo.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={firstAccess ? 'Senha que você recebeu' : 'Senha atual'}>
        {(id) => <Input id={id} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />}
      </Field>
      <Field label="Senha nova" hint="Pelo menos 8 caracteres.">
        {(id) => <Input id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" maxLength={100} />}
      </Field>
      <Field label="Repita a senha nova">
        {(id) => <Input id={id} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={100} />}
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      {ok && !firstAccess && <Notice tone="success">Senha trocada.</Notice>}
      <Button type="submit" busy={busy}>
        {firstAccess ? 'Criar minha senha' : 'Trocar senha'}
      </Button>
    </form>
  )
}
