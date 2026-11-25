import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore'
import { createEnv, staffToken } from './setup'

let env: RulesTestEnvironment

const db = {
  anon: () => env.unauthenticatedContext().firestore(),
  // Conta logada sem função (ex.: alguém que criou conta por fora): não é da equipe.
  noRole: () => env.authenticatedContext('stranger', { iat: Math.floor(Date.now() / 1000) }).firestore(),
  waiter: () => env.authenticatedContext('waiter1', staffToken('waiter')).firestore(),
  waiter2: () => env.authenticatedContext('waiter2', staffToken('waiter')).firestore(),
  manager: () => env.authenticatedContext('manager1', staffToken('manager')).firestore(),
  admin: () => env.authenticatedContext('admin1', staffToken('admin')).firestore(),
  counter: () => env.authenticatedContext('counter1', { role: 'counter', iat: Math.floor(Date.now() / 1000) }).firestore(),
  /** Função que não existe mais (a antiga Cozinha): não pode ler nada da equipe. */
  oldRole: () => env.authenticatedContext('old1', { role: 'kitchen', iat: Math.floor(Date.now() / 1000) }).firestore(),
}

const item = (uid: string, extra: Record<string, unknown> = {}) => ({
  categoryId: 'cat1',
  name: 'Porção de batata',
  description: 'Serve 2 pessoas',
  price: 3290,
  photoPath: null,
  photoUrl: null,
  available: true,
  visible: true,
  order: 10,
  updatedAt: serverTimestamp(),
  updatedBy: uid,
  ...extra,
})

beforeAll(async () => {
  env = await createEnv()
})
afterAll(async () => {
  await env.cleanup()
})
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore()
    await setDoc(doc(f, 'categories/cat1'), { name: 'Porções', order: 10, visible: true })
    await setDoc(doc(f, 'categories/hidden'), { name: 'Rascunho', order: 20, visible: false })
    await setDoc(doc(f, 'items/visivel'), { ...item('admin1'), updatedAt: new Date() })
    await setDoc(doc(f, 'items/oculto'), { ...item('admin1', { visible: false }), updatedAt: new Date() })
    await setDoc(doc(f, 'tables/AbCdEf123456789xyz'), { label: '12', number: 12, active: true })
    await setDoc(doc(f, 'tables/Inativa1234567890xx'), { label: '13', number: 13, active: false })
    await setDoc(doc(f, 'calls/call1'), { tableId: 'AbCdEf123456789xyz', status: 'open' })
    await setDoc(doc(f, 'staff/waiter1'), { name: 'João', role: 'waiter', active: true, onDuty: false })
    await setDoc(doc(f, 'staff/waiter2'), { name: 'Maria', role: 'waiter', active: true, onDuty: false })
    await setDoc(doc(f, 'settings/public'), { callCooldownMin: 5 })
    await setDoc(doc(f, 'settings/ops'), { routing: 'round_robin', escalateAfterMin: 0, ownerAfterMin: 0, qrBaseUrl: '' })
    await setDoc(doc(f, 'rateLimits/x_call'), { hits: [] })
    await setDoc(doc(f, 'audit/a1'), { event: 'user_created' })
  })
})

