import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/domains/audit/audit";
import { loadPlatformSettings } from "@/domains/platform-settings";
import { one, rows, withSystemTx, type Db } from "@/server/db/pool";
import { assertTransition, type SubscriptionStatus } from "./state-machine";

/**
 * Serviço de assinaturas. Executa em CONTEXTO DE SISTEMA (dono das tabelas) porque as escritas
 * de cobrança não são permitidas ao papel da aplicação. Todas as funções públicas exigem um
 * `Actor` explícito, e os chamadores (ações do cliente / painel admin / webhooks / jobs)
 * são responsáveis por verificar a autorização antes de chamar.
 */
export type Actor =
  | { type: "user"; userId: string }
  | { type: "platform_admin"; userId: string }
  | { type: "system" }
  | { type: "provider"; provider: string };

export type SubscriptionRow = {
  id: string;
  tenant_id: string;
  plan_id: string;
  billing_interval: "monthly" | "yearly";
  price_cents: number;
  status: SubscriptionStatus;
  trial_ends_at: Date | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  next_billing_at: Date | null;
  past_due_since: Date | null;
  canceled_at: Date | null;
  provider: string;
};

const actorUser = (a: Actor) => ("userId" in a ? a.userId : null);
const auditActor = (a: Actor) => (a.type === "user" ? "user" : a.type);

