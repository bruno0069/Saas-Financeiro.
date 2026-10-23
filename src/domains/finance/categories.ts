import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { parse, uuid } from "@/lib/validation";
import { one, rows } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { requirePerm, requireWrite } from "@/server/authz";
import { audit } from "./shared";

export type CategoryRow = { id: string; name: string; kind: "income" | "expense"; code: string | null; is_system: boolean; is_active: boolean };

export async function listCategories(ctx: TenantCtx, opts: { kind?: "income" | "expense"; includeInactive?: boolean } = {}) {
  return rows<CategoryRow>(ctx.db,
    `select id, name, kind, code, is_system, is_active from saas.categories
      where tenant_id = $1 and ($2::text is null or kind = $2) and ($3 or is_active)
      order by kind, name`, [ctx.tenant.id, opts.kind ?? null, !!opts.includeInactive]);
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80),
  kind: z.enum(["income", "expense"]),
});

export async function createCategory(ctx: TenantCtx, input: unknown) {
  requirePerm(ctx, "categories.manage");
  requireWrite(ctx);
  const d = parse(createSchema, input);
  const c = await one<{ id: string }>(ctx.db,
    "insert into saas.categories (tenant_id, name, kind) values ($1, $2, $3) returning id", [ctx.tenant.id, d.name, d.kind]);
  await audit(ctx, "category.create", "category", c!.id, { kind: d.kind });
  return c!.id;
}

const updateSchema = z.object({ id: uuid, name: z.string().trim().min(1).max(80), isActive: z.boolean() });

/** Categorias não são excluídas (preserva histórico); podem ser renomeadas ou desativadas. */
export async function updateCategory(ctx: TenantCtx, input: unknown) {
  requirePerm(ctx, "categories.manage");
  requireWrite(ctx);
  const d = parse(updateSchema, input);
  const r = await ctx.db.query("update saas.categories set name = $3, is_active = $4 where id = $1 and tenant_id = $2",
    [d.id, ctx.tenant.id, d.name, d.isActive]);
  if (!r.rowCount) throw new NotFoundError("Categoria não encontrada.");
  await audit(ctx, "category.update", "category", d.id, { is_active: d.isActive });
}

export async function categoryIdByCode(ctx: TenantCtx, code: string): Promise<string> {
  const c = await one<{ id: string }>(ctx.db, "select id from saas.categories where tenant_id = $1 and code = $2", [ctx.tenant.id, code]);
  if (c) return c.id;
  throw new NotFoundError(`Categoria padrão ${code} não encontrada. Verifique as configurações da empresa.`);
}
