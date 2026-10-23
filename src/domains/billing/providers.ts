import { logger } from "@/lib/logger";
import { safeEqual } from "@/server/auth/crypto";
import { one, withSystemTx, type Db } from "@/server/db/pool";
import { lockSubscription, markInvoicePaid, transition } from "./subscriptions";

/**
 * Integração com provedores de pagamento.
 *
 * - "manual": nenhuma cobrança externa; o administrador confirma o pagamento no painel
 *   (útil para piloto, PIX manual ou boleto emitido fora da plataforma).
 * - "asaas": provedor brasileiro com cobrança recorrente (PIX, boleto e cartão) e webhooks.
 *   O RECEBIMENTO DE WEBHOOKS está implementado e testado com eventos simulados.
 *   A CRIAÇÃO DE COBRANÇAS/CLIENTES NO ASAAS está PENDENTE: exige credenciais e homologação
 *   no sandbox; ver docs/INTEGRACOES.md. Nenhuma chamada é feita sem ASAAS_API_KEY.
 */

export type WebhookResult = { status: number; body: string };

type AsaasEvent = {
  id?: string;
  event?: string;
  payment?: { id?: string; externalReference?: string | null; value?: number; status?: string; billingType?: string; paymentDate?: string | null };
};

const PAID_EVENTS = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]);

async function findInvoice(db: Db, ev: AsaasEvent) {
  const chargeId = ev.payment?.id ?? null;
  const ref = ev.payment?.externalReference ?? null;
  return one<{ id: string; tenant_id: string; subscription_id: string; amount_cents: number }>(db,
    `select id, tenant_id, subscription_id, amount_cents from saas.invoices
      where (provider = 'asaas' and provider_charge_id = $1)
         or ($2::text ~ '^[0-9a-f-]{36}$' and id = $2::uuid)
      limit 1`, [chargeId, ref]);
}

/**
 * Processa um webhook do Asaas.
 * 1) Autentica pelo token configurado no painel do provedor (comparação em tempo constante).
 * 2) Registra o evento com chave única (provider, id) — reenvios não são processados de novo.
 * 3) Atualiza fatura/assinatura na mesma transação do registro.
 */
export async function handleAsaasWebhook(headers: Headers, rawBody: string): Promise<WebhookResult> {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  const received = headers.get("asaas-access-token") ?? "";
  if (!expected || !safeEqual(received, expected)) {
    logger.warn("asaas webhook rejected: invalid token");
    return { status: 401, body: "unauthorized" };
  }
  if (rawBody.length > 256 * 1024) return { status: 413, body: "payload too large" };
  let ev: AsaasEvent;
  try {
    ev = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: "invalid json" };
  }
  const eventId = ev.id ?? (ev.payment?.id && ev.event ? `${ev.event}:${ev.payment.id}` : null);
  if (!eventId || !ev.event) return { status: 400, body: "missing event id" };

  try {
    return await withSystemTx(async (db) => {
      await db.query(
        `insert into saas.billing_events (provider, provider_event_id, event_type, payload)
         values ('asaas', $1, $2, $3) on conflict (provider, provider_event_id) do nothing`,
        [eventId, ev.event, rawBody]);
      const stored = await one<{ id: string; status: string }>(db,
        "select id, status from saas.billing_events where provider = 'asaas' and provider_event_id = $1 for update", [eventId]);
      if (stored!.status === "processed" || stored!.status === "ignored") {
        return { status: 200, body: "duplicate" };
      }
      const invoice = await findInvoice(db, ev);
      let outcome: "processed" | "ignored" = "ignored";
      if (invoice) {
        if (PAID_EVENTS.has(ev.event!)) {
          await markInvoicePaid(db, invoice.id, {
            paidAt: ev.payment?.paymentDate ? new Date(`${ev.payment.paymentDate}T12:00:00Z`) : new Date(),
            amountCents: typeof ev.payment?.value === "number" ? Math.round(ev.payment.value * 100) : undefined,
            method: ev.payment?.billingType ?? null,
            actor: { type: "provider", provider: "asaas" },
          });
          outcome = "processed";
        } else if (ev.event === "PAYMENT_OVERDUE") {
          await db.query("update saas.invoices set status = 'overdue' where id = $1 and status = 'pending'", [invoice.id]);
          const sub = await lockSubscription(db, invoice.subscription_id);
          if (sub.status === "pending_payment" || sub.status === "active") {
            await transition(db, sub, "past_due", { type: "provider", provider: "asaas" }, "Provedor informou atraso");
          }
          outcome = "processed";
        } else if (ev.event === "PAYMENT_REFUNDED") {
          // Estorno não altera a assinatura automaticamente; fica registrado para análise do time financeiro.
          await db.query("update saas.invoices set status = 'refunded' where id = $1", [invoice.id]);
          outcome = "processed";
        }
      }
      await db.query("update saas.billing_events set status = $2, processed_at = now(), tenant_id = $3 where id = $1",
        [stored!.id, outcome, invoice?.tenant_id ?? null]);
      return { status: 200, body: outcome };
    });
  } catch (err) {
    logger.error("asaas webhook processing failed", { event_id: eventId, err: (err as Error).message });
    await withSystemTx(async (db) => {
      await db.query(
        `insert into saas.billing_events (provider, provider_event_id, event_type, payload, status, error)
         values ('asaas', $1, $2, $3, 'failed', $4)
         on conflict (provider, provider_event_id) do update set status = 'failed', error = excluded.error`,
        [eventId, ev.event, rawBody, (err as Error).message.slice(0, 500)]);
      await db.query("insert into saas.ops_events (level, source, message, context) values ('error', 'webhook.asaas', $1, $2)",
        [(err as Error).message.slice(0, 500), JSON.stringify({ event_id: eventId, event: ev.event })]);
    }).catch(() => {});
    // 500 faz o provedor reenviar; o evento com status 'failed' será reprocessado.
    return { status: 500, body: "processing error" };
  }
}

/** Ponto de integração para criação de cobranças no provedor. PENDENTE para "asaas". */
export function paymentProviderName(): "manual" | "asaas" {
  return process.env.PAYMENT_PROVIDER === "asaas" ? "asaas" : "manual";
}
