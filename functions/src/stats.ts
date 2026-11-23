import { onCall } from 'firebase-functions/v2/https'
import { FieldValue } from 'firebase-admin/firestore'
import { db } from './lib/firebase'
import { clientKey, parse, rateLimit } from './lib/guard'
import { trackEventSchema } from './lib/schemas'
import { callableOptions } from './lib/options'
import { saoPauloNow } from './calls'

/**
 * Contadores anônimos do dia (`stats/{AAAA-MM-DD}`), para o painel: cardápios abertos por hora e por ambiente,
 * e respostas ao pedido de avaliação no Google. Nada identifica o cliente; só números somados.
 */
export const trackEvent = onCall(callableOptions, async (req) => {
  const { type, tableId } = parse(trackEventSchema, req.data)
  await rateLimit(clientKey(req), 'events', 60, 60 * 60 * 1000)
  const { date, hour } = saoPauloNow()
  let areaId: string | null = null
  if (tableId) {
    const t = await db.collection('tables').doc(tableId).get()
    if (!t.exists || t.get('active') !== true) return { ok: false }
    areaId = (t.get('areaId') as string | null | undefined) ?? null
  }
  const inc = FieldValue.increment(1)
  const data: Record<string, unknown> =
    type === 'menu_open'
      ? {
          menuOpens: inc,
          menuOpensByHour: { [String(hour)]: inc },
          ...(tableId ? { menuOpensWithTable: inc } : {}),
          ...(areaId ? { menuOpensByArea: { [areaId]: inc } } : {}),
        }
      : type === 'review_yes'
        ? { reviewYes: inc }
        : { reviewNo: inc }
  await db.collection('stats').doc(date).set({ date, ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { ok: true }
})
