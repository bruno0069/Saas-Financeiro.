import { z } from "zod";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parse, uuid } from "@/lib/validation";
import { writeAudit } from "@/domains/audit/audit";
import { loadEntitlements } from "@/domains/billing/entitlements";
import { audit, lockTenantKey } from "@/domains/finance/shared";
import { one, rows, withSystemTx } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { checkLimit, limitOf, requireFeature, requirePerm, requireWrite } from "@/server/authz";
import { newToken, sha256 } from "@/server/auth/crypto";
import type { SessionUser } from "@/server/auth/service";
import { appUrl, sendMail } from "@/server/system/mailer";
import { rateLimit } from "@/server/system/rate-limit";
import { ALL_PERMISSIONS, effectivePermissions, isPermission, OWNER_ONLY, type Role } from "./permissions";

export type MemberRow = {
  id: string; user_id: string; name: string; email: string; role: Role; status: string;
  extra_permissions: string[]; revoked_permissions: string[]; permissions: string[]; created_at: string;
};

export async function listMembers(ctx: TenantCtx) {
  requirePerm(ctx, "users.manage");
  const members = await rows<MemberRow>(ctx.db,
    `select m.id, m.user_id, u.name, u.email, m.role, m.status, m.extra_permissions, m.revoked_permissions, m.permissions, m.created_at
       from saas.memberships m join saas.users u on u.id = m.user_id
      where m.tenant_id = $1 order by m.status, (m.role = 'owner') desc, u.name`, [ctx.tenant.id]);
  const invites = await rows<{ id: string; email: string; role: string; expires_at: Date; created_at: Date }>(ctx.db,
    `select id, email, role, expires_at, created_at from saas.invitations
      where tenant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now() order by created_at desc`,
    [ctx.tenant.id]);
  return { members, invites, maxUsers: limitOf(ctx, "max_users") };
}

async function seatsInUse(ctx: TenantCtx) {
  const r = await one<{ n: number }>(ctx.db,
    `select (select count(*) from saas.memberships where tenant_id = $1 and status = 'active')
          + (select count(*) from saas.invitations where tenant_id = $1 and accepted_at is null and revoked_at is null and expires_at > now())
            as n`, [ctx.tenant.id]);
  return Number(r!.n);
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("E-mail inválido")),
  role: z.enum(["manager", "finance", "operator"]),
});

export async function inviteUser(ctx: TenantCtx, input: unknown): Promise<{ id: string; link: string }> {
  requirePerm(ctx, "users.manage");
  requireWrite(ctx);
  requireFeature(ctx, "users.invite");
  const d = parse(inviteSchema, input);
  await rateLimit(`invite:${ctx.tenant.id}`, 30, 3600);
  await lockTenantKey(ctx, "seats");
  const member = await one(ctx.db,
    `select 1 from saas.memberships m join saas.users u on u.id = m.user_id
      where m.tenant_id = $1 and u.email = $2 and m.status = 'active'`, [ctx.tenant.id, d.email]);
  if (member) throw new ValidationError("Este e-mail já é membro da empresa.");
  await ctx.db.query(
    "update saas.invitations set revoked_at = now() where tenant_id = $1 and email = $2 and accepted_at is null and revoked_at is null",
    [ctx.tenant.id, d.email]);
  checkLimit(ctx, "max_users", await seatsInUse(ctx));
  const token = newToken();
  const inv = await one<{ id: string }>(ctx.db,
    `insert into saas.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
     values ($1, $2, $3, $4, $5, now() + interval '7 days') returning id`,
    [ctx.tenant.id, d.email, d.role, sha256(token), ctx.user.id]);
  const link = appUrl(`/invite/${token}`);
  await audit(ctx, "invite.create", "invitation", inv!.id, { role: d.role });
  await sendMail({
    to: d.email,
    subject: `Convite para ${ctx.tenant.trade_name}`,
    text: `${ctx.user.name} convidou você para acessar ${ctx.tenant.trade_name} na plataforma de gestão financeira.\n\nAceite o convite (válido por 7 dias):\n${link}\n`,
  }).catch(() => {});
  return { id: inv!.id, link };
}

