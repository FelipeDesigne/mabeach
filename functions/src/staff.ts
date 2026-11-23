import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, db } from './lib/firebase'
import { audit, parse, rateLimit, requireAdmin, type Role } from './lib/guard'
import { createUserSchema, setPasswordSchema, updateUserSchema } from './lib/schemas'
import { callableOptions, USERNAME_DOMAIN } from './lib/options'

const toEmail = (login: string) => (login.includes('@') ? login : `${login}@${USERNAME_DOMAIN}`)

/** Encerra as sessões abertas: a mudança vale na hora em todos os aparelhos. */
async function revokeSessions(uid: string) {
  await adminAuth.revokeRefreshTokens(uid)
  const { tokensValidAfterTime } = await adminAuth.getUser(uid)
  const at = Math.floor((Date.parse(tokensValidAfterTime ?? '') || Date.now()) / 1000)
  await db.collection('sessionRevocations').doc(uid).set({ at })
}

async function activeAdmins() {
  return (await db.collection('staff').where('role', '==', 'admin').where('active', '==', true).count().get()).data().count
}

/** ADM cadastra alguém da equipe: nome, login (usuário ou e-mail), senha inicial e função. */
export const adminCreateUser = onCall(callableOptions, async (req) => {
  const { uid: by } = await requireAdmin(req)
  await rateLimit(by, 'users', 60, 60 * 60 * 1000)
  const { name, login, password, role } = parse(createUserSchema, req.data)
  const email = toEmail(login)

  const user = await adminAuth.createUser({ email, password, displayName: name }).catch((err: { code?: string }) => {
    if (err.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Esse login já está em uso.')
    if (err.code === 'auth/invalid-password') throw new HttpsError('invalid-argument', 'A senha precisa ter pelo menos 8 caracteres.')
    throw err
  })
  await adminAuth.setCustomUserClaims(user.uid, { role })
  await db.collection('staff').doc(user.uid).set({
    name,
    login,
    role,
    active: true,
    onDuty: false,
    // Senha criada pelo ADM: a pessoa troca pela dela no primeiro acesso.
    mustChangePassword: true,
    photoUrl: null,
    photoPath: null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: by,
  })
  await audit('user_created', { by, uid: user.uid, login, role })
  return { uid: user.uid }
})

/** ADM muda nome, função ou desativa/reativa alguém. Nunca a própria função, e nunca o último ADM ativo. */
export const adminUpdateUser = onCall(callableOptions, async (req) => {
  const { uid: by } = await requireAdmin(req)
  await rateLimit(by, 'users', 60, 60 * 60 * 1000)
  const { uid, name, role, active } = parse(updateUserSchema, req.data)
  const ref = db.collection('staff').doc(uid)
  const current = await ref.get()
  if (!current.exists) throw new HttpsError('not-found', 'Pessoa não encontrada.')
  const wasRole = current.get('role') as Role
  const wasActive = current.get('active') === true

  if (uid === by && ((role && role !== 'admin') || active === false)) {
    throw new HttpsError('failed-precondition', 'Você não pode tirar o seu próprio acesso de ADM.')
  }
  const losesAdmin = wasRole === 'admin' && wasActive && ((role && role !== 'admin') || active === false)
  if (losesAdmin && (await activeAdmins()) <= 1) throw new HttpsError('failed-precondition', 'É preciso ter pelo menos um ADM ativo.')

  const roleChanged = !!role && role !== wasRole
  const activeChanged = active !== undefined && active !== wasActive
  await adminAuth.updateUser(uid, { ...(name ? { displayName: name } : {}), ...(activeChanged ? { disabled: !active } : {}) })
  if (roleChanged) await adminAuth.setCustomUserClaims(uid, { role })
  if (roleChanged || activeChanged) await revokeSessions(uid)

  await ref.update({
    ...(name ? { name } : {}),
    ...(roleChanged ? { role } : {}),
    ...(activeChanged ? { active, ...(active ? {} : { onDuty: false }) } : {}),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: by,
  })
  await audit('user_updated', { by, uid, role: role ?? null, active: active ?? null, renamed: !!name })
  return { ok: true }
})

/** ADM define uma nova senha (garçons sem e-mail não têm "esqueci a senha"). */
export const adminSetPassword = onCall(callableOptions, async (req) => {
  const { uid: by } = await requireAdmin(req)
  await rateLimit(by, 'users', 60, 60 * 60 * 1000)
  const { uid, password } = parse(setPasswordSchema, req.data)
  if (!(await db.collection('staff').doc(uid).get()).exists) throw new HttpsError('not-found', 'Pessoa não encontrada.')
  await adminAuth.updateUser(uid, { password })
  if (uid !== by) {
    await revokeSessions(uid)
    // Senha nova definida pelo ADM: a pessoa troca pela dela ao entrar.
    await db.collection('staff').doc(uid).update({ mustChangePassword: true })
  }
  await audit('password_set', { by, uid })
  return { ok: true }
})
