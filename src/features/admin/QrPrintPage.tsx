import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeft, Printer } from 'lucide-react'
import { col, useLiveQuery, useOpsSettings } from '../../lib/data'
import { tableName } from '../../lib/format'
import { qrDataUrl, tableUrl } from '../../lib/qr'
import { Button, Spinner } from '../../components/ui'
import { sortTables } from './TablesAdmin'
import type { Table } from '../../types'

/** Folha A4 com 6 cartões por página (logo, número da mesa e QR), pronta para imprimir ou salvar em PDF. */
export function QrPrintPage() {
  const [params] = useSearchParams()
  const ids = useMemo(() => new Set((params.get('ids') ?? '').split(',').filter(Boolean)), [params])
  const tables = useLiveQuery<Table>(col('tables'), [])
  const ops = useOpsSettings()
  const list = useMemo(() => tables.data.filter((t) => ids.has(t.id)).sort(sortTables), [tables.data, ids])
  const [qrs, setQrs] = useState<Record<string, string>>({})

  useEffect(() => {
    if (ops.loading) return
    let alive = true
    Promise.all(list.map(async (t) => [t.id, await qrDataUrl(tableUrl(ops.data.qrBaseUrl, t.id), 720)] as const)).then((pairs) => {
      if (alive) setQrs(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [list, ops.loading, ops.data.qrBaseUrl])

  if (tables.loading || ops.loading) return <Spinner />
  const ready = list.length > 0 && list.every((t) => qrs[t.id])

  return (
    <div className="bg-white">
      <style>{`@page { size: A4; margin: 10mm; }`}</style>
      <div className="no-print mx-auto flex max-w-4xl flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/admin/mesas" className="inline-flex items-center gap-2 text-sm font-semibold">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
          <Button onClick={() => window.print()} disabled={!ready}>
            <Printer className="size-4" /> Imprimir ou salvar PDF
          </Button>
        </div>
        <p className="text-sm text-muted">{list.length} QR codes. Na janela de impressão, escolha "Salvar como PDF" para mandar para a gráfica.</p>
      </div>

      <div className="mx-auto grid max-w-[190mm] grid-cols-2 gap-[6mm] print:max-w-none">
        {list.map((t) => (
          <article key={t.id} className="flex h-[88mm] break-inside-avoid flex-col items-center justify-between rounded-[5mm] border-[0.4mm] border-navy p-[5mm] text-center text-navy">
            <img src="/logo.svg" alt="MA Beach" className="h-[16mm] w-auto" width={2782} height={1908} />
            {qrs[t.id] ? <img src={qrs[t.id]} alt="" className="h-[44mm] w-[44mm]" /> : <div className="h-[44mm] w-[44mm]" />}
            <div>
              <p className="text-[6mm] leading-none font-bold">{tableName(t.label)}</p>
              <p className="mt-[1.5mm] text-[3mm] leading-snug">Aponte a câmera para ver o cardápio e chamar o garçom</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