export async function revokeInvite(ctx: TenantCtx, id: string) {
  requirePerm(ctx, "users.manage");
  const r = await ctx.db.query("update saas.invitations set revoked_at = now() where id = $1 and tenant_id = $2 and accepted_at is null",
    [id, ctx.tenant.id]);
  if (!r.rowCount) throw new NotFoundError("Convite não encontrado.");
  await audit(ctx, "invite.revoke", "invitation", id);
}

/** Aceite de convite: o e-mail da conta precisa ser o mesmo do convite. */
export async function acceptInvite(user: SessionUser, token: string): Promise<string> {
  if (!token || token.length > 100) throw new ValidationError("Convite inválido.");
  return withSystemTx(async (db) => {
    const inv = await one<{ id: string; tenant_id: string; email: string; role: Role }>(db,
      `select id, tenant_id, email, role from saas.invitations
        where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update`, [sha256(token)]);
    if (!inv) throw new ValidationError("Convite inválido, expirado ou já utilizado.");
    if (inv.email !== user.email) {
      throw new ForbiddenError(`Este convite foi enviado para ${inv.email}. Entre com essa conta para aceitá-lo.`);
    }
    await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${inv.tenant_id}:seats`]);
    const sub = await one<{ plan_id: string }>(db, "select plan_id from saas.subscriptions where tenant_id = $1 and status <> 'ended'", [inv.tenant_id]);
    const ent = await loadEntitlements(db, inv.tenant_id, sub?.plan_id ?? null);
    const active = await one<{ n: number }>(db,
      "select count(*)::int as n from saas.memberships where tenant_id = $1 and status = 'active'", [inv.tenant_id]);
    const max = ent.limits.max_users;
    if (max != null && active!.n + 1 > max) throw new AppError("A empresa atingiu o limite de usuários do plano.", "plan_restriction", 402);
    const perms = effectivePermissions(inv.role);
    await db.query(
      `insert into saas.memberships (tenant_id, user_id, role, permissions) values ($1, $2, $3, $4)
       on conflict (tenant_id, user_id) do update
         set role = excluded.role, permissions = excluded.permissions, extra_permissions = '{}', revoked_permissions = '{}',
             status = 'active', removed_at = null, removed_by = null`,
      [inv.tenant_id, user.id, inv.role, perms]);
    await db.query("update saas.invitations set accepted_at = now(), accepted_by = $2 where id = $1", [inv.id, user.id]);
    await writeAudit(db, { tenantId: inv.tenant_id, actorUserId: user.id, actorType: "user", action: "invite.accept",
      entityType: "invitation", entityId: inv.id, metadata: { role: inv.role } });
    return inv.tenant_id;
  });
}

const updateMemberSchema = z.object({
  membershipId: uuid,
  role: z.enum(["manager", "finance", "operator"]),
  extraPermissions: z.array(z.string()).default([]),
  revokedPermissions: z.array(z.string()).default([]),
});

export async function updateMember(ctx: TenantCtx, input: unknown) {
  requirePerm(ctx, "users.manage");
  requireWrite(ctx);
  const d = parse(updateMemberSchema, input);
  const m = await one<{ user_id: string; role: Role; status: string }>(ctx.db,
    "select user_id, role, status from saas.memberships where id = $1 and tenant_id = $2", [d.membershipId, ctx.tenant.id]);
  if (!m) throw new NotFoundError("Usuário não encontrado.");
  if (m.user_id === ctx.user.id) throw new ForbiddenError("Você não pode alterar as próprias permissões.");
  if (m.role === "owner") throw new ForbiddenError("Para alterar o proprietário, use a transferência de propriedade.");
  if (m.status !== "active") throw new ValidationError("Usuário removido.");
  const extra = d.extraPermissions.filter(isPermission).filter((p) => !OWNER_ONLY.includes(p));
  const revoked = d.revokedPermissions.filter(isPermission);
  const perms = effectivePermissions(d.role, extra, revoked);
  // Ninguém concede permissões que não possui (o banco também verifica).
  if (ctx.role !== "owner") {
    const missing = perms.filter((p) => !ctx.permissions.has(p));
    if (missing.length) throw new ForbiddenError("Você não pode conceder permissões que não possui.");
  }
  await ctx.db.query(
    `update saas.memberships set role = $3, extra_permissions = $4, revoked_permissions = $5, permissions = $6
      where id = $1 and tenant_id = $2`, [d.membershipId, ctx.tenant.id, d.role, extra, revoked, perms]);
  await audit(ctx, "membership.update", "membership", d.membershipId, { role: d.role, extra, revoked });
}

/** Remove o acesso do usuário. Lançamentos criados por ele são preservados. */
export async function removeMember(ctx: TenantCtx, membershipId: string) {
  requirePerm(ctx, "users.manage");
  requireWrite(ctx);
  const m = await one<{ user_id: string; role: Role }>(ctx.db,
    "select user_id, role from saas.memberships where id = $1 and tenant_id = $2 and status = 'active'", [membershipId, ctx.tenant.id]);
  if (!m) throw new NotFoundError("Usuário não encontrado.");
  if (m.role === "owner") throw new ForbiddenError("O proprietário não pode ser removido. Transfira a propriedade antes.");
  if (m.user_id === ctx.user.id) throw new ForbiddenError("Você não pode remover a si mesmo.");
  await ctx.db.query(
    "update saas.memberships set status = 'removed', removed_at = now(), removed_by = $3, permissions = '{}' where id = $1 and tenant_id = $2",
    [membershipId, ctx.tenant.id, ctx.user.id]);
  await audit(ctx, "membership.remove", "membership", membershipId);
}

/**
 * Transferência de propriedade: somente o proprietário atual, para um membro ativo, com confirmação
 * pelo nome da empresa. O antigo proprietário passa a Gerente. Executada em contexto de sistema
 * (o gatilho do banco impede usuários de alterarem o próprio vínculo).
 */
export async function transferOwnership(ctx: TenantCtx, input: unknown) {
  const d = parse(z.object({ membershipId: uuid, confirmName: z.string() }), input);
  if (ctx.role !== "owner") throw new ForbiddenError("Somente o proprietário pode transferir a propriedade.");
  requireWrite(ctx);
  if (d.confirmName.trim() !== ctx.tenant.trade_name) throw new ValidationError("Digite exatamente o nome da empresa para confirmar.");
  const target = await one<{ user_id: string }>(ctx.db,
    "select user_id from saas.memberships where id = $1 and tenant_id = $2 and status = 'active' and role <> 'owner'",
    [d.membershipId, ctx.tenant.id]);
  if (!target) throw new NotFoundError("Usuário não encontrado.");
  await withSystemTx(async (db) => {
    await db.query(
      "update saas.memberships set role = 'manager', permissions = $3, extra_permissions = '{}', revoked_permissions = '{}' where tenant_id = $1 and user_id = $2",
      [ctx.tenant.id, ctx.user.id, effectivePermissions("manager")]);
    await db.query(
      "update saas.memberships set role = 'owner', permissions = $3, extra_permissions = '{}', revoked_permissions = '{}' where tenant_id = $1 and user_id = $2",
      [ctx.tenant.id, target.user_id, ALL_PERMISSIONS]);
    await writeAudit(db, { tenantId: ctx.tenant.id, actorUserId: ctx.user.id, actorType: "user", action: "ownership.transfer",
      entityType: "membership", entityId: d.membershipId, metadata: { new_owner: target.user_id } });
  });
}
