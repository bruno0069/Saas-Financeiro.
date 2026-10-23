import { Card, Money, PageHeader, Stat, Table, Td } from "@/components/ui";
import { metrics, runAsAdmin } from "@/domains/admin/service";
import { STATUS_LABELS, SUBSCRIPTION_STATUSES } from "@/domains/billing/state-machine";
import { MODULES } from "@/domains/modules/registry";
import { sessionToken } from "@/server/web";

export const metadata = { title: "Plataforma" };

export default async function AdminHome() {
  const m = await runAsAdmin(await sessionToken(), null, (a) => metrics(a));
  return (
    <>
      <PageHeader title="Visão geral" subtitle="Indicadores comerciais e operacionais. Valores faturados e não pagos não são receita recebida." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Empresas cadastradas" value={m.tenants.total} hint={`${m.tenants.active} com acesso pleno`} />
        <Stat label="MRR contratado" value={<Money cents={m.mrr_cents} />} hint="Ativas + aguardando + em atraso (anual ÷ 12)" />
        <Stat label="ARR estimado" value={<Money cents={m.arr_cents} />} hint="MRR × 12" />
        <Stat label="Conversão de avaliações (90d)" value={m.trial_conversion == null ? "—" : `${Math.round(m.trial_conversion * 100)}%`} hint={`${m.trials_ended_90d} avaliação(ões) encerrada(s)`} />
        <Stat label="Faturado no mês" value={<Money cents={m.invoices.billed} />} hint="Faturas emitidas (exceto canceladas)" />
        <Stat label="Recebido no mês" value={<Money cents={m.invoices.received} />} tone="positive" hint="Pagamentos confirmados" />
        <Stat label="Em atraso" value={<Money cents={m.invoices.overdue} />} tone={m.invoices.overdue ? "negative" : "default"} hint={`Aguardando: ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(m.invoices.pending / 100)}`} />
        <Stat label="Cancelamentos no mês" value={m.cancellations_month} />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Assinaturas por situação">
          <ul className="space-y-1 text-sm">{SUBSCRIPTION_STATUSES.map((s) => <li key={s} className="flex justify-between"><span>{STATUS_LABELS[s]}</span><strong>{m.byStatus[s] ?? 0}</strong></li>)}</ul>
        </Card>
        <Card title="Uso dos módulos (30 dias)">
          {m.usage.length === 0 ? <p className="text-sm text-gray-500">Sem dados.</p> : (
            <Table head={["Módulo", "Habilitado", "Em uso", "Registros"]}>
              {m.usage.map((u) => <tr key={u.module_key}><Td>{MODULES[u.module_key]?.name ?? u.module_key}</Td><Td right>{u.tenants_enabled}</Td><Td right>{u.tenants_active}</Td><Td right>{u.events}</Td></tr>)}
            </Table>
          )}
          <p className="mt-2 text-xs text-gray-500">Somente contagens; nenhum valor financeiro dos clientes.</p>
        </Card>
        <Card title="Saúde operacional (7 dias)">
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between"><span>Erros registrados</span><strong className={m.errors.ops ? "text-red-700" : ""}>{m.errors.ops}</strong></li>
            <li className="flex justify-between"><span>Webhooks com falha</span><strong className={m.errors.webhooks ? "text-red-700" : ""}>{m.errors.webhooks}</strong></li>
            <li className="flex justify-between"><span>Jobs com falha</span><strong className={m.errors.jobs ? "text-red-700" : ""}>{m.errors.jobs}</strong></li>
            <li className="flex justify-between"><span>Último ciclo de cobrança</span><span>{m.lastJob ? `${new Date(m.lastJob.started_at).toLocaleString("pt-BR")} (${m.lastJob.status})` : "nunca executado"}</span></li>
          </ul>
        </Card>
      </div>
    </>
  );
}
