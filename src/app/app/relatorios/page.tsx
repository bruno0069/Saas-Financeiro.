import Link from "next/link";
import { Alert, Bar, Card, Money, PageHeader, Table, Td, btn, inputClass } from "@/components/ui";
import { plannedByCategory, realizedByCategory, realizedByMonth } from "@/domains/finance/reports";
import { listTitles } from "@/domains/finance/titles";
import { addMonths, formatDateBR, formatMonthBR, isIsoDate, monthEnd, monthStart } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { requirePerm } from "@/server/authz";
import { withTenantPage } from "@/server/web";

export const metadata = { title: "Relatórios" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const data = await withTenantPage(async (ctx) => {
    requirePerm(ctx, "reports.view");
    const from = sp.from && isIsoDate(sp.from) ? sp.from : monthStart(ctx.today);
    const to = sp.to && isIsoDate(sp.to) ? sp.to : monthEnd(ctx.today);
    const advanced = ctx.entitlements.features.has("reports.advanced");
    // Período anterior de mesma duração (comparativo — relatório avançado).
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
    const prevTo = new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
    const prevFrom = new Date(Date.parse(prevTo) - days * 86400000).toISOString().slice(0, 10);
    return {
      from, to, prevFrom, prevTo, advanced,
      income: await realizedByCategory(ctx, from, to, "receivable"),
      expense: await realizedByCategory(ctx, from, to, "payable"),
      prevIncome: advanced ? await realizedByCategory(ctx, prevFrom, prevTo, "receivable") : null,
      prevExpense: advanced ? await realizedByCategory(ctx, prevFrom, prevTo, "payable") : null,
      plannedExpense: await plannedByCategory(ctx, from, to, "payable"),
      plannedIncome: await plannedByCategory(ctx, from, to, "receivable"),
      months: await realizedByMonth(ctx, monthStart(addMonths(ctx.today, -11)), monthEnd(ctx.today)),
      overduePay: ctx.permissions.has("payables.view") ? await listTitles(ctx, { direction: "payable", status: "overdue" }) : [],
      overdueRec: ctx.permissions.has("receivables.view") ? await listTitles(ctx, { direction: "receivable", status: "overdue" }) : [],
      canExport: ctx.permissions.has("reports.export") && ctx.entitlements.features.has("export.csv"),
    };
  });
  const result = data.income.total_cents - data.expense.total_cents;
  const prevResult = data.prevIncome && data.prevExpense ? data.prevIncome.total_cents - data.prevExpense.total_cents : null;
  const delta = (cur: number, prev: number | null | undefined) => prev == null || prev === 0 ? "—" : `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / Math.abs(prev)) * 100)}%`;
  return (
    <>
      <PageHeader title="Relatórios" subtitle="Receitas e despesas por categoria (realizado, regime de caixa), previsto do período e contas vencidas."
        actions={data.canExport ? <a className={btn.secondary} href={`/api/export/categories?from=${data.from}&to=${data.to}`}>Exportar CSV</a> : null} />
      <form className="mb-6 flex flex-wrap items-end gap-2">
        <label className="text-sm">De<input type="date" name="from" defaultValue={data.from} className={`${inputClass} w-auto`} /></label>
        <label className="text-sm">Até<input type="date" name="to" defaultValue={data.to} className={`${inputClass} w-auto`} /></label>
        <button className={btn.secondary}>Aplicar</button>
      </form>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><div className="text-sm text-gray-600">Receitas realizadas</div><div className="text-xl font-semibold text-emerald-700"><Money cents={data.income.total_cents} /></div>
          {data.prevIncome && <div className="text-xs text-gray-500">vs. período anterior: {delta(data.income.total_cents, data.prevIncome.total_cents)}</div>}</Card>
        <Card><div className="text-sm text-gray-600">Despesas realizadas</div><div className="text-xl font-semibold text-red-700"><Money cents={data.expense.total_cents} /></div>
          {data.prevExpense && <div className="text-xs text-gray-500">vs. período anterior: {delta(data.expense.total_cents, data.prevExpense.total_cents)}</div>}</Card>
        <Card><div className="text-sm text-gray-600">Resultado de caixa</div><div className={`text-xl font-semibold ${result < 0 ? "text-red-700" : ""}`}><Money cents={result} /></div>
          {prevResult != null && <div className="text-xs text-gray-500">Período anterior ({formatDateBR(data.prevFrom)}–{formatDateBR(data.prevTo)}): {formatBRL(prevResult)}</div>}</Card>
      </div>
      {!data.advanced && <div className="mb-6"><Alert>Comparativo com o período anterior disponível nos planos com relatórios avançados.</Alert></div>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {([["Receitas por categoria", data.income, "green"], ["Despesas por categoria", data.expense, "red"]] as const).map(([title, r, tone]) => (
          <Card key={title} title={title}>
            {r.rows.length === 0 ? <p className="text-sm text-gray-500">Sem valores realizados no período.</p> : (
              <ul className="space-y-3">
                {r.rows.map((c) => (
                  <li key={c.category_id} className="text-sm">
                    <div className="mb-1 flex justify-between gap-2"><span>{c.category_name}</span><span className="tabular">{formatBRL(c.amount_cents)} · {Math.round(c.share * 100)}%</span></div>
                    <Bar value={c.amount_cents} max={r.rows[0].amount_cents} tone={tone} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
        <Card title="Previsto no período (por vencimento)">
          <Table head={["Categoria", "Total", "Liquidado", "Em aberto"]}>
            {[...data.plannedIncome.map((x) => ({ ...x, k: "r" })), ...data.plannedExpense.map((x) => ({ ...x, k: "p" }))].map((x) => (
              <tr key={x.k + x.category_name}>
                <Td>{x.k === "r" ? "↓ " : "↑ "}{x.category_name}</Td>
                <Td right><Money cents={x.amount_cents} /></Td><Td right><Money cents={x.paid_cents} /></Td><Td right><Money cents={x.open_cents} /></Td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-gray-500">↓ a receber · ↑ a pagar. Cancelados não entram.</p>
        </Card>
        <Card title="Evolução de 12 meses (realizado)">
          <Table head={["Mês", "Receitas", "Despesas", "Resultado"]}>
            {data.months.map((m) => (
              <tr key={m.month}><Td>{formatMonthBR(m.month)}</Td><Td right><Money cents={m.income_cents} /></Td><Td right><Money cents={m.expense_cents} /></Td><Td right><Money cents={m.result_cents} signed /></Td></tr>
            ))}
          </Table>
        </Card>
        <Card title="Contas vencidas" className="lg:col-span-2">
          {data.overduePay.length + data.overdueRec.length === 0 ? <p className="text-sm text-gray-500">Nenhuma conta vencida. 👏</p> : (
            <Table head={["Vencimento", "Tipo", "Descrição", "Em aberto"]}>
              {[...data.overduePay, ...data.overdueRec].sort((a, b) => a.due_date.localeCompare(b.due_date)).map((t) => (
                <tr key={t.id}><Td>{formatDateBR(t.due_date)}</Td><Td>{t.direction === "payable" ? "A pagar" : "A receber"}</Td>
                  <Td><Link href={`/app/titulos/${t.id}`} className="hover:underline">{t.description}</Link></Td><Td right><Money cents={t.open_cents} /></Td></tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <p className="mt-6 text-xs text-gray-500">Relatórios gerenciais simplificados. Não constituem demonstrações contábeis oficiais (DRE/Balanço).</p>
    </>
  );
}
