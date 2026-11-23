import QRCode from 'qrcode'

/** Endereço que vai no QR da mesa. Sem domínio configurado, usa o endereço atual do site. */
export const tableUrl = (base: string, tableId: string) => `${(base || location.origin).replace(/\/$/, '')}/m/${tableId}`

/** QR em PNG (data URL) nas cores da marca. */
export const qrDataUrl = (text: string, width = 640) =>
  QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#081021', light: '#ffffff' } })

/** Baixa um data URL como arquivo. */
export function download(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
