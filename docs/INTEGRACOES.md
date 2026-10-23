# Integrações

## Pagamentos (assinaturas do SaaS)

### Situação

| Item | Situação |
|---|---|
| Estrutura de planos, preços, assinaturas, faturas e máquina de estados | **Implementado e testado** |
| Ciclo de cobrança (emissão de fatura, atraso, suspensão, encerramento) | **Implementado e testado** |
| Provedor `manual` (administrador confirma o pagamento no painel, com referência obrigatória) | **Implementado e testado** |
| Recebimento de webhooks do Asaas (autenticação por token, idempotência, reprocessamento de falhas) | **Implementado e testado com eventos simulados** |
| Criação de clientes/cobranças/assinaturas no Asaas (API de saída) | **PENDENTE** — requer conta, `ASAAS_API_KEY` e homologação no sandbox |
| Checkout/link de pagamento para o cliente final | **PENDENTE** (depende do item acima) |
| Notas fiscais de serviço do SaaS | **PENDENTE** (fora do escopo atual; avaliar emissor de NFS-e) |

### Por que Asaas

Provedor brasileiro com cobrança recorrente via PIX, boleto e cartão, API REST e webhooks com token
de autenticação. Alternativas equivalentes: Iugu, Pagar.me, Mercado Pago. A arquitetura isola o
provedor em `src/domains/billing/providers.ts`; outro provedor exige um novo *handler* de webhook e
um adaptador de criação de cobrança.

### Pontos de integração para concluir o Asaas

1. Ao converter avaliação/emitir fatura (`issueInvoice` em `subscriptions.ts`), chamar a API:
   `POST /customers` (uma vez por empresa; guardar em `subscriptions.provider_customer_id`) e
   `POST /payments` com `externalReference = invoices.id`; guardar `payment.id` em
   `invoices.provider_charge_id`.
2. Alternativamente usar `POST /subscriptions` do Asaas e mapear cada cobrança gerada por webhook.
3. Configurar no painel Asaas o webhook para `/api/webhooks/asaas`, eventos `PAYMENT_*`, com o token
   de autenticação igual a `ASAAS_WEBHOOK_TOKEN`.
4. Homologar no sandbox: pagamento confirmado, recebido, vencido, estornado e reenvio de evento.
5. A confirmação de pagamento **nunca** deve vir do redirecionamento do navegador — somente do webhook
   autenticado ou de consulta servidor-a-servidor à API.

## E-mail transacional

* `MAIL_PROVIDER=console` (desenvolvimento): imprime no terminal; **bloqueado em produção**.
* `MAIL_PROVIDER=resend`: implementado via API HTTP, **não validado** (sem credenciais no ambiente).
* Usado em: confirmação de e-mail, redefinição de senha e convites.
* **Pendente**: avisos de vencimento por e-mail (a preferência `notify_due_days` já existe na
  empresa; falta o job de envio).

## Outras integrações não implementadas

* Conciliação bancária (OFX/Open Finance).
* Emissão de NF-e/NFC-e para as vendas da padaria.
* Integração com PDV/maquininhas (importação automática das vendas do dia) — hoje o fechamento é digitado.
