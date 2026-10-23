"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import * as admin from "@/domains/admin/service";
import { formObject, requestId, sessionToken, SUPPORT_COOKIE, toActionError, type ActionState } from "@/server/web";

async function run<T>(roles: admin.AdminRole[] | null, fn: (a: admin.AdminCtx) => Promise<T>, msg: string): Promise<ActionState<T>> {
  try {
    const data = await admin.runAsAdmin(await sessionToken(), roles, fn, await requestId());
    revalidatePath("/admin", "layout");
    return { ok: true, data, message: msg, stamp: Date.now() };
  } catch (err) {
    return toActionError(err) as ActionState<T>;
  }
}

export async function savePlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const limits: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) if (k.startsWith("limit_")) limits[k.slice(6)] = String(v);
  return run(["superadmin"], (a) => admin.savePlan(a, {
    ...d, isActive: d.isActive === true, isPublic: d.isPublic === true, features: (d.features as string[]) ?? [], limits,
  }), "Plano salvo.");
}

export async function featureOverrideAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(["superadmin"], (a) => admin.setFeatureOverride(a, formObject(fd)), "Funcionalidade ajustada.");
}

export async function limitOverrideAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(["superadmin"], (a) => admin.setLimitOverride(a, formObject(fd)), "Limite ajustado.");
}

export async function subscriptionAdminAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(["superadmin", "billing"], (a) => admin.adminSubscriptionAction(a, formObject(fd)), "Assinatura atualizada.");
}

export async function markPaidAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(["superadmin", "billing"], (a) => admin.markInvoicePaidByAdmin(a, formObject(fd)), "Pagamento confirmado.");
}

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  return run(["superadmin"], (a) => admin.saveSettings(a, { ...d, disabledModules: (d.disabledModules as string[]) ?? [] }), "Configurações salvas.");
}

export async function enterSupportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const r = await run(["support", "superadmin"], (a) => admin.enterSupport(a, d), "");
  if (!r.ok) return r;
  (await cookies()).set(SUPPORT_COOKIE, String(d.tenantId), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 4 * 3600 });
  redirect("/app");
}
