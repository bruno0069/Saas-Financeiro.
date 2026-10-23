import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { Alert, Badge, Bar, Card, EmptyState, LinkButton, Money, PageHeader, Stat } from "@/components/ui";
import { dashboard } from "@/domains/finance/reports";
import { padariaKpis } from "@/domains/padaria/kpis";
import { ONBOARDING_STEPS } from "@/domains/tenants/service";
import { formatDateBR, formatMonthBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { withTenantPage } from "@/server/web";
import { completeOnboardingAction } from "./actions";

export const metadata = { title: "Painel" };

export default async function DashboardPage() {
  const data = await withTenantPage(async (ctx) => {
    if (!ctx.permissions.has("dashboard.view")) {
      return { redirectTo: ctx.modules.some((m) => m.available) ? "/app/padaria/caixa" : "/app/contatos" };
    }
    return {
      d: await dashboard(ctx),
      kpis: ctx.tenant.segment === "padaria" ? await padariaKpis(ctx) : null,
      steps: ctx.tenant.onboarding_steps ?? {},
      onboardingDone: !!ctx.tenant.onboarding_completed_at,
      canSettings: ctx.permissions.has("settings.manage"),
      today: ctx.today,
    };
  });
  if ("redirectTo" in data) redirect(data.redirectTo as string);
  const { d, kpis, steps } = data;
  const maxMonth = Math.max(1, ...d.months.flatMap((m) => [m.income_cents, m.expense_cents]));
  const stepDone = (k: string) => !!steps[k];
  const stepLinks: Record<string, string> = {
    company: "/app/configuracoes", accounts: "/app/contas", categories: "/app/categorias", first_entry: "/app/receber", team: "/app/configuracoes/usuarios",
  };

  return (
    <>
      <PageHeader
        title="Painel financeiro"
        subtitle={`Situação em ${formatDateBR(data.today)}. Valores realizados consideram pagamentos e recebimentos efetivados.`}
        actions={<><LinkButton href="/app/receber?novo=1" variant="secondary">+ Receita</LinkButton><LinkButton href="/app/pagar?novo=1">+ Despesa</LinkButton></>}
      />

      {!data.onboardingDone && data.canSettings && (
        <Card title="Primeiros passos" className="mb-6" actions={
          <form action={completeOnboardingAction}><button className="text-sm text-gray-500 hover:underline">Ocultar</button></form>}>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ONBOARDING_STEPS.map((s) => (
              <li key={s.key}>
                <Link href={stepLinks[s.key]} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm hover:bg-gray-50">
                  {stepDone(s.key) ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-gray-300" />}
                  <span className={stepDone(s.key) ? "text-gray-500 line-through" : ""}>{s.label}</span>
                  {!s.required && <span className="ml-auto text-xs text-gray-400">opcional</span>}
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {d.alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {d.alerts.map((a, i) => <Alert key={i} tone={a.level === "danger" ? "danger" : a.level === "warn" ? "warn" : "info"}>{a.text}</Alert>)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Saldo em contas" value={<Money cents={d.balance_cents} />} hint="Dinheiro disponível hoje (não é lucro)" tone={d.balance_cents < 0 ? "negative" : "default"} />
        <Stat label="Resultado de caixa do mês" value={<Money cents={d.month.result_cents} />}
          hint={<>Entradas {formatBRL(d.month.income_cents)} · Saídas {formatBRL(d.month.expense_cents)}</>} tone={d.month.result_cents < 0 ? "negative" : "positive"} />
        <Stat label="A receber (em aberto)" value={<Money cents={d.totals.receivable_open} />}
          hint={d.totals.receivable_overdue ? <span className="text-amber-700">Vencido: {formatBRL(d.totals.receivable_overdue)}</span> : "Nada vencido"} />
        <Stat label="A pagar (em aberto)" value={<Money cents={d.totals.payable_open} />}
          hint={d.totals.payable_overdue ? <span className="text-red-700">Vencido: {formatBRL(d.totals.payable_overdue)}</span> : "Nada vencido"} />
      </div>

      {kpis && (kpis.caixa || kpis.producao) && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.caixa && <Stat label="Vendas no balcão (mês)" value={<Money cents={kpis.caixa.sales_total_cents} />} hint={`${kpis.caixa.closings} fechamento(s) de caixa`} />}
          {kpis.caixa && <Stat label="Ticket médio" value={kpis.caixa.average_ticket_cents != null ? <Money cents={kpis.caixa.average_ticket_cents} /> : "—"} hint="Informe o nº de atendimentos no fechamento" />}
          {kpis.caixa && <Stat label="Cartões a receber" value={<Money cents={kpis.caixa.card_receivables_open_cents} />} hint={`Quebra de caixa no mês: ${formatBRL(kpis.caixa.cash_shortage_cents)}`} tone={kpis.caixa.cash_shortage_cents > 0 ? "warning" : "default"} />}
          {kpis.producao && <Stat label="Perdas do mês (a custo)" value={<Money cents={kpis.producao.losses_month_cents} />}
            hint={kpis.ingredient_cost_share != null ? `Insumos pagos = ${Math.round(kpis.ingredient_cost_share * 100)}% das vendas recebidas` : "Estimativa gerencial"} tone={kpis.producao.losses_month_cents > 0 ? "warning" : "default"} />}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Evolução mensal (realizado)" className="xl:col-span-2">
          <ul className="space-y-3">
            {d.months.map((m) => (
              <li key={m.month} className="grid grid-cols-[3.5rem_1fr] items-center gap-3 text-sm sm:grid-cols-[4rem_1fr_9rem]">
                <span className="text-gray-600">{formatMonthBR(m.month)}</span>
                <div className="space-y-1">
                  <Bar value={m.income_cents} max={maxMonth} tone="green" />
                  <Bar value={m.expense_cents} max={maxMonth} tone="red" />
                </div>
                <span className={`col-start-2 text-right tabular sm:col-start-auto ${m.result_cents < 0 ? "text-red-700" : "text-gray-900"}`}>{formatBRL(m.result_cents)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex gap-4 text-xs text-gray-500"><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Entradas</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />Saídas</span></p>
        </Card>

        <Card title="Previsão de caixa (30 dias)">
          <div className="text-2xl font-semibold tabular"><Money cents={d.projection_30_cents} /></div>
          <p className="mt-1 text-sm text-gray-600">Saldo atual + a receber − a pagar nos próximos 30 dias.</p>
          <p className="mt-3 text-sm">Menor saldo previsto: <strong className={d.projection_min.projected_balance_cents < 0 ? "text-red-700" : ""}>{formatBRL(d.projection_min.projected_balance_cents)}</strong> em {formatDateBR(d.projection_min.date)}</p>
          <p className="mt-2 text-xs text-gray-500">Estimativa: considera que os títulos em aberto serão pagos/recebidos no vencimento.</p>
          <Link href="/app/fluxo-de-caixa" className="mt-3 inline-block text-sm text-brand-700 hover:underline">Ver fluxo de caixa</Link>
        </Card>

        <Card title="Despesas do mês por categoria">
          {d.expenses_by_category.rows.length === 0 ? <p className="text-sm text-gray-500">Nenhuma despesa paga neste mês.</p> : (
            <ul className="space-y-3">
              {d.expenses_by_category.rows.slice(0, 6).map((c) => (
                <li key={c.category_id} className="text-sm">
                  <div className="mb-1 flex justify-between gap-2"><span className="truncate">{c.category_name}</span><span className="tabular text-gray-700">{formatBRL(c.amount_cents)} · {Math.round(c.share * 100)}%</span></div>
                  <Bar value={c.amount_cents} max={d.expenses_by_category.rows[0].amount_cents} tone="red" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Vencimentos dos próximos 7 dias">
          {d.upcoming.length === 0 ? <p className="text-sm text-gray-500">Nenhum compromisso nos próximos 7 dias.</p> : (
            <ul className="divide-y divide-gray-100">
              {d.upcoming.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/app/titulos/${u.id}`} className="min-w-0 hover:underline">
                    <div className="truncate">{u.description}</div>
                    <div className="text-xs text-gray-500">{formatDateBR(u.due_date)} {u.contact_name ? `· ${u.contact_name}` : ""}</div>
                  </Link>
                  <span className="flex flex-col items-end">
                    <Money cents={u.open_cents} />
                    <Badge tone={u.direction === "payable" ? "red" : "green"}>{u.direction === "payable" ? "Pagar" : "Receber"}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Saldos por conta">
          {d.accounts.length === 0 ? (
            <EmptyState title="Nenhuma conta cadastrada" description="Cadastre o caixa da loja e as contas bancárias com o saldo inicial." action={<LinkButton href="/app/contas">Cadastrar conta</LinkButton>} />
          ) : (
            <ul className="divide-y divide-gray-100">
              {d.accounts.map((a) => (
                <li key={a.id} className="flex justify-between gap-2 py-2 text-sm"><span className="truncate">{a.name}</span><Money cents={a.balance_cents} signed /></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-6 text-xs text-gray-500">Indicadores gerenciais simplificados, em regime de caixa. Não substituem demonstrações contábeis oficiais.</p>
    </>
  );
}
