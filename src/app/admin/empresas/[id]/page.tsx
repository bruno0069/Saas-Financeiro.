import { Disclosure } from "@/components/forms";
import { Alert, Badge, Card, Money, PageHeader, Table, Td } from "@/components/ui";
import { listPlans, runAsAdmin, tenantDetail } from "@/domains/admin/service";
import { FEATURES, LIMITS, type FeatureKey, type LimitKey } from "@/domains/billing/catalog";
import { STATUS_LABELS } from "@/domains/billing/state-machine";
import { MODULES } from "@/domains/modules/registry";
import { getSegment } from "@/domains/segments/registry";
import { sessionToken } from "@/server/web";
import { EnterSupportForm, FeatureOverrideForm, LimitOverrideForm, MarkPaidForm, SubscriptionAdminForm } from "../../forms";

export const metadata = { title: "Empresa" };

export default async function TenantAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { d, plans, role } = await runAsAdmin(await sessionToken(), null, async (a) => ({ d: await tenantDetail(a, id), plans: await listPlans(a), role: a.role }));
  const s = d.subscription;
  return (
    <>
      <PageHeader title={d.tenant.trade_name} subtitle={`${getSegment(d.tenant.segment).name} · cadastrada em ${new Date(d.tenant.created_at).toLocaleDateString("pt-BR")}`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Assinatura">
          {!s ? <p className="text-sm">Sem assinatura.</p> : (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-gray-600">Plano</dt><dd>{s.plan_name}</dd>
              <dt className="text-gray-600">Situação</dt><dd><Badge>{STATUS_LABELS[s.status]}</Badge></dd>
              <dt className="text-gray-600">Valor</dt><dd><Money cents={s.price_cents} /> ({s.billing_interval === "yearly" ? "anual" : "mensal"})</dd>
              <dt className="text-gray-600">Período até</dt><dd>{s.current_period_end ? new Date(s.current_period_end).toLocaleDateString("pt-BR") : "—"}</dd>
            </dl>
          )}
          {role !== "support" && <div className="mt-4"><Disclosure summary="Alterar assinatura"><SubscriptionAdminForm tenantId={id} plans={plans} /></Disclosure></div>}
        </Card>
        <Card title="Usuários">
          <ul className="text-sm">{d.members.map((m) => <li key={m.email} className="flex justify-between py-1"><span>{m.name} · {m.email}</span><span className="text-gray-500">{m.role}{m.status !== "active" ? " (removido)" : ""}</span></li>)}</ul>
        </Card>
        <Card title="Faturas" className="lg:col-span-2">
          <Table head={["Período", "Vencimento", "Valor", "Situação", ""]}>
            {d.invoices.map((i) => (
              <tr key={i.id}><Td>{new Date(i.period_start).toLocaleDateString("pt-BR")} – {new Date(i.period_end).toLocaleDateString("pt-BR")}</Td><Td>{i.due_date.split("-").reverse().join("/")}</Td>
                <Td right><Money cents={i.amount_cents} /></Td><Td>{i.status}</Td>
                <Td>{role !== "support" && (i.status === "pending" || i.status === "overdue") && <MarkPaidForm invoiceId={i.id} />}</Td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Módulos e ajustes comerciais">
          <ul className="mb-3 text-sm">{d.modules.map((m) => <li key={m.module_key}>{MODULES[m.module_key]?.name ?? m.module_key}: {m.enabled ? "habilitado pela empresa" : "desabilitado pela empresa"}</li>)}</ul>
          {d.featureOverrides.length > 0 && <ul className="mb-3 text-sm">{d.featureOverrides.map((f) => <li key={f.feature_key}>{f.enabled ? "✓ Concedido" : "✗ Bloqueado"}: {FEATURES[f.feature_key as FeatureKey]} — {f.reason}</li>)}</ul>}
          {d.limitOverrides.length > 0 && <ul className="mb-3 text-sm">{d.limitOverrides.map((l) => <li key={l.limit_key}>{LIMITS[l.limit_key as LimitKey]}: {l.limit_value ?? "ilimitado"} — {l.reason}</li>)}</ul>}
          {role === "superadmin" && <div className="space-y-3"><FeatureOverrideForm tenantId={id} /><LimitOverrideForm tenantId={id} /></div>}
        </Card>
        <Card title="Suporte assistido">
          {d.supportGrant ? (
            <>
              <Alert tone="warn">Concessão vigente até {new Date(d.supportGrant.expires_at).toLocaleString("pt-BR")}: {d.supportGrant.reason}</Alert>
              {(role === "support" || role === "superadmin") && <div className="mt-3"><EnterSupportForm tenantId={id} /></div>}
            </>
          ) : <p className="text-sm text-gray-600">O proprietário não concedeu acesso. Dados financeiros da empresa não estão disponíveis à plataforma.</p>}
        </Card>
        <Card title="Histórico da assinatura" className="lg:col-span-2">
          <Table head={["Quando", "Evento", "De → Para", "Origem", "Motivo"]}>
            {d.events.map((e, i) => <tr key={i}><Td>{new Date(e.created_at).toLocaleString("pt-BR")}</Td><Td>{e.event_type}</Td><Td>{e.from_status ?? "—"} → {e.to_status ?? "—"}</Td><Td>{e.actor_type}</Td><Td>{e.reason ?? ""}</Td></tr>)}
          </Table>
        </Card>
      </div>
    </>
  );
}
