import { Disclosure } from "@/components/forms";
import { Badge, Card, EmptyState, Money, PageHeader, Stat, Table, Td } from "@/components/ui";
import * as producao from "@/domains/padaria/producao";
import { formatDateBR, monthEnd, monthStart } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { withTenantPage } from "@/server/web";
import { IngredientForm, LossForm, ProductForm } from "./forms";

export const metadata = { title: "Produção e margens" };

const REASONS: Record<string, string> = { sobra: "Sobra", queimado: "Queimado", vencido: "Vencido", avaria: "Avaria", outro: "Outro" };

export default async function ProducaoPage() {
  const data = await withTenantPage(async (ctx) => ({
    ingredients: await producao.listIngredients(ctx),
    products: await producao.listProducts(ctx),
    losses: await producao.listLosses(ctx, monthStart(ctx.today), monthEnd(ctx.today)),
    kpis: await producao.kpis(ctx),
    canManage: ctx.permissions.has("padaria.producao.manage") && ctx.access === "full" && !ctx.supportMode,
    today: ctx.today,
  }));
  const lowMargin = data.products.filter((p) => p.margin_pct != null && p.margin_pct < 0.3);
  return (
    <>
      <PageHeader title="Produção e margens" subtitle="Custo estimado de cada produto a partir da ficha técnica, margem sobre o preço de venda e controle de perdas. Indicadores gerenciais — não geram lançamentos financeiros." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Perdas no mês (a custo)" value={<Money cents={data.kpis.losses_month_cents} />} hint={`${data.kpis.losses_count} registro(s)`} tone={data.kpis.losses_month_cents ? "warning" : "default"} />
        <Stat label="Produtos com ficha técnica" value={data.products.filter((p) => p.items.length).length} />
        <Stat label="Margem abaixo de 30%" value={lowMargin.length} tone={lowMargin.length ? "warning" : "default"} hint={lowMargin.slice(0, 3).map((p) => p.name).join(", ") || "Nenhum"} />
      </div>
      <Card title="Produtos" className="mb-6">
        {data.products.length === 0 ? <EmptyState title="Cadastre seus produtos" description="Cadastre primeiro os insumos com o preço pago, depois monte a ficha técnica de cada produto." /> : (
          <Table head={["Produto", "Preço de venda", "Custo unitário", "Margem", "Insumos da receita"]}>
            {data.products.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.name}<div className="text-xs text-gray-500">rende {Number(p.yield_quantity).toLocaleString("pt-BR")} {p.sale_unit}</div></Td>
                <Td right><Money cents={p.sale_price_cents} /></Td>
                <Td right><Money cents={p.unit_cost_cents} /></Td>
                <Td right>{p.margin_pct == null ? "—" : <Badge tone={p.margin_pct < 0.3 ? "red" : p.margin_pct < 0.5 ? "amber" : "green"}>{Math.round(p.margin_pct * 100)}% · {formatBRL(p.margin_cents)}</Badge>}</Td>
                <Td className="text-xs text-gray-600">{p.items.map((i) => `${i.ingredient_name} ${Number(i.quantity).toLocaleString("pt-BR")}${i.unit}`).join(", ") || "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {data.canManage && (
        <div className="mb-6 space-y-4">
          <Disclosure summary="+ Novo produto (ficha técnica)">{data.ingredients.length === 0 ? <p className="text-sm text-gray-600">Cadastre os insumos primeiro.</p> : <ProductForm ingredients={data.ingredients} />}</Disclosure>
          <Disclosure summary="+ Novo insumo"><IngredientForm /></Disclosure>
          {data.products.length > 0 && <Disclosure summary="+ Registrar perda" defaultOpen><LossForm products={data.products} today={data.today} /></Disclosure>}
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Insumos">
          {data.ingredients.length === 0 ? <p className="text-sm text-gray-500">Nenhum insumo cadastrado.</p> : (
            <Table head={["Insumo", "Embalagem", "Custo por unidade"]}>
              {data.ingredients.map((i) => (
                <tr key={i.id}><Td>{i.name}</Td><Td>{Number(i.pack_quantity).toLocaleString("pt-BR")} {i.unit} por <Money cents={i.pack_cost_cents} /></Td>
                  <Td right>{formatBRL(Math.round(i.unit_cost))}/{i.unit}</Td></tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Perdas do mês">
          {data.losses.length === 0 ? <p className="text-sm text-gray-500">Nenhuma perda registrada.</p> : (
            <Table head={["Data", "Produto", "Qtd.", "Motivo", "Custo"]}>
              {data.losses.map((l) => (
                <tr key={l.id}><Td>{formatDateBR(l.loss_date)}</Td><Td>{l.product_name}</Td><Td>{Number(l.quantity).toLocaleString("pt-BR")}</Td><Td>{REASONS[l.reason]}</Td><Td right><Money cents={l.total_cents} /></Td></tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
