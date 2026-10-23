import { z } from "zod";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "@/lib/errors";
import { monthStart } from "@/lib/dates";
import { moneyNonNegative, optionalText, parse, uuid } from "@/lib/validation";
import { writeAudit } from "@/domains/audit/audit";
import { isFeatureKey, isLimitKey } from "@/domains/billing/catalog";
import { monthlyValue, type SubscriptionStatus } from "@/domains/billing/state-machine";
import * as subs from "@/domains/billing/subscriptions";
import { PLATFORM_SETTING_KEYS, loadPlatformSettings, type PlatformSettings } from "@/domains/platform-settings";
import { one, rows, withAppTx, withSystemTx, type Db } from "@/server/db/pool";

export type AdminRole = "superadmin" | "support" | "billing";
export type AdminCtx = { db: Db; userId: string; name: string; role: AdminRole; requestId: string };

/**
 * Contexto do painel da plataforma: papel da aplicação + verificação de administrador no banco.
 * As políticas RLS dão acesso a cadastro de empresas, assinaturas e auditoria — NÃO aos dados
 * financeiros dos clientes (acesso a esses só via concessão de suporte do proprietário).
 */
export async function runAsAdmin<T>(sessionToken: string | null, required: AdminRole[] | null, fn: (a: AdminCtx) => Promise<T>, requestId = "") {
  if (!sessionToken) throw new UnauthenticatedError();
  return withAppTx({ sessionToken }, async (db) => {
    const u = await one<{ id: string; name: string; role: AdminRole | null }>(db,
      "select u.id, u.name, saas.platform_admin_role() as role from saas.users u where u.id = saas.current_user_id()");
    if (!u) throw new UnauthenticatedError();
    if (!u.role) throw new ForbiddenError("Área restrita à administração da plataforma.");
    if (required && u.role !== "superadmin" && !required.includes(u.role)) throw new ForbiddenError("Seu perfil administrativo não permite esta operação.");
    return fn({ db, userId: u.id, name: u.name, role: u.role, requestId });
  });
}

async function adminAudit(a: AdminCtx, action: string, entityType: string, entityId: string | null, metadata: Record<string, unknown> = {}, reason?: string, tenantId: string | null = null) {
  await writeAudit(a.db, { tenantId, actorUserId: a.userId, actorType: "platform_admin", action, entityType, entityId, metadata, reason, requestId: a.requestId });
}

/**
 * Indicadores comerciais. Definições:
 *  - MRR contratado: soma do valor mensal normalizado (anual/12) das assinaturas ativas, aguardando pagamento ou em atraso.
 *    Não inclui avaliações, suspensas, canceladas ou encerradas.
 *  - Faturado no mês: faturas emitidas no mês (exceto canceladas). Recebido no mês: faturas pagas no mês (valor pago).
 *  - Valores faturados e não pagos NÃO são receita recebida.
 *  - Conversão de avaliação (90 dias): avaliações encerradas nos últimos 90 dias que chegaram a "ativa".
 */
export async function metrics(a: AdminCtx) {
  const today = new Date().toISOString().slice(0, 10);
  const mStart = monthStart(today);
  const tenants = (await one<{ total: number; active: number }>(a.db,
    `select count(*)::int as total,
            count(*) filter (where t.status = 'active' and saas.tenant_access_level(t.id) = 'full')::int as active
       from saas.tenants t`))!;
  const byStatus = await rows<{ status: SubscriptionStatus; n: number }>(a.db,
    "select status, count(*)::int as n from saas.subscriptions group by status");
  const recurring = await rows<{ price_cents: number; billing_interval: "monthly" | "yearly" }>(a.db,
    "select price_cents, billing_interval from saas.subscriptions where status in ('active', 'pending_payment', 'past_due')");
  const mrr = recurring.reduce((s, r) => s + monthlyValue(r.price_cents, r.billing_interval), 0);
  const inv = (await one<{ billed: number; received: number; overdue: number; pending: number }>(a.db,
    `select coalesce(sum(amount_cents) filter (where issued_at >= $1::date and status <> 'canceled'), 0)::bigint as billed,
            coalesce(sum(paid_amount_cents) filter (where paid_at >= $1::date and status = 'paid'), 0)::bigint as received,
            coalesce(sum(amount_cents) filter (where status = 'overdue'), 0)::bigint as overdue,
            coalesce(sum(amount_cents) filter (where status = 'pending'), 0)::bigint as pending
       from saas.invoices`, [mStart]))!;
  const cancels = (await one<{ n: number }>(a.db,
    "select count(*)::int as n from saas.subscription_events where to_status = 'canceled' and created_at >= $1::date", [mStart]))!;
  const trials = (await one<{ ended: number; converted: number }>(a.db,
    `select count(*)::int as ended,
            count(*) filter (where exists (select 1 from saas.subscription_events e where e.subscription_id = s.id and e.to_status = 'active'))::int as converted
       from saas.subscriptions s where s.trial_ends_at between now() - interval '90 days' and now()`))!;
  const errors = (await one<{ ops: number; webhooks: number; jobs: number }>(a.db,
    `select (select count(*) from saas.ops_events where level = 'error' and created_at > now() - interval '7 days')::int as ops,
            (select count(*) from saas.billing_events where status = 'failed')::int as webhooks,
            (select count(*) from saas.job_runs where status = 'failed' and started_at > now() - interval '7 days')::int as jobs`))!;
  const lastJob = await one<{ started_at: Date; status: string }>(a.db,
    "select started_at, status from saas.job_runs where job = 'billing_cycle' order by started_at desc limit 1");
  const usage = await rows<{ module_key: string; tenants_enabled: number; tenants_active: number; events: number }>(a.db,
    "select * from saas.platform_module_usage(30)");
  return {
    tenants, byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s.n])) as Partial<Record<SubscriptionStatus, number>>,
    mrr_cents: mrr, arr_cents: mrr * 12, invoices: inv, cancellations_month: cancels.n,
    trial_conversion: trials.ended ? trials.converted / trials.ended : null, trials_ended_90d: trials.ended,
    errors, lastJob, usage,
  };
}

