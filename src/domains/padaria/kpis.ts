import { monthEnd, monthStart } from "@/lib/dates";
import { one } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { moduleState } from "@/server/context";
import * as caixa from "./caixa";
import * as producao from "./producao";

/** Indicadores do segmento Padaria. Retorna apenas os blocos dos módulos disponíveis. */
export async function padariaKpis(ctx: TenantCtx) {
  const out: {
    caixa?: Awaited<ReturnType<typeof caixa.kpis>>;
    producao?: Awaited<ReturnType<typeof producao.kpis>>;
    ingredient_cost_share?: number | null;
  } = {};
  if (moduleState(ctx, caixa.MODULE_KEY)?.available) out.caixa = await caixa.kpis(ctx);
  if (moduleState(ctx, producao.MODULE_KEY)?.available) out.producao = await producao.kpis(ctx);
  // Custo de insumos pagos / vendas recebidas no mês (regime de caixa; estimativa gerencial).
  const r = await one<{ insumos: number; vendas: number }>(ctx.db,
    `select coalesce(sum(case when c.code = 'padaria.insumos' then (case m.direction when 'out' then m.amount_cents else -m.amount_cents end) end), 0)::bigint as insumos,
            coalesce(sum(case when c.code in ('padaria.vendas_balcao', 'padaria.encomendas', 'padaria.revenda') then (case m.direction when 'in' then m.amount_cents else -m.amount_cents end) end), 0)::bigint as vendas
       from saas.cash_movements m join saas.titles t on t.id = m.title_id join saas.categories c on c.id = t.category_id
      where m.tenant_id = $1 and m.occurred_on between $2 and $3`, [ctx.tenant.id, monthStart(ctx.today), monthEnd(ctx.today)]);
  out.ingredient_cost_share = r!.vendas > 0 ? r!.insumos / r!.vendas : null;
  return out;
}
