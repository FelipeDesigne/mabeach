import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { logger } from 'firebase-functions/v2'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { db } from './lib/firebase'
import { clientKey, parse, rateLimit, requireRole } from './lib/guard'
import { attendCallSchema, callWaiterSchema, closeTableSchema } from './lib/schemas'
import { callableOptions, REGION } from './lib/options'
import { chooseRecipients, rotationKey, type Candidate, type Routing } from './lib/routing'
import { pushToRoles, pushToUids } from './lib/push'

export const DEFAULTS = { callCooldownMin: 5, routing: 'round_robin' as Routing, escalateAfterMin: 0, ownerAfterMin: 0, autoOffDutyHour: 5 }
/** Chamado esquecido aberto some do painel depois deste tempo. */
const EXPIRE_AFTER_MIN = 120

const tableName = (label: string) => (/^\d+$/.test(label) ? `Mesa ${label}` : label)

async function onDutyStaff(): Promise<Candidate[]> {
  const snap = await db.collection('staff').where('active', '==', true).where('onDuty', '==', true).get()
  const now = Date.now()
  // Em pausa: fora do rodízio até a pausa acabar (volta sozinho).
  return snap.docs
    .filter((d) => ((d.get('pausedUntil') as Timestamp | null | undefined)?.toMillis() ?? 0) <= now)
    .map((d) => ({
      uid: d.id,
      name: String(d.get('name') ?? ''),
      photoUrl: (d.get('photoUrl') as string | null) ?? null,
      areas: (d.get('areas') as string[] | undefined) ?? [],
    }))
}

/**
 * Situação de cada mesa para o mapa do balcão e para "Suas mesas" do garçom (`tableStatus/{mesa}`, só o servidor escreve):
 * - `calling`: chamando (pisca no mapa)
 * - `busy`: com um garçom, até alguém encerrar a mesa
 * - `free`: livre
 */
const statusRef = (tableId: string) => db.collection('tableStatus').doc(tableId)

/**
 * Cliente aperta "Chamar garçom" na mesa (sem login: o código da mesa vem do QR).
 * O servidor confere a mesa, o prazo entre chamadas da mesa e escolhe quem recebe (rodízio ou todos).
 */