async function recordEvent(db: Db, sub: SubscriptionRow, e: {
  type: string; from?: string | null; to?: string | null; fromPlan?: string | null; toPlan?: string | null; actor: Actor; reason?: string | null;
}) {
  await db.query(
    `insert into saas.subscription_events (subscription_id, tenant_id, event_type, from_status, to_status, from_plan_id, to_plan_id,
                                           actor_type, actor_user_id, reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [sub.id, sub.tenant_id, e.type, e.from ?? null, e.to ?? null, e.fromPlan ?? null, e.toPlan ?? null, e.actor.type,
     actorUser(e.actor), e.reason ?? null]);
  await writeAudit(db, {
    tenantId: sub.tenant_id, actorUserId: actorUser(e.actor), actorType: auditActor(e.actor), action: "subscription.change",
    entityType: "subscription", entityId: sub.id, reason: e.reason ?? null,
    metadata: { event: e.type, from: e.from ?? null, to: e.to ?? null, to_plan: e.toPlan ?? null },
  });
}

export async function lockSubscription(db: Db, id: string): Promise<SubscriptionRow> {
  const s = await one<SubscriptionRow>(db, "select * from saas.subscriptions where id = $1 for update", [id]);
  if (!s) throw new NotFoundError("Assinatura não encontrada.");
  return s;
}

export async function currentSubscriptionId(db: Db, tenantId: string): Promise<string | null> {
  const r = await one<{ id: string }>(db, "select id from saas.subscriptions where tenant_id = $1 and status <> 'ended'", [tenantId]);
  return r?.id ?? null;
}

export async function transition(db: Db, sub: SubscriptionRow, to: SubscriptionStatus, actor: Actor, reason?: string) {
  if (sub.status === to) return sub;
  assertTransition(sub.status, to);
  const extra: string[] = [];
  if (to === "past_due") extra.push("past_due_since = coalesce(past_due_since, now())");
  if (to === "active") extra.push("past_due_since = null", "canceled_at = null", "cancel_reason = null");
  if (to === "canceled") extra.push("canceled_at = now()", "cancel_reason = $3");
  if (to === "ended") extra.push("ended_at = now()");
  const sql = `update saas.subscriptions set status = $2${extra.length ? ", " + extra.join(", ") : ""} where id = $1 returning *`;
  const params = to === "canceled" ? [sub.id, to, reason ?? null] : [sub.id, to];
  const updated = await one<SubscriptionRow>(db, sql, params);
  await recordEvent(db, sub, { type: "status_changed", from: sub.status, to, actor, reason });
  return updated!;
}

export async function planPrice(db: Db, planId: string, interval: "monthly" | "yearly") {
  const p = await one<{ price_cents: number; trial_days: number; is_active: boolean }>(db,
    `select pp.price_cents, p.trial_days, p.is_active and pp.is_active as is_active
       from saas.plans p join saas.plan_prices pp on pp.plan_id = p.id and pp.billing_interval = $2
      where p.id = $1`, [planId, interval]);
  if (!p) throw new ValidationError("Plano/periodicidade indisponível.");
  return p;
}

export async function createTrialSubscription(db: Db, tenantId: string, actor: Actor) {
  const plan = await one<{ id: string }>(db, "select id from saas.plans where is_default and is_active");
  if (!plan) throw new AppError("Nenhum plano padrão configurado. Contate o suporte.", "no_default_plan", 500);
  const price = await planPrice(db, plan.id, "monthly");
  const sub = await one<SubscriptionRow>(db,
    `insert into saas.subscriptions (tenant_id, plan_id, billing_interval, price_cents, status, trial_ends_at,
                                     current_period_start, current_period_end, next_billing_at)
     values ($1, $2, 'monthly', $3, 'trialing', now() + make_interval(days => $4), now(),
             now() + make_interval(days => $4), now() + make_interval(days => $4))
     returning *`, [tenantId, plan.id, price.price_cents, price.trial_days]);
  await recordEvent(db, sub!, { type: "created", to: "trialing", toPlan: plan.id, actor });
  return sub!;
}

/** Uso atual do tenant, para validar downgrades contra os limites do novo plano. */
async function usage(db: Db, tenantId: string) {
  return (await one<{ users: number; accounts: number }>(db,
    `select (select count(*)::int from saas.memberships where tenant_id = $1 and status = 'active') as users,
            (select count(*)::int from saas.financial_accounts where tenant_id = $1 and is_active) as accounts`, [tenantId]))!;
}

export async function changePlan(subscriptionId: string, planId: string, interval: "monthly" | "yearly", actor: Actor, reason?: string) {
  return withSystemTx(async (db) => {
    const sub = await lockSubscription(db, subscriptionId);
    if (["ended", "canceled"].includes(sub.status)) throw new ValidationError("Reative a assinatura antes de trocar de plano.");
    const price = await planPrice(db, planId, interval);
    if (!price.is_active && actor.type !== "platform_admin") throw new ValidationError("Plano indisponível para contratação.");
    const limits = new Map((await rows<{ limit_key: string; limit_value: number | null }>(db,
      "select limit_key, limit_value from saas.plan_limits where plan_id = $1", [planId])).map((l) => [l.limit_key, l.limit_value]));
    const u = await usage(db, sub.tenant_id);
    const maxUsers = limits.get("max_users");
    const maxAccounts = limits.get("max_financial_accounts");
    if (maxUsers != null && u.users > maxUsers) {
      throw new ValidationError(`O plano escolhido permite ${maxUsers} usuário(s); a empresa possui ${u.users} ativos. Remova usuários antes.`);
    }
    if (maxAccounts != null && u.accounts > maxAccounts) {
      throw new ValidationError(`O plano escolhido permite ${maxAccounts} conta(s) financeira(s) ativa(s); a empresa possui ${u.accounts}.`);
    }
    // O novo preço vale a partir da próxima cobrança; o período atual não é recalculado (sem pró-rata).
    await db.query("update saas.subscriptions set plan_id = $2, billing_interval = $3, price_cents = $4 where id = $1",
      [sub.id, planId, interval, price.price_cents]);
    await recordEvent(db, sub, { type: "plan_changed", fromPlan: sub.plan_id, toPlan: planId, actor, reason });
  });
}

export async function cancelSubscription(subscriptionId: string, actor: Actor, reason: string) {
  return withSystemTx(async (db) => {
    const sub = await lockSubscription(db, subscriptionId);
    await transition(db, sub, "canceled", actor, reason);
    await db.query("update saas.invoices set status = 'canceled' where subscription_id = $1 and status in ('pending', 'overdue')", [sub.id]);
  });
}

export async function reactivateSubscription(subscriptionId: string, actor: Actor) {
  return withSystemTx(async (db) => {
    const sub = await lockSubscription(db, subscriptionId);
    if (sub.status !== "canceled") throw new ValidationError("Somente assinaturas canceladas podem ser reativadas aqui.");
    if (!sub.current_period_end || sub.current_period_end <= new Date()) {
      throw new ValidationError("O período contratado já terminou. Uma nova cobrança será necessária.");
    }
    // Cancelada durante a avaliação volta para avaliação; cancelada com período pago volta a ativa.
    if (sub.trial_ends_at && sub.current_period_end.getTime() === sub.trial_ends_at.getTime()) {
      await db.query("update saas.subscriptions set status = 'trialing', canceled_at = null, cancel_reason = null where id = $1", [sub.id]);
      await recordEvent(db, sub, { type: "reactivated", from: "canceled", to: "trialing", actor });
    } else {
      await transition(db, sub, "active", actor, "Reativação");
    }
  });
}

function addInterval(d: Date, interval: "monthly" | "yearly"): Date {
  const n = new Date(d);
  if (interval === "yearly") n.setUTCFullYear(n.getUTCFullYear() + 1);
  else n.setUTCMonth(n.getUTCMonth() + 1);
  return n;
}

/** Emite a fatura do próximo período (idempotente por período). */
export async function issueInvoice(db: Db, sub: SubscriptionRow, dueDays: number) {
  const start = sub.current_period_end ?? new Date();
  const end = addInterval(start, sub.billing_interval);
  const due = new Date(start.getTime() + dueDays * 86400000).toISOString().slice(0, 10);
  const inv = await one<{ id: string }>(db,
    `insert into saas.invoices (tenant_id, subscription_id, amount_cents, period_start, period_end, due_date, provider)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (subscription_id, period_start) do nothing returning id`,
    [sub.tenant_id, sub.id, sub.price_cents, start, end, due, sub.provider]);
  return inv?.id ?? null;
}

/**
 * Confirma o pagamento de uma fatura (idempotente). Deve ser chamado apenas a partir de uma
 * confirmação confiável: webhook autenticado do provedor ou baixa manual por administrador.
 */
export async function markInvoicePaid(db: Db, invoiceId: string, p: {
  paidAt?: Date; amountCents?: number; method?: string | null; actor: Actor;
}): Promise<"paid" | "already_paid"> {
  const inv = await one<{ id: string; status: string; subscription_id: string; amount_cents: number; period_start: Date; period_end: Date }>(db,
    "select id, status, subscription_id, amount_cents, period_start, period_end from saas.invoices where id = $1 for update", [invoiceId]);
  if (!inv) throw new NotFoundError("Fatura não encontrada.");
  if (inv.status === "paid") return "already_paid";
  if (inv.status === "canceled" || inv.status === "refunded") {
    throw new ValidationError("Fatura cancelada/estornada não pode ser marcada como paga.");
  }
  await db.query(
    "update saas.invoices set status = 'paid', paid_at = $2, paid_amount_cents = $3, payment_method = $4 where id = $1",
    [inv.id, p.paidAt ?? new Date(), p.amountCents ?? inv.amount_cents, p.method ?? null]);
  const sub = await lockSubscription(db, inv.subscription_id);
  if (["trialing", "pending_payment", "past_due", "suspended"].includes(sub.status)) {
    await transition(db, sub, "active", p.actor, "Pagamento confirmado");
  }
  if (sub.status !== "ended") {
    await db.query(
      `update saas.subscriptions set current_period_start = $2, current_period_end = greatest(coalesce(current_period_end, $3), $3),
              next_billing_at = greatest(coalesce(current_period_end, $3), $3)
        where id = $1`, [sub.id, inv.period_start, inv.period_end]);
  }
  return "paid";
}

export type CycleStats = { invoices_issued: number; to_past_due: number; to_suspended: number; to_ended: number; errors: number };

/**
 * Job do ciclo de cobrança. Cada assinatura é processada em transação própria, isolando falhas
 * e evitando misturar dados de empresas diferentes.
 */
export async function runBillingCycle(now = new Date()): Promise<CycleStats> {
  const stats: CycleStats = { invoices_issued: 0, to_past_due: 0, to_suspended: 0, to_ended: 0, errors: 0 };
  const run = await withSystemTx((db) => one<{ id: string }>(db, "insert into saas.job_runs (job) values ('billing_cycle') returning id"));
  const settings = await withSystemTx((db) => loadPlatformSettings(db));
  const candidates = await withSystemTx((db) => rows<{ id: string }>(db,
    `select id from saas.subscriptions
      where (status in ('trialing', 'active') and current_period_end <= $1)
         or status in ('pending_payment', 'past_due')
         or (status = 'canceled' and current_period_end <= $1)`, [now]));
  const actor: Actor = { type: "system" };
  for (const c of candidates) {
    try {
      await withSystemTx(async (db) => {
        let sub = await lockSubscription(db, c.id);
        if ((sub.status === "trialing" || sub.status === "active") && sub.current_period_end && sub.current_period_end <= now) {
          if (await issueInvoice(db, sub, settings.invoiceDueDays)) stats.invoices_issued++;
          sub = await transition(db, sub, "pending_payment", actor, "Fim do período: fatura emitida");
        }
        if (sub.status === "pending_payment") {
          const overdue = await rows<{ id: string }>(db,
            `update saas.invoices set status = 'overdue'
              where subscription_id = $1 and status in ('pending', 'overdue') and due_date < $2::date returning id`,
            [sub.id, now.toISOString().slice(0, 10)]);
          if (overdue.length) {
            sub = await transition(db, sub, "past_due", actor, "Fatura vencida");
            stats.to_past_due++;
          }
        }
        if (sub.status === "past_due") {
          const since = sub.past_due_since ?? now;
          if (now.getTime() - new Date(since).getTime() > settings.graceDaysBeforeSuspension * 86400000) {
            sub = await transition(db, sub, "suspended", actor, `Atraso superior a ${settings.graceDaysBeforeSuspension} dias`);
            stats.to_suspended++;
          }
        }
        if (sub.status === "canceled" && sub.current_period_end && sub.current_period_end <= now) {
          await transition(db, sub, "ended", actor, "Fim do período após cancelamento");
          stats.to_ended++;
        }
      });
    } catch (err) {
      stats.errors++;
      logger.error("billing cycle failed for subscription", { subscription_id: c.id, err: (err as Error).message });
      await withSystemTx((db) => db.query(
        "insert into saas.ops_events (level, source, message, context) values ('error', 'job.billing_cycle', $1, $2)",
        [(err as Error).message.slice(0, 500), JSON.stringify({ subscription_id: c.id })])).catch(() => {});
    }
  }
  await withSystemTx((db) => db.query(
    "update saas.job_runs set finished_at = now(), status = $2, stats = $3 where id = $1",
    [run!.id, stats.errors ? "failed" : "succeeded", JSON.stringify(stats)]));
  return stats;
}
