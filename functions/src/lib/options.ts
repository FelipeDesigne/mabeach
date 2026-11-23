import type { CallableOptions } from 'firebase-functions/v2/https'

/** Região das funções: a mesma do banco (São Paulo). */
export const REGION = 'southamerica-east1'

/**
 * Sites que podem chamar as funções pelo navegador (CORS): o domínio próprio e os endereços do Firebase.
 * Outro domínio pode entrar em `functions/.env` como EXTRA_ORIGINS=https://dominio.com.br.
 * Isso vale só para navegadores; a proteção de verdade é o login e as permissões conferidas em cada função.
 */
const ALLOWED_ORIGINS = [
  'https://mabeach.com.br',
  'https://www.mabeach.com.br',
  'https://ma-beach.web.app',
  'https://ma-beach.firebaseapp.com',
  ...(process.env.EXTRA_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https:\/\/[a-z0-9.-]+$/i.test(s)),
]

/** App Check exigido só depois de configurado e conferido em modo de observação (APP_CHECK_ENFORCED=true). */
const appCheckEnforced = process.env.APP_CHECK_ENFORCED === 'true'

export const callableOptions: CallableOptions = {
  cors: process.env.FUNCTIONS_EMULATOR === 'true' ? true : ALLOWED_ORIGINS,
  enforceAppCheck: appCheckEnforced,
  consumeAppCheckToken: false,
  memory: '256MiB',
  timeoutSeconds: 30,
}

/** Login sem e-mail ("joao") vira um endereço interno, que nunca recebe mensagens. */
export const USERNAME_DOMAIN = 'equipe.ma-beach.web.app'