export async function listTenants(a: AdminCtx, q?: string) {
  return rows<{ id: string; trade_name: string; segment: string; status: string; created_at: Date; plan_name: string | null;
                sub_status: string | null; members: number }>(a.db,
    `select t.id, t.trade_name, t.segment, t.status, t.created_at, p.name as plan_name, s.status as sub_status,
            (select count(*)::int from saas.memberships m where m.tenant_id = t.id and m.status = 'active') as members
       from saas.tenants t
       left join saas.subscriptions s on s.tenant_id = t.id and s.status <> 'ended'
       left join saas.plans p on p.id = s.plan_id
      where ($1::text is null or t.trade_name ilike '%' || $1 || '%')
      order by t.created_at desc limit 200`, [q?.trim() || null]);
}

export async function tenantDetail(a: AdminCtx, tenantId: string) {
  parse(uuid, tenantId);
  const tenant = await one<{ id: string; trade_name: string; legal_name: string | null; segment: string; status: string; created_at: Date }>(a.db,
    "select id, trade_name, legal_name, segment, status, created_at from saas.tenants where id = $1", [tenantId]);
  if (!tenant) throw new NotFoundError("Empresa não encontrada.");
  const subscription = await one<subs.SubscriptionRow & { plan_name: string }>(a.db,
    `select s.*, p.name as plan_name from saas.subscriptions s join saas.plans p on p.id = s.plan_id
      where s.tenant_id = $1 order by (s.status = 'ended'), s.created_at desc limit 1`, [tenantId]);
  const invoices = await rows<{ id: string; amount_cents: number; status: string; due_date: string; period_start: Date; period_end: Date; paid_at: Date | null }>(a.db,
    "select id, amount_cents, status, due_date, period_start, period_end, paid_at from saas.invoices where tenant_id = $1 order by period_start desc limit 24", [tenantId]);
  const events = await rows<{ event_type: string; from_status: string | null; to_status: string | null; actor_type: string; reason: string | null; created_at: Date }>(a.db,
    "select event_type, from_status, to_status, actor_type, reason, created_at from saas.subscription_events where tenant_id = $1 order by created_at desc limit 30", [tenantId]);
  const members = await rows<{ name: string; email: string; role: string; status: string }>(a.db,
    "select u.name, u.email, m.role, m.status from saas.memberships m join saas.users u on u.id = m.user_id where m.tenant_id = $1", [tenantId]);
  const modules = await rows<{ module_key: string; enabled: boolean }>(a.db, "select module_key, enabled from saas.tenant_modules where tenant_id = $1", [tenantId]);
  const featureOverrides = await rows<{ feature_key: string; enabled: boolean; reason: string }>(a.db,
    "select feature_key, enabled, reason from saas.tenant_feature_overrides where tenant_id = $1", [tenantId]);
  const limitOverrides = await rows<{ limit_key: string; limit_value: number | null; reason: string }>(a.db,
    "select limit_key, limit_value, reason from saas.tenant_limit_overrides where tenant_id = $1", [tenantId]);
  const grant = await one<{ expires_at: Date; reason: string }>(a.db,
    `select expires_at, reason from saas.support_access_grants where tenant_id = $1 and revoked_at is null and expires_at > now()
      order by expires_at desc limit 1`, [tenantId]);
  return { tenant, subscription, invoices, events, members, modules, featureOverrides, limitOverrides, supportGrant: grant };
}

