import { writeAudit } from "@/domains/audit/audit";
import type { TenantCtx } from "@/server/context";

/** Registra auditoria na mesma transação da operação (tudo ou nada). */
export async function audit(
  ctx: TenantCtx,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
  reason?: string | null,
) {
  await writeAudit(ctx.db, {
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    actorType: ctx.supportMode ? "support" : "user",
    action,
    entityType,
    entityId,
    metadata,
    reason: reason ?? null,
    requestId: ctx.requestId,
  });
}

/** Serializa operações concorrentes do mesmo tenant (ex.: verificação de limites do plano). */
export async function lockTenantKey(ctx: TenantCtx, key: string) {
  await ctx.db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${ctx.tenant.id}:${key}`]);
}
