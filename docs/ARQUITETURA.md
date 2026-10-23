# Arquitetura

## Visão geral

Monólito modular em **Next.js 16 (App Router) + TypeScript**, com **PostgreSQL** como única
dependência de infraestrutura. Não há microsserviços: domínios são separados por pastas e por
contratos de serviço, e todas as regras financeiras críticas ficam no servidor e no banco.

```
Navegador ──(cookies httpOnly)──▶ Next.js (Server Components + Server Actions + Route Handlers)
                                     │
                                     ├── papel saas_app  (RLS obrigatório)  ← requisições de usuários
                                     └── papel dono      (ignora RLS)       ← cadastro, webhooks, jobs
                                              │
                                         PostgreSQL 16 (schema "saas")
```

## Organização do código

| Pasta | Conteúdo |
|---|---|
| `db/migrations/` | Migrações SQL versionadas (tabelas, RLS, gatilhos, dados de catálogo). |
| `src/lib/` | Utilitários puros: dinheiro (centavos), datas, validação, CSV, CPF/CNPJ, logs, erros. |
| `src/server/db/` | Pools, transações (`withAppTx`, `withSystemTx`) e executor de migrações. |
| `src/server/auth/` | Hash de senha (scrypt), sessões, verificação de e-mail, redefinição de senha. |
| `src/server/context.ts` | Monta o **contexto do tenant** (usuário, empresa, papel, permissões, plano, módulos). |
| `src/server/authz.ts` | `requirePerm`, `requireWrite`, `requireFeature`, `requireModule`, `checkLimit`. |
| `src/server/web.ts` | Integração com Next (cookies, redirecionamentos, wrapper de Server Actions). |
| `src/domains/access/` | Catálogo de permissões, papéis, membros, convites, acesso de suporte. |
| `src/domains/tenants/` | Criação atômica de empresa, onboarding, configurações, módulos. |
| `src/domains/finance/` | **Núcleo financeiro**: contas, categorias, contatos, títulos, baixas, transferências, estornos, relatórios. |
| `src/domains/billing/` | Catálogo comercial, entitlements, máquina de estados, ciclo de cobrança, webhooks. |
| `src/domains/segments/` | Registro de segmentos (configuração inicial: categorias, módulos, KPIs). |
| `src/domains/modules/` | Registro de módulos (requisitos, permissões, dependências, efeitos financeiros). |
| `src/domains/padaria/` | Módulos do segmento Padaria (caixa e produção). |
| `src/domains/admin/` | Painel da plataforma (métricas, empresas, planos, cobranças, auditoria). |
| `src/domains/lgpd/` | Exportação de dados e exclusão/anonimização de conta. |
| `src/app/` | Rotas: `/app/*` (cliente), `/admin/*` (plataforma), `/api/*` (export, webhooks, cron, health). |
| `tests/` | Testes de integração contra PostgreSQL real. `e2e/` testes de navegador (Playwright). |

## Multi-tenant

* Banco compartilhado, isolamento lógico por `tenant_id` + **Row Level Security**.
* A identidade é estabelecida **dentro do banco**: o servidor envia o token de sessão em
  `app.session_token` (variável local da transação) e `saas.current_user_id()` resolve o usuário
  pelo hash do token. Um `user_id` ou `tenant_id` forjado não concede acesso.
* `saas.current_tenant_id()` só retorna o tenant solicitado se o usuário tiver vínculo ativo
  (ou concessão de suporte vigente). Todas as políticas usam essa função.
* Chaves estrangeiras compostas `(tenant_id, id)` impedem referências cruzadas entre empresas,
  inclusive em código de sistema.
* Escritas exigem `saas.can_write()`: membro real (não suporte) e assinatura com acesso pleno.
* Permissões finas por função são verificadas no serviço (`authz.ts`); tabelas sensíveis
  (vínculos, convites, auditoria, configurações) também verificam permissão no banco.

## Núcleo financeiro (modelo)

* **Títulos** (`titles`): contas a pagar/receber, uma linha por parcela. `paid_cents` e `status`
  são mantidos pelo banco a partir das movimentações (a aplicação não tem permissão de gravá-los).
* **Movimentações** (`cash_movements`): o razão do caixa, **imutável**. Tipos: saldo inicial,
  baixa de título, transferência, ajuste e estorno. Correções sempre por estorno/ajuste.
* **Receita/despesa realizada** = baixa de título (uma despesa paga na hora é um título com baixa
  imediata — sem duplicidade entre "despesas" e "contas a pagar").
* **Transferências** geram duas movimentações e nunca entram em receitas/despesas.
* Valores em **centavos (bigint)**; datas de calendário como `date` (sem fuso).
* Critérios únicos para painel, fluxo de caixa e relatórios estão documentados em
  `src/domains/finance/reports.ts` e cobertos por testes de consistência.

## Segmentos e módulos

* Um **segmento** (registro em código) define a configuração inicial: categorias com códigos
  estáveis, módulos sugeridos, indicadores e rótulos. Não altera o núcleo.
* Um **módulo** declara funcionalidade comercial exigida, permissões, dependências e efeitos
  financeiros, e usa somente os serviços centrais (`createTitleInternal`, `settleInternal`,
  `transferInternal`, `reverseMovementInternal`) para gerar efeitos financeiros.
* Disponível = plano concede **e** não desligado globalmente **e** habilitado pela empresa.
* Para adicionar um segmento: incluir em `segments/registry.ts`; se houver módulo próprio, criar
  migração com tabelas tipadas (com `tenant_id`, FKs compostas e RLS), registrar em
  `modules/registry.ts`, criar a funcionalidade em `billing/catalog.ts` e associá-la aos planos.

## Comercial

* Planos, preços (mensal/anual), funcionalidades e limites são **dados** (painel admin).
* `Entitlements` = plano + ajustes por empresa; calculado a cada requisição no servidor.
* Máquina de estados em `billing/state-machine.ts`; o banco espelha a política de acesso em
  `saas.tenant_access_level()`.
* Ciclo de cobrança (`runBillingCycle`) é idempotente e processa cada assinatura em transação
  própria. Webhooks são autenticados e deduplicados por `(provider, provider_event_id)`.

## Evolução do banco

* Migrações numeradas em `db/migrations`, aplicadas em ordem com bloqueio consultivo e
  **checksum**: um arquivo já aplicado não pode ser alterado — toda mudança é uma nova migração.
* Mudanças devem ser compatíveis com a versão anterior da aplicação durante o deploy
  (adicionar coluna nula → preencher → tornar obrigatória em migração posterior).
