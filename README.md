# MA Beach

Cardápio digital com QR code por mesa e botão "Chamar garçom" para o MA Beach.
Projeto separado do app da MA Madeiras (repositório e Firebase próprios: `ma-beach`).

## O que tem

- **Cardápio** (`/` e `/m/{código-da-mesa}`): só visualização. Foto escondida atrás do botão "Ver foto real".
  Item esgotado aparece marcado. Links de avaliação no Google e Instagram no fim.
- **Chamar garçom**: aparece só quando o cardápio é aberto pelo QR de uma mesa. Depois de chamar, o botão
  da mesa fica bloqueado pelo tempo configurado (padrão 5 minutos), conferido no servidor.
- **Painel do garçom** (`/garcom`): "Em serviço", ativar avisos no celular, lista das mesas chamando e botão "Atendido".
- **Painel** (`/admin`): cardápio, mesas e QR codes (impressão em A4), histórico, equipe e configurações.

## Funções da equipe

| Função  | Acesso |
| ------- | ------ |
| ADM     | Tudo, incluindo cadastrar usuários e configurações |
| Gerente | Cardápio, mesas, histórico e chamados (provisório, a definir com o cliente) |
| Garçom  | Só o painel de chamados |

Login com usuário simples (`joao`) ou e-mail. Usuários são cadastrados pelo ADM no painel (Equipe).

## Como os chamados são distribuídos

Configurável em Configurações:
- **Rodízio**: cada chamado vai para o próximo garçom "Em serviço", em ordem alfabética, revezando.
- **Todos**: todo mundo em serviço recebe.
- Se ninguém atender em X minutos, avisa todos em serviço (0 = desligado).
- Se a mesa esperar mais de Y minutos, avisa o ADM (0 = desligado).
- Ninguém em serviço: o aviso vai para ADM e Gerente.
- Chamado esquecido aberto por 2 horas é encerrado sozinho.

## Rodar no computador

```bash
npm install
npm --prefix functions install
node scripts/make-env.cjs          # cria o .env.local a partir de "credenciasi do firebase.txt"
```

Com emuladores (nada toca no Firebase real):

```bash
# Terminal 1 (o Java do emulador precisa de uma pasta temporária sem espaços no caminho)
set JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:/Users/FELIPE~1/Desktop/MABEACH/.emulator-tmp
npm --prefix functions run build
firebase emulators:start --only auth,firestore,functions,storage --project demo-ma-beach

# Terminal 2
node scripts/seed-emulator.mjs      # contas de teste: admin, joao, maria (senha teste1234)
npx vite --mode emulators
```

Abra `http://localhost:5173/m/TesteMesa01abcdefgh` (cardápio da mesa 1) e `http://localhost:5173/entrar`.

## Testes

```bash
npm --prefix functions test          # distribuição dos chamados (rodízio)
npm run test:rules                   # regras de segurança (precisa do JAVA_TOOL_OPTIONS acima no Windows)
```

## Antes de publicar

1. Plano Blaze no projeto `ma-beach` (Cloud Functions exigem; o uso esperado fica na cota grátis).
2. Chave pública dos avisos: Console > Configurações do projeto > Cloud Messaging > Certificados push da Web.
   Colocar em `VITE_FIREBASE_VAPID_KEY` no `.env.local`.
3. Primeiro ADM: criar a conta em Authentication (e-mail e senha) e liberar a função `admin`
   (claim `role: "admin"` e documento `staff/{uid}`). Depois disso, o resto da equipe é cadastrado pelo painel.
4. `npm run build` e `firebase deploy`.
5. Quando o domínio for comprado: adicionar no Hosting, em `functions/.env` (`EXTRA_ORIGINS=https://dominio`),
   na restrição da chave de API e em Configurações > Domínio (antes de imprimir os QR codes).

## Segurança

- Banco e arquivos negam tudo por padrão; cada coleção liberada explicitamente (`firestore.rules`, `storage.rules`).
- Funções da equipe ficam no servidor (claim `role`). Ao mudar função ou desativar, as sessões antigas são encerradas.
- Chamados, cadastro de usuários e senhas só pelo servidor, com validação (zod) e limite de tentativas.
- O código da mesa no QR é aleatório: ninguém chama de outra mesa trocando o número no link.
- Telas da equipe escondidas: /entrar, /garcom, /admin e /conta só aparecem em aparelho liberado pelo
  link de acesso (Equipe > Link de acesso: vale 48 h e uma vez só; só o resumo do código fica no banco)
  ou com alguém da equipe já logado. Para o resto, a página do caranguejo. Isso só tira curiosos do
  caminho: a proteção de verdade continua sendo a senha e as permissões no servidor.
- Senha provisória criada pelo ADM: troca obrigatória no primeiro acesso.
- Cabeçalhos de segurança no Hosting (HSTS, CSP, bloqueio de iframe, nosniff, Referrer e Permissions-Policy).
- Sem source maps em produção. Credenciais fora do Git.
