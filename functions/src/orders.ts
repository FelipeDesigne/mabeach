import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'
import { FieldValue, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore'
import { db } from './lib/firebase'
import { audit, parse, rateLimit, requireRole } from './lib/guard'
import { createOrderSchema, orderStatusSchema } from './lib/schemas'
import { callableOptions } from './lib/options'
import { pushToUids } from './lib/push'
import { saoPauloNow } from './calls'

const tableName = (label: string) => (/^\d+$/.test(label) ? `Mesa ${label}` : label)

/**
 * Comanda: o garçom anota o pedido da mesa e envia para a cozinha (`orders/{id}`, só o servidor escreve).
 * O app manda só a mesa, os itens e as quantidades; nome e preço vêm do cardápio no servidor.
 * Se a mesa estava livre, ela passa a ficar com este garçom (como ao atender um chamado).
 */
export const createOrder = onCall(callableOptions, async (req) => {
  const { uid } = await requireRole(req, ['admin', 'manager', 'waiter'])
  const { tableId, lines, note } = parse(createOrderSchema, req.data)
  await rateLimit(uid, 'order', 120, 60 * 60 * 1000)

  const me = await db.collection('staff').doc(uid).get()
  const myName = String(me.get('name') ?? 'Equipe')
  const ids = [...new Set(lines.map((l) => l.itemId))]
  const itemDocs = await db.getAll(...ids.map((i) => db.collection('items').doc(i)))
  const items = new Map<string, DocumentSnapshot>(itemDocs.map((d) => [d.id, d]))

  const out = lines.map((l) => {
    const it = items.get(l.itemId)
    if (!it?.exists || it.get('visible') !== true) throw new HttpsError('failed-precondition', 'Um dos itens saiu do cardápio. Confira o pedido.')
    if (it.get('available') !== true) throw new HttpsError('failed-precondition', `${String(it.get('name'))} está esgotado. Tire do pedido.`)
    const promo = it.get('promoPrice') as number | null | undefined
    const unitPrice = typeof promo === 'number' ? promo : Number(it.get('price') ?? 0)
    return { itemId: it.id, name: String(it.get('name')), qty: l.qty, unitPrice, note: l.note ?? '' }
  })
  const total = out.reduce((s, l) => s + l.qty * l.unitPrice, 0)

  const { date } = saoPauloNow()
  const tableRef = db.collection('tables').doc(tableId)
  const statusRef = db.collection('tableStatus').doc(tableId)
  const seqRef = db.collection('meta').doc(`orders_${date}`)
  const orderRef = db.collection('orders').doc()

  const result = await db.runTransaction(async (tx) => {
    const [table, status, seq] = await Promise.all([tx.get(tableRef), tx.get(statusRef), tx.get(seqRef)])
    if (!table.exists || table.get('active') !== true) throw new HttpsError('not-found', 'Mesa não encontrada.')
    const label = String(table.get('label'))
    const areaId = (table.get('areaId') as string | null | undefined) ?? null
    const number = Number(seq.get('count') ?? 0) + 1
    const now = Timestamp.now()

    // Mesa que já está com alguém continua com essa pessoa; mesa livre passa a ficar com quem anotou.
    let holderUid = (status.get('holderUid') as string | null | undefined) ?? null
    let sessionId = holderUid ? ((status.get('sessionId') as string | null | undefined) ?? null) : null
    if (!holderUid || !sessionId) {
      const sref = db.collection('sessions').doc()
      sessionId = sref.id
      holderUid = uid
      tx.create(sref, {
        tableId, tableLabel: label, areaId, holderUid: uid, holderName: myName,
        startAt: now, calls: 0, endAt: null, durationMin: null, autoClosed: false,
      })
      tx.set(
        statusRef,
        {
          sessionId,
          // Mesa chamando continua piscando até alguém atender o chamado.
          status: status.get('status') === 'calling' ? 'calling' : 'busy',
          tableLabel: label,
          areaId,
          holderUid: uid,
          holderName: myName,
          since: now,
          updatedAt: now,
        },
        { merge: true },
      )
    }
    tx.set(db.collection('sessions').doc(sessionId), { orders: FieldValue.increment(1), ordersTotal: FieldValue.increment(total) }, { merge: true })
    tx.set(seqRef, { count: number, date }, { merge: true })
    tx.create(orderRef, {
      number,
      date,
      tableId,
      tableLabel: label,
      areaId,
      sessionId,
      waiterUid: uid,
      waiterName: myName,
      lines: out,
      note: note ?? '',
      total,
      status: 'new',
      createdAt: now,
      readyAt: null,
      deliveredAt: null,
      canceledAt: null,
    })
    return { number, label }
  })
  logger.info('order_created', { orderId: orderRef.id, lines: out.length })
  return { orderId: orderRef.id, number: result.number }
})

/**
 * Andamento do pedido:
 * - `ready`: a cozinha terminou (avisa o garçom que anotou)
 * - `delivered`: o garçom levou à mesa
 * - `canceled`: o garçom que anotou (ou a gerência) cancela; a cozinha vê e imprime o cancelamento
 */
export const setOrderStatus = onCall(callableOptions, async (req) => {
  const { uid, role } = await requireRole(req, ['admin', 'manager', 'waiter', 'kitchen'])
  const { orderId, status } = parse(orderStatusSchema, req.data)
  await rateLimit(uid, 'orderStatus', 600, 60 * 60 * 1000)
  const ref = db.collection('orders').doc(orderId)
  const manager = role === 'admin' || role === 'manager'

  const out = await db.runTransaction(async (tx) => {
    const order = await tx.get(ref)
    if (!order.exists) throw new HttpsError('not-found', 'Pedido não encontrado.')
    const cur = String(order.get('status'))
    const owner = order.get('waiterUid') === uid
    if (status === 'ready') {
      if (!manager && role !== 'kitchen') throw new HttpsError('permission-denied', 'Acesso restrito.')
      if (cur !== 'new') return { changed: false, order }
      tx.update(ref, { status: 'ready', readyAt: FieldValue.serverTimestamp(), readyBy: uid })
    } else if (status === 'delivered') {
      if (role === 'kitchen') throw new HttpsError('permission-denied', 'Acesso restrito.')
      if (cur !== 'new' && cur !== 'ready') return { changed: false, order }
      tx.update(ref, { status: 'delivered', deliveredAt: FieldValue.serverTimestamp(), deliveredBy: uid })
    } else {
      if (!manager && !(role === 'waiter' && owner)) throw new HttpsError('permission-denied', 'Só quem anotou o pedido ou a gerência pode cancelar.')
      if (cur === 'canceled') return { changed: false, order }
      if (cur === 'delivered' && !manager) throw new HttpsError('failed-precondition', 'Pedido já entregue. Peça para a gerência cancelar.')
      tx.update(ref, { status: 'canceled', canceledAt: FieldValue.serverTimestamp(), canceledBy: uid })
      const sid = order.get('sessionId') as string | null | undefined
      if (sid) tx.set(db.collection('sessions').doc(sid), { orders: FieldValue.increment(-1), ordersTotal: FieldValue.increment(-Number(order.get('total') ?? 0)) }, { merge: true })
    }
    return { changed: true, order }
  })

  if (out.changed && status === 'ready') {
    const label = String(out.order.get('tableLabel'))
    await pushToUids([String(out.order.get('waiterUid'))], {
      title: `Pedido da ${tableName(label)} pronto`,
      body: `Pedido nº ${out.order.get('number')}. Pode buscar na cozinha.`,
      url: '/garcom',
      tag: `order-${orderId}`,
      renotify: true,
    }).catch((err) => logger.warn('push_order_ready_failed', { orderId, err: String(err) }))
  }
  if (out.changed && status === 'canceled') await audit('order_canceled', { by: uid, orderId, total: Number(out.order.get('total') ?? 0) })
  return { ok: true, changed: out.changed }
})
