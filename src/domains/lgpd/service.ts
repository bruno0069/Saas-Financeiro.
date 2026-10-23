import { AppError, ForbiddenError } from "@/lib/errors";
import { writeAudit } from "@/domains/audit/audit";
import { one, rows, withSystemTx } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { verifyPassword } from "@/server/auth/crypto";
import type { SessionUser } from "@/server/auth/service";
import { audit } from "@/domains/finance/shared";

const TENANT_TABLES = [
  "financial_accounts", "categories", "contacts", "titles", "transfers", "cash_movements",
  "bakery_settings", "bakery_cash_closings", "bakery_card_receivables", "bakery_ingredients", "bakery_products",
  "bakery_recipe_items", "bakery_losses",
] as const;

/**
 * Exportação completa dos dados da empresa (portabilidade). Disponível inclusive em modo somente
 * leitura (assinatura suspensa/encerrada). Executa no papel da aplicação: RLS garante que só
 * dados do tenant atual sejam incluídos.
 */
export async function exportTenantData(ctx: TenantCtx) {
  if (ctx.role !== "owner") throw new ForbiddenError("Somente o proprietário pode exportar todos os dados da empresa.");
  const data: Record<string, unknown[]> = {};
  for (const t of TENANT_TABLES) {
    data[t] = await rows(ctx.db, `select * from saas.${t} where tenant_id = $1`, [ctx.tenant.id]);
  }
  data.members = await rows(ctx.db,
    `select u.name, u.email, m.role, m.status, m.created_at from saas.memberships m join saas.users u on u.id = m.user_id
      where m.tenant_id = $1`, [ctx.tenant.id]);
  await audit(ctx, "lgpd.export", "tenant", ctx.tenant.id, { tables: TENANT_TABLES.length });
  return { exported_at: new Date().toISOString(), tenant: ctx.tenant, data };
}

/** Dados pessoais do próprio usuário (direito de acesso do titular). */
export async function exportMyData(user: SessionUser) {
  return withSystemTx(async (db) => ({
    exported_at: new Date().toISOString(),
    user: await one(db, "select id, email, name, email_verified_at, status, created_at from saas.users where id = $1", [user.id]),
    memberships: await rows(db,
      `select t.trade_name, m.role, m.status, m.created_at from saas.memberships m join saas.tenants t on t.id = m.tenant_id
        where m.user_id = $1`, [user.id]),
    sessions: await rows(db, "select created_at, last_seen_at, expires_at, revoked_at, user_agent from saas.sessions where user_id = $1", [user.id]),
  }));
}

/**
 * Exclusão da conta do usuário: anonimiza os dados pessoais e encerra sessões. Registros
 * financeiros das empresas são preservados (obrigações legais de guarda); o autor passa a
 * aparecer como "Usuário removido". Proprietários precisam transferir a propriedade antes.
 */
export async function deleteMyAccount(user: SessionUser, password: string) {
  await withSystemTx(async (db) => {
    const u = await one<{ password_hash: string }>(db, "select password_hash from saas.users where id = $1 for update", [user.id]);
    if (!u || !(await verifyPassword(password, u.password_hash))) throw new AppError("Senha incorreta.", "invalid_credentials", 401);
    const owner = await one(db,
      `select 1 from saas.memberships m join saas.tenants t on t.id = m.tenant_id
        where m.user_id = $1 and m.role = 'owner' and m.status = 'active' and t.status = 'active'`, [user.id]);
    if (owner) throw new AppError("Você é proprietário de uma empresa ativa. Transfira a propriedade ou encerre a empresa antes.", "owner_blocked");
    await db.query(
      `update saas.users set name = 'Usuário removido', email = 'removido+' || id || '@invalid.local', password_hash = 'disabled',
              status = 'deleted', deleted_at = now() where id = $1`, [user.id]);
    await db.query("update saas.memberships set status = 'removed', removed_at = now(), permissions = '{}' where user_id = $1", [user.id]);
    await db.query("update saas.sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [user.id]);
    await db.query("delete from saas.auth_tokens where user_id = $1", [user.id]);
    await writeAudit(db, { tenantId: null, actorUserId: user.id, actorType: "user", action: "lgpd.account_delete", entityType: "user", entityId: user.id });
  });
}