export async function listPlans(a: AdminCtx) {
  const plans = await rows<{ id: string; code: string; name: string; description: string; is_active: boolean; is_public: boolean;
                             is_default: boolean; trial_days: number; sort_order: number }>(a.db, "select * from saas.plans order by sort_order, name");
  const prices = await rows<{ plan_id: string; billing_interval: string; price_cents: number; is_active: boolean }>(a.db, "select * from saas.plan_prices");
  const features = await rows<{ plan_id: string; feature_key: string }>(a.db, "select * from saas.plan_features");
  const limits = await rows<{ plan_id: string; limit_key: string; limit_value: number | null }>(a.db, "select * from saas.plan_limits");
  const subsCount = await rows<{ plan_id: string; n: number }>(a.db,
    "select plan_id, count(*)::int as n from saas.subscriptions where status <> 'ended' group by plan_id");
  return plans.map((p) => ({
    ...p,
    prices: prices.filter((x) => x.plan_id === p.id),
    features: features.filter((x) => x.plan_id === p.id).map((x) => x.feature_key),
    limits: Object.fromEntries(limits.filter((x) => x.plan_id === p.id).map((x) => [x.limit_key, x.limit_value])),
    subscriptions: subsCount.find((x) => x.plan_id === p.id)?.n ?? 0,
  }));
}

const planSchema = z.object({
  id: uuid.optional(),
  code: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, "Código: letras minúsculas, números e _"),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(""),
  isActive: z.boolean(),
  isPublic: z.boolean(),
  trialDays: z.coerce.number().int().min(0).max(90),
  sortOrder: z.coerce.number().int().min(0).max(100),
  monthlyPrice: moneyNonNegative,
  yearlyPrice: z.union([z.literal(""), moneyNonNegative]).optional(),
  features: z.array(z.string()).default([]),
  limits: z.record(z.string(), z.union([z.literal(""), z.coerce.number().int().min(0)])).default({}),
});

