/**
 * Dados de teste para os EMULADORES locais (nunca roda no banco real: exige o projeto demo-ma-beach).
 * Uso (com `npm run emulators` rodando em outro terminal): node scripts/seed-emulator.mjs
 *
 * Contas de teste (só existem no emulador):
 *   admin / teste1234  (ADM)
 *   joao  / teste1234  (Garçom)
 *   maria / teste1234  (Garçom)
 *   balcao / teste1234 (Balcão)
 */
import { createRequire } from 'node:module'

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'
const projectId = 'demo-ma-beach'

const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')

initializeApp({ projectId })
const auth = getAuth()
const db = getFirestore()
const DOMAIN = 'equipe.ma-beach.web.app'

async function user(login, name, role, onDuty = false, areas = []) {
  const email = `${login}@${DOMAIN}`
  const existing = await auth.getUserByEmail(email).catch(() => null)
  const u = existing ?? (await auth.createUser({ email, password: 'teste1234', displayName: name }))
  await auth.setCustomUserClaims(u.uid, { role })
  await db.doc(`staff/${u.uid}`).set({ name, login, role, active: true, onDuty, areas, createdAt: FieldValue.serverTimestamp() })
  return u.uid
}

const admin = await user('admin', 'Marco', 'admin')
await user('joao', 'João', 'waiter', true, ['salao'])
await user('maria', 'Maria', 'waiter', true, ['varanda'])
await user('balcao', 'Balcão', 'counter')

const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: admin }
const cats = [
  ['porcoes', 'Porções', 10],
  ['lanches', 'Lanches', 20],
  ['bebidas', 'Bebidas', 30],
]
for (const [id, name, order] of cats) await db.doc(`categories/${id}`).set({ name, order, visible: true, ...stamp })

const items = [
  ['batata', 'porcoes', 'Batata frita', 'Porção de 500 g com cheddar e bacon. Serve 2 pessoas.', 3490],
  ['calabresa', 'porcoes', 'Calabresa acebolada', 'Com pão. Serve 2 a 3 pessoas.', 4290],
  ['tilapia', 'porcoes', 'Isca de tilápia', 'Com molho tártaro.', 5890],
  ['xburger', 'lanches', 'X-Burguer', 'Pão, hambúrguer 150 g, queijo e salada.', 2890],
  ['xtudo', 'lanches', 'X-Tudo', 'Hambúrguer, ovo, bacon, presunto, queijo e salada.', 3590],
  ['refri', 'bebidas', 'Refrigerante lata', 'Coca-Cola, Guaraná ou Fanta.', 690],
  ['chopp', 'bebidas', 'Chopp 300 ml', '', 1290],
  ['agua', 'bebidas', 'Água mineral', 'Com ou sem gás.', 450],
]
let order = 10
for (const [id, categoryId, name, description, price] of items) {
  await db.doc(`items/${id}`).set({
    categoryId, name, description, price, photoPath: null, photoUrl: null,
    available: id !== 'tilapia', visible: true, order: (order += 10), ...stamp,
  })
}

// Ambientes de teste: Salão (mesas 1 a 3, no mapa) e Varanda (mesas 4 e 5, a 5 fora do mapa).
await db.doc('areas/salao').set({ name: 'Salão', order: 10, fills: [{ x: 300, y: 300, floor: 'cimento' }, { x: 800, y: 150, floor: 'porcelanato' }], walls: [
  { x1: 40, y1: 40, x2: 960, y2: 40 }, { x1: 960, y1: 40, x2: 960, y2: 560 },
  { x1: 960, y1: 560, x2: 40, y2: 560, openings: [{ kind: 'door', t: 0.5, w: 60, flip: 1 }] }, { x1: 40, y1: 560, x2: 40, y2: 40, openings: [{ kind: 'window', t: 0.5, w: 120 }] },
  { x1: 600, y1: 40, x2: 600, y2: 300 }, { x1: 600, y1: 300, x2: 960, y2: 300, openings: [{ kind: 'door', t: 0.3, w: 50 }] },
], ...stamp })
await db.doc('areas/varanda').set({ name: 'Varanda', order: 20, floor: 'deck', walls: [{ x1: 40, y1: 520, x2: 960, y2: 520 }], ...stamp })
const pos = { 1: [200, 200, 'round'], 2: [380, 200, 'square'], 3: [300, 420, 'round'], 4: [300, 300, 'round'] }
for (let n = 1; n <= 5; n++) {
  const [x, y, shape] = pos[n] ?? [null, null, 'round']
  await db.doc(`tables/TesteMesa${String(n).padStart(2, '0')}abcdefgh`).set({
    label: String(n), number: n, active: true, areaId: n <= 3 ? 'salao' : 'varanda', x, y, shape, ...stamp,
  })
}
await db.doc('settings/public').set({ callCooldownMin: 5, googleReviewUrl: '', instagramUrl: '', ...stamp })
await db.doc('settings/ops').set({ routing: 'round_robin', escalateAfterMin: 0, ownerAfterMin: 0, qrBaseUrl: '', ...stamp })

console.log('Pronto. Mesa 1 de teste: /m/TesteMesa01abcdefgh')
process.exit(0)
