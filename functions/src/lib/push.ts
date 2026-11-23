import { getMessaging } from 'firebase-admin/messaging'
import type { DocumentReference } from 'firebase-admin/firestore'
import { db } from './firebase'
import type { Role } from './guard'

export type PushMessage = {
  title: string
  body: string
  /** Caminho aberto ao tocar no aviso (ex.: /garcom). */
  url: string
  /** Avisos com a mesma tag substituem o anterior no aparelho (ex.: o mesmo chamado). */
  tag?: string
  /** "1" faz o aparelho tocar de novo mesmo substituindo um aviso com a mesma tag. */
  renotify?: boolean
}

type Device = { token: string; ref: DocumentReference }

const INVALID_TOKEN = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'])

/**
 * Envia como mensagem de dados (o service worker monta o aviso) e com urgência alta, para chegar
 * mesmo com o celular em economia de bateria. Aparelhos que desinstalaram ou revogaram a permissão são apagados.
 */
async function send(devices: Device[], msg: PushMessage) {
  const unique = [...new Map(devices.map((d) => [d.token, d])).values()]
  let sent = 0
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500)
    const res = await getMessaging().sendEachForMulticast({
      tokens: chunk.map((d) => d.token),
      data: { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag ?? '', renotify: msg.renotify ? '1' : '' },
      // Um chamado velho não serve para nada: se o aparelho estiver desligado, desiste em 10 minutos.
      webpush: { headers: { Urgency: 'high', TTL: String(10 * 60) } },
    })
    sent += res.successCount
    await Promise.all(
      res.responses.map((r, j) => (!r.success && r.error && INVALID_TOKEN.has(r.error.code) ? chunk[j].ref.delete().catch(() => undefined) : undefined)),
    )
  }
  return sent
}

async function devicesOf(uids: string[]): Promise<Device[]> {
  const lists = await Promise.all(
    [...new Set(uids)].map(async (uid) =>
      (await db.collection('staff').doc(uid).collection('devices').get()).docs.map((d) => ({ token: d.get('token') as string, ref: d.ref })),
    ),
  )
  return lists.flat()
}

/** Aviso para pessoas específicas da equipe. */
export async function pushToUids(uids: string[], msg: PushMessage) {
  if (!uids.length) return 0
  return send(await devicesOf(uids), msg)
}

/** Aviso para quem tem uma das funções (só contas ativas). */
export async function pushToRoles(roles: Role[], msg: PushMessage) {
  const snap = await db.collection('staff').where('active', '==', true).where('role', 'in', roles).get()
  return pushToUids(
    snap.docs.map((d) => d.id),
    msg,
  )
}
