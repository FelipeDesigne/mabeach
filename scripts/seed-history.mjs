/**
 * Histórico FALSO de 30 dias para testar o painel de Relatórios nos EMULADORES (nunca no banco real).
 * Rode depois do seed-emulator.mjs: node scripts/seed-history.mjs
 * Padrão gerado: mais movimento à noite (pico 20h) e no fim de semana (sábado o dia mais forte).
 */
import { createRequire } from 'node:module'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
initializeApp({ projectId: 'demo-ma-beach' })
const db = getFirestore()

let seed = 42
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const pick = (a) => a[Math.floor(rand() * a.length)]

const tables = [1, 2, 3, 4].map((n) => ({ id: `TesteMesa0${n}abcdefgh`, label: String(n), areaId: n <= 3 ? 'salao' : 'varanda' }))
const waiters = [
  { uid: 'w-joao', name: 'João', speed: 70 },
  { uid: 'w-maria', name: 'Maria', speed: 110 },
  { uid: 'w-pedro', name: 'Pedro', speed: 160 },
]
// Peso por hora (aberto das 11h às 23h) e por dia da semana (0 = domingo).
const hourW = { 11: 2, 12: 5, 13: 5, 14: 2, 15: 1, 16: 1, 17: 2, 18: 4, 19: 6, 20: 8, 21: 7, 22: 4, 23: 2 }
const dayW = [6, 2, 2, 3, 4, 7, 9]

let batch = db.batch()
let ops = 0
const flush = async () => {
  if (ops) await batch.commit()
  batch = db.batch()
  ops = 0
}
const add = async (ref, data) => {
  batch.set(ref, data)
  if (++ops >= 400) await flush()
}

let totalCalls = 0
for (let back = 29; back >= 0; back--) {
  const day = new Date()
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() - back)
  const wd = day.getDay()
  const stats = { menuOpens: 0, menuOpensByHour: {}, menuOpensByArea: {}, reviewYes: 0, reviewNo: 0 }
  for (const [h, w] of Object.entries(hourW)) {
    const n = Math.round(w * dayW[wd] * 0.25 * (0.6 + rand() * 0.8))
    for (let i = 0; i < n; i++) {
      const t = pick(tables)
      const waiter = pick(waiters)
      const at = new Date(day)
      at.setHours(Number(h), Math.floor(rand() * 60))
      const resp = Math.round(waiter.speed * (0.5 + rand()))
      const status = rand() < 0.05 ? 'expired' : 'attended'
      const sref = db.collection('sessions').doc()
      await add(db.collection('calls').doc(), {
        tableId: t.id, tableLabel: t.label, tableNumber: Number(t.label), areaId: t.areaId, status, routing: 'round_robin',
        assignedTo: waiter.uid, assignedName: waiter.name, notified: [waiter.uid], noOneOnDuty: false, escalated: status === 'expired',
        ownerNotified: false, createdAt: Timestamp.fromDate(at),
        ...(status === 'attended' ? { attendedBy: waiter.uid, attendedByName: waiter.name, responseSec: resp, sessionId: sref.id } : {}),
      })
      totalCalls++
      if (status === 'attended' && rand() < 0.6) {
        const dur = Math.round(40 + rand() * 110)
        await add(sref, {
          tableId: t.id, tableLabel: t.label, areaId: t.areaId, holderUid: waiter.uid, holderName: waiter.name,
          startAt: Timestamp.fromDate(at), calls: 1 + Math.floor(rand() * 3), endAt: Timestamp.fromDate(new Date(at.getTime() + dur * 60000)),
          durationMin: dur, autoClosed: false,
        })
      }
      const opens = 1 + Math.floor(rand() * 3)
      stats.menuOpens += opens
      stats.menuOpensByHour[h] = (stats.menuOpensByHour[h] ?? 0) + opens
      stats.menuOpensByArea[t.areaId] = (stats.menuOpensByArea[t.areaId] ?? 0) + opens
      if (rand() < 0.3) stats[rand() < 0.4 ? 'reviewYes' : 'reviewNo']++
    }
  }
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  await add(db.collection('stats').doc(key), { date: key, ...stats })
}
await flush()
console.log(`Histórico de teste: ${totalCalls} chamados em 30 dias.`)
process.exit(0)