describe('cardápio', () => {
  it('cliente lê só o que está visível', async () => {
    await assertSucceeds(getDocs(query(collection(db.anon(), 'items'), where('visible', '==', true))))
    await assertSucceeds(getDoc(doc(db.anon(), 'items/visivel')))
    await assertFails(getDoc(doc(db.anon(), 'items/oculto')))
    await assertFails(getDocs(collection(db.anon(), 'items')))
    await assertFails(getDoc(doc(db.anon(), 'categories/hidden')))
  })

  it('cliente e garçom não alteram o cardápio', async () => {
    await assertFails(setDoc(doc(db.anon(), 'items/novo'), item('x')))
    await assertFails(setDoc(doc(db.waiter(), 'items/novo'), item('waiter1')))
    await assertFails(updateDoc(doc(db.waiter(), 'items/visivel'), { available: false, updatedAt: serverTimestamp(), updatedBy: 'waiter1' }))
    await assertFails(deleteDoc(doc(db.noRole(), 'items/visivel')))
  })

  it('gerente e ADM editam o cardápio com dados válidos', async () => {
    await assertSucceeds(setDoc(doc(db.manager(), 'items/novo'), item('manager1')))
    await assertSucceeds(updateDoc(doc(db.admin(), 'items/visivel'), { available: false, updatedAt: serverTimestamp(), updatedBy: 'admin1' }))
    await assertSucceeds(getDocs(collection(db.manager(), 'items')))
  })

  it('recusa preço inválido, campo extra e autor trocado', async () => {
    await assertFails(setDoc(doc(db.admin(), 'items/a'), item('admin1', { price: -1 })))
    await assertFails(setDoc(doc(db.admin(), 'items/b'), item('admin1', { price: 12.5 })))
    await assertFails(setDoc(doc(db.admin(), 'items/c'), item('admin1', { hacker: true })))
    await assertFails(setDoc(doc(db.admin(), 'items/d'), item('outra-pessoa')))
    await assertFails(setDoc(doc(db.admin(), 'items/e'), item('admin1', { photoUrl: 'https://site-estranho.com/x.jpg', photoPath: 'menu/e/x.webp' })))
    await assertFails(setDoc(doc(db.admin(), 'items/f'), item('admin1', { photoPath: 'menu/outro-item/x.webp', photoUrl: null })))
  })
})

describe('destaques', () => {
  const banner = (uid: string, extra: Record<string, unknown> = {}) => ({
    imageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/banner%2Fa.webp',
    imagePath: 'banner/a.webp',
    visible: true,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    ...extra,
  })

  it('todo mundo vê a arte; só gerente e ADM trocam', async () => {
    await assertSucceeds(getDoc(doc(db.anon(), 'settings/banner')))
    await assertSucceeds(setDoc(doc(db.manager(), 'settings/banner'), banner('manager1')))
    await assertSucceeds(setDoc(doc(db.admin(), 'settings/banner'), banner('admin1', { imageUrl: null, imagePath: null, visible: false })))
    await assertFails(setDoc(doc(db.waiter(), 'settings/banner'), banner('waiter1')))
    await assertFails(setDoc(doc(db.anon(), 'settings/banner'), banner('x')))
    await assertFails(setDoc(doc(db.admin(), 'settings/banner'), banner('admin1', { imageUrl: 'https://site-estranho.com/a.jpg' })))
    await assertFails(setDoc(doc(db.admin(), 'settings/banner'), banner('admin1', { imagePath: 'menu/x/a.webp' })))
  })

  it('produto em destaque com preço de promoção menor que o normal', async () => {
    await assertSucceeds(updateDoc(doc(db.manager(), 'items/visivel'), { featured: true, promoPrice: 2990, updatedAt: serverTimestamp(), updatedBy: 'manager1' }))
    await assertSucceeds(updateDoc(doc(db.admin(), 'items/visivel'), { featured: true, promoPrice: null, updatedAt: serverTimestamp(), updatedBy: 'admin1' }))
    await assertFails(updateDoc(doc(db.admin(), 'items/visivel'), { promoPrice: 3290, updatedAt: serverTimestamp(), updatedBy: 'admin1' }))
    await assertFails(updateDoc(doc(db.admin(), 'items/visivel'), { promoPrice: -5, updatedAt: serverTimestamp(), updatedBy: 'admin1' }))
    await assertFails(updateDoc(doc(db.admin(), 'items/visivel'), { featured: 'sim', updatedAt: serverTimestamp(), updatedBy: 'admin1' }))
    await assertFails(updateDoc(doc(db.waiter(), 'items/visivel'), { featured: true, updatedAt: serverTimestamp(), updatedBy: 'waiter1' }))
  })
})

