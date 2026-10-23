import { randomUUID } from "node:crypto";
import pg from "pg";
import { signup, getSessionUser } from "@/server/auth/service";
import { createCompany } from "@/domains/tenants/service";
import { runInTenant, type TenantCtx } from "@/server/context";
import { ownerPool } from "@/server/db/pool";
import { acceptInvite, inviteUser } from "@/domains/access/members";
import { createAccount } from "@/domains/finance/accounts";
import type { Role } from "@/domains/access/permissions";

export const ip = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

export type TestUser = { id: string; token: string; email: string };

export async function makeUser(name = "Usuário Teste", verified = true): Promise<TestUser> {
  const email = `u-${randomUUID().slice(0, 8)}@teste.local`;
  const r = await signup({ name, email, password: "senha-super-forte-123" }, { ip: ip() });
  if (verified) await ownerPool().query("update saas.users set email_verified_at = now() where id = $1", [r.userId]);
  return { id: r.userId, token: r.sessionToken, email };
}

export async function makeCompany(name = "Padaria Teste", segment = "padaria") {
  const owner = await makeUser("Dono " + name);
  const su = (await getSessionUser(owner.token))!;
  const tenantId = await createCompany(su, { tradeName: name, segment });
  return { owner, tenantId };
}

export function as<T>(u: TestUser, tenantId: string, fn: (ctx: TenantCtx) => Promise<T>, supportMode = false) {
  return runInTenant({ sessionToken: u.token, tenantId, supportMode }, fn);
}

export async function addMember(owner: TestUser, tenantId: string, role: Exclude<Role, "owner">): Promise<TestUser> {
  const u = await makeUser(`Membro ${role}`);
  const inv = await as(owner, tenantId, (ctx) => inviteUser(ctx, { email: u.email, role }));
  const token = inv.link.split("/invite/")[1];
  await acceptInvite((await getSessionUser(u.token))!, token);
  return u;
}

export async function makeAccount(owner: TestUser, tenantId: string, name: string, opening = 0, kind = "checking") {
  return as(owner, tenantId, (ctx) => createAccount(ctx, { name, kind, openingBalance: opening, openingDate: ctx.today }));
}

export async function categoryId(tenantId: string, code: string): Promise<string> {
  return (await ownerPool().query("select id from saas.categories where tenant_id = $1 and code = $2", [tenantId, code])).rows[0].id;
}

/** Cliente direto com o papel da aplicação, para testar as políticas RLS sem passar pelos serviços. */
export async function rawApp(token: string | null, tenantId: string | null, fn: (c: pg.PoolClient) => Promise<void>, support = false) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: "-c search_path=saas,public" });
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.session_token', $1, true), set_config('app.tenant_id', $2, true), set_config('app.support_mode', $3, true)",
      [token ?? "", tenantId ?? "", support ? "on" : "off"]);
    await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
    await pool.end();
  }
}

export async function setSubscriptionStatus(tenantId: string, status: string, extra = "") {
  await ownerPool().query(`update saas.subscriptions set status = $2 ${extra} where tenant_id = $1 and status <> 'ended'`, [tenantId, status]);
}
