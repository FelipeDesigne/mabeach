import { z } from 'zod'

const id = z.string().regex(/^[A-Za-z0-9]{10,40}$/)
const name = z.string().trim().min(2).max(60)
const role = z.enum(['admin', 'manager', 'waiter', 'counter', 'kitchen'])
const password = z.string().min(8).max(100)
/** "joao", "maria.silva" ou um e-mail. */
const login = z
  .string()
  .trim()
  .toLowerCase()
  .max(100)
  .refine((v) => (v.includes('@') ? z.email().safeParse(v).success : /^[a-z0-9][a-z0-9._-]{2,29}$/.test(v)))

export const callWaiterSchema = z.object({ tableId: id }).strict()
export const attendCallSchema = z.object({ callId: id }).strict()
export const closeTableSchema = z.object({ tableId: id }).strict()

// Pedido feito pelo garçom na mesa: só identificadores e quantidades. Nome e preço o servidor lê do cardápio.
const orderLine = z
  .object({ itemId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), qty: z.number().int().min(1).max(50), note: z.string().trim().max(140).optional() })
  .strict()
export const createOrderSchema = z.object({ tableId: id, lines: z.array(orderLine).min(1).max(60), note: z.string().trim().max(200).optional() }).strict()
export const orderStatusSchema = z.object({ orderId: id, status: z.enum(['ready', 'delivered', 'canceled']) }).strict()

export const createUserSchema = z.object({ name, login, password, role }).strict()
export const updateUserSchema = z
  .object({ uid: z.string().min(1).max(128), name: name.optional(), role: role.optional(), active: z.boolean().optional() })
  .strict()
export const setPasswordSchema = z.object({ uid: z.string().min(1).max(128), password }).strict()

export const createInviteSchema = z.object({ uid: z.string().min(1).max(128) }).strict()
export const redeemInviteSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).strict()
export const trackEventSchema = z.object({ type: z.enum(['menu_open', 'review_yes', 'review_no']), tableId: id.optional() }).strict()
