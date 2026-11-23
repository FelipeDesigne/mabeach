/** Mesmo domínio interno usado pelo servidor ao cadastrar quem entra só com usuário ("joao"). */
export const USERNAME_DOMAIN = 'equipe.ma-beach.web.app'

/** "Joao" -> "joao@equipe.ma-beach.web.app"; e-mails ficam como estão. */
export const loginToEmail = (login: string) => {
  const v = login.trim().toLowerCase()
  return v.includes('@') ? v : `${v}@${USERNAME_DOMAIN}`
}

/** Mostra o login como foi cadastrado (sem o domínio interno). */
export const displayLogin = (emailOrLogin: string) => emailOrLogin.replace(`@${USERNAME_DOMAIN}`, '')
