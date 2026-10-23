import { addDays, addMonths, monthEnd, monthStart } from "@/lib/dates";
import { one, rows } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { requireFeature, requirePerm } from "@/server/authz";

/**
 * CRITÉRIOS DE CÁLCULO (únicos para painel, fluxo de caixa e relatórios):
 *  - REALIZADO (regime de caixa): baixas de títulos na data da movimentação, menos estornos na data do estorno.
 *    Receitas = baixas de contas a receber; despesas = baixas de contas a pagar.
 *  - Transferências entre contas próprias e saldos iniciais NUNCA são receita/despesa.
 *  - Ajustes de saldo aparecem em linha própria (não operacionais).
 *  - PREVISTO: saldo em aberto (valor - pago) dos títulos não cancelados, pela data de vencimento.
 *  - Saldo = soma de todas as movimentações da conta (inclui saldo inicial). Saldo não é lucro.
 */

const OPERATIONAL = `
  select m.occurred_on,
         t.direction as title_direction,
         t.category_id,
         case when t.direction = 'receivable'
              then case m.direction when 'in' then m.amount_cents else -m.amount_cents end
              else case m.direction when 'out' then m.amount_cents else -m.amount_cents end
         end as value_cents
    from saas.cash_movements m
    join saas.titles t on t.id = m.title_id
   where m.tenant_id = $1 and m.kind in ('settlement', 'reversal') and m.title_id is not null`;

export type MonthRow = { month: string; income_cents: number; expense_cents: number; result_cents: number };

export async function realizedByMonth(ctx: TenantCtx, from: string, to: string): Promise<MonthRow[]> {
  const r = await rows<{ month: string; income_cents: number; expense_cents: number }>(ctx.db,
    `with op as (${OPERATIONAL} and m.occurred_on between $2 and $3),
          months as (select to_char(d, 'YYYY-MM') as month from generate_series($2::date, $3::date, interval '1 month') d)
     select months.month,
            coalesce(sum(op.value_cents) filter (where op.title_direction = 'receivable'), 0)::bigint as income_cents,
            coalesce(sum(op.value_cents) filter (where op.title_direction = 'payable'), 0)::bigint as expense_cents
       from months left join op on to_char(op.occurred_on, 'YYYY-MM') = months.month
      group by months.month order by months.month`,
    [ctx.tenant.id, monthStart(from), to]);
  return r.map((x) => ({ ...x, result_cents: x.income_cents - x.expense_cents }));
}

export type CategoryAmount = { category_id: string; category_name: string; amount_cents: number; share: number };

export async function realizedByCategory(ctx: TenantCtx, from: string, to: string, direction: "payable" | "receivable") {
  const r = await rows<{ category_id: string; category_name: string; amount_cents: number }>(ctx.db,
    `with op as (${OPERATIONAL} and m.occurred_on between $2 and $3 and t.direction = $4)
     select c.id as category_id, c.name as category_name, sum(op.value_cents)::bigint as amount_cents
       from op join saas.categories c on c.id = op.category_id
      group by c.id, c.name having sum(op.value_cents) <> 0
      order by amount_cents desc`, [ctx.tenant.id, from, to, direction]);
  const total = r.reduce((a, b) => a + b.amount_cents, 0);
  return { total_cents: total, rows: r.map((x) => ({ ...x, share: total ? x.amount_cents / total : 0 })) as CategoryAmount[] };
}

export async function plannedByCategory(ctx: TenantCtx, from: string, to: string, direction: "payable" | "receivable") {
  return rows<{ category_name: string; amount_cents: number; paid_cents: number; open_cents: number }>(ctx.db,
    `select c.name as category_name, sum(t.amount_cents)::bigint as amount_cents, sum(t.paid_cents)::bigint as paid_cents,
            sum(t.amount_cents - t.paid_cents)::bigint as open_cents
       from saas.titles t join saas.categories c on c.id = t.category_id
      where t.tenant_id = $1 and t.direction = $4 and t.status <> 'canceled' and t.due_date between $2 and $3
      group by c.name order by amount_cents desc`, [ctx.tenant.id, from, to, direction]);
}

export type CashFlowMonth = {
  month: string;
  opening_cents: number;
  income_cents: number;
  expense_cents: number;
  adjustments_cents: number;
  informed_opening_cents: number;
  net_cents: number;
  closing_cents: number;
};

