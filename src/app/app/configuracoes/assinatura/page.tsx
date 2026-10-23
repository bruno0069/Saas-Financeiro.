import { Alert, Badge, Card, Money, Table, Td } from "@/components/ui";
import { FEATURES, LIMITS, type FeatureKey, type LimitKey } from "@/domains/billing/catalog";
import { STATUS_LABELS, type SubscriptionStatus } from "@/domains/billing/state-machine";
import { paymentProviderName } from "@/domains/billing/providers";
import { formatDateBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { rows, one } from "@/server/db/pool";
import { requirePerm } from "@/server/authz";
import { withTenantPage } from "@/server/web";
import { CancelSubscription, ChangePlanForm, Reactivate } from "./forms";

export const metadata = { title: "Assinatura" };

const INVOICE: Record<string, string> = { pending: "Aguardando pagamento", paid: "Paga", overdue: "Vencida", canceled: "Cancelada", refunded: "Estornada" };

export default async function SubscriptionPage() {
  const data = await withTenantPage(async (ctx) => {
    requirePerm(ctx, "billing.manage");
    const sub = await one<{ id: string; status: SubscriptionStatus; plan_id: string; billing_interval: string; price_cents: number; trial_ends_at: Date | null; current_period_end: Date | null; canceled_at: Date | null }>(ctx.db,
      "select id, status, plan_id, billing_interval, price_cents, trial_ends_at, current_period_end, canceled_at from saas.subscriptions where tenant_id = $1 and status <> 'ended' order by created_at desc limit 1", [ctx.tenant.id]);
    const plans = await rows<{ id: string; name: string; description: string }>(ctx.db, "select id, name, description from saas.plans where is_active and is_public order by sort_order");
    const prices = await rows<{ plan_id: string; billing_interval: string; price_cents: number }>(ctx.db, "select plan_id, billing_interval, price_cents from saas.plan_prices where is_active");
    const invoices = await rows<{ id: string; amount_cents: number; status: string; due_date: string; paid_at: Date | null; period_start: Date; period_end: Date }>(ctx.db,
      "select id, amount_cents, status, due_date, paid_at, period_start, period_end from saas.invoices where tenant_id = $1 order by period_start desc limit 24", [ctx.tenant.id]);
    return { sub, plans, prices, invoices, ent: ctx.entitlements, planName: ctx.subscription?.plan_name, writable: !ctx.supportMode };
  });
  const s = data.sub;
  const plans = data.plans.map((p) => ({
    ...p, prices: data.prices.filter((x) => x.plan_id === p.id).map((x) => ({ billing_interval: x.billing_interval, label: `${formatBRL(x.price_cents)}/${x.billing_interval === "yearly" ? "ano" : "mês"}` })),
  }));
  const manual = paymentProviderName() === "manual";
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card title="Situação atual">
        {!s ? <Alert tone="danger">Nenhuma assinatura vigente. A empresa está em modo somente leitura.</Alert> : (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-gray-600">Plano</dt><dd className="font-medium">{data.planName}</dd>
            <dt className="text-gray-600">Situação</dt><dd><Badge tone={s.status === "active" || s.status === "trialing" ? "green" : s.status === "canceled" || s.status === "suspended" ? "red" : "amber"}>{STATUS_LABELS[s.status]}</Badge></dd>
            <dt className="text-gray-600">Valor contratado</dt><dd><Money cents={s.price_cents} />/{s.billing_interval === "yearly" ? "ano" : "mês"}</dd>
            {s.trial_ends_at && s.status === "trialing" && <><dt className="text-gray-600">Fim da avaliação</dt><dd>{formatDateBR(s.trial_ends_at.toISOString())}</dd></>}
            {s.current_period_end && <><dt className="text-gray-600">{s.status === "canceled" ? "Acesso até" : "Período atual até"}</dt><dd>{formatDateBR(s.current_period_end.toISOString())}</dd></>}
          </dl>
        )}
        {manual && (
          <div className="mt-4"><Alert>Pagamento online ainda não habilitado nesta instalação. As faturas são confirmadas pela nossa equipe financeira após o pagamento (PIX/boleto enviados por e-mail).</Alert></div>
        )}
        {s && data.writable && (
          <div className="mt-4 flex flex-wrap gap-2">
            {s.status === "canceled" ? <Reactivate /> : !["ended", "suspended"].includes(s.status) && <CancelSubscription />}
          </div>
        )}
      </Card>
      <Card title="Recursos e limites do plano">
        <ul className="space-y-1 text-sm">{(Object.keys(FEATURES) as FeatureKey[]).map((f) => (
          <li key={f} className={data.ent.features.has(f) ? "" : "text-gray-400 line-through"}>{data.ent.features.has(f) ? "✓" : "✗"} {FEATURES[f]}</li>
        ))}</ul>
        <ul className="mt-3 space-y-1 text-sm">{(Object.keys(LIMITS) as LimitKey[]).map((l) => (
          <li key={l}>{LIMITS[l]}: <strong>{data.ent.limits[l] == null ? "ilimitado" : data.ent.limits[l]}</strong></li>
        ))}</ul>
      </Card>
      {s && data.writable && !["ended", "canceled"].includes(s.status) && (
        <Card title="Trocar de plano" className="xl:col-span-2">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {plans.map((p) => (
              <div key={p.id} className={`rounded-lg border p-3 text-sm ${p.id === s.plan_id ? "border-brand-500 bg-brand-50" : "border-gray-200"}`}>
                <div className="font-semibold">{p.name}</div>
                <div className="text-gray-600">{p.description}</div>
                <div className="mt-2 text-gray-800">{p.prices.map((x) => x.label).join(" · ")}</div>
              </div>
            ))}
          </div>
          <ChangePlanForm plans={plans} currentPlanId={s.plan_id} currentInterval={s.billing_interval} />
          <p className="mt-2 text-xs text-gray-500">O novo valor vale a partir da próxima cobrança. Reduções de plano exigem que o uso atual caiba nos novos limites.</p>
        </Card>
      )}
      <Card title="Faturas" className="xl:col-span-2">
        {data.invoices.length === 0 ? <p className="text-sm text-gray-500">Nenhuma fatura emitida.</p> : (
          <Table head={["Período", "Vencimento", "Valor", "Situação", "Pago em"]}>
            {data.invoices.map((i) => (
              <tr key={i.id}><Td>{formatDateBR(i.period_start.toISOString())} – {formatDateBR(i.period_end.toISOString())}</Td><Td>{formatDateBR(i.due_date)}</Td>
                <Td right><Money cents={i.amount_cents} /></Td><Td>{INVOICE[i.status]}</Td><Td>{i.paid_at ? formatDateBR(i.paid_at.toISOString()) : "—"}</Td></tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