describe('função antiga (Cozinha, removida)', () => {
  it('não lê mesas, mapa, chamados nem pedidos, e não mexe no cardápio', async () => {
    await assertFails(getDocs(collection(db.oldRole(), 'tables')))
    await assertFails(getDocs(collection(db.oldRole(), 'tableStatus')))
    await assertFails(getDocs(collection(db.oldRole(), 'areas')))
    await assertFails(getDoc(doc(db.oldRole(), 'calls/call1')))
    await assertFails(getDocs(collection(db.oldRole(), 'orders')))
    await assertFails(setDoc(doc(db.oldRole(), 'items/novo'), item('old1')))
  })
})

describe('mesas', () => {
  it('cliente abre só a mesa do QR (ativa) e não lista as mesas', async () => {
    await assertSucceeds(getDoc(doc(db.anon(), 'tables/AbCdEf123456789xyz')))
    await assertFails(getDoc(doc(db.anon(), 'tables/Inativa1234567890xx')))
    await assertFails(getDocs(collection(db.anon(), 'tables')))
    await assertFails(getDocs(collection(db.noRole(), 'tables')))
    // O garçom lista as mesas para escolher a mesa do pedido.
    await assertSucceeds(getDocs(collection(db.waiter(), 'tables')))
  })

  it('só gerente e ADM criam e mudam mesas', async () => {
    const t = (uid: string) => ({ label: '14', number: 14, active: true, updatedAt: serverTimestamp(), updatedBy: uid })
    await assertFails(setDoc(doc(db.anon(), 'tables/Nova12345678901234'), t('x')))
    await assertFails(setDoc(doc(db.waiter(), 'tables/Nova12345678901234'), t('waiter1')))
    await assertSucceeds(setDoc(doc(db.manager(), 'tables/Nova12345678901234'), t('manager1')))
    await assertSucceeds(getDocs(collection(db.admin(), 'tables')))
  })
})

describe('chamados', () => {
  it('só a equipe vê os chamados e ninguém grava direto (só o servidor)', async () => {
    await assertFails(getDoc(doc(db.anon(), 'calls/call1')))
    await assertFails(getDoc(doc(db.noRole(), 'calls/call1')))
    await assertSucceeds(getDoc(doc(db.waiter(), 'calls/call1')))
    await assertFails(setDoc(doc(db.anon(), 'calls/falso'), { tableId: 'x', status: 'open' }))
    await assertFails(updateDoc(doc(db.waiter(), 'calls/call1'), { status: 'attended' }))
    await assertFails(updateDoc(doc(db.admin(), 'calls/call1'), { status: 'attended' }))
  })
})