/** Fluxo de caixa realizado consolidado. Fechamento de cada mês = soma dos saldos das contas na data. */
export async function cashFlow(ctx: TenantCtx, from: string, to: string): Promise<{ months: CashFlowMonth[]; opening_cents: number; closing_cents: number }> {
  requirePerm(ctx, "reports.view");
  const start = monthStart(from);
  const opening = await one<{ v: number }>(ctx.db,
    `select coalesce(sum(case when direction = 'in' then amount_cents else -amount_cents end), 0)::bigint as v
       from saas.cash_movements where tenant_id = $1 and occurred_on < $2`, [ctx.tenant.id, start]);
  const data = await rows<{ month: string; income: number; expense: number; adjustments: number; informed: number; net: number }>(ctx.db,
    `with mv as (
       select to_char(m.occurred_on, 'YYYY-MM') as month, m.kind, m.direction, m.amount_cents, t.direction as td
         from saas.cash_movements m left join saas.titles t on t.id = m.title_id
        where m.tenant_id = $1 and m.occurred_on between $2 and $3
     ), months as (select to_char(d, 'YYYY-MM') as month from generate_series($2::date, $3::date, interval '1 month') d)
     select months.month,
            coalesce(sum(case when mv.td = 'receivable' then (case mv.direction when 'in' then mv.amount_cents else -mv.amount_cents end) end), 0)::bigint as income,
            coalesce(sum(case when mv.td = 'payable' then (case mv.direction when 'out' then mv.amount_cents else -mv.amount_cents end) end), 0)::bigint as expense,
            coalesce(sum(case when mv.kind = 'adjustment' then (case mv.direction when 'in' then mv.amount_cents else -mv.amount_cents end) end), 0)::bigint as adjustments,
            coalesce(sum(case when mv.kind = 'opening_balance' then (case mv.direction when 'in' then mv.amount_cents else -mv.amount_cents end) end), 0)::bigint as informed,
            coalesce(sum(case when mv.direction = 'in' then mv.amount_cents else -mv.amount_cents end), 0)::bigint as net
       from months left join mv on mv.month = months.month
      group by months.month order by months.month`, [ctx.tenant.id, start, to]);
  let running = opening!.v;
  const months = data.map((d) => {
    const m: CashFlowMonth = {
      month: d.month, opening_cents: running, income_cents: d.income, expense_cents: d.expense, adjustments_cents: d.adjustments,
      informed_opening_cents: d.informed, net_cents: d.net, closing_cents: running + d.net,
    };
    running = m.closing_cents;
    return m;
  });
  return { months, opening_cents: opening!.v, closing_cents: running };
}

export async function totalBalance(ctx: TenantCtx, asOf?: string): Promise<number> {
  const r = await one<{ v: number }>(ctx.db,
    `select coalesce(sum(case when direction = 'in' then amount_cents else -amount_cents end), 0)::bigint as v
       from saas.cash_movements where tenant_id = $1 and ($2::date is null or occurred_on <= $2::date)`,
    [ctx.tenant.id, asOf ?? null]);
  return r!.v;
}

export async function openTotals(ctx: TenantCtx) {
  return (await one<{ payable_open: number; payable_overdue: number; receivable_open: number; receivable_overdue: number;
                      payable_overdue_count: number; receivable_overdue_count: number }>(ctx.db,
    `select coalesce(sum(amount_cents - paid_cents) filter (where direction = 'payable'), 0)::bigint as payable_open,
            coalesce(sum(amount_cents - paid_cents) filter (where direction = 'payable' and due_date < $2), 0)::bigint as payable_overdue,
            coalesce(sum(amount_cents - paid_cents) filter (where direction = 'receivable'), 0)::bigint as receivable_open,
            coalesce(sum(amount_cents - paid_cents) filter (where direction = 'receivable' and due_date < $2), 0)::bigint as receivable_overdue,
            count(*) filter (where direction = 'payable' and due_date < $2)::int as payable_overdue_count,
            count(*) filter (where direction = 'receivable' and due_date < $2)::int as receivable_overdue_count
       from saas.titles where tenant_id = $1 and status in ('open', 'partial')`, [ctx.tenant.id, ctx.today]))!;
}

export type ProjectionDay = { date: string; receivable_cents: number; payable_cents: number; projected_balance_cents: number };

/**
 * Previsão de caixa: saldo atual + recebimentos previstos - pagamentos previstos.
 * Títulos vencidos em aberto entram no dia de hoje (premissa: serão liquidados).
 */
