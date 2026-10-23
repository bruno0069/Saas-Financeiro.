"use server";

import { revalidatePath } from "next/cache";
import { inviteUser, removeMember, revokeInvite, transferOwnership, updateMember } from "@/domains/access/members";
import { grantSupport, revokeSupport } from "@/domains/access/support";
import * as subs from "@/domains/billing/subscriptions";
import { markOnboardingStep, setModuleEnabled, updateCompany } from "@/domains/tenants/service";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { requirePerm } from "@/server/authz";
import { formObject, tenantAction, type ActionState } from "@/server/web";

const refresh = () => revalidatePath("/app", "layout");

export async function updateCompanyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const r = await tenantAction((ctx) => updateCompany(ctx, { ...d, notifyEmail: d.notifyEmail === true }), "Dados da empresa atualizados.");
  if (r.ok) refresh();
  return r;
}

export async function toggleModuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => setModuleEnabled(ctx, String(fd.get("module")), fd.get("enabled") === "true"), "Módulo atualizado.");
  if (r.ok) refresh();
  return r;
}

export async function inviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction(async (ctx) => {
    const inv = await inviteUser(ctx, formObject(fd));
    await markOnboardingStep(ctx, "team");
    return inv;
  });
  if (r.ok) {
    refresh();
    return { ...r, message: `Convite criado. Enviamos o link por e-mail; você também pode copiá-lo: ${r.data?.link}` };
  }
  return r;
}

export async function revokeInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => revokeInvite(ctx, String(fd.get("id"))), "Convite revogado.");
  if (r.ok) refresh();
  return r;
}

export async function updateMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const r = await tenantAction((ctx) => updateMember(ctx, {
    membershipId: d.membershipId, role: d.role,
    extraPermissions: (d.extra as string[] | undefined) ?? [], revokedPermissions: (d.revoked as string[] | undefined) ?? [],
  }), "Permissões atualizadas.");
  if (r.ok) refresh();
  return r;
}

export async function removeMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => removeMember(ctx, String(fd.get("membershipId"))), "Acesso removido. Os registros do usuário foram preservados.");
  if (r.ok) refresh();
  return r;
}

export async function transferOwnershipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => transferOwnership(ctx, formObject(fd)), "Propriedade transferida.");
  if (r.ok) refresh();
  return r;
}

export async function grantSupportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => grantSupport(ctx, formObject(fd)), "Acesso de suporte concedido.");
  if (r.ok) refresh();
  return r;
}

export async function revokeSupportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => revokeSupport(ctx, String(fd.get("id"))), "Acesso de suporte revogado.");
  if (r.ok) refresh();
  return r;
}

/** Ações de assinatura do próprio cliente: autoriza no tenant e executa no serviço de assinaturas. */
export async function subscriptionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const r = await tenantAction(async (ctx) => {
    requirePerm(ctx, "billing.manage");
    if (ctx.supportMode) throw new ForbiddenError();
    const subId = ctx.subscription?.subscription_id;
    if (!subId) throw new ValidationError("Empresa sem assinatura vigente.");
    const actor = { type: "user" as const, userId: ctx.user.id };
    return { subId, actor };
  });
  if (!r.ok || !r.data) return r;
  try {
    if (d.op === "change_plan") {
      await subs.changePlan(r.data.subId, String(d.planId), d.interval === "yearly" ? "yearly" : "monthly", r.data.actor, "Alteração pelo cliente");
    } else if (d.op === "cancel") {
      const reason = String(d.reason ?? "").trim();
      if (reason.length < 3) return { ok: false, error: "Conte-nos o motivo do cancelamento." };
      await subs.cancelSubscription(r.data.subId, r.data.actor, reason);
    } else if (d.op === "reactivate") {
      await subs.reactivateSubscription(r.data.subId, r.data.actor);
    }
  } catch (err) {
    const { toActionError } = await import("@/server/web");
    return toActionError(err);
  }
  refresh();
  return { ok: true, message: "Assinatura atualizada.", stamp: Date.now() };
}
