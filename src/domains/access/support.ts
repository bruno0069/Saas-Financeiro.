import { z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parse, uuid } from "@/lib/validation";
import { audit } from "@/domains/finance/shared";
import { one, rows } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";

/** Concessão de acesso de suporte (somente leitura, temporária, justificada e auditada). */
export async function listSupportGrants(ctx: TenantCtx) {
  if (ctx.role !== "owner") return [];
  return rows<{ id: string; reason: string; expires_at: Date; revoked_at: Date | null; created_at: Date; active: boolean }>(ctx.db,
    `select id, reason, expires_at, revoked_at, created_at, (revoked_at is null and expires_at > now()) as active
       from saas.support_access_grants where tenant_id = $1 order by created_at desc limit 20`, [ctx.tenant.id]);
}

export async function grantSupport(ctx: TenantCtx, input: unknown) {
  if (ctx.role !== "owner" || ctx.supportMode) throw new ForbiddenError("Somente o proprietário pode conceder acesso de suporte.");
  const d = parse(z.object({
    hours: z.coerce.number().int().min(1),
    reason: z.string().trim().min(10, "Descreva o motivo (mínimo 10 caracteres)").max(500),
  }), input);
  if (d.hours > ctx.platform.supportGrantMaxHours) {
    throw new ValidationError(`O acesso pode durar no máximo ${ctx.platform.supportGrantMaxHours} horas.`);
  }
  const g = await one<{ id: string }>(ctx.db,
    `insert into saas.support_access_grants (tenant_id, granted_by, reason, expires_at)
     values ($1, $2, $3, now() + make_interval(hours => $4)) returning id`, [ctx.tenant.id, ctx.user.id, d.reason, d.hours]);
  await audit(ctx, "support.grant", "support_grant", g!.id, { hours: d.hours }, d.reason);
}

export async function revokeSupport(ctx: TenantCtx, id: string) {
  if (ctx.role !== "owner") throw new ForbiddenError();
  parse(uuid, id);
  const r = await ctx.db.query("update saas.support_access_grants set revoked_at = now() where id = $1 and tenant_id = $2 and revoked_at is null",
    [id, ctx.tenant.id]);
  if (!r.rowCount) throw new NotFoundError("Concessão não encontrada.");
  await audit(ctx, "support.revoke", "support_grant", id);
}
