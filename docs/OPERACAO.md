# Implantação, operação, backup e recuperação

## Requisitos

* Node.js ≥ 20.11 (testado com 22) e PostgreSQL ≥ 15 (testado com 16).
* Dois papéis de banco:
  * **dono** (`DATABASE_URL_OWNER`): executa migrações e operações de sistema. Precisa de `CREATEROLE`
    na primeira migração (para criar `saas_app`). No Supabase, o papel `postgres` atende.
  * **saas_app** (`DATABASE_URL`): criado pela migração 0001 sem login; `npm run db:roles` define a
    senha (lida da própria `DATABASE_URL`) e habilita o login.

## Implantação (exemplo: Vercel + PostgreSQL gerenciado — Supabase, Neon, RDS)

1. Provisione o PostgreSQL (região São Paulo, se possível) com backups automáticos e PITR habilitados.
2. Configure as variáveis do `.env.example` no ambiente de produção (nunca versione valores reais).
   * Gere `CRON_SECRET` com `openssl rand -hex 32`.
   * `MAIL_PROVIDER=resend` + `RESEND_API_KEY` (o modo `console` é bloqueado em produção).
   * `REQUIRE_EMAIL_VERIFICATION` deve permanecer ativo (padrão).
3. Rode as migrações **antes** de publicar a nova versão:
   ```bash
   npm ci
   npm run db:migrate   # idempotente, com bloqueio e checksum
   npm run db:roles     # apenas na primeira vez ou ao trocar a senha de saas_app
   ```
4. Publique (`npm run build` / deploy da plataforma).
5. Agende o ciclo de cobrança diário: `GET /api/cron/billing` com `Authorization: Bearer $CRON_SECRET`
   (ex.: Vercel Cron `0 9 * * *`) ou `npm run job:billing` via cron do sistema.
6. Crie o primeiro administrador: cadastre-se pela tela e execute
   `npm run admin:grant -- seu@email.com superadmin`.
7. Configure monitoramento externo de disponibilidade em `GET /api/health` (retorna 503 se o banco cair).
8. Se usar o Asaas: configure o webhook para `https://SEU_DOMINIO/api/webhooks/asaas` com o token de
   autenticação igual a `ASAAS_WEBHOOK_TOKEN` (ver `INTEGRACOES.md`).

### Conexões

Em ambiente *serverless*, use o *pooler* do provedor (PgBouncer/Supavisor) **em modo transação**: a
aplicação usa somente `set_config(..., true)` (local à transação), compatível com esse modo.
Ajuste `DB_POOL_MAX` conforme o limite de conexões.

## Observabilidade

| Sinal | Onde |
|---|---|
| Logs estruturados (JSON, sem dados sensíveis) | stdout da hospedagem. Correlacione por `request_id` (cabeçalho `x-request-id`, quando fornecido pelo proxy). |
| Erros de integração e jobs | Tabela `saas.ops_events` e painel `/admin/operacao`. |
| Execuções agendadas | `saas.job_runs` (início, fim, situação, estatísticas). Alerte se o último `billing_cycle` tiver mais de 26 h ou `status = 'failed'`. |
| Webhooks | `saas.billing_events` (status `failed` aparece em `/admin` e é reprocessado no reenvio do provedor). |
| Disponibilidade | `/api/health`. |
| Erros não tratados da interface | Página de erro mostra um código (`digest`) que pode ser localizado nos logs. |

**Pendente**: integração com um serviço de monitoramento de erros (ex.: Sentry) e alertas
automáticos (e-mail/Slack) — depende da escolha e das credenciais do serviço.

## Backup e recuperação

### Estratégia recomendada

* **PITR (point-in-time recovery)** do provedor gerenciado, retenção mínima de 7 dias (ideal 30).
* **Dump lógico diário** adicional, criptografado, em armazenamento separado (outra conta/região):
  ```bash
  pg_dump --format=custom --no-owner --schema=saas --schema=public \
    "$DATABASE_URL_OWNER" > backup-$(date +%F).dump
  ```
* Teste de restauração **mensal** em banco descartável (procedimento abaixo) e registro do resultado.

### Restauração completa (desastre)

```bash
createdb saas_restore
# Em um cluster novo, o papel da aplicação precisa existir antes (os GRANTs do dump o referenciam):
psql postgres://.../saas_restore -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'saas_app') then create role saas_app nologin nobypassrls; end if; end \$\$;"
pg_restore --no-owner --dbname=postgres://.../saas_restore backup-AAAA-MM-DD.dump
# Habilita o login de saas_app com a senha da DATABASE_URL apontando para o banco restaurado:
DATABASE_URL=... DATABASE_URL_OWNER=... npm run db:roles
DATABASE_URL_OWNER=... npm run db:migrate   # deve responder "Banco já está atualizado."
```
O `pg_restore` reporta um erro esperado e inofensivo: `schema "public" already exists`.
Procedimento validado em desenvolvimento: contagens de movimentações, soma dos saldos, auditoria e
as 82 políticas RLS idênticas entre origem e restauração.
Depois aponte `DATABASE_URL*` para o banco restaurado e valide `/api/health`.

### Restauração de uma única empresa

Como os dados são compartilhados, não restaure o banco inteiro por causa de um tenant. Restaure o
backup em um banco auxiliar e copie apenas as linhas do `tenant_id` afetado, tabela por tabela,
respeitando a ordem das chaves estrangeiras (tenants → categories/contacts/financial_accounts →
titles → transfers → cash_movements → módulos). Movimentações são imutáveis: para corrigir dados
lógicos prefira **estornos/ajustes** pela aplicação em vez de reescrever o histórico.
Registre o procedimento na auditoria (`actor_type = 'system'`).

## Atualizações de versão

1. Migrações sempre aditivas e compatíveis com a versão anterior da aplicação.
2. `npm run db:migrate` → deploy da aplicação → (opcional) migração de limpeza na versão seguinte.
3. Nunca edite uma migração já aplicada (o executor recusa por checksum).

## Encerramento de conta de cliente

1. Cliente cancela → acesso até o fim do período → `ended` (somente leitura + exportação).
2. Após o prazo de retenção (configurável) e mediante solicitação do proprietário, a exclusão
   definitiva é feita por procedimento manual auditado (dump do tenant arquivado conforme obrigação
   legal; remoção de linhas pelo papel dono com o gatilho de imutabilidade desabilitado apenas
   dentro da transação de expurgo). **Ainda não automatizado** — ver limitações.