/** Cria/edita plano. Mudança de preço vale para novas contratações e trocas de plano; assinaturas mantêm o valor contratado. */
export async function savePlan(a: AdminCtx, input: unknown) {
  if (a.role !== "superadmin") throw new ForbiddenError();
  const d = parse(planSchema, input);
  const features = d.features.filter(isFeatureKey);
  let id = d.id;
  if (id) {
    const r = await a.db.query(
      "update saas.plans set code = $2, name = $3, description = $4, is_active = $5, is_public = $6, trial_days = $7, sort_order = $8 where id = $1",
      [id, d.code, d.name, d.description, d.isActive, d.isPublic, d.trialDays, d.sortOrder]);
    if (!r.rowCount) throw new NotFoundError("Plano não encontrado.");
  } else {
    id = (await one<{ id: string }>(a.db,
      "insert into saas.plans (code, name, description, is_active, is_public, trial_days, sort_order) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [d.code, d.name, d.description, d.isActive, d.isPublic, d.trialDays, d.sortOrder]))!.id;
  }
  const upsertPrice = async (interval: string, cents: number | null) => {
    if (cents === null) {
      await a.db.query("update saas.plan_prices set is_active = false where plan_id = $1 and billing_interval = $2", [id, interval]);
      return;
    }
    await a.db.query(
      `insert into saas.plan_prices (plan_id, billing_interval, price_cents, is_active) values ($1, $2, $3, true)
       on conflict (plan_id, billing_interval) do update set price_cents = excluded.price_cents, is_active = true`, [id, interval, cents]);
  };
  await upsertPrice("monthly", d.monthlyPrice);
  await upsertPrice("yearly", d.yearlyPrice === "" || d.yearlyPrice === undefined ? null : d.yearlyPrice);
  await a.db.query("delete from saas.plan_features where plan_id = $1", [id]);
  for (const f of features) await a.db.query("insert into saas.plan_features (plan_id, feature_key) values ($1, $2)", [id, f]);
  await a.db.query("delete from saas.plan_limits where plan_id = $1", [id]);
  for (const [k, v] of Object.entries(d.limits)) {
    if (!isLimitKey(k)) continue;
    await a.db.query("insert into saas.plan_limits (plan_id, limit_key, limit_value) values ($1, $2, $3)", [id, k, v === "" ? null : v]);
  }
  await adminAudit(a, "plan.save", "plan", id!, { code: d.code, features: features.length });
  return id!;
}

export async function setFeatureOverride(a: AdminCtx, input: unknown) {
  if (a.role !== "superadmin") throw new ForbiddenError();
  const d = parse(z.object({ tenantId: uuid, feature: z.string().refine(isFeatureKey, "Funcionalidade inválida"),
    mode: z.enum(["plan", "on", "off"]), reason: z.string().trim().min(5, "Informe o motivo").max(300) }), input);
  if (d.mode === "plan") {
    await a.db.query("delete from saas.tenant_feature_overrides where tenant_id = $1 and feature_key = $2", [d.tenantId, d.feature]);
  } else {
    await a.db.query(
      `insert into saas.tenant_feature_overrides (tenant_id, feature_key, enabled, reason, created_by) values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, feature_key) do update set enabled = excluded.enabled, reason = excluded.reason, created_by = excluded.created_by, created_at = now()`,
      [d.tenantId, d.feature, d.mode === "on", d.reason, a.userId]);
  }
  await adminAudit(a, "tenant.feature_override", "tenant", d.tenantId, { feature: d.feature, mode: d.mode }, d.reason, d.tenantId);
}

export async function setLimitOverride(a: AdminCtx, input: unknown) {
  if (a.role !== "superadmin") throw new ForbiddenError();
  const d = parse(z.object({ tenantId: uuid, limit: z.string().refine(isLimitKey, "Limite inválido"),
    value: z.union([z.literal("plan"), z.literal("unlimited"), z.coerce.number().int().min(0)]),
    reason: z.string().trim().min(5, "Informe o motivo").max(300) }), input);
  if (d.value === "plan") {
    await a.db.query("delete from saas.tenant_limit_overrides where tenant_id = $1 and limit_key = $2", [d.tenantId, d.limit]);
  } else {
    await a.db.query(
      `insert into saas.tenant_limit_overrides (tenant_id, limit_key, limit_value, reason, created_by) values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, limit_key) do update set limit_value = excluded.limit_value, reason = excluded.reason, created_by = excluded.created_by, created_at = now()`,
      [d.tenantId, d.limit, d.value === "unlimited" ? null : d.value, d.reason, a.userId]);
  }
  await adminAudit(a, "tenant.limit_override", "tenant", d.tenantId, { limit: d.limit, value: d.value }, d.reason, d.tenantId);
}

/** Operações de assinatura pelo painel. Executadas pelo serviço de assinaturas (contexto de sistema). */
export async function adminSubscriptionAction(a: AdminCtx, input: unknown) {
  if (a.role === "support") throw new ForbiddenError();
  const d = parse(z.object({
    tenantId: uuid,
    action: z.enum(["change_plan", "cancel", "reactivate", "suspend", "end"]),
    planId: uuid.optional(),
    interval: z.enum(["monthly", "yearly"]).optional(),
    reason: z.string().trim().min(5, "Informe o motivo").max(300),
  }), input);
  const subId = await subs.currentSubscriptionId(a.db, d.tenantId);
  if (!subId) throw new NotFoundError("Empresa sem assinatura vigente.");
  const actor: subs.Actor = { type: "platform_admin", userId: a.userId };
  if (d.action === "change_plan") {
    if (!d.planId || !d.interval) throw new ValidationError("Selecione plano e periodicidade.");
    await subs.changePlan(subId, d.planId, d.interval, actor, d.reason);
  } else if (d.action === "cancel") {
    await subs.cancelSubscription(subId, actor, d.reason);
  } else if (d.action === "reactivate") {
    await subs.reactivateSubscription(subId, actor);
  } else {
    await withSystemTx(async (db) => {
      const s = await subs.lockSubscription(db, subId);
      await subs.transition(db, s, d.action === "suspend" ? "suspended" : "ended", actor, d.reason);
    });
  }
  await adminAudit(a, "admin.subscription", "subscription", subId, { action: d.action }, d.reason, d.tenantId);
}

export async function markInvoicePaidByAdmin(a: AdminCtx, input: unknown) {
  if (a.role === "support") throw new ForbiddenError();
  const d = parse(z.object({ invoiceId: uuid, method: optionalText(40), reason: z.string().trim().min(5, "Informe a referência do pagamento").max(300) }), input);
  const r = await withSystemTx((db) => subs.markInvoicePaid(db, d.invoiceId, {
    method: d.method ?? "manual", actor: { type: "platform_admin", userId: a.userId } }));
  await adminAudit(a, "admin.invoice_paid", "invoice", d.invoiceId, { result: r }, d.reason);
  return r;
}

export async function listInvoices(a: AdminCtx, status?: string) {
  return rows<{ id: string; tenant_id: string; trade_name: string; amount_cents: number; status: string; due_date: string; issued_at: Date; paid_at: Date | null; provider: string }>(a.db,
    `select i.id, i.tenant_id, t.trade_name, i.amount_cents, i.status, i.due_date, i.issued_at, i.paid_at, i.provider
       from saas.invoices i join saas.tenants t on t.id = i.tenant_id
      where ($1::text is null or i.status = $1) order by i.issued_at desc limit 300`, [status || null]);
}

export async function listBillingEvents(a: AdminCtx) {
  return rows<{ id: string; provider: string; provider_event_id: string; event_type: string; status: string; error: string | null; received_at: Date; processed_at: Date | null; trade_name: string | null }>(a.db,
    `select e.id, e.provider, e.provider_event_id, e.event_type, e.status, e.error, e.received_at, e.processed_at, t.trade_name
       from saas.billing_events e left join saas.tenants t on t.id = e.tenant_id order by e.received_at desc limit 200`);
}

export async function listAudit(a: AdminCtx, scope: "platform" | "all") {
  return rows<{ id: string; created_at: Date; action: string; actor_type: string; actor_name: string | null; trade_name: string | null; entity_type: string | null; result: string; reason: string | null }>(a.db,
    `select l.id, l.created_at, l.action, l.actor_type, u.name as actor_name, t.trade_name, l.entity_type, l.result, l.reason
       from saas.audit_log l left join saas.users u on u.id = l.actor_user_id left join saas.tenants t on t.id = l.tenant_id
      where ($1 = 'all' or l.tenant_id is null or l.actor_type in ('platform_admin', 'support'))
      order by l.created_at desc limit 300`, [scope]);
}

export async function listOps(a: AdminCtx) {
  const events = await rows<{ id: string; level: string; source: string; message: string; created_at: Date }>(a.db,
    "select id, level, source, message, created_at from saas.ops_events order by created_at desc limit 200");
  const jobs = await rows<{ id: string; job: string; started_at: Date; finished_at: Date | null; status: string; stats: Record<string, number>; error: string | null }>(a.db,
    "select * from saas.job_runs order by started_at desc limit 50");
  return { events, jobs };
}

export async function getSettings(a: AdminCtx) {
  return loadPlatformSettings(a.db);
}

export async function saveSettings(a: AdminCtx, input: unknown) {
  if (a.role !== "superadmin") throw new ForbiddenError();
  const d = parse(z.object({
    graceDaysBeforeSuspension: z.coerce.number().int().min(0).max(90),
    invoiceDueDays: z.coerce.number().int().min(0).max(30),
    readOnlyRetentionDays: z.coerce.number().int().min(30).max(3650),
    supportGrantMaxHours: z.coerce.number().int().min(1).max(720),
    disabledModules: z.array(z.string()).default([]),
  }), input) as PlatformSettings;
  for (const [prop, key] of Object.entries(PLATFORM_SETTING_KEYS) as [keyof PlatformSettings, string][]) {
    await a.db.query(
      `insert into saas.platform_settings (key, value, updated_by) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
      [key, JSON.stringify(d[prop]), a.userId]);
  }
  await adminAudit(a, "platform.settings", "platform_settings", null, { disabled_modules: d.disabledModules });
}

/** Registro auditado de entrada em modo suporte. Exige concessão vigente do proprietário. */
export async function enterSupport(a: AdminCtx, input: unknown) {
  if (a.role !== "support" && a.role !== "superadmin") throw new ForbiddenError();
  const d = parse(z.object({ tenantId: uuid, justification: z.string().trim().min(10, "Descreva a finalidade (mínimo 10 caracteres)").max(500) }), input);
  const g = await one(a.db,
    "select 1 from saas.support_access_grants where tenant_id = $1 and revoked_at is null and expires_at > now()", [d.tenantId]);
  if (!g) throw new ForbiddenError("O proprietário não concedeu acesso de suporte (ou a concessão expirou).");
  await adminAudit(a, "support.enter", "tenant", d.tenantId, {}, d.justification, null);
  // Também registra no tenant, para que o proprietário veja na auditoria da empresa.
  await withSystemTx((db) => writeAudit(db, { tenantId: d.tenantId, actorUserId: a.userId, actorType: "support", action: "support.enter",
    entityType: "tenant", entityId: d.tenantId, reason: d.justification, requestId: a.requestId }));
}