describe('equipe', () => {
  it('garçom liga e desliga "Em serviço" só para si', async () => {
    await assertSucceeds(updateDoc(doc(db.waiter(), 'staff/waiter1'), { onDuty: true, onDutyAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db.waiter(), 'staff/waiter2'), { onDuty: true, onDutyAt: serverTimestamp() }))
  })

  it('garçom não muda a própria função nem lê os dados dos outros', async () => {
    await assertFails(updateDoc(doc(db.waiter(), 'staff/waiter1'), { role: 'admin' }))
    await assertFails(updateDoc(doc(db.waiter(), 'staff/waiter1'), { active: false, onDuty: true, onDutyAt: serverTimestamp() }))
    await assertSucceeds(getDoc(doc(db.waiter(), 'staff/waiter1')))
    await assertFails(getDoc(doc(db.waiter(), 'staff/waiter2')))
    await assertFails(getDocs(collection(db.manager(), 'staff')))
    await assertSucceeds(getDocs(collection(db.admin(), 'staff')))
  })

  it('foto do garçom: só o ADM coloca, e só no caminho certo', async () => {
    const photo = (uid: string, by: string) => ({
      photoPath: `staff/${uid}/f.webp`,
      photoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/f.webp',
      updatedAt: serverTimestamp(),
      updatedBy: by,
    })
    await assertSucceeds(updateDoc(doc(db.admin(), 'staff/waiter1'), photo('waiter1', 'admin1')))
    await assertFails(updateDoc(doc(db.waiter(), 'staff/waiter1'), photo('waiter1', 'waiter1')))
    await assertFails(updateDoc(doc(db.manager(), 'staff/waiter1'), photo('waiter1', 'manager1')))
    await assertFails(updateDoc(doc(db.admin(), 'staff/waiter1'), photo('outro', 'admin1')))
    await assertFails(updateDoc(doc(db.admin(), 'staff/waiter1'), { ...photo('waiter1', 'admin1'), role: 'admin' }))
  })

  it('pausa: o garçom pausa a si mesmo por até 30 minutos', async () => {
    const em = (min: number) => Timestamp.fromMillis(Date.now() + min * 60000)
    await assertSucceeds(updateDoc(doc(db.waiter(), 'staff/waiter1'), { pausedUntil: em(15) }))
    await assertSucceeds(updateDoc(doc(db.waiter(), 'staff/waiter1'), { pausedUntil: null }))
    await assertFails(updateDoc(doc(db.waiter(), 'staff/waiter1'), { pausedUntil: em(120) }))
    await assertFails(updateDoc(doc(db.waiter(), 'staff/waiter1'), { pausedUntil: em(-5) }))
    await assertFails(updateDoc(doc(db.waiter2(), 'staff/waiter1'), { pausedUntil: em(15) }))
  })

  it('troca obrigatória de senha: a pessoa só desliga o aviso dela', async () => {
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'staff/waiter1'), { mustChangePassword: true }))
    await assertFails(updateDoc(doc(db.waiter(), 'staff/waiter1'), { mustChangePassword: false, role: 'admin' }))
    await assertFails(updateDoc(doc(db.waiter2(), 'staff/waiter1'), { mustChangePassword: false }))
    await assertSucceeds(updateDoc(doc(db.waiter(), 'staff/waiter1'), { mustChangePassword: false }))
    await assertFails(updateDoc(doc(db.waiter(), 'staff/waiter1'), { mustChangePassword: true }))
  })

  it('ninguém cria cadastro da equipe pelo app (só o servidor)', async () => {
    await assertFails(setDoc(doc(db.admin(), 'staff/novo'), { name: 'X', role: 'admin', active: true, onDuty: false }))
    await assertFails(setDoc(doc(db.noRole(), 'staff/stranger'), { name: 'X', role: 'admin', active: true, onDuty: false }))
  })

  it('aparelhos para avisos: cada um só no próprio cadastro', async () => {
    const dev = { token: 'x'.repeat(40), platform: 'android', updatedAt: serverTimestamp() }
    await assertSucceeds(setDoc(doc(db.waiter(), 'staff/waiter1/devices/d1'), dev))
    await assertFails(setDoc(doc(db.waiter(), 'staff/waiter2/devices/d1'), dev))
    await assertFails(getDoc(doc(db.waiter2(), 'staff/waiter1/devices/d1')))
    await assertFails(setDoc(doc(db.noRole(), 'staff/stranger/devices/d1'), dev))
  })

  it('sessão aberta antes de mudar a função perde o acesso na hora', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'sessionRevocations/manager1'), { at: Math.floor(Date.now() / 1000) + 60 }))
    await assertFails(getDocs(collection(db.manager(), 'items')))
  })
})

