const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** 1290 -> "R$ 12,90" */
export const money = (cents: number) => brl.format(cents / 100)

/** "12,90" ou "12.90" -> 1290. Retorna null se não for um valor válido. */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/[^\d,.]/g, '')
  if (!clean) return null
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0 || value > 100000) return null
  return Math.round(value * 100)
}

/** 1290 -> "12,90" (para o campo de preço). */
export const moneyInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

/** "12" -> "Mesa 12"; nomes livres ("Varanda 3") ficam como estão. */
export const tableName = (label: string) => (/^\d+$/.test(label) ? `Mesa ${label}` : label)

/** Segundos -> "45 s", "3 min", "1 h 05". */
export function duration(sec: number) {
  if (sec < 60) return `${Math.round(sec)} s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

/** Contagem regressiva "4:59". */
export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const timeOf = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
