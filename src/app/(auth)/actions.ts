"use server";

import { redirect } from "next/navigation";
import * as auth from "@/server/auth/service";
import { acceptInvite } from "@/domains/access/members";
import {
  clearAuthCookies, clientIp, currentUser, formObject, sessionToken, setSessionCookie, setTenantCookie, toActionError,
  userAgent, type ActionState,
} from "@/server/web";
import { listMyCompanies } from "@/domains/tenants/service";

function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const data = formObject(fd);
  let target: string;
  try {
    const r = await auth.login(data, { ip: await clientIp(), userAgent: await userAgent() });
    await setSessionCookie(r.sessionToken);
    const companies = await listMyCompanies(r.userId);
    if (companies.length === 1) await setTenantCookie(companies[0].id);
    target = companies.length === 0 ? "/onboarding" : safeNext(data.next);
  } catch (err) {
    return toActionError(err);
  }
  redirect(target);
}

export async function signupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const data = formObject(fd);
  if (data.password !== data.passwordConfirm) return { ok: false, error: "As senhas não conferem.", fieldErrors: { passwordConfirm: "As senhas não conferem" } };
  if (!data.acceptTerms) return { ok: false, error: "É necessário aceitar os termos de uso e a política de privacidade." };
  try {
    const r = await auth.signup(data, { ip: await clientIp(), userAgent: await userAgent() });
    await setSessionCookie(r.sessionToken);
  } catch (err) {
    return toActionError(err);
  }
  redirect(typeof data.next === "string" && data.next.startsWith("/invite/") ? data.next : "/onboarding");
}

export async function logoutAction() {
  await auth.logout(await sessionToken());
  await clearAuthCookies();
  redirect("/login");
}

export async function resendVerificationAction(): Promise<ActionState> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "Entre novamente." };
  try {
    await auth.resendVerification(u.id, await clientIp());
    return { ok: true, message: "Enviamos um novo link de confirmação para o seu e-mail.", stamp: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await auth.requestPasswordReset(String(fd.get("email") ?? ""), await clientIp());
  } catch (err) {
    return toActionError(err);
  }
  return { ok: true, message: "Se houver uma conta com este e-mail, você receberá um link para criar uma nova senha.", stamp: Date.now() };
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  if (d.password !== d.passwordConfirm) return { ok: false, error: "As senhas não conferem." };
  try {
    await auth.resetPassword(String(d.token ?? ""), String(d.password ?? ""));
  } catch (err) {
    return toActionError(err);
  }
  redirect("/login?reset=1");
}

export async function acceptInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await currentUser();
  if (!u) return { ok: false, error: "Entre na sua conta para aceitar o convite." };
  let tenantId: string;
  try {
    tenantId = await acceptInvite(u, String(fd.get("token") ?? ""));
  } catch (err) {
    return toActionError(err);
  }
  await setTenantCookie(tenantId);
  redirect("/app");
}
