import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { monthEnd, monthStart } from "@/lib/dates";
import { isoDate, moneyNonNegative, optionalText, parse, uuid } from "@/lib/validation";
import { one, rows } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { requireModule, requirePerm, requireWrite } from "@/server/authz";
import { audit } from "@/domains/finance/shared";

/**
 * Módulo Produção e margens. Indicadores gerenciais estimados — não são demonstrações contábeis.
 * Custo unitário = Σ(quantidade do insumo × custo por unidade do insumo) / rendimento da receita.
 */
export const MODULE_KEY = "padaria.producao";

const qty = z.union([z.string(), z.number()]).transform((v, c) => {
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) {
    c.addIssue({ code: "custom", message: "Quantidade inválida" });
    return z.NEVER;
  }
  return Math.round(n * 10000) / 10000;
});

export type IngredientRow = { id: string; name: string; unit: string; pack_quantity: string; pack_cost_cents: number; unit_cost: number; is_active: boolean };

export async function listIngredients(ctx: TenantCtx): Promise<IngredientRow[]> {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.producao.view");
  const r = await rows<Omit<IngredientRow, "unit_cost">>(ctx.db,
    "select id, name, unit, pack_quantity, pack_cost_cents, is_active from saas.bakery_ingredients where tenant_id = $1 order by name",
    [ctx.tenant.id]);
  return r.map((i) => ({ ...i, unit_cost: i.pack_cost_cents / Number(i.pack_quantity) }));
}

const ingredientSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Informe o nome").max(80),
  unit: z.enum(["kg", "g", "l", "ml", "un"]),
  packQuantity: qty,
  packCost: moneyNonNegative,
});

export async function saveIngredient(ctx: TenantCtx, input: unknown) {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.producao.manage");
  requireWrite(ctx);
  const d = parse(ingredientSchema, input);
  if (d.id) {
    const r = await ctx.db.query(
      "update saas.bakery_ingredients set name = $3, unit = $4, pack_quantity = $5, pack_cost_cents = $6 where id = $1 and tenant_id = $2",
      [d.id, ctx.tenant.id, d.name, d.unit, d.packQuantity, d.packCost]);
    if (!r.rowCount) throw new NotFoundError("Insumo não encontrado.");
    return d.id;
  }
  const r = await one<{ id: string }>(ctx.db,
    "insert into saas.bakery_ingredients (tenant_id, name, unit, pack_quantity, pack_cost_cents) values ($1, $2, $3, $4, $5) returning id",
    [ctx.tenant.id, d.name, d.unit, d.packQuantity, d.packCost]);
  await audit(ctx, "padaria.ingredient.create", "bakery_ingredient", r!.id);
  return r!.id;
}

export type ProductCost = {
  id: string; name: string; sale_unit: string; sale_price_cents: number; yield_quantity: string; is_active: boolean;
  batch_cost_cents: number; unit_cost_cents: number; margin_cents: number; margin_pct: number | null;
  items: { ingredient_id: string; ingredient_name: string; unit: string; quantity: string; cost_cents: number }[];
};

export async function listProducts(ctx: TenantCtx): Promise<ProductCost[]> {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.producao.view");
  const products = await rows<Omit<ProductCost, "batch_cost_cents" | "unit_cost_cents" | "margin_cents" | "margin_pct" | "items">>(ctx.db,
    "select id, name, sale_unit, sale_price_cents, yield_quantity, is_active from saas.bakery_products where tenant_id = $1 order by name",
    [ctx.tenant.id]);
  const items = await rows<{ product_id: string; ingredient_id: string; ingredient_name: string; unit: string; quantity: string;
                             pack_quantity: string; pack_cost_cents: number }>(ctx.db,
    `select ri.product_id, ri.ingredient_id, i.name as ingredient_name, i.unit, ri.quantity, i.pack_quantity, i.pack_cost_cents
       from saas.bakery_recipe_items ri join saas.bakery_ingredients i on i.id = ri.ingredient_id
      where ri.tenant_id = $1 order by i.name`, [ctx.tenant.id]);
  return products.map((p) => {
    const its = items.filter((i) => i.product_id === p.id).map((i) => ({
      ingredient_id: i.ingredient_id, ingredient_name: i.ingredient_name, unit: i.unit, quantity: i.quantity,
      cost_cents: Math.round((Number(i.quantity) * i.pack_cost_cents) / Number(i.pack_quantity)),
    }));
    const batch = its.reduce((a, b) => a + b.cost_cents, 0);
    const unit = Math.round(batch / Number(p.yield_quantity));
    const margin = p.sale_price_cents - unit;
    return { ...p, items: its, batch_cost_cents: batch, unit_cost_cents: unit, margin_cents: margin,
             margin_pct: p.sale_price_cents > 0 ? margin / p.sale_price_cents : null };
  });
}

const productSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(1, "Informe o nome").max(80),
  saleUnit: z.enum(["un", "kg", "cento", "fatia"]),
  salePrice: moneyNonNegative,
  yieldQuantity: qty,
  items: z.array(z.object({ ingredientId: uuid, quantity: qty })).max(60).default([]),
});

export async function saveProduct(ctx: TenantCtx, input: unknown) {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.producao.manage");
  requireWrite(ctx);
  const d = parse(productSchema, input);
  const ids = new Set(d.items.map((i) => i.ingredientId));
  if (ids.size !== d.items.length) throw new ValidationError("Insumo repetido na ficha técnica.");
  let id = d.id;
  if (id) {
    const r = await ctx.db.query(
      "update saas.bakery_products set name = $3, sale_unit = $4, sale_price_cents = $5, yield_quantity = $6 where id = $1 and tenant_id = $2",
      [id, ctx.tenant.id, d.name, d.saleUnit, d.salePrice, d.yieldQuantity]);
    if (!r.rowCount) throw new NotFoundError("Produto não encontrado.");
    await ctx.db.query("delete from saas.bakery_recipe_items where tenant_id = $1 and product_id = $2", [ctx.tenant.id, id]);
  } else {
    const r = await one<{ id: string }>(ctx.db,
      "insert into saas.bakery_products (tenant_id, name, sale_unit, sale_price_cents, yield_quantity) values ($1, $2, $3, $4, $5) returning id",
      [ctx.tenant.id, d.name, d.saleUnit, d.salePrice, d.yieldQuantity]);
    id = r!.id;
  }
  for (const it of d.items) {
    await ctx.db.query(
      "insert into saas.bakery_recipe_items (tenant_id, product_id, ingredient_id, quantity) values ($1, $2, $3, $4)",
      [ctx.tenant.id, id, it.ingredientId, it.quantity]);
  }
  await audit(ctx, "padaria.product.save", "bakery_product", id!);
  return id!;
}

const lossSchema = z.object({
  lossDate: isoDate,
  productId: uuid,
  quantity: qty,
  reason: z.enum(["sobra", "queimado", "vencido", "avaria", "outro"]),
  notes: optionalText(300),
});

/** Registra perda valorizada ao custo unitário vigente (instantâneo). Sem efeito financeiro. */
export async function registerLoss(ctx: TenantCtx, input: unknown) {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.producao.manage");
  requireWrite(ctx);
  const d = parse(lossSchema, input);
  if (d.lossDate > ctx.today) throw new ValidationError("A data não pode estar no futuro.");
  const product = (await listProducts(ctx)).find((p) => p.id === d.productId);
  if (!product) throw new NotFoundError("Produto não encontrado.");
  const r = await one<{ id: string }>(ctx.db,
    `insert into saas.bakery_losses (tenant_id, loss_date, product_id, quantity, unit_cost_cents, reason, notes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [ctx.tenant.id, d.lossDate, d.productId, d.quantity, product.unit_cost_cents, d.reason, d.notes, ctx.user.id]);
  return r!.id;
}

export async function listLosses(ctx: TenantCtx, from: string, to: string) {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.producao.view");
  return rows<{ id: string; loss_date: string; product_name: string; quantity: string; unit_cost_cents: number; total_cents: number; reason: string; created_by_name: string | null }>(ctx.db,
    `select l.id, l.loss_date, p.name as product_name, l.quantity, l.unit_cost_cents,
            round(l.quantity * l.unit_cost_cents)::bigint as total_cents, l.reason, u.name as created_by_name
       from saas.bakery_losses l join saas.bakery_products p on p.id = l.product_id left join saas.users u on u.id = l.created_by
      where l.tenant_id = $1 and l.loss_date between $2 and $3 order by l.loss_date desc, l.created_at desc`,
    [ctx.tenant.id, from, to]);
}

export async function kpis(ctx: TenantCtx) {
  const r = await one<{ v: number; n: number }>(ctx.db,
    `select coalesce(round(sum(quantity * unit_cost_cents)), 0)::bigint as v, count(*)::int as n
       from saas.bakery_losses where tenant_id = $1 and loss_date between $2 and $3`,
    [ctx.tenant.id, monthStart(ctx.today), monthEnd(ctx.today)]);
  return { losses_month_cents: r!.v, losses_count: r!.n };
}
