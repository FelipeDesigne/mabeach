import { Link } from 'react-router'

/** Endereço que não existe (ou tela da equipe aberta em aparelho não liberado). */
export function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-5 px-4 py-10 text-center">
      <img src="/img/caranguejo.webp" alt="Caranguejo desconfiado" className="w-56" width={520} height={376} />
      <div>
        <h1 className="text-2xl font-bold">O que você quer aqui, hein?</h1>
        <p className="mt-2 text-muted">Aqui não tem nada pra você. O que é bom mesmo está no cardápio.</p>
      </div>
      <Link to="/" className="inline-flex min-h-11 items-center rounded-xl bg-navy px-5 text-sm font-semibold text-beige">
        Voltar pro cardápio
      </Link>
    </main>
  )
}
