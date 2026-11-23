import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, Outlet } from 'react-router'
import { AuthProvider } from './features/auth/AuthProvider'
import { RequireRole } from './features/auth/RequireRole'
import { StaffGate } from './features/auth/StaffGate'
import { NotFound } from './features/NotFound'
import { MenuPage } from './features/menu/MenuPage'
import { Spinner } from './components/ui'
import { DialogProvider } from './components/dialogs'

// Telas da equipe carregadas sob demanda: o cliente que abre o cardápio não baixa o painel.
const AccessPage = lazy(() => import('./features/auth/AccessPage').then((m) => ({ default: m.AccessPage })))
const AccountPage = lazy(() => import('./features/auth/AccountPage').then((m) => ({ default: m.AccountPage })))
const LoginPage = lazy(() => import('./features/auth/LoginPage').then((m) => ({ default: m.LoginPage })))
const WaiterPage = lazy(() => import('./features/waiter/WaiterPage').then((m) => ({ default: m.WaiterPage })))
const AdminLayout = lazy(() => import('./features/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })))
const MenuAdmin = lazy(() => import('./features/admin/MenuAdmin').then((m) => ({ default: m.MenuAdmin })))
const HighlightsAdmin = lazy(() => import('./features/admin/HighlightsAdmin').then((m) => ({ default: m.HighlightsAdmin })))
const TablesAdmin = lazy(() => import('./features/admin/TablesAdmin').then((m) => ({ default: m.TablesAdmin })))
const QrPrintPage = lazy(() => import('./features/admin/QrPrintPage').then((m) => ({ default: m.QrPrintPage })))
const TeamAdmin = lazy(() => import('./features/admin/TeamAdmin').then((m) => ({ default: m.TeamAdmin })))
const CallsAdmin = lazy(() => import('./features/admin/CallsAdmin').then((m) => ({ default: m.CallsAdmin })))
const AreasAdmin = lazy(() => import('./features/admin/AreasAdmin').then((m) => ({ default: m.AreasAdmin })))
const OrderPage = lazy(() => import('./features/orders/OrderPage').then((m) => ({ default: m.OrderPage })))
const KitchenPage = lazy(() => import('./features/kitchen/KitchenPage').then((m) => ({ default: m.KitchenPage })))
const CounterPage = lazy(() => import('./features/counter/CounterPage').then((m) => ({ default: m.CounterPage })))
const ReportsAdmin = lazy(() => import('./features/admin/ReportsAdmin').then((m) => ({ default: m.ReportsAdmin })))
const SettingsAdmin = lazy(() => import('./features/admin/SettingsAdmin').then((m) => ({ default: m.SettingsAdmin })))

const L = ({ children }: { children: ReactNode }) => <Suspense fallback={<Spinner />}>{children}</Suspense>

function Root() {
  return (
    <AuthProvider>
      <DialogProvider>
        <Outlet />
      </DialogProvider>
    </AuthProvider>
  )
}

const managers = ['admin', 'manager'] as const
const adminOnly = ['admin'] as const

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <MenuPage /> },
      { path: '/m/:tableId', element: <MenuPage /> },
      { path: '/acesso/:token', element: <L><AccessPage /></L> },
      {
        // Telas da equipe: só em aparelho liberado pelo link de acesso (ou com a equipe já logada).
        element: (
          <StaffGate>
            <Outlet />
          </StaffGate>
        ),
        children: [
          { path: '/entrar', element: <L><LoginPage /></L> },
          {
            path: '/garcom',
            element: (
              <RequireRole roles={['admin', 'manager', 'waiter']}>
                <L><WaiterPage /></L>
              </RequireRole>
            ),
          },
          {
            path: '/balcao',
            element: (
              <RequireRole roles={['admin', 'manager', 'counter']}>
                <L><CounterPage /></L>
              </RequireRole>
            ),
          },
          {
            path: '/garcom/pedido',
            element: (
              <RequireRole roles={['admin', 'manager', 'waiter']}>
                <L><OrderPage /></L>
              </RequireRole>
            ),
          },
          {
            path: '/cozinha',
            element: (
              <RequireRole roles={['admin', 'manager', 'kitchen']}>
                <L><KitchenPage /></L>
              </RequireRole>
            ),
          },
          {
            path: '/conta',
            element: (
              <RequireRole roles={['admin', 'manager', 'waiter', 'counter', 'kitchen']}>
                <L><AccountPage /></L>
              </RequireRole>
            ),
          },
          {
            path: '/admin/mesas/imprimir',
            element: (
              <RequireRole roles={[...managers]}>
                <L><QrPrintPage /></L>
              </RequireRole>
            ),
          },
          {
            path: '/admin',
            element: (
              <RequireRole roles={[...managers]}>
                <L><AdminLayout /></L>
              </RequireRole>
            ),
            children: [
              { index: true, element: <Navigate to="/admin/relatorios" replace /> },
              { path: 'relatorios', element: <L><ReportsAdmin /></L> },
              { path: 'cardapio', element: <L><MenuAdmin /></L> },
              { path: 'destaques', element: <L><HighlightsAdmin /></L> },
              { path: 'mesas', element: <L><TablesAdmin /></L> },
              { path: 'ambientes', element: <L><AreasAdmin /></L> },
              { path: 'chamados', element: <L><CallsAdmin /></L> },
              { path: 'equipe', element: <RequireRole roles={[...adminOnly]}><L><TeamAdmin /></L></RequireRole> },
              { path: 'config', element: <RequireRole roles={[...adminOnly]}><L><SettingsAdmin /></L></RequireRole> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])
