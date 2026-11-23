/**
 * Cria o .env.local a partir do arquivo de configuração copiado do Console do Firebase
 * ("credenciasi do firebase.txt", que fica fora do Git). Só identificadores públicos.
 * Uso: node scripts/make-env.cjs
 */
const fs = require('fs')
const src = process.argv[2] || 'credenciasi do firebase.txt'
const t = fs.readFileSync(src, 'utf8')
const g = (k) => (t.match(new RegExp(k + '\\s*:\\s*"([^"]+)"')) || [])[1] || ''
const keys = {
  API_KEY: 'apiKey',
  AUTH_DOMAIN: 'authDomain',
  PROJECT_ID: 'projectId',
  STORAGE_BUCKET: 'storageBucket',
  MESSAGING_SENDER_ID: 'messagingSenderId',
  APP_ID: 'appId',
}
const old = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : ''
const keep = (name, fallback) => (old.match(new RegExp('^' + name + '=(.*)$', 'm')) || [])[1] || fallback
let env = ''
for (const [k, v] of Object.entries(keys)) env += `VITE_FIREBASE_${k}=${g(v)}\n`
env += `VITE_FIREBASE_VAPID_KEY=${keep('VITE_FIREBASE_VAPID_KEY', '')}\n`
env += `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY=${keep('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY', '')}\n`
env += `VITE_USE_EMULATORS=${keep('VITE_USE_EMULATORS', 'false')}\n`
fs.writeFileSync('.env.local', env)
console.log('filled:', Object.values(keys).map((v) => `${v}=${g(v) ? 'ok' : 'MISSING'}`).join(' '))
