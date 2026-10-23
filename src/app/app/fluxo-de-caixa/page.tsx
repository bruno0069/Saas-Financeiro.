import { Alert, Card, Money, PageHeader, Table, Td, btn, inputClass } from "@/components/ui";
import { cashFlow, projection } from "@/domains/finance/reports";
import { addMonths, formatDateBR, formatMonthBR, isIsoDate, monthEnd, monthStart } from "@/lib/dates";
import { withTenantPage } from "@/server/web";
import { requirePerm } from "@/server/authz";

export const metadata = { title: "Fluxo de caixa" };

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; dias?: string }> }) {
  const raw = await searchParams;
  const norm = (v?: string) => (v && /^\d{4}-\d{2}$/.test(v) ? `${v}-01` : v);
  const sp = { ...raw, from: norm(raw.from), to: norm(raw.to) };
  const data = await withTenantPage(async (ctx) => {
    requirePerm(ctx, "reports.view");
    const to = sp.to && isIsoDate(sp.to) ? monthEnd(sp.to) : monthEnd(ctx.today);
    const from = sp.from && isIsoDate(sp.from) ? monthStart(sp.from) : monthStart(addMonths(ctx.today, -5));
    const advanced = ctx.entitlements.features.has("reports.advanced");
    const days = Math.min(advanced ? 180 : 30, Math.max(7, Number(sp.dias) || 30));
    return {
      from, to, days, advanced,
      flow: await cashFlow(ctx, from, to),
      proj: await projection(ctx, days),
      canExport: ctx.permissions.has("reports.export") && ctx.entitlements.features.has("export.csv"),
    };
  });
  const weeks = data.proj.days.filter((_, i) => i === 0 || i % 7 === 0 || i === data.proj.days.length - 1);
  return (
    <>
      <PageHeader title="Fluxo de caixa" subtitle="Realizado: o que efetivamente entrou e saiu. Previsto: estimativa com base nos títulos em aberto."
        actions={data.canExport ? <a className={btn.secondary} href={`/api/export/cashflow?from=${data.from}&to=${data.to}`}>Exportar CSV</a> : null} />
      <Card title="Realizado por mês" className="mb-6">
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-sm">De<input type="month" name="from" defaultValue={data.from.slice(0, 7)} className={`${inputClass} w-auto`} /></label>
          <label className="text-sm">Até<input type="month" name="to" defaultValue={data.to.slice(0, 7)} className={`${inputClass} w-auto`} /></label>
          <button className={btn.secondary}>Atualizar</button>
        </form>
        <Table head={["Mês", "Saldo inicial", "Entradas", "Saídas", "Ajustes/saldos informados", "Resultado de caixa", "Saldo final"]}>
          {data.flow.months.map((m) => (
            <tr key={m.month}>
              <Td className="font-medium">{formatMonthBR(m.month)}</Td>
              <Td right><Money cents={m.opening_cents} /></Td>
              <Td right><Money cents={m.income_cents} className="text-emerald-700" /></Td>
              <Td right><Money cents={-m.expense_cents} className="text-red-700" /></Td>
              <Td right><Money cents={m.adjustments_cents + m.informed_opening_cents} /></Td>
              <Td right><Money cents={m.income_cents - m.expense_cents} signed /></Td>
              <Td right className="font-semibold"><Money cents={m.closing_cents} /></Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-gray-500">Transferências entre contas próprias não aparecem como entradas/saídas. Saldos iniciais e ajustes são exibidos separadamente.</p>
      </Card>
      <Card title={`Previsão para os próximos ${data.days} dias`}>
        {!data.advanced && <div className="mb-3"><Alert>Previsões acima de 30 dias estão disponíveis nos planos com relatórios avançados.</Alert></div>}
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-sm">Horizonte (dias)<input type="number" name="dias" min={7} max={data.advanced ? 180 : 30} defaultValue={data.days} className={`${inputClass} w-28`} /></label>
          <button className={btn.secondary}>Atualizar</button>
        </form>
        <Table head={["Data", "A receber no dia", "A pagar no dia", "Saldo previsto"]}>
          {weeks.map((d) => (
            <tr key={d.date}>
              <Td>{formatDateBR(d.date)}</Td>
              <Td right><Money cents={d.receivable_cents} /></Td>
              <Td right><Money cents={d.payable_cents} /></Td>
              <Td right className="font-semibold"><Money cents={d.projected_balance_cents} signed /></Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-gray-500">Saldo atual: <Money cents={data.proj.start_balance_cents} />. Títulos vencidos em aberto entram na data de hoje. Linhas exibidas a cada 7 dias.</p>
      </Card>
    </>
  );
}
