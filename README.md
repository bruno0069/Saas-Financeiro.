# Gestão Financeira — SaaS multiempresa para pequenos negócios

Plataforma SaaS de gestão financeira para pequenos negócios brasileiros: **multi-tenant**,
**multissegmento** e **modular**. Um núcleo financeiro único atende todos os segmentos; cada
segmento recebe configuração inicial e módulos complementares. Segmento implementado nesta
versão: **Padaria** (fechamento de caixa e produção/margens).

> Estado: base funcional para **piloto controlado**. Ainda **não** está pronta para produção
> comercial — ver [Limitações conhecidas](#limitações-conhecidas) e [Integrações pendentes](#integrações-pendentes).

> **Só quer abrir o programa?** Veja [COMO-ABRIR.md](COMO-ABRIR.md): instale o Node.js e clique em
> `Iniciar (Windows).bat` ou `Iniciar (Mac).command` — banco, dados de demonstração e navegador são preparados automaticamente.

## O que está pronto (implementado e testado)

* **Fundação**: cadastro/login (scrypt, sessões no banco), confirmação de e-mail, recuperação de
  senha, limitação de tentativas, criação **atômica** de empresa (com retomada do onboarding).
* **Isolamento multi-tenant** com RLS no PostgreSQL, identidade derivada do token de sessão dentro
  do banco e FKs compostas por tenant. Tentativas de acesso cruzado são testadas.
* **Usuários e permissões**: proprietário, gerente, financeiro e operador; ajustes finos por usuário;
  convites com limite do plano; remoção preservando registros; transferência de propriedade; proteção
  contra autoescalonamento (no serviço e no banco).
* **Núcleo financeiro**: contas (caixa, banco, carteiras, recebíveis) com saldo inicial explícito;
  contas a pagar/receber com parcelamento; baixas parciais; receitas/despesas já realizadas sem
  duplicidade; transferências; ajustes com motivo; estornos; cancelamentos; categorias;
  clientes/fornecedores; painel; fluxo de caixa realizado e previsto; relatórios por categoria,
  previsto × realizado, comparativo de períodos, contas vencidas; exportação CSV.
* **Módulo Padaria — Fechamento de caixa**: vendas por forma de pagamento, troco, sangrias, conferência
  (quebra/sobra), recebíveis de cartão com prazo e taxa da maquininha, confirmação de repasse, estorno do
  fechamento. Todos os efeitos financeiros passam pelos serviços centrais.
* **Módulo Padaria — Produção e margens**: insumos, fichas técnicas, custo unitário, margem por produto
  e registro de perdas (indicadores, sem lançamentos financeiros).
* **Comercial**: planos configuráveis (preço mensal/anual, funcionalidades e limites), avaliação
  gratuita, máquina de estados da assinatura, ciclo de cobrança, política de acesso (somente leitura
  sem apagar dados), webhook de pagamento autenticado e idempotente, troca de plano com verificação
  de limites, cancelamento e reativação.
* **Painel da plataforma** (`/admin`): MRR/ARR contratado, faturado × recebido, inadimplência,
  conversão de avaliações, cancelamentos, uso de módulos (só contagens), empresas, planos, ajustes de
  funcionalidades/limites por empresa, faturas (baixa manual), webhooks, auditoria, operação e
  configurações globais. **Sem acesso aos dados financeiros dos clientes**; suporte só com concessão
  temporária do proprietário, somente leitura e auditado.
* **Auditoria** imutável de operações críticas; **LGPD**: exportação de dados da empresa e pessoais,
  exclusão de conta com anonimização preservando registros financeiros.
* Interface responsiva em português, formato monetário brasileiro, estados vazios, confirmações de
  operações críticas, navegação por teclado.

## Stack

Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL 16
(RLS) · `pg` · Zod · Vitest (integração com banco real) · Playwright (E2E).
Sem ORM e sem serviços adicionais: o banco é a fonte das regras críticas.
Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Como executar (desenvolvimento)

Pré-requisitos: Node.js ≥ 20.11 e PostgreSQL ≥ 15 local.

```bash
# 1. Banco: um papel dono (não precisa ser superusuário, mas precisa de CREATEROLE) e dois bancos
psql -U postgres -c "create role saas_owner login createdb createrole password 'devowner'"
psql -U postgres -c "create database saas_dev owner saas_owner"
psql -U postgres -c "create database saas_test owner saas_owner"

# 2. Configuração
cp .env.example .env          # ajuste as URLs/senhas
npm install

# 3. Esquema, papel da aplicação e dados FICTÍCIOS de demonstração
npm run db:migrate
npm run db:roles
npm run db:seed               # dono@demo.local / admin@demo.local, senha: demonstracao123

# 4. Aplicação
npm run dev                   # http://localhost:3000
```

Em desenvolvimento os e-mails (confirmação, convites, senha) são impressos no terminal
(`MAIL_PROVIDER=console`).

Outros comandos:

| Comando | Uso |
|---|---|
| `npm run admin:grant -- email [superadmin\|support\|billing]` | Torna um usuário administrador da plataforma. |
| `npm run job:billing` | Executa o ciclo de cobrança (também via `GET /api/cron/billing`). |
| `npm run typecheck` | Verificação de tipos. |

## Testes

```bash
npm test             # testes de integração: recria o schema em saas_test e roda contra PostgreSQL real
npm run build && npm start   # em outro terminal, com o banco de desenvolvimento semeado
npm run test:e2e     # Playwright (desktop e celular). Se usar o Chromium do sistema:
                     # PLAYWRIGHT_CHROMIUM_PATH=/caminho/do/chrome npm run test:e2e
```

Cobertura por requisito (arquivos em `tests/` e `e2e/`):

| Requisito | Onde |
|---|---|
| Criação de empresa, proprietário, falha no meio do cadastro, e-mail obrigatório | `tenancy.test.ts` |
| Isolamento (serviço, RLS com tenant forjado, gravação cruzada, sem sessão, colunas sensíveis, FKs) | `tenancy.test.ts` |
| Permissões, autoescalonamento, convites, remoção, transferência de propriedade | `access-billing.test.ts` |
| Contas, saldo inicial, receitas, despesas, baixas parciais, parcelas, transferências, estornos, cancelamentos, imutabilidade, ajustes | `finance.test.ts` |
| Consistência painel × fluxo de caixa × relatórios × previsão | `finance.test.ts` |
| Limites e funcionalidades do plano, módulos, downgrade, overrides | `access-billing.test.ts` |
| Máquina de estados, ciclo de cobrança, suspensão/somente leitura, webhook duplicado/inválido, cancelamento | `access-billing.test.ts` |
| Proteção das rotas admin, admin sem acesso a dados financeiros, suporte com concessão, MRR | `access-billing.test.ts` |
| Fluxos da Padaria (fechamento, cartões, sangria, quebra, estorno, margens, perdas) | `padaria.test.ts` |
| Utilitários (dinheiro, datas, CPF/CNPJ, CSV) | `unit.test.ts` |
| Persistência, telas principais, lançamento pela interface, responsividade (sem rolagem horizontal), menu móvel | `e2e/smoke.spec.ts` |

## Documentação

* [docs/ARQUITETURA.md](docs/ARQUITETURA.md) — organização, multi-tenant, modelo financeiro, módulos, migrações.
* [docs/SEGURANCA.md](docs/SEGURANCA.md) — controles, auditoria, LGPD, retenção, resposta a incidentes.
* [docs/OPERACAO.md](docs/OPERACAO.md) — implantação, observabilidade, backup e recuperação.
* [docs/INTEGRACOES.md](docs/INTEGRACOES.md) — pagamentos, e-mail e integrações pendentes.

## Integrações pendentes

* **Asaas — criação de cobranças/clientes** (API de saída) e checkout: estrutura e webhook prontos;
  falta conta, credenciais e homologação no sandbox. Até lá, use o provedor `manual`.
* **E-mail transacional real** (Resend implementado, não validado sem credenciais).
* **Monitoramento de erros e alertas** (ex.: Sentry) — depende do serviço escolhido.
* Avisos de vencimento por e-mail (preferência já existe; falta o job de envio).

## Limitações conhecidas

* Juros, multa e desconto na baixa de títulos não são tratados (a baixa é pelo valor do título).
* Sem conciliação bancária (OFX/Open Finance) e sem integração com PDV/maquininhas: o fechamento de
  caixa é digitado.
* Múltiplas unidades/filiais não implementadas.
* Sem pró-rata na troca de plano (novo valor vale a partir da próxima cobrança).
* Exclusão definitiva de uma empresa após o prazo de retenção é procedimento manual documentado,
  não automatizado.
* Sem MFA (recomendado ao menos para administradores da plataforma antes de produção).
* Anexos de arquivos (comprovantes) não implementados.
* Segmentos além de Padaria têm apenas configuração inicial (categorias); não há módulos próprios.
* Indicadores são gerenciais (regime de caixa) e não substituem demonstrações contábeis.
* Termos de uso e política de privacidade são modelos e precisam de revisão jurídica.
* Antes de produção: revisão de segurança independente (pentest), teste de carga, revisão de
  índices com volume real e definição de SLA/RPO/RTO com o provedor de banco.