describe('configurações', () => {
  const pub = (uid: string, extra = {}) => ({ callCooldownMin: 5, googleReviewUrl: '', instagramUrl: '', updatedAt: serverTimestamp(), updatedBy: uid, ...extra })
  const ops = (uid: string, extra = {}) => ({ routing: 'all', escalateAfterMin: 2, ownerAfterMin: 5, qrBaseUrl: 'https://mabeach.com.br', updatedAt: serverTimestamp(), updatedBy: uid, ...extra })

  it('todo mundo lê as públicas; só a equipe lê as de distribuição', async () => {
    await assertSucceeds(getDoc(doc(db.anon(), 'settings/public')))
    await assertFails(getDoc(doc(db.anon(), 'settings/ops')))
    await assertSucceeds(getDoc(doc(db.waiter(), 'settings/ops')))
  })

  it('só o ADM altera, com valores válidos', async () => {
    await assertFails(setDoc(doc(db.manager(), 'settings/public'), pub('manager1')))
    await assertFails(setDoc(doc(db.waiter(), 'settings/ops'), ops('waiter1')))
    await assertSucceeds(setDoc(doc(db.admin(), 'settings/public'), pub('admin1')))
    await assertSucceeds(setDoc(doc(db.admin(), 'settings/ops'), ops('admin1')))
    await assertFails(setDoc(doc(db.admin(), 'settings/public'), pub('admin1', { callCooldownMin: 0 })))
    await assertFails(setDoc(doc(db.admin(), 'settings/public'), pub('admin1', { googleReviewUrl: 'javascript:alert(1)' })))
    await assertSucceeds(setDoc(doc(db.admin(), 'settings/public'), pub('admin1', { askReviewAfterCall: false })))
    await assertFails(setDoc(doc(db.admin(), 'settings/public'), pub('admin1', { askReviewAfterCall: 'sim' })))
    await assertFails(setDoc(doc(db.admin(), 'settings/ops'), ops('admin1', { routing: 'aleatorio' })))
    await assertSucceeds(setDoc(doc(db.admin(), 'settings/ops'), ops('admin1', { autoOffDutyHour: 5 })))
    await assertSucceeds(setDoc(doc(db.admin(), 'settings/ops'), ops('admin1', { autoOffDutyHour: -1 })))
    await assertFails(setDoc(doc(db.admin(), 'settings/ops'), ops('admin1', { autoOffDutyHour: 24 })))
    await assertFails(setDoc(doc(db.admin(), 'settings/ops'), ops('admin1', { qrBaseUrl: 'http://inseguro.com' })))
  })
})