export const callWaiter = onCall(callableOptions, async (req) => {
  const { tableId } = parse(callWaiterSchema, req.data)
  // Mesmo aparelho chamando em muitas mesas: limite geral por aparelho.
  await rateLimit(clientKey(req), 'call', 20, 60 * 60 * 1000)

  const [pub, ops, staff] = await Promise.all([
    db.doc('settings/public').get(),
    db.doc('settings/ops').get(),
    onDutyStaff(),
  ])
  const cooldownMs = Number(pub.get('callCooldownMin') ?? DEFAULTS.callCooldownMin) * 60 * 1000
  const routing = (ops.get('routing') as Routing | undefined) ?? DEFAULTS.routing

  const tableRef = db.collection('tables').doc(tableId)
  const stateRef = db.collection('tableState').doc(tableId)
  const rotationRef = db.doc('meta/rotation')
  const callRef = db.collection('calls').doc()

  const result = await db.runTransaction(async (tx) => {
    const [table, state, rotation, status] = await Promise.all([tx.get(tableRef), tx.get(stateRef), tx.get(rotationRef), tx.get(statusRef(tableId))])
    if (!table.exists || table.get('active') !== true) throw new HttpsError('not-found', 'Mesa não encontrada. Chame um garçom no salão.')
    const now = Date.now()
    const last = (state.get('lastCallAt') as Timestamp | undefined)?.toMillis() ?? 0
    if (now - last < cooldownMs) {
      throw new HttpsError('resource-exhausted', 'O garçom já foi chamado. Aguarde um pouco.', { retryAt: last + cooldownMs })
    }
    const areaId = (table.get('areaId') as string | null | undefined) ?? null
    const holderUid = status.get('status') !== 'free' ? ((status.get('holderUid') as string | null | undefined) ?? null) : null
    const key = rotationKey(areaId)
    const { recipients, assigned, sticky, rotate } = chooseRecipients({
      routing,
      candidates: staff,
      areaId,
      holderUid,
      lastUid: (rotation.get(key) as string | undefined) ?? null,
    })
    const label = String(table.get('label'))
    const stamp = Timestamp.fromMillis(now)
    // Mesa já em atendimento: o chamado entra na conta da mesma "visita" (para o painel).
    const sessionId = holderUid ? ((status.get('sessionId') as string | null | undefined) ?? null) : null
    if (sessionId) tx.set(db.collection('sessions').doc(sessionId), { calls: FieldValue.increment(1) }, { merge: true })
    tx.create(callRef, {
      sessionId,
      tableId,
      tableLabel: label,
      tableNumber: Number(table.get('number') ?? 0),
      areaId,
      status: 'open',
      routing: sticky ? 'holder' : routing,
      assignedTo: assigned?.uid ?? null,
      assignedName: assigned?.name ?? null,
      notified: recipients,
      noOneOnDuty: recipients.length === 0,
      escalated: false,
      ownerNotified: false,
      createdAt: stamp,
    })
    tx.set(stateRef, { lastCallAt: stamp, lastCallId: callRef.id })
    tx.set(
      statusRef(tableId),
      {
        status: 'calling',
        tableLabel: label,
        areaId,
        callId: callRef.id,
        callAt: stamp,
        assignedName: assigned?.name ?? null,
        holderUid: holderUid ?? null,
        holderName: holderUid ? ((status.get('holderName') as string | undefined) ?? null) : null,
        updatedAt: stamp,
      },
      { merge: true },
    )
    if (rotate && assigned) tx.set(rotationRef, { [key]: assigned.uid, at: stamp }, { merge: true })
    return { recipients, label, now, assigned }
  })

  const msg = { title: `${tableName(result.label)} chamando`, body: 'Toque para abrir os chamados.', url: '/garcom', tag: `call-${callRef.id}`, renotify: true }
  try {
    if (result.recipients.length) await pushToUids(result.recipients, msg)
    // Ninguém marcado "Em serviço": avisa a gerência para o chamado não se perder.
    else await pushToRoles(['admin', 'manager'], { ...msg, body: 'Ninguém está em serviço no momento.' })
  } catch (err) {
    // O chamado já está no painel; falha no aviso fica só no log.
    logger.error('push_failed', { callId: callRef.id, err: String(err) })
  }
  // Rodízio: o cliente vê quem vai atendê-lo (só o primeiro nome e a foto).
  const waiter = result.assigned ? { name: result.assigned.name.split(' ')[0], photoUrl: result.assigned.photoUrl ?? null } : null
  return { callId: callRef.id, retryAt: result.now + cooldownMs, waiter }
})

/**
 * Garçom (ou gerência) marca o chamado como atendido. Fica registrado quem atendeu e em quanto tempo,
 * e a mesa passa a ficar "com" essa pessoa até alguém encerrar a mesa.
 */
