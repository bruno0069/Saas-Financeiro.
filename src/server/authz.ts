import { ForbiddenError, PlanRestrictionError, ReadOnlyError } from "@/lib/errors";
import type { Permission } from "@/domains/access/permissions";
import { FEATURES, LIMITS, type FeatureKey, type LimitKey } from "@/domains/billing/catalog";
import { moduleState, type TenantCtx } from "./context";

/** Permissão do USUÁRIO na empresa. */
export function requirePerm(ctx: TenantCtx, ...perms: Permission[]) {
  for (const p of perms) {
    if (!ctx.permissions.has(p)) throw new ForbiddenError(undefined, p);
  }
}

export function hasPerm(ctx: TenantCtx, p: Permission) {
  return ctx.permissions.has(p);
}

/** Escrita permitida: não está em modo suporte e a assinatura concede acesso pleno. */
export function requireWrite(ctx: TenantCtx) {
  if (ctx.supportMode) throw new ReadOnlyError("Acesso de suporte é somente leitura.");
  if (ctx.access !== "full") throw new ReadOnlyError();
}

/** Funcionalidade contratada pela EMPRESA (plano + ajustes). */
export function requireFeature(ctx: TenantCtx, f: FeatureKey) {
  if (!ctx.entitlements.features.has(f)) {
    throw new PlanRestrictionError(`O recurso "${FEATURES[f]}" não está incluído no plano atual.`, f);
  }
}

export function requireModule(ctx: TenantCtx, key: string) {
  const m = moduleState(ctx, key);
  if (!m) throw new PlanRestrictionError("Módulo não disponível para o segmento desta empresa.");
  if (!m.entitled) throw new PlanRestrictionError(`O módulo "${m.def.name}" não está incluído no plano atual.`, m.def.feature);
  if (m.globallyDisabled) throw new PlanRestrictionError(`O módulo "${m.def.name}" está temporariamente indisponível.`);
  if (!m.enabledByTenant) throw new PlanRestrictionError(`O módulo "${m.def.name}" está desabilitado nas configurações da empresa.`);
}

export function limitOf(ctx: TenantCtx, key: LimitKey): number | null {
  const v = ctx.entitlements.limits[key];
  return v === undefined ? null : v;
}

/** Verifica se adicionar `adding` itens ao total atual respeita o limite contratado. */
export function checkLimit(ctx: TenantCtx, key: LimitKey, current: number, adding = 1) {
  const max = limitOf(ctx, key);
  if (max !== null && current + adding > max) {
    throw new PlanRestrictionError(`Limite do plano atingido: ${LIMITS[key]} (máximo ${max}). Faça upgrade para continuar.`);
  }
}
