import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import type { z } from 'zod'
import { adminAuth, db } from './firebase'

export type Role = 'admin' | 'manager' | 'waiter' | 'counter'
export const ROLES: Role[] = ['admin', 'manager', 'waiter', 'counter']

export function requireUser(req: CallableRequest<unknown>) {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Entre na sua conta para continuar.')
  return { uid: req.auth.uid, token: req.auth.token }
}

/**
 * Exige uma das funções. Confere a conta atual, e não só a sessão: quem foi desativado ou mudou de função
 * perde o acesso antigo na hora, mesmo com a sessão (que vale até 1 hora) ainda aberta.
 */
export async function requireRole(req: CallableRequest<unknown>, roles: Role[]) {
  const user = requireUser(req)
  const denied = new HttpsError('permission-denied', 'Acesso restrito.')
  if (!roles.includes(user.token.role as Role)) throw denied
  const account = await adminAuth.getUser(user.uid).catch(() => null)
  const validAfter = account?.tokensValidAfterTime ? Date.parse(account.tokensValidAfterTime) : 0
  if (!account || account.disabled || !roles.includes(account.customClaims?.role as Role) || user.token.iat * 1000 < validAfter) throw denied
  return { ...user, role: account.customClaims?.role as Role }
}

export const requireAdmin = (req: CallableRequest<unknown>) => requireRole(req, ['admin'])
export const requireStaff = (req: CallableRequest<unknown>) => requireRole(req, ROLES)

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    // Só o caminho e o tipo do problema; nunca os valores enviados.
    logger.warn('invalid_input', { issues: result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })) })
    throw new HttpsError('invalid-argument', 'Confira os dados e tente novamente.')
  }
  return result.data
}

/** Identificador anônimo do aparelho que chamou (endereço de rede embaralhado; o endereço não é guardado). */
export function clientKey(req: CallableRequest<unknown>) {
  const forwarded = String(req.rawRequest?.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim()
  const ip = forwarded || req.rawRequest?.ip || 'desconhecido'
  return createHash('sha256').update(ip).digest('hex').slice(0, 24)
}

/** Limite de tentativas por chave numa janela de tempo. Grava em `rateLimits`, que o app não lê nem escreve. */
export async function rateLimit(key: string, action: string, max: number, windowMs: number) {
  const ref = db.collection('rateLimits').doc(`${key}_${action}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200))
  const now = Date.now()
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const hits = ((snap.get('hits') as number[] | undefined) ?? []).filter((t) => now - t < windowMs)
    if (hits.length >= max) return false
    tx.set(ref, { hits: [...hits, now], expiresAt: Timestamp.fromMillis(now + windowMs) })
    return true
  })
  if (!allowed) throw new HttpsError('resource-exhausted', 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.')
}

/** Registro das ações de administração, sem senhas nem dados pessoais além do login. */
export async function audit(event: string, data: Record<string, string | number | boolean | null | undefined>) {
  await db.collection('audit').add({ event, ...data, at: FieldValue.serverTimestamp() })
}
