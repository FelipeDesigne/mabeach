import { describe, expect, it } from 'vitest'
import { chooseRecipients, pickRecipients } from './routing'

const team = [
  { uid: 'u3', name: 'Carla' },
  { uid: 'u1', name: 'Ana' },
  { uid: 'u2', name: 'Bruno' },
]

describe('distribuição dos chamados', () => {
  it('sem ninguém em serviço, ninguém recebe', () => {
    expect(pickRecipients('round_robin', [], null)).toEqual({ recipients: [], assigned: null })
    expect(pickRecipients('all', [], 'u1').recipients).toEqual([])
  })

  it('modo todos: avisa a equipe inteira em serviço', () => {
    const r = pickRecipients('all', team, 'u2')
    expect(r.recipients).toEqual(['u1', 'u2', 'u3'])
    expect(r.assigned).toBeNull()
  })

  it('rodízio: começa pelo primeiro e segue a ordem, voltando ao início', () => {
    expect(pickRecipients('round_robin', team, null).recipients).toEqual(['u1'])
    expect(pickRecipients('round_robin', team, 'u1').recipients).toEqual(['u2'])
    expect(pickRecipients('round_robin', team, 'u2').recipients).toEqual(['u3'])
    expect(pickRecipients('round_robin', team, 'u3').recipients).toEqual(['u1'])
  })

  it('rodízio: o mesmo garçom não recebe dois chamados seguidos quando há outro em serviço', () => {
    let last: string | null = null
    const got: string[] = []
    for (let i = 0; i < 6; i++) {
      const r = pickRecipients('round_robin', team, last)
      got.push(r.recipients[0])
      last = r.recipients[0]
    }
    for (let i = 1; i < got.length; i++) expect(got[i]).not.toBe(got[i - 1])
    expect(got).toEqual(['u1', 'u2', 'u3', 'u1', 'u2', 'u3'])
  })

  it('rodízio: quem recebeu por último saiu do turno, começa do início', () => {
    expect(pickRecipients('round_robin', team, 'u9').recipients).toEqual(['u1'])
  })

  it('rodízio com uma pessoa só: ela recebe todos', () => {
    expect(pickRecipients('round_robin', [team[0]], 'u3').recipients).toEqual(['u3'])
  })
})

describe('ambientes e mesa com garçom', () => {
  const equipe = [
    { uid: 'a', name: 'Ana', areas: ['varanda'] },
    { uid: 'b', name: 'Bruno', areas: ['salao'] },
    { uid: 'c', name: 'Carla', areas: ['salao', 'varanda'] },
    { uid: 'd', name: 'Davi' }, // sem ambiente: atende todos
  ]

  it('só quem trabalha no ambiente da mesa (ou sem ambiente) recebe', () => {
    const r = chooseRecipients({ routing: 'all', candidates: equipe, areaId: 'salao', holderUid: null, lastUid: null })
    expect(r.recipients).toEqual(['b', 'c', 'd'])
  })

  it('rodízio dentro do ambiente', () => {
    const v1 = chooseRecipients({ routing: 'round_robin', candidates: equipe, areaId: 'varanda', holderUid: null, lastUid: null })
    expect(v1.recipients).toEqual(['a'])
    const v2 = chooseRecipients({ routing: 'round_robin', candidates: equipe, areaId: 'varanda', holderUid: null, lastUid: 'a' })
    expect(v2.recipients).toEqual(['c'])
    const v3 = chooseRecipients({ routing: 'round_robin', candidates: equipe, areaId: 'varanda', holderUid: null, lastUid: 'c' })
    expect(v3.recipients).toEqual(['d'])
  })

  it('ninguém do ambiente em serviço: vai pra quem estiver em serviço', () => {
    const soSalao = [equipe[1]]
    const r = chooseRecipients({ routing: 'all', candidates: soSalao, areaId: 'quadras', holderUid: null, lastUid: null })
    expect(r.recipients).toEqual(['b'])
  })

  it('mesa já com um garçom em serviço: vai direto pra ele, sem mexer no rodízio', () => {
    const r = chooseRecipients({ routing: 'round_robin', candidates: equipe, areaId: 'salao', holderUid: 'a', lastUid: 'b' })
    expect(r.recipients).toEqual(['a'])
    expect(r.sticky).toBe(true)
    expect(r.rotate).toBe(false)
  })

  it('garçom da mesa em pausa ou fora de serviço: segue o modo normal', () => {
    const semAna = equipe.filter((c) => c.uid !== 'a')
    const r = chooseRecipients({ routing: 'round_robin', candidates: semAna, areaId: 'varanda', holderUid: 'a', lastUid: null })
    expect(r.recipients).toEqual(['c'])
    expect(r.sticky).toBe(false)
  })
})
