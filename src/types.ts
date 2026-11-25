import type { Timestamp } from 'firebase/firestore'

export type Role = 'admin' | 'manager' | 'waiter' | 'counter'
export const ROLE_LABEL: Record<Role, string> = { admin: 'ADM', manager: 'Gerente', waiter: 'Garçom', counter: 'Balcão' }
/** Quem atende mesas (recebe chamados, tem ambientes e foto para o cliente). O balcão não. */
export const servesTables = (role: Role) => role !== 'counter'

export type Category = { id: string; name: string; order: number; visible: boolean }

export type Item = {
  id: string
  categoryId: string
  name: string
  description: string
  /** Em centavos. */
  price: number
  photoPath: string | null
  photoUrl: string | null
  /** false = esgotado (continua aparecendo, marcado como esgotado). */
  available: boolean
  /** false = escondido do cardápio. */
  visible: boolean
  order: number
  /** Em destaque: aparece embaixo da arte, no topo do cardápio. */
  featured?: boolean
  /** Preço de promoção em centavos (menor que `price`). null = sem promoção. */
  promoPrice?: number | null
}

/** Arte 16:9 no topo do cardápio. */
export type Banner = { imageUrl: string | null; imagePath: string | null; visible: boolean }
export const DEFAULT_BANNER: Banner = { imageUrl: null, imagePath: null, visible: false }

export type Table = {
  id: string
  label: string
  number: number
  active: boolean
  /** Ambiente (Salão, Varanda...). */
  areaId?: string | null
  /** Posição no mapa do ambiente (null = fora do mapa). */
  x?: number | null
  y?: number | null
  shape?: 'round' | 'square'
}

/** Parede desenhada no mapa (coordenadas do mapa, 1000 x 600). */
export type Wall = { x1: number; y1: number; x2: number; y2: number }
export type FloorId = 'deck' | 'madeira' | 'cimento' | 'porcelanato' | 'areia' | 'grama'
/** Pisos do mapa (texturas em public/img/pisos). */
export const FLOORS: { id: FloorId; label: string }[] = [
  { id: 'deck', label: 'Deck de madeira' },
  { id: 'madeira', label: 'Assoalho de madeira' },
  { id: 'cimento', label: 'Cimento queimado' },
  { id: 'porcelanato', label: 'Porcelanato' },
  { id: 'areia', label: 'Areia' },
  { id: 'grama', label: 'Grama' },
]
export type Area = { id: string; name: string; order: number; walls?: Wall[]; floor?: FloorId }

/** Situação da mesa para o mapa do balcão (escrita só pelo servidor). */
export type TableStatus = {
  id: string
  status: 'calling' | 'busy' | 'free'
  tableLabel: string
  areaId: string | null
  callId: string | null
  callAt: Timestamp | null
  assignedName: string | null
  holderUid: string | null
  holderName: string | null
  since?: Timestamp | null
}

export type CallStatus = 'open' | 'attended' | 'expired' | 'closed'
export type Call = {
  id: string
  tableId: string
  tableLabel: string
  tableNumber: number
  status: CallStatus
  routing: 'round_robin' | 'all' | 'holder'
  areaId?: string | null
  assignedTo: string | null
  assignedName: string | null
  notified: string[]
  noOneOnDuty: boolean
  escalated: boolean
  createdAt: Timestamp
  attendedBy?: string
  attendedByName?: string
  attendedAt?: Timestamp
  responseSec?: number
}

export type Staff = {
  id: string
  name: string
  login: string
  role: Role
  active: boolean
  onDuty: boolean
  /** Senha criada pelo ADM: troca obrigatória no próximo acesso. */
  mustChangePassword?: boolean
  photoUrl?: string | null
  photoPath?: string | null
  /** Em pausa até este momento (fora do rodízio). */
  pausedUntil?: Timestamp | null
  /** Ambientes em que trabalha (vazio = todos). */
  areas?: string[]
}

export type PublicSettings = { callCooldownMin: number; googleReviewUrl?: string; instagramUrl?: string; askReviewAfterCall?: boolean }
export type OpsSettings = {
  routing: 'round_robin' | 'all'
  escalateAfterMin: number
  ownerAfterMin: number
  qrBaseUrl: string
  /** Hora (0 a 23, horário de Brasília) em que todo mundo sai de "Em serviço". -1 = desligado. */
  autoOffDutyHour: number
}

export const DEFAULT_PUBLIC: PublicSettings = { callCooldownMin: 5, googleReviewUrl: '', instagramUrl: '', askReviewAfterCall: true }
export const DEFAULT_OPS: OpsSettings = { routing: 'round_robin', escalateAfterMin: 0, ownerAfterMin: 0, qrBaseUrl: '', autoOffDutyHour: 5 }
