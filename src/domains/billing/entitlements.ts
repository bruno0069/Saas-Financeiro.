import type { Db } from "@/server/db/pool";
import { rows } from "@/server/db/pool";
import { FEATURES, LIMITS, type FeatureKey, type LimitKey } from "./catalog";

export type Entitlements = {
  features: Set<FeatureKey>;
  /** undefined/null = ilimitado */
  limits: Partial<Record<LimitKey, number | null>>;
};

/**
 * Funcionalidades e limites efetivos = plano contratado + ajustes concedidos pela plataforma.
 * Calculado no servidor a cada requisição; o front-end apenas exibe.
 */
export async function loadEntitlements(db: Db, tenantId: string, planId: string | null): Promise<Entitlements> {
  const features = new Set<FeatureKey>();
  const limits: Entitlements["limits"] = {};
  if (planId) {
    for (const r of await rows<{ feature_key: string }>(db, "select feature_key from saas.plan_features where plan_id = $1", [planId])) {
      if (r.feature_key in FEATURES) features.add(r.feature_key as FeatureKey);
    }
    for (const r of await rows<{ limit_key: string; limit_value: number | null }>(db,
      "select limit_key, limit_value from saas.plan_limits where plan_id = $1", [planId])) {
      if (r.limit_key in LIMITS) limits[r.limit_key as LimitKey] = r.limit_value;
    }
  }
  for (const r of await rows<{ feature_key: string; enabled: boolean }>(db,
    "select feature_key, enabled from saas.tenant_feature_overrides where tenant_id = $1", [tenantId])) {
    if (!(r.feature_key in FEATURES)) continue;
    if (r.enabled) features.add(r.feature_key as FeatureKey);
    else features.delete(r.feature_key as FeatureKey);
  }
  for (const r of await rows<{ limit_key: string; limit_value: number | null }>(db,
    "select limit_key, limit_value from saas.tenant_limit_overrides where tenant_id = $1", [tenantId])) {
    if (r.limit_key in LIMITS) limits[r.limit_key as LimitKey] = r.limit_value;
  }
  return { features, limits };
}
