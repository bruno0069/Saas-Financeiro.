import type { Db } from "@/server/db/pool";
import { rows } from "@/server/db/pool";

/** Configurações globais da plataforma (editáveis pelo superadmin). */
export type PlatformSettings = {
  graceDaysBeforeSuspension: number;
  invoiceDueDays: number;
  disabledModules: string[];
  readOnlyRetentionDays: number;
  supportGrantMaxHours: number;
};

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  graceDaysBeforeSuspension: 15,
  invoiceDueDays: 5,
  disabledModules: [],
  readOnlyRetentionDays: 365,
  supportGrantMaxHours: 72,
};

export const PLATFORM_SETTING_KEYS: Record<keyof PlatformSettings, string> = {
  graceDaysBeforeSuspension: "billing.grace_days",
  invoiceDueDays: "billing.invoice_due_days",
  disabledModules: "modules.disabled",
  readOnlyRetentionDays: "retention.read_only_days",
  supportGrantMaxHours: "support.grant_max_hours",
};

export async function loadPlatformSettings(db: Db): Promise<PlatformSettings> {
  const map = new Map((await rows<{ key: string; value: unknown }>(db, "select key, value from saas.platform_settings")).map((r) => [r.key, r.value]));
  const out = { ...DEFAULT_PLATFORM_SETTINGS };
  for (const [prop, key] of Object.entries(PLATFORM_SETTING_KEYS) as [keyof PlatformSettings, string][]) {
    const v = map.get(key);
    if (v === undefined) continue;
    if (prop === "disabledModules") {
      if (Array.isArray(v)) out.disabledModules = v.filter((x): x is string => typeof x === "string");
    } else if (typeof v === "number" && Number.isFinite(v)) {
      (out[prop] as number) = v;
    }
  }
  return out;
}
