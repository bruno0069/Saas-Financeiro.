# Segurança, privacidade e auditoria

## Controles implementados

| Área | Controle |
|---|---|
| Senhas | scrypt (N=16384, r=8, p=1) com sal aleatório; comparação em tempo constante; mínimo de 10 caracteres. |
| Sessões | Token aleatório de 256 bits em cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção; no banco apenas o SHA-256. Expiram em 30 dias; revogadas no logout e na troca de senha. |
| Enumeração de contas | Login e recuperação de senha respondem de forma idêntica para e-mails inexistentes (inclusive tempo de hash). |
| Limitação de requisições | Janela fixa persistida no banco: login (por IP e por e-mail), cadastro, recuperação de senha, convites e criação de empresas. |
| CSRF | Server Actions do Next.js validam a origem; cookies `SameSite=Lax`; webhooks autenticados por token. |
| Cabeçalhos | CSP restritiva, `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy`. |
| Isolamento | RLS em todas as tabelas com dados de clientes, identidade derivada do token no banco, FKs compostas por tenant. Testado em `tests/tenancy.test.ts`. |
| Privilégios de banco | Papel da aplicação sem BYPASSRLS, sem DELETE nas tabelas financeiras, sem acesso a `sessions`, `auth_tokens`, `password_hash`; colunas sensíveis (`paid_cents`, saldo inicial) não graváveis. |
| Credenciais privilegiadas | `DATABASE_URL_OWNER`, `ASAAS_*`, `CRON_SECRET` existem apenas no servidor; nada é exposto ao navegador (sem variáveis `NEXT_PUBLIC_*`). |
| Validação | Zod em todas as entradas de serviço; CPF/CNPJ com dígitos verificadores; CSV com proteção contra injeção de fórmulas. |
| Logs | JSON estruturado com remoção automática de campos sensíveis (senhas, tokens, valores, CPF/CNPJ). |
| Escalonamento de privilégios | Gatilho `memberships_guard` impede alterar o próprio vínculo, conceder permissões que o ator não possui e transferir propriedade sem ser proprietário. |

## Auditoria

`saas.audit_log` registra quem, qual empresa, quando, operação, entidade, resultado e
justificativa. É **somente inclusão**: um gatilho bloqueia UPDATE/DELETE (inclusive para o
dono das tabelas), e o papel da aplicação só pode inserir registros em nome do usuário da sessão.
Tentativas negadas (`access.denied`) são registradas em transação separada.

Não são gravados valores financeiros nem dados pessoais desnecessários nos metadados.

## Acesso administrativo e suporte

* O painel `/admin` exige um registro em `platform_admins` (papéis `superadmin`, `support`,
  `billing`). As políticas RLS dão à plataforma acesso a cadastro de empresas, assinaturas,
  faturas e auditoria — **não** aos dados financeiros dos clientes.
* Métricas de uso de módulos usam uma função que retorna apenas contagens.
* **Suporte assistido**: o proprietário concede acesso temporário (máx. configurável, padrão 72 h)
  com motivo; o suporte informa a finalidade ao entrar; o acesso é somente leitura (bloqueado no
  banco por `can_write()`) e fica registrado na auditoria da empresa e da plataforma.

## LGPD

* **Finalidade/minimização**: cadastro exige só nome, e-mail e senha; dados fiscais são opcionais.
* **Papéis**: a empresa cliente é controladora dos dados que registra; a plataforma é operadora.
* **Direitos do titular**: exportação de dados pessoais (`/api/me/export`) e exclusão de conta
  com anonimização (`/conta`). Exportação completa da empresa pelo proprietário (`/api/export/full`).
* **Exclusão vs. registros empresariais**: excluir um usuário anonimiza seus dados pessoais, encerra
  sessões e remove vínculos, mas preserva os lançamentos financeiros (obrigação legal de guarda).
  Proprietários precisam transferir a propriedade antes.

## Política de retenção e encerramento

| Situação | Acesso | Dados |
|---|---|---|
| Em atraso | Pleno durante a carência (padrão 15 dias) | Preservados |
| Suspensa | Somente leitura + exportação | Preservados |
| Cancelada | Pleno até o fim do período pago, depois somente leitura | Preservados |
| Encerrada | Somente leitura + exportação pelo prazo de retenção (padrão 365 dias) | Preservados |
| Exclusão definitiva | Somente por solicitação do proprietário (ou procedimento documentado após o prazo), respeitando prazos fiscais | Removidos por procedimento manual auditado |

Nenhum dado financeiro é apagado automaticamente por inadimplência ou cancelamento.

## Resposta a incidentes (procedimento)

1. Conter: revogar sessões (`update saas.sessions set revoked_at = now() ...`), rotacionar
   `DATABASE_URL*`, `ASAAS_*`, `CRON_SECRET`; desligar módulos afetados em *Configurações globais*.
2. Investigar: `audit_log`, `ops_events`, logs da hospedagem (identificar tenants afetados).
3. Comunicar: avaliar risco aos titulares; comunicar a ANPD e os titulares quando aplicável
   (prazo orientativo de 3 dias úteis), e os clientes controladores afetados.
4. Corrigir e registrar lições aprendidas.

## Pendências de segurança antes de produção

Ver `README.md` → *Limitações conhecidas*. Em especial: revisão de segurança/pentest externo,
MFA para administradores da plataforma, revisão jurídica dos termos e da política de privacidade.
