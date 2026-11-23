/**
 * Aparelho liberado para a equipe: só nele aparecem as telas de login, garçom e painel.
 * Liberado ao abrir o link de acesso gerado pelo ADM, ou automaticamente para quem já está logado na equipe.
 * Isto só esconde as telas de curiosos; a proteção de verdade continua sendo a senha e as permissões no servidor.
 */
const KEY = 'mabeach-equipe'

export function isStaffDevice() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function markStaffDevice() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // sem localStorage: a pessoa usa o link de acesso de novo quando precisar
  }
}