describe('ambientes, mapa e balcão', () => {
  const area = (uid: string, extra = {}) => ({ name: 'Varanda', order: 10, walls: [{ x1: 0, y1: 0, x2: 100, y2: 0 }], updatedAt: serverTimestamp(), updatedBy: uid, ...extra })

  it('gerência cria ambientes; garçom e balcão só leem', async () => {
    await assertSucceeds(setDoc(doc(db.manager(), 'areas/varanda'), area('manager1')))
    await assertFails(setDoc(doc(db.waiter(), 'areas/x'), area('waiter1')))
    await assertFails(setDoc(doc(db.counter(), 'areas/x'), area('counter1')))
    await assertSucceeds(getDoc(doc(db.waiter(), 'areas/varanda')))
    await assertSucceeds(getDoc(doc(db.counter(), 'areas/varanda')))
    await assertFails(getDoc(doc(db.anon(), 'areas/varanda')))
    await assertFails(setDoc(doc(db.manager(), 'areas/y'), area('manager1', { hacker: 1 })))
    await assertSucceeds(setDoc(doc(db.manager(), 'areas/deck'), area('manager1', { floor: 'deck' })))
    await assertFails(setDoc(doc(db.manager(), 'areas/z'), area('manager1', { floor: 'lava' })))
  })

  it('mesa com ambiente e posição no mapa', async () => {
    const t = (extra = {}) => ({ label: '20', number: 20, active: true, areaId: 'varanda', x: 120, y: 80.5, shape: 'round', updatedAt: serverTimestamp(), updatedBy: 'manager1', ...extra })
    await assertSucceeds(setDoc(doc(db.manager(), 'tables/ComMapa1234567890ab'), t()))
    await assertFails(setDoc(doc(db.manager(), 'tables/ComMapa1234567890ac'), t({ x: -5 })))
    await assertFails(setDoc(doc(db.manager(), 'tables/ComMapa1234567890ad'), t({ shape: 'estrela' })))
  })

  it('balcão lista as mesas e vê a situação delas, mas não escreve', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'tableStatus/AbCdEf123456789xyz'), { status: 'calling' }))
    await assertSucceeds(getDocs(collection(db.counter(), 'tables')))
    await assertSucceeds(getDoc(doc(db.counter(), 'tableStatus/AbCdEf123456789xyz')))
    await assertSucceeds(getDoc(doc(db.waiter(), 'tableStatus/AbCdEf123456789xyz')))
    await assertFails(getDoc(doc(db.anon(), 'tableStatus/AbCdEf123456789xyz')))
    await assertFails(setDoc(doc(db.counter(), 'tableStatus/AbCdEf123456789xyz'), { status: 'free' }))
    await assertFails(setDoc(doc(db.admin(), 'tableStatus/AbCdEf123456789xyz'), { status: 'free' }))
    await assertFails(updateDoc(doc(db.counter(), 'tables/AbCdEf123456789xyz'), { active: false, updatedAt: serverTimestamp(), updatedBy: 'counter1' }))
  })

  it('balcão não entra no rodízio nem lê chamados', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'staff/counter1'), { name: 'Balcão', role: 'counter', active: true, onDuty: false }))
    await assertFails(updateDoc(doc(db.counter(), 'staff/counter1'), { onDuty: true, onDutyAt: serverTimestamp() }))
    await assertFails(getDoc(doc(db.counter(), 'calls/call1')))
  })

  it('ambientes do garçom: só o ADM define', async () => {
    const a = (by: string) => ({ areas: ['varanda'], updatedAt: serverTimestamp(), updatedBy: by })
    await assertSucceeds(updateDoc(doc(db.admin(), 'staff/waiter1'), a('admin1')))
    await assertFails(updateDoc(doc(db.waiter(), 'staff/waiter1'), a('waiter1')))
    await assertFails(updateDoc(doc(db.manager(), 'staff/waiter1'), a('manager1')))
  })
})

describe('painel', () => {
  it('só ADM e gerente leem visitas e contadores; ninguém escreve pelo app', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'sessions/s1'), { tableId: 'x', calls: 1 })
      await setDoc(doc(ctx.firestore(), 'stats/2026-12-12'), { menuOpens: 10 })
    })
    await assertSucceeds(getDoc(doc(db.admin(), 'sessions/s1')))
    await assertSucceeds(getDoc(doc(db.manager(), 'stats/2026-12-12')))
    await assertFails(getDoc(doc(db.waiter(), 'sessions/s1')))
    await assertFails(getDoc(doc(db.counter(), 'stats/2026-12-12')))
    await assertFails(getDoc(doc(db.anon(), 'stats/2026-12-12')))
    await assertFails(setDoc(doc(db.admin(), 'stats/2026-12-12'), { menuOpens: 9999 }))
    await assertFails(setDoc(doc(db.anon(), 'stats/2026-12-13'), { menuOpens: 1 }))
  })
})

describe('controle interno', () => {
  it('limites e auditoria ficam fora do alcance do app', async () => {
    await assertFails(getDoc(doc(db.admin(), 'rateLimits/x_call')))
    await assertFails(setDoc(doc(db.anon(), 'rateLimits/x_call'), { hits: [] }))
    await assertFails(getDoc(doc(db.admin(), 'audit/a1')))
    await assertFails(getDoc(doc(db.admin(), 'invites/qualquer')))
    await assertFails(setDoc(doc(db.anon(), 'invites/qualquer'), { uid: 'admin1' }))
    await assertFails(setDoc(doc(db.admin(), 'meta/rotation'), { lastUid: 'admin1' }))
  })
})