export async function projection(ctx: TenantCtx, days: number): Promise<{ start_balance_cents: number; days: ProjectionDay[] }> {
  if (days > 30) requireFeature(ctx, "reports.advanced");
  const end = addDays(ctx.today, days);
  const balance = await totalBalance(ctx);
  const r = await rows<{ d: string; rec: number; pay: number }>(ctx.db,
    `select greatest(due_date, $2::date)::text as d,
            coalesce(sum(amount_cents - paid_cents) filter (where direction = 'receivable'), 0)::bigint as rec,
            coalesce(sum(amount_cents - paid_cents) filter (where direction = 'payable'), 0)::bigint as pay
       from saas.titles where tenant_id = $1 and status in ('open', 'partial') and due_date <= $3
      group by 1 order by 1`, [ctx.tenant.id, ctx.today, end]);
  const byDay = new Map(r.map((x) => [x.d, x]));
  let running = balance;
  const out: ProjectionDay[] = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(ctx.today, i);
    const x = byDay.get(date);
    running += (x?.rec ?? 0) - (x?.pay ?? 0);
    out.push({ date, receivable_cents: x?.rec ?? 0, payable_cents: x?.pay ?? 0, projected_balance_cents: running });
  }
  return { start_balance_cents: balance, days: out };
}

export async function upcoming(ctx: TenantCtx, days: number, limit = 10) {
  return rows<{ id: string; direction: string; description: string; due_date: string; open_cents: number; contact_name: string | null }>(ctx.db,
    `select t.id, t.direction, t.description, t.due_date, (t.amount_cents - t.paid_cents)::bigint as open_cents, c.name as contact_name
       from saas.titles t left join saas.contacts c on c.id = t.contact_id
      where t.tenant_id = $1 and t.status in ('open', 'partial') and t.due_date between $2 and $3
      order by t.due_date, t.amount_cents desc limit $4`, [ctx.tenant.id, ctx.today, addDays(ctx.today, days), limit]);
}

export async function dashboard(ctx: TenantCtx) {
  requirePerm(ctx, "dashboard.view");
  const mStart = monthStart(ctx.today);
  const mEnd = monthEnd(ctx.today);
  const sixMonthsAgo = addMonths(mStart, -5);
  // Consultas sequenciais: a transação usa uma única conexão.
  const balance = await totalBalance(ctx);
  const totals = await openTotals(ctx);
  const months = await realizedByMonth(ctx, sixMonthsAgo, mEnd);
  const expenses = await realizedByCategory(ctx, mStart, mEnd, "payable");
  const next7 = await upcoming(ctx, 7);
  const proj = await projection(ctx, 30);
  const accounts = await rows<{ id: string; name: string; kind: string; balance_cents: number }>(ctx.db,
    `select a.id, a.name, a.kind, coalesce(b.balance_cents, 0) as balance_cents
       from saas.financial_accounts a left join saas.account_balances b on b.account_id = a.id
      where a.tenant_id = $1 and a.is_active order by a.name`, [ctx.tenant.id]);
  const current = months[months.length - 1];
  const previous = months[months.length - 2];
  const proj30 = proj.days[proj.days.length - 1].projected_balance_cents;
  const minProj = proj.days.reduce((min, d) => (d.projected_balance_cents < min.projected_balance_cents ? d : min), proj.days[0]);
  const alerts: { level: "warn" | "danger" | "info"; text: string }[] = [];
  if (totals.payable_overdue_count) alerts.push({ level: "danger", text: `${totals.payable_overdue_count} conta(s) a pagar vencida(s).` });
  if (totals.receivable_overdue_count) alerts.push({ level: "warn", text: `${totals.receivable_overdue_count} conta(s) a receber vencida(s).` });
  if (minProj.projected_balance_cents < 0) {
    alerts.push({ level: "danger", text: `A previsão indica saldo negativo em ${minProj.date.split("-").reverse().join("/")}.` });
  }
  if (expenses.rows[0] && expenses.rows[0].share > 0.4) {
    alerts.push({ level: "info", text: `"${expenses.rows[0].category_name}" concentra ${Math.round(expenses.rows[0].share * 100)}% das despesas do mês.` });
  }
  return {
    balance_cents: balance,
    month: { income_cents: current.income_cents, expense_cents: current.expense_cents, result_cents: current.result_cents },
    previous_month: previous ?? null,
    totals,
    months,
    expenses_by_category: expenses,
    upcoming: next7,
    projection_30_cents: proj30,
    projection_min: minProj,
    accounts,
    alerts,
  };
}
