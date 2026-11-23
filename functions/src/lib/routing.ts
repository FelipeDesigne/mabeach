export type Routing = 'round_robin' | 'all'
export type Candidate = {
  uid: string
  name: string
  photoUrl?: string | null
  /** Ambientes em que a pessoa trabalha. Vazio = todos. */
  areas?: string[]
}

/** Ordem fixa da equipe em serviço, para o rodízio ser previsível (por nome, depois pelo id). */
export const sortCandidates = (list: Candidate[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.uid.localeCompare(b.uid))

/**
 * Quem recebe um chamado novo.
 * - `all`: todos em serviço.
 * - `round_robin`: um por vez, o próximo depois de quem recebeu o último chamado.
 *   Se quem recebeu por último saiu do turno, continua de onde ele estaria na ordem.
 */
export function pickRecipients(routing: Routing, candidates: Candidate[], lastUid: string | null) {
  const list = sortCandidates(candidates)
  if (!list.length) return { recipients: [] as string[], assigned: null as Candidate | null }
  if (routing === 'all') return { recipients: list.map((c) => c.uid), assigned: null }
  let next = 0
  if (lastUid) {
    const idx = list.findIndex((c) => c.uid === lastUid)
    if (idx >= 0) next = (idx + 1) % list.length
  }
  return { recipients: [list[next].uid], assigned: list[next] }
}

/** Chave do rodízio: cada ambiente tem o seu (quem não tem ambiente usa o geral). */
export const rotationKey = (areaId: string | null) => (areaId ? `area_${areaId}` : 'geral')

/**
 * Escolha completa de um chamado:
 * 1. Mesa já "com" um garçom (atendida e não encerrada) e ele está em serviço: vai direto pra ele.
 * 2. Senão, só quem trabalha no ambiente da mesa (rodízio ou todos, conforme a configuração).
 * 3. Ninguém do ambiente em serviço: qualquer um em serviço, para o chamado não ficar sem resposta.
 */
export function chooseRecipients(opts: {
  routing: Routing
  candidates: Candidate[]
  areaId: string | null
  holderUid: string | null
  lastUid: string | null
}) {
  const { routing, candidates, areaId, holderUid, lastUid } = opts
  const holder = holderUid ? candidates.find((c) => c.uid === holderUid) : undefined
  if (holder) return { recipients: [holder.uid], assigned: holder, sticky: true, rotate: false }

  const inArea = areaId ? candidates.filter((c) => !c.areas?.length || c.areas.includes(areaId)) : candidates
  const pool = inArea.length ? inArea : candidates
  const picked = pickRecipients(routing, pool, lastUid)
  return { ...picked, sticky: false, rotate: !!picked.assigned }
}
