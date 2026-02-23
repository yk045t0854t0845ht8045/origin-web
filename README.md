# Origin Web Admin

Painel web para publicar jogos no launcher Origin com fluxo protegido:

- Login inicial via Steam OpenID.
- Somente SteamIDs autorizadas podem acessar o painel e publicar.
- Primeira etapa de novo jogo: colar link de arquivo no Google Drive ou enviar `.rar/.zip`.
- Formulario de metadados liberado somente depois do upload do arquivo.
- Tabela de staffs autorizados com SteamID, nome e cargo.
- Upload para Google Drive:
  - `Meu Drive/Origin Launcher/<NomeDoJogo>/*.rar` (ou `*.zip`).
- Upsert automatico no Supabase em `public.launcher_games`.

## 1) Requisitos

- Node.js 18+.
- Google Service Account com acesso ao Google Drive de destino.
- Supabase com permissao de `insert/update` na tabela `public.launcher_games`.
- Supabase com permissao de `select/insert/update/delete` na tabela `public.admin_steam_ids` (quando `SITE_ADMINS_PROVIDER=auto` ou `supabase`).
- Recomendado para backend: `SUPABASE_SERVICE_ROLE_KEY` no `site/.env` (evita bloqueio de RLS para escrita).

## 2) Configuracao

Dentro de `site/`:

1. Copie `.env.example` para `.env`.
2. Preencha pelo menos:
   - `STEAM_API_KEY`
   - `SITE_BOOTSTRAP_ADMIN_IDS` (ou `SITE_BOOTSTRAP_ADMIN_TABLE`)
   - `GOOGLE_DRIVE_KEY_FILE` ou `GOOGLE_SERVICE_ACCOUNT_JSON`
   - `SUPABASE_URL` e `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (recomendado em producao)
3. Opcional:
   - `SITE_BOOTSTRAP_ADMIN_TABLE` no formato:
     - `steamId|staffName|staffRole,steamId2|staffName2|staffRole2`
   - `SITE_BOOTSTRAP_ADMINS_JSON` com lista JSON de staffs
   - `GOOGLE_DRIVE_PATH_PREFIX` (padrao: `Origin Launcher`)
   - Deixar `SUPABASE_URL`/`SUPABASE_ANON_KEY` vazios para usar `../config/auth.json`
   - `SITE_ADMINS_PROVIDER=auto|supabase|local` (padrao: `auto`)
   - `SITE_ADMINS_SUPABASE_SCHEMA` (padrao: `public`)
   - `SITE_ADMINS_SUPABASE_TABLE` (padrao: `admin_steam_ids`)

## 2.1) Onde pegar `GOOGLE_DRIVE_KEY_FILE` / `GOOGLE_SERVICE_ACCOUNT_JSON`

1. Acesse `https://console.cloud.google.com/` e selecione/crie um projeto.
2. Va em `APIs e Servicos > Biblioteca` e ative a API `Google Drive API`.
3. Va em `APIs e Servicos > Credenciais > Criar credenciais > Conta de servico`.
4. Abra a conta criada e entre em `Chaves > Adicionar chave > Criar nova chave > JSON`.
5. Baixe o arquivo `.json` da Service Account.

Como usar no painel:

- Opcao A (recomendada): salve o arquivo JSON no servidor e use o caminho em `GOOGLE_DRIVE_KEY_FILE`.
- Opcao B: copie o conteudo do JSON para `GOOGLE_SERVICE_ACCOUNT_JSON` (inline) ou `base64:<json_em_base64>`.

Permissao no Drive:

- Copie o `client_email` do JSON da Service Account.
- No Google Drive, compartilhe a pasta de destino com esse email como `Editor`.
- Use o ID dessa pasta em `GOOGLE_DRIVE_ROOT_FOLDER_ID` (ou a URL completa da pasta).
- Com Service Account pura, evite `GOOGLE_DRIVE_ROOT_FOLDER_ID=root` (normalmente falha por quota).
- Se quiser evitar pasta intermediaria, deixe `GOOGLE_DRIVE_PATH_PREFIX=` vazio para criar direto em `PastaRaiz/NomeDoJogo`.

Observacao:

- Se aparecer erro de credencial, confirme se o JSON tem `client_email` e `private_key`.
- Se usar `GOOGLE_DRIVE_KEY_FILE`, confirme que o caminho aponta para um arquivo existente.

## 3) Exemplo de tabela de staff autorizado

| Nome  | Cargo       | SteamID64         |
|-------|-------------|-------------------|
| Owner | super-admin | 76561199481226329 |

Voce pode cadastrar/editar/remover staffs pela tela "Staffs autorizados" dentro do painel.
Com `SITE_ADMINS_PROVIDER=auto` (ou `supabase`), o painel grava essa lista direto no Supabase.
Sem `SUPABASE_SERVICE_ROLE_KEY`, o Supabase precisa de policies RLS liberando escrita para `anon`.
Script pronto da tabela/policies: `../docs/SUPABASE_SQL_ADMINS_STAFF.sql`.

## 4) Rodar local

```bash
cd site
npm install
npm run dev
```

Abra `http://localhost:4080`.

## 5) Publicar o repositorio do site

No root do projeto principal:

```bash
npm run site
```

O script `scripts/site.ps1` executa:

- `git status`
- `git add .`
- `git status`
- `git commit -m "..."`
- `git push -u origin main`

Ele roda dentro da pasta `site/` e inicializa Git nela caso necessario.

Voce tambem pode informar:

```bash
npm run site -- -CommitMessage "feat: painel admin"
npm run site -- -RemoteUrl "https://github.com/<user>/origin-web.git"
```
"# origin-web" 
