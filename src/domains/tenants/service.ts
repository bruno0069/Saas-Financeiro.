import { z } from "zod";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { isValidTaxId, normalizeTaxId } from "@/lib/tax-id";
import { optionalText, parse } from "@/lib/validation";
import { ALL_PERMISSIONS } from "@/domains/access/permissions";
import { writeAudit } from "@/domains/audit/audit";
import { createTrialSubscription } from "@/domains/billing/subscriptions";
import { getSegment, isSegmentKey, seedCategoriesFor } from "@/domains/segments/registry";
import { one, rows, withSystemTx } from "@/server/db/pool";
import { rateLimit } from "@/server/system/rate-limit";
import type { SessionUser } from "@/server/auth/service";
import { emailVerificationRequired } from "@/server/auth/service";
import type { TenantCtx } from "@/server/context";
import { requirePerm, requireWrite } from "@/server/authz";
import { audit } from "@/domains/finance/shared";

export const createCompanySchema = z.object({
  tradeName: z.string().trim().min(2, "Informe o nome da empresa").max(120),
  segment: z.string().refine(isSegmentKey, "Selecione um segmento"),
  legalName: optionalText(160),
  taxId: optionalText(20),
});

export const ONBOARDING_STEPS = [
  { key: "company", label: "Cadastrar a empresa", required: true },
  { key: "accounts", label: "Cadastrar contas financeiras e saldos iniciais", required: true },
  { key: "categories", label: "Revisar categorias", required: false },
  { key: "first_entry", label: "Registrar o primeiro lançamento", required: false },
  { key: "team", label: "Convidar a equipe", required: false },
] as const;

/**
 * Cria empresa + vínculo de proprietário + configuração do segmento + assinatura de avaliação
 * em UMA transação. Qualquer falha desfaz tudo: não existem empresas parcialmente cadastradas.
 * Executa em contexto de sistema porque o usuário ainda não é membro de nenhum tenant.
 */
export async function createCompany(user: SessionUser, input: unknown, opts: { failAfterStep?: string } = {}): Promise<string> {
  if (emailVerificationRequired() && !user.emailVerified) {
    throw new ForbiddenError("Confirme seu e-mail antes de cadastrar a empresa.");
  }
  const d = parse(createCompanySchema, input);
  const taxId = normalizeTaxId(d.taxId);
  if (taxId && !isValidTaxId(taxId)) throw new ValidationError("CPF/CNPJ inválido", { taxId: "CPF/CNPJ inválido" });
  await rateLimit(`company:create:${user.id}`, 5, 86400);
  const segment = getSegment(d.segment);

  return withSystemTx(async (db) => {
    const owned = await one<{ n: number }>(db,
      "select count(*)::int as n from saas.memberships where user_id = $1 and role = 'owner' and status = 'active'", [user.id]);
    if (owned!.n >= 10) throw new AppError("Limite de empresas por usuário atingido. Contate o suporte.", "too_many_tenants");

    const t = await one<{ id: string }>(db,
      `insert into saas.tenants (trade_name, legal_name, tax_id, segment, created_by, onboarding_steps, preferred_kpis)
       values ($1, $2, $3, $4, $5, '{"company": true}', $6) returning id`,
      [d.tradeName, d.legalName, taxId, segment.key, user.id, segment.kpis]);
    const tenantId = t!.id;
    await db.query(
      "insert into saas.memberships (tenant_id, user_id, role, permissions) values ($1, $2, 'owner', $3)",
      [tenantId, user.id, ALL_PERMISSIONS]);
    if (opts.failAfterStep === "membership") throw new Error("Falha simulada após vínculo");

    for (const c of seedCategoriesFor(segment.key)) {
      await db.query("insert into saas.categories (tenant_id, name, kind, code, is_system) values ($1, $2, $3, $4, true)",
        [tenantId, c.name, c.kind, c.code ?? null]);
    }
    for (const m of segment.defaultModules) {
      await db.query("insert into saas.tenant_modules (tenant_id, module_key, enabled, updated_by) values ($1, $2, true, $3)",
        [tenantId, m, user.id]);
    }
    if (opts.failAfterStep === "categories") throw new Error("Falha simulada após categorias");
    await createTrialSubscription(db, tenantId, { type: "user", userId: user.id });
    await writeAudit(db, {
      tenantId, actorUserId: user.id, actorType: "user", action: "tenant.create", entityType: "tenant", entityId: tenantId,
      metadata: { segment: segment.key },
    });
    return tenantId;
  });
}

