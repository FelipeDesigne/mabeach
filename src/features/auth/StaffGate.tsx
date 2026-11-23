import { useEffect, type ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { isStaffDevice, markStaffDevice } from '../../lib/staffDevice'
import { Spinner } from '../../components/ui'
import { NotFound } from '../NotFound'

/**
 * Telas da equipe só aparecem em aparelho liberado (link de acesso) ou para quem já está logado na equipe.
 * Para o resto, a mesma página de "não existe" de qualquer endereço inventado.
 */
export function StaffGate({ children }: { children: ReactNode }) {
  const { user, role, loading } = useAuth()
  const staff = !!user && !!role
  useEffect(() => {
    if (staff) markStaffDevice()
  }, [staff])

  if (isStaffDevice() || staff) return <>{children}</>
  if (loading) return <Spinner />
  return <NotFound />
}
