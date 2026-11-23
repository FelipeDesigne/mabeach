import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'

/** Projeto fictício só para os testes: nunca toca no banco real. */
export const PROJECT_ID = 'demo-ma-beach'

export async function createEnv(): Promise<RulesTestEnvironment> {
  const [fh, fp] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')
  const [sh, sp] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199').split(':')
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: fh, port: Number(fp), rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
    storage: { host: sh, port: Number(sp), rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8') },
  })
}

/** Sessão de alguém da equipe (iat = agora, como uma sessão nova). */
export const staffToken = (role: 'admin' | 'manager' | 'waiter') => ({ role, iat: Math.floor(Date.now() / 1000) })