export const attendCall = onCall(callableOptions, async (req) => {
  const { uid } = await requireRole(req, ['admin', 'manager', 'waiter'])
  const { callId } = parse(attendCallSchema, req.data)
  const ref = db.collection('calls').doc(callId)
  const me = await db.collection('staff').doc(uid).get()
  const myName = String(me.get('name') ?? 'Equipe')

  const out = await db.runTransaction(async (tx) => {
    const call = await tx.get(ref)
    if (!call.exists) throw new HttpsError('not-found', 'Chamado não encontrado.')
    if (call.get('status') !== 'open') return { already: true, by: String(call.get('attendedByName') ?? ''), notified: [] as string[], label: '' }
    const created = (call.get('createdAt') as Timestamp).toMillis()
    const tableId = String(call.get('tableId'))
    const status = await tx.get(statusRef(tableId))
    tx.update(ref, {
      status: 'attended',
      attendedBy: uid,
      attendedByName: myName,
      attendedAt: FieldValue.serverTimestamp(),
      responseSec: Math.max(0, Math.round((Date.now() - created) / 1000)),
    })
    // Só mexe na situação da mesa se este for o chamado atual dela (um chamado antigo não desfaz o novo).
    if (!status.exists || status.get('callId') === callId) {
      // Começa uma "visita" (mesa atendida até ser encerrada), usada no painel: permanência, chamados por visita.
      let sessionId = (status.get('holderUid') ? (status.get('sessionId') as string | null | undefined) : null) ?? null
      if (!sessionId) {
        const sref = db.collection('sessions').doc()
        sessionId = sref.id
        tx.create(sref, {
          tableId,
          tableLabel: String(call.get('tableLabel')),
          areaId: (call.get('areaId') as string | null | undefined) ?? null,
          holderUid: uid,
          holderName: myName,
          startAt: Timestamp.fromMillis(created),
          calls: 1,
          endAt: null,
          durationMin: null,
          autoClosed: false,
        })
        tx.update(ref, { sessionId })
      }
      tx.set(
        statusRef(tableId),
        {
          sessionId,
          status: 'busy',
          tableLabel: String(call.get('tableLabel')),
          areaId: (call.get('areaId') as string | null | undefined) ?? null,
          callId: null,
          callAt: null,
          assignedName: null,
          holderUid: uid,
          holderName: myName,
          since: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    }
    return { already: false, by: myName, notified: (call.get('notified') as string[]) ?? [], label: String(call.get('tableLabel')) }
  })

  if (!out.already) {
    // Troca o aviso nos outros aparelhos por "atendida", sem tocar de novo.
    const others = out.notified.filter((u) => u !== uid)
    await pushToUids(others, { title: `${tableName(out.label)} atendida`, body: `Por ${out.by}.`, url: '/garcom', tag: `call-${callId}` }).catch(
      (err) => logger.warn('push_attended_failed', { callId, err: String(err) }),
    )
  }
  return { already: out.already, attendedByName: out.by }
})

/**
 * Encerra a mesa (o cliente foi embora): ela volta a ficar livre no mapa e o próximo chamado segue o modo normal.
 * Garçom encerra as mesas que estão com ele; gerência e balcão encerram qualquer mesa.
 */
export const closeTable = onCall(callableOptions, async (req) => {
  const { uid, role } = await requireRole(req, ['admin', 'manager', 'waiter', 'counter'])
  const { tableId } = parse(closeTableSchema, req.data)
  const ref = statusRef(tableId)
  await db.runTransaction(async (tx) => {
    const status = await tx.get(ref)
    if (!status.exists || status.get('status') === 'free') return
    if (role === 'waiter' && status.get('holderUid') !== uid) throw new HttpsError('permission-denied', 'Esta mesa está com outra pessoa.')
    const callId = status.get('callId') as string | null | undefined
    const sessionId = status.get('sessionId') as string | null | undefined
    const session = sessionId ? await tx.get(db.collection('sessions').doc(sessionId)) : null
    if (callId) {
      const call = await tx.get(db.collection('calls').doc(callId))
      if (call.exists && call.get('status') === 'open') tx.update(call.ref, { status: 'closed', closedAt: FieldValue.serverTimestamp(), closedBy: uid })
    }
    if (session?.exists && !session.get('endAt')) {
      const start = (session.get('startAt') as Timestamp).toMillis()
      tx.update(session.ref, { endAt: FieldValue.serverTimestamp(), durationMin: Math.max(0, Math.round((Date.now() - start) / 60000)), closedBy: uid })
    }
    tx.set(
      ref,
      { status: 'free', sessionId: null, callId: null, callAt: null, assignedName: null, holderUid: null, holderName: null, since: null, closedBy: uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
  })
  return { ok: true }
})

/** Data e hora de São Paulo (o servidor roda em UTC). */
export function saoPauloNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

/**
 * Uma vez por dia, no horário configurado (padrão 5h), tira todo mundo de "Em serviço".
 * Assim ninguém fica recebendo chamado em casa nem entra no rodízio sem estar no salão.
 */
async function autoOffDuty(hourSetting: number) {
  if (hourSetting < 0) return
  const { date, hour } = saoPauloNow()
  if (hour !== hourSetting) return
  const ref = db.doc('meta/autoOffDuty')
  if ((await ref.get()).get('date') === date) return
  const onDuty = await db.collection('staff').where('onDuty', '==', true).get()
  // Mesas esquecidas abertas: encerra e marca como "automático" (o painel não conta na permanência média).
  const openTables = await db.collection('tableStatus').where('status', 'in', ['busy', 'calling']).get()
  const batch = db.batch()
  onDuty.docs.forEach((d) => batch.update(d.ref, { onDuty: false, onDutyAt: FieldValue.serverTimestamp() }))
  for (const t of openTables.docs) {
    const sid = t.get('sessionId') as string | null | undefined
    if (sid) batch.set(db.collection('sessions').doc(sid), { endAt: FieldValue.serverTimestamp(), autoClosed: true }, { merge: true })
    batch.set(t.ref, { status: 'free', sessionId: null, callId: null, callAt: null, assignedName: null, holderUid: null, holderName: null, since: null, closedBy: 'auto', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  batch.set(ref, { date, count: onDuty.size, tablesClosed: openTables.size, at: FieldValue.serverTimestamp() })
  await batch.commit()
  logger.info('auto_off_duty', { count: onDuty.size, tables: openTables.size })
}

/**
 * A cada minuto: chamados sem resposta passam para toda a equipe em serviço e, se configurado, avisam o dono.
 * Chamados esquecidos abertos por muito tempo são encerrados para não poluir o painel.
 * Também faz o "fim do expediente" diário (todo mundo sai de "Em serviço").
 */
export const escalateCalls = onSchedule({ schedule: 'every 1 minutes', region: REGION, timeZone: 'America/Sao_Paulo', memory: '256MiB' }, async () => {
  const ops = await db.doc('settings/ops').get()
  await autoOffDuty(Number(ops.get('autoOffDutyHour') ?? DEFAULTS.autoOffDutyHour)).catch((err) => logger.error('auto_off_duty_failed', { err: String(err) }))
  const open = await db.collection('calls').where('status', '==', 'open').get()
  if (open.empty) return
  const escalateMin = Number(ops.get('escalateAfterMin') ?? DEFAULTS.escalateAfterMin)
  const ownerMin = Number(ops.get('ownerAfterMin') ?? DEFAULTS.ownerAfterMin)
  const now = Date.now()
  let team: Candidate[] | null = null

  for (const doc of open.docs) {
    const ageMin = (now - (doc.get('createdAt') as Timestamp).toMillis()) / 60000
    const label = String(doc.get('tableLabel'))
    if (ageMin >= EXPIRE_AFTER_MIN) {
      await doc.ref.update({ status: 'expired', expiredAt: FieldValue.serverTimestamp() })
      // Mesa parada "chamando" há horas: volta para "com o garçom" (se tinha) ou livre.
      const st = statusRef(String(doc.get('tableId')))
      const cur = await st.get()
      if (cur.get('callId') === doc.id) {
        await st.update({ status: cur.get('holderUid') ? 'busy' : 'free', callId: null, callAt: null, assignedName: null, updatedAt: FieldValue.serverTimestamp() })
      }
      continue
    }
    if (escalateMin > 0 && ageMin >= escalateMin && doc.get('escalated') !== true) {
      team ??= await onDutyStaff()
      const already = new Set((doc.get('notified') as string[]) ?? [])
      const extra = team.map((t) => t.uid).filter((u) => !already.has(u))
      await doc.ref.update({ escalated: true, ...(extra.length ? { notified: FieldValue.arrayUnion(...extra) } : {}) })
      await pushToUids(team.map((t) => t.uid), {
        title: `${tableName(label)} esperando`,
        body: `Chamado sem resposta há ${Math.floor(ageMin)} min.`,
        url: '/garcom',
        tag: `call-${doc.id}`,
        renotify: true,
      }).catch((err) => logger.warn('push_escalate_failed', { err: String(err) }))
    }
    if (ownerMin > 0 && ageMin >= ownerMin && doc.get('ownerNotified') !== true) {
      await doc.ref.update({ ownerNotified: true })
      await pushToRoles(['admin'], {
        title: `${tableName(label)} sem atendimento`,
        body: `Esperando há ${Math.floor(ageMin)} min.`,
        url: '/garcom',
        tag: `call-${doc.id}-dono`,
        renotify: true,
      }).catch((err) => logger.warn('push_owner_failed', { err: String(err) }))
    }
  }
})