/** Empresas das quais o usuário é membro (para seleção de empresa). */
export async function listMyCompanies(userId: string) {
  return withSystemTx((db) => rows<{ id: string; trade_name: string; segment: string; role: string }>(db,
    `select t.id, t.trade_name, t.segment, m.role from saas.memberships m join saas.tenants t on t.id = m.tenant_id
      where m.user_id = $1 and m.status = 'active' order by t.trade_name`, [userId]));
}

export async function markOnboardingStep(ctx: TenantCtx, step: string) {
  if (ctx.supportMode || ctx.access !== "full" || !ctx.permissions.has("settings.manage")) return;
  if (ctx.tenant.onboarding_steps?.[step]) return;
  await ctx.db.query(
    "update saas.tenants set onboarding_steps = onboarding_steps || jsonb_build_object($2::text, true) where id = $1",
    [ctx.tenant.id, step]);
}

export async function completeOnboarding(ctx: TenantCtx) {
  requirePerm(ctx, "settings.manage");
  requireWrite(ctx);
  await ctx.db.query("update saas.tenants set onboarding_completed_at = coalesce(onboarding_completed_at, now()) where id = $1",
    [ctx.tenant.id]);
}

export const updateCompanySchema = z.object({
  tradeName: z.string().trim().min(2).max(120),
  legalName: optionalText(160),
  taxId: optionalText(20),
  timezone: z.enum(["America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Recife",
    "America/Cuiaba", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha"]),
  notifyDueDays: z.coerce.number().int().min(0).max(30),
  notifyEmail: z.boolean(),
});

export async function updateCompany(ctx: TenantCtx, input: unknown) {
  requirePerm(ctx, "settings.manage");
  requireWrite(ctx);
  const d = parse(updateCompanySchema, input);
  const taxId = normalizeTaxId(d.taxId);
  if (taxId && !isValidTaxId(taxId)) throw new ValidationError("CPF/CNPJ inválido", { taxId: "CPF/CNPJ inválido" });
  await ctx.db.query(
    `update saas.tenants set trade_name = $2, legal_name = $3, tax_id = $4, timezone = $5, notify_due_days = $6, notify_email = $7
      where id = $1`, [ctx.tenant.id, d.tradeName, d.legalName, taxId, d.timezone, d.notifyDueDays, d.notifyEmail]);
  await audit(ctx, "tenant.update", "tenant", ctx.tenant.id);
}

export async function setModuleEnabled(ctx: TenantCtx, moduleKey: string, enabled: boolean) {
  requirePerm(ctx, "settings.manage");
  requireWrite(ctx);
  const m = ctx.modules.find((x) => x.def.key === moduleKey);
  if (!m) throw new ValidationError("Módulo não disponível para este segmento.");
  if (enabled && !m.entitled) throw new ForbiddenError(`O módulo "${m.def.name}" não está incluído no plano atual.`);
  await ctx.db.query(
    `insert into saas.tenant_modules (tenant_id, module_key, enabled, updated_by, updated_at) values ($1, $2, $3, $4, now())
     on conflict (tenant_id, module_key) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`,
    [ctx.tenant.id, moduleKey, enabled, ctx.user.id]);
  await audit(ctx, "module.toggle", "module", moduleKey, { enabled });
}
