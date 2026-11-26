import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { AtSign, Camera, Star } from 'lucide-react'
import { db } from '../../lib/firebase'
import { money, tableName } from '../../lib/format'
import { useBanner, usePublicSettings } from '../../lib/data'
import { track } from '../../lib/track'
import { Modal, Spinner } from '../../components/ui'
import type { Category, Item, Table } from '../../types'
import { CallBar } from './CallBar'

type Loaded = { categories: Category[]; items: Item[] }

export function MenuPage() {
  const { tableId } = useParams()
  const settings = usePublicSettings()
  const banner = useBanner()
  const [menu, setMenu] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [table, setTable] = useState<Table | null | 'invalid'>(tableId ? null : 'invalid')
  const [photo, setPhoto] = useState<Item | null>(null)
  const [active, setActive] = useState<string>('')

  useEffect(() => {
    // O público só pode ler o que está visível: a consulta precisa filtrar por isso.
    Promise.all([
      getDocs(query(collection(db, 'categories'), where('visible', '==', true))),
      getDocs(query(collection(db, 'items'), where('visible', '==', true))),
    ])
      .then(([c, i]) => {
        const byOrder = <T extends { order: number; name: string }>(a: T, b: T) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR')
        setMenu({
          categories: c.docs.map((d) => ({ id: d.id, ...d.data() }) as Category).sort(byOrder),
          items: i.docs.map((d) => ({ id: d.id, ...d.data() }) as Item).sort(byOrder),
        })
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    // Cardápio aberto sem mesa (link geral): também conta para o painel.
    if (!tableId) track('menu_open')
  }, [tableId])

  useEffect(() => {
    if (!tableId) return
    if (!/^[A-Za-z0-9]{10,40}$/.test(tableId)) return setTable('invalid')
    getDoc(doc(db, 'tables', tableId))
      .then((snap) => {
        const ok = snap.exists() && snap.get('active') === true
        setTable(ok ? ({ id: snap.id, ...snap.data() } as Table) : 'invalid')
        // Painel: conta o cardápio aberto nesta mesa (anônimo).
        if (ok) track('menu_open', snap.id)
      })
      .catch(() => setTable('invalid'))
  }, [tableId])

  const sections = useMemo(() => {
    if (!menu) return []
    return menu.categories.map((c) => ({ ...c, items: menu.items.filter((i) => i.categoryId === c.id) })).filter((s) => s.items.length)
  }, [menu])

  useEffect(() => {
    if (!sections.length) return
    setActive(sections[0].id)
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActive(visible.target.id.replace('cat-', ''))
      },
      { rootMargin: '-120px 0px -60% 0px' },
    )
    sections.forEach((s) => {
      const el = document.getElementById(`cat-${s.id}`)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [sections])

  // Destaques: na ordem do cardápio, só o que o cliente pode pedir agora.
  const featured = useMemo(() => sections.flatMap((s) => s.items).filter((i) => i.featured && i.available), [sections])

  const hasTable = table && table !== 'invalid'
  const { googleReviewUrl, instagramUrl } = settings.data
  const bannerUrl = banner.data.visible ? banner.data.imageUrl : null

  return (
    <div className={`min-h-dvh ${tableId ? 'pb-32' : 'pb-10'}`}>
      <header className="bg-beige px-4 pt-6 pb-4 text-center">
        <img src="/logo.svg" alt="MA Beach" className="mx-auto w-32 sm:w-40" width={2782} height={1908} />
        {hasTable && (
          <p className="mt-4 inline-flex rounded-full bg-navy px-4 py-1.5 text-sm font-semibold text-beige">{tableName(table.label)}</p>
        )}
      </header>

      {(bannerUrl || featured.length > 0) && (
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-6">
          {bannerUrl && <img src={bannerUrl} alt="Destaque do MA Beach" className="w-full rounded-2xl bg-beige-200" />}
          {featured.length > 0 && (
            <section aria-labelledby="destaques">
              <h2 id="destaques" className="text-xl font-bold">
                Destaques
              </h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {featured.map((item) => (
                  <li key={item.id} className="flex flex-col gap-2 rounded-2xl bg-navy p-4 text-beige shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-semibold">{item.name}</h3>
                      {item.promoPrice != null && <span className="shrink-0 rounded-full bg-sun px-2.5 py-0.5 text-xs font-bold text-navy">Promoção</span>}
                    </div>
                    {item.description && <p className="line-clamp-2 text-sm leading-relaxed text-beige/75">{item.description}</p>}
                    <div className="mt-auto flex items-end gap-3 pt-1">
                      {item.photoUrl && (
                        <button
                          type="button"
                          onClick={() => setPhoto(item)}
                          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline decoration-beige/40 underline-offset-4"
                        >
                          <Camera className="size-4" aria-hidden />
                          Ver foto real
                        </button>
                      )}
                      <p className="ml-auto text-right tabular-nums">
                        {item.promoPrice != null ? (
                          <>
                            <span className="block text-xs text-beige/70 line-through">
                              <span className="sr-only">De </span>
                              {money(item.price)}
                            </span>
                            <span className="text-lg font-bold text-sun">
                              <span className="sr-only">por </span>
                              {money(item.promoPrice)}
                            </span>
                          </>
                        ) : (
                          <span className="text-lg font-bold">{money(item.price)}</span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {sections.length > 1 && (
        <nav aria-label="Categorias" className="sticky top-0 z-10 border-b border-line bg-beige/95 backdrop-blur">
          <ul className="mx-auto flex max-w-2xl gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
            {sections.map((s) => (
              <li key={s.id} className="shrink-0">
                <a
                  href={`#cat-${s.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    document.getElementById(`cat-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  aria-current={active === s.id ? 'true' : undefined}
                  className={`block rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                    active === s.id ? 'bg-navy text-beige' : 'bg-white text-navy ring-1 ring-line'
                  }`}
                >
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <main className="mx-auto max-w-2xl px-4">
        {!menu && !failed && <Spinner label="Carregando o cardápio" />}
        {failed && <p className="py-16 text-center text-muted">Não foi possível carregar o cardápio. Confira a internet e tente de novo.</p>}
        {menu && !sections.length && <p className="py-16 text-center text-muted">O cardápio ainda está sendo preparado.</p>}

        {sections.map((s) => (
          <section key={s.id} id={`cat-${s.id}`} className="scroll-mt-20 pt-8">
            <h2 className="text-xl font-bold">{s.name}</h2>
            <ul className="mt-2 divide-y divide-line">
              {s.items.map((item) => (
                <li key={item.id} className={`flex gap-4 py-4 ${item.available ? '' : 'opacity-60'}`}>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{item.name}</h3>
                    {item.description && <p className="mt-1 text-sm leading-relaxed text-muted">{item.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {!item.available && <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-semibold">Esgotado</span>}
                      {item.available && item.promoPrice != null && <span className="rounded-full bg-sun px-2 py-0.5 text-xs font-bold">Promoção</span>}
                      {item.photoUrl && (
                        <button
                          type="button"
                          onClick={() => setPhoto(item)}
                          className="inline-flex items-center gap-1.5 text-sm font-semibold underline decoration-navy/30 underline-offset-4"
                        >
                          <Camera className="size-4" aria-hidden />
                          Ver foto real
                        </button>
                      )}
                    </div>
                  </div>
                  {item.promoPrice != null ? (
                    <p className="shrink-0 text-right tabular-nums">
                      <span className="block text-xs text-muted line-through">
                        <span className="sr-only">De </span>
                        {money(item.price)}
                      </span>
                      <span className="font-bold">
                        <span className="sr-only">por </span>
                        {money(item.promoPrice)}
                      </span>
                    </p>
                  ) : (
                    <p className="shrink-0 font-semibold tabular-nums">{money(item.price)}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {(googleReviewUrl || instagramUrl) && menu && (
          <footer className="mt-12 flex flex-col items-center gap-3 border-t border-line pt-8 text-center">
            <p className="text-sm text-muted">Gostou? Conta pra gente.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {googleReviewUrl && (
                <a href={googleReviewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-line">
                  <Star className="size-4" aria-hidden />
                  Avaliar no Google
                </a>
              )}
              {instagramUrl && (
                <a href={instagramUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-line">
                  <AtSign className="size-4" aria-hidden />
                  Instagram
                </a>
              )}
            </div>
          </footer>
        )}
      </main>

      {tableId && table !== null && <CallBar
          table={table === 'invalid' ? null : table}
          cooldownMin={settings.data.callCooldownMin}
          reviewUrl={settings.data.askReviewAfterCall !== false ? settings.data.googleReviewUrl : undefined}
        />}

      <Modal open={!!photo} onClose={() => setPhoto(null)} title={photo?.name ?? ''} wide>
        {photo?.photoUrl && (
          <>
            <img src={photo.photoUrl} alt={`Foto real: ${photo.name}`} className="w-full rounded-2xl bg-beige-200 object-contain" />
            <p className="mt-3 text-center text-xs text-muted">Foto real do prato servido no MA Beach.</p>
          </>
        )}
      </Modal>
    </div>
  )
}
