import { randomUUID } from "node:crypto";
import { ForbiddenError, UnauthenticatedError, fromDbError } from "@/lib/errors";
import { todayIn } from "@/lib/dates";
import { effectivePermissions, type Permission, type Role } from "@/domains/access/permissions";
import { loadEntitlements, type Entitlements } from "@/domains/billing/entitlements";
import { loadPlatformSettings, type PlatformSettings } from "@/domains/platform-settings";
import { MODULES, modulesForSegment, type ModuleDef } from "@/domains/modules/registry";
import { one, rows, withAppTx, type Db } from "./db/pool";
import type { SessionUser } from "./auth/service";

export type TenantRow = {
  id: string;
  trade_name: string;
  legal_name: string | null;
  tax_id: string | null;
  segment: string;
  currency: string;
  timezone: string;
  notify_due_days: number;
  notify_email: boolean;
  preferred_kpis: string[];
  status: string;
  onboarding_steps: Record<string, boolean>;
  onboarding_completed_at: string | null;
};

export type SubscriptionSummary = {
  subscription_id: string;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  status: string;
  billing_interval: string;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  access_level: "full" | "read_only";
};

export type ModuleState = {
  def: ModuleDef;
  entitled: boolean;
  globallyDisabled: boolean;
  enabledByTenant: boolean;
  available: boolean;
};

export type TenantCtx = {
  db: Db;
  requestId: string;
  user: SessionUser;
  tenant: TenantRow;
  role: Role | null;
  permissions: Set<Permission>;
  supportMode: boolean;
  access: "full" | "read_only";
  subscription: SubscriptionSummary | null;
  entitlements: Entitlements;
  modules: ModuleState[];
  platform: PlatformSettings;
  today: string;
};

export type TenantAuth = { sessionToken: string | null; tenantId: string | null; supportMode?: boolean; requestId?: string };

export async function loadModuleStates(db: Db, tenant: TenantRow, ent: Entitlements, platform: PlatformSettings): Promise<ModuleState[]> {
  const toggles = new Map(
    (await rows<{ module_key: string; enabled: boolean }>(db,
      "select module_key, enabled from saas.tenant_modules where tenant_id = $1", [tenant.id])).map((r) => [r.module_key, r.enabled]),
  );
  return modulesForSegment(tenant.segment).map((def) => {
    const entitled = ent.features.has(def.feature);
    const globallyDisabled = platform.disabledModules.includes(def.key);
    const enabledByTenant = toggles.get(def.key) ?? false;
    return { def, entitled, globallyDisabled, enabledByTenant, available: entitled && !globallyDisabled && enabledByTenant };
  });
}

/**
 * Abre uma transação no papel da aplicação, com identidade e tenant verificados pelo banco,
 * e monta o contexto de autorização. Toda operação de dados de empresa passa por aqui.
 */
export async function runInTenant<T>(auth: TenantAuth, fn: (ctx: TenantCtx) => Promise<T>): Promise<T> {
  if (!auth.sessionToken) throw new UnauthenticatedError();
  try {
    return await runInTenantTx(auth, fn);
  } catch (err) {
    // Regras violadas no banco (RLS, gatilhos, restrições) viram erros de domínio com mensagem segura.
    throw fromDbError(err) ?? err;
  }
}

async function runInTenantTx<T>(auth: TenantAuth, fn: (ctx: TenantCtx) => Promise<T>): Promise<T> {
  return withAppTx({ sessionToken: auth.sessionToken, tenantId: auth.tenantId, supportMode: auth.supportMode }, async (db) => {
    const u = await one<{ id: string; email: string; name: string; email_verified_at: string | null; platform_role: string | null }>(db,
      `select u.id, u.email, u.name, u.email_verified_at, saas.platform_admin_role() as platform_role
         from saas.users u where u.id = saas.current_user_id()`);
    if (!u) throw new UnauthenticatedError();
    const user: SessionUser = {
      id: u.id, email: u.email, name: u.name, emailVerified: !!u.email_verified_at,
      platformRole: (u.platform_role as SessionUser["platformRole"]) ?? null,
    };
    // current_tenant_id() só retorna o tenant se houver vínculo ativo (ou suporte autorizado).
    const tenant = await one<TenantRow>(db, "select * from saas.tenants where id = saas.current_tenant_id()");
    if (!tenant) throw new ForbiddenError("Empresa não encontrada ou sem acesso.");
    const m = auth.supportMode
      ? null
      : await one<{ role: Role; extra_permissions: string[]; revoked_permissions: string[] }>(db,
          "select role, extra_permissions, revoked_permissions from saas.memberships where tenant_id = $1 and user_id = $2 and status = 'active'",
          [tenant.id, user.id]);
    if (!auth.supportMode && !m) throw new ForbiddenError("Empresa não encontrada ou sem acesso.");
    const subscription = await one<SubscriptionSummary>(db, "select * from saas.current_subscription_summary()");
    const entitlements = await loadEntitlements(db, tenant.id, subscription?.plan_id ?? null);
    const platform = await loadPlatformSettings(db);
    const modules = await loadModuleStates(db, tenant, entitlements, platform);
    // Suporte: somente leitura e somente permissões de visualização.
    const permissions = new Set<Permission>(
      m ? effectivePermissions(m.role, m.extra_permissions, m.revoked_permissions)
        : (["dashboard.view", "finance.view", "payables.view", "receivables.view", "reports.view", "padaria.producao.view"] as Permission[]),
    );
    const ctx: TenantCtx = {
      db,
      requestId: auth.requestId ?? randomUUID(),
      user,
      tenant,
      role: m?.role ?? null,
      permissions,
      supportMode: !!auth.supportMode,
      access: auth.supportMode ? "read_only" : subscription?.access_level ?? "read_only",
      subscription,
      entitlements,
      modules,
      platform,
      today: todayIn(tenant.timezone),
    };
    return fn(ctx);
  });
}

export function moduleState(ctx: TenantCtx, key: keyof typeof MODULES | string): ModuleState | undefined {
  return ctx.modules.find((m) => m.def.key === key);
}
