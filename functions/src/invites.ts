import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createHash, randomBytes } from 'node:crypto'
import { db } from './lib/firebase'
import { audit, clientKey, parse, rateLimit, requireAdmin } from './lib/guard'
import { createInviteSchema, redeemInviteSchema } from './lib/schemas'
import { callableOptions } from './lib/options'

/** Link de acesso vale por 48 horas e uma vez só. */
const VALID_MS = 48 * 60 * 60 * 1000
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

/**
 * ADM gera o link de acesso de alguém da equipe. Só o resumo (hash) do código fica guardado:
 * nem quem lê o banco consegue montar o link. Gerar um novo cancela o anterior da mesma pessoa.
 */
export const adminCreateInvite = onCall(callableOptions, async (req) => {
  const { uid: by } = await requireAdmin(req)
  await rateLimit(by, 'invites', 60, 60 * 60 * 1000)
  const { uid } = parse(createInviteSchema, req.data)
  const person = await db.collection('staff').doc(uid).get()
  if (!person.exists || person.get('active') !== true) throw new HttpsError('not-found', 'Pessoa não encontrada ou desativada.')

  const old = await db.collection('invites').where('uid', '==', uid).get()
  const batch = db.batch()
  old.docs.forEach((d) => batch.delete(d.ref))
  const token = randomBytes(24).toString('base64url')
  batch.set(db.collection('invites').doc(hash(token)), {
    uid,
    createdBy: by,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + VALID_MS),
    usedAt: null,
  })
  await batch.commit()
  await audit('invite_created', { by, uid })
  return { token, expiresInHours: VALID_MS / 3600000 }
})

/**
 * O link é aberto no celular da pessoa: libera aquele aparelho para ver a tela de login
 * e devolve o login dela para já vir preenchido. A senha continua sendo exigida.
 */
export const redeemInvite = onCall(callableOptions, async (req) => {
  await rateLimit(clientKey(req), 'invite_redeem', 20, 60 * 60 * 1000)
  const { token } = parse(redeemInviteSchema, req.data)
  const ref = db.collection('invites').doc(hash(token))
  const result = await db.runTransaction(async (tx) => {
    const invite = await tx.get(ref)
    if (!invite.exists) return { status: 'invalid' as const }
    const expired = (invite.get('expiresAt') as Timestamp).toMillis() < Date.now()
    if (invite.get('usedAt') || expired) return { status: 'expired' as const }
    const person = await tx.get(db.collection('staff').doc(String(invite.get('uid'))))
    if (!person.exists || person.get('active') !== true) return { status: 'expired' as const }
    tx.update(ref, { usedAt: FieldValue.serverTimestamp() })
    return { status: 'ok' as const, login: String(person.get('login')), uid: person.id }
  })
  if (result.status === 'ok') await audit('invite_used', { uid: result.uid })
  return result.status === 'ok' ? { status: 'ok', login: result.login } : { status: result.status }
})
