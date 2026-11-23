import { afterAll, beforeAll, describe, it } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { ref, uploadBytes } from 'firebase/storage'
import { createEnv, staffToken } from './setup'

let env: RulesTestEnvironment
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

beforeAll(async () => {
  env = await createEnv()
})
afterAll(async () => {
  await env.cleanup()
})

describe('fotos do cardápio', () => {
  it('só gerente e ADM enviam fotos, e só imagens', async () => {
    const anon = env.unauthenticatedContext().storage()
    const waiter = env.authenticatedContext('w', staffToken('waiter')).storage()
    const manager = env.authenticatedContext('m', staffToken('manager')).storage()
    await assertFails(uploadBytes(ref(anon, 'menu/item1/a.png'), png, { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(waiter, 'menu/item1/a.png'), png, { contentType: 'image/png' }))
    await assertSucceeds(uploadBytes(ref(manager, 'menu/item1/a.png'), png, { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(manager, 'menu/item1/a.html'), png, { contentType: 'text/html' }))
    await assertFails(uploadBytes(ref(manager, 'outra-pasta/a.png'), png, { contentType: 'image/png' }))
  })

  it('arte de destaque: gerente e ADM enviam, só imagens', async () => {
    const anon = env.unauthenticatedContext().storage()
    const waiter = env.authenticatedContext('w', staffToken('waiter')).storage()
    const manager = env.authenticatedContext('m', staffToken('manager')).storage()
    await assertSucceeds(uploadBytes(ref(manager, 'banner/a.png'), png, { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(waiter, 'banner/a.png'), png, { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(anon, 'banner/a.png'), png, { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(manager, 'banner/a.svg'), png, { contentType: 'image/svg+xml' }))
  })

  it('foto do garçom: só o ADM envia', async () => {
    const admin = env.authenticatedContext('a', staffToken('admin')).storage()
    const manager = env.authenticatedContext('m', staffToken('manager')).storage()
    const waiter = env.authenticatedContext('w', staffToken('waiter')).storage()
    await assertSucceeds(uploadBytes(ref(admin, 'staff/w/f.png'), png, { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(manager, 'staff/w/f.png'), png, { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(waiter, 'staff/w/f.png'), png, { contentType: 'image/png' }))
  })
})
