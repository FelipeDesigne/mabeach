import { NavLink, Outlet, Link } from 'react-router'
import { BellRing, ChartColumn, History, LogOut, Map, Monitor, QrCode, Settings, Sparkles, UserRound, UtensilsCrossed, Users } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { ROLE_LABEL } from '../../types'
import { UpdateBanner } from '../pwa/UpdateBanner'

const LINKS = [
  { to: '/admin/relatorios', label: 'Relatórios', icon: ChartColumn, adminOnly: false },
  { to: '/admin/cardapio', label: 'Cardápio', icon: UtensilsCrossed, adminOnly: false },
  { to: '/admin/destaques', label: 'Destaques', icon: Sparkles, adminOnly: false },
  { to: '/admin/mesas', label: 'Mesas e QR', icon: QrCode, adminOnly: false },
  { to: '/admin/ambientes', label: 'Ambientes e mapa', icon: Map, adminOnly: false },
  { to: '/admin/chamados', label: 'Histórico', icon: History, adminOnly: false },
  { to: '/admin/equipe', label: 'Equipe', icon: Users, adminOnly: true },
  { to: '/admin/config', label: 'Configurações', icon: Settings, adminOnly: true },
]

export function AdminLayout() {
  const { role, profile, signOut } = useAuth()
  const links = LINKS.filter((l) => !l.adminOnly || role === 'admin')
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
      isActive ? 'bg-navy text-beige' : 'text-navy hover:bg-beige-200'
    }`

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="no-print border-b border-line bg-white lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:flex-col lg:items-start lg:py-6">
          <img src="/logo.svg" alt="MA Beach" className="h-10 w-auto lg:h-auto lg:w-36" width={2782} height={1908} />
          <div className="text-right lg:text-left">
            <p className="text-sm font-semibold">{profile?.name}</p>
            <p className="text-xs text-muted">{role ? ROLE_LABEL[role] : ''}</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-6">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={item}>
              <l.icon className="size-4" aria-hidden />
              {l.label}
            </NavLink>
          ))}
          <Link to="/balcao" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold whitespace-nowrap hover:bg-beige-200">
            <Monitor className="size-4" aria-hidden />
            Balcão (mapa ao vivo)
          </Link>
          <Link to="/garcom" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold whitespace-nowrap hover:bg-beige-200">
            <BellRing className="size-4" aria-hidden />
            Chamados ao vivo
          </Link>
          <Link to="/conta" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold whitespace-nowrap hover:bg-beige-200">
            <UserRound className="size-4" aria-hidden />
            Minha conta
          </Link>
          <button type="button" onClick={signOut} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold whitespace-nowrap text-muted hover:bg-beige-200 lg:mt-4">
            <LogOut className="size-4" aria-hidden />
            Sair
          </button>
        </nav>
      </aside>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 lg:px-8">
        <div className="mb-4 empty:hidden">
          <UpdateBanner />
        </div>
        <Outlet />
      </main>
    </div>
  )
}

/** Título de cada tela do painel (direto, sem etiqueta em cima). */
export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}
