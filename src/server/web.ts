import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError, ForbiddenError, PlanRestrictionError, UnauthenticatedError, ValidationError, fromDbError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/domains/audit/audit";
import { getSessionUser, SESSION_TTL_DAYS, type SessionUser } from "./auth/service";
import { runInTenant, type TenantCtx } from "./context";
import { withSystemTx } from "./db/pool";

export const SESSION_COOKIE = "sf_session";
export const TENANT_COOKIE = "sf_tenant";
export const SUPPORT_COOKIE = "sf_support";

const secure = process.env.NODE_ENV === "production";

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: SESSION_TTL_DAYS * 86400,
  });
}

export async function setTenantCookie(tenantId: string) {
  (await cookies()).set(TENANT_COOKIE, tenantId, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 365 * 86400 });
}

export async function clearAuthCookies() {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
  c.delete(SUPPORT_COOKIE);
}

export async function sessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local").slice(0, 64);
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

export async function requestId(): Promise<string> {
  return (await headers()).get("x-request-id") ?? randomUUID();
}

export async function currentUser(): Promise<SessionUser | null> {
  return getSessionUser(await sessionToken());
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

async function tenantAuth() {
  const c = await cookies();
  const support = c.get(SUPPORT_COOKIE)?.value;
  return {
    sessionToken: c.get(SESSION_COOKIE)?.value ?? null,
    tenantId: support ?? c.get(TENANT_COOKIE)?.value ?? null,
    supportMode: !!support,
    requestId: await requestId(),
  };
}

/** Para páginas: executa no tenant atual, redirecionando quando sem sessão ou sem empresa. */
export async function withTenantPage<T>(fn: (ctx: TenantCtx) => Promise<T>): Promise<T> {
  const auth = await tenantAuth();
  if (!auth.sessionToken) redirect("/login");
  if (!auth.tenantId) redirect("/empresas");
  let result: T;
  try {
    result = await runInTenant(auth, fn);
  } catch (err) {
    if (err instanceof UnauthenticatedError) redirect("/login");
    if (err instanceof ForbiddenError && /Empresa não encontrada/.test(err.message)) redirect("/empresas");
    if (err instanceof ForbiddenError) redirect("/app/acesso-negado");
    if (err instanceof PlanRestrictionError) redirect(`/app/recurso-indisponivel?m=${encodeURIComponent(err.message)}`);
    throw err;
  }
  return result;
}

export type ActionState<T = unknown> = {
  ok?: boolean;
  error?: string;
  code?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
  data?: T;
  /** Muda a cada envio para que o formulário possa reagir (limpar campos, fechar diálogos). */
  stamp?: number;
};

export function toActionError(err: unknown): ActionState {
  const e = err instanceof AppError ? err : fromDbError(err);
  if (e) {
    return { ok: false, error: e.message, code: e.code, fieldErrors: e instanceof ValidationError ? e.fieldErrors : undefined, stamp: Date.now() };
  }
  logger.error("unexpected action error", { err: (err as Error)?.message, stack: (err as Error)?.stack?.split("\n").slice(0, 4).join(" | ") });
  return { ok: false, error: "Ocorreu um erro inesperado. Tente novamente; se persistir, contate o suporte.", code: "internal", stamp: Date.now() };
}

/**
 * Executa uma ação de servidor no tenant atual. Negações de acesso são auditadas em transação
 * separada (a transação da operação é desfeita).
 */
export async function tenantAction<T>(fn: (ctx: TenantCtx) => Promise<T>, okMessage?: string): Promise<ActionState<T>> {
  const auth = await tenantAuth();
  try {
    if (!auth.sessionToken) throw new UnauthenticatedError();
    if (!auth.tenantId) throw new ForbiddenError("Selecione uma empresa.");
    const data = await runInTenant(auth, fn);
    return { ok: true, data, message: okMessage, stamp: Date.now() };
  } catch (err) {
    if (err instanceof ForbiddenError && auth.sessionToken && auth.tenantId) {
      const user = await getSessionUser(auth.sessionToken).catch(() => null);
      await withSystemTx((db) => writeAudit(db, {
        tenantId: auth.tenantId, actorUserId: user?.id ?? null, actorType: auth.supportMode ? "support" : "user",
        action: "access.denied", result: "denied", metadata: { permission: err.permission ?? null }, requestId: auth.requestId,
      })).catch(() => {});
    }
    return toActionError(err) as ActionState<T>;
  }
}

/** Converte FormData em objeto simples (checkbox "on" => true; campos repetidos => arrays). */
export function formObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const val = typeof v === "string" ? v : v.name;
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      (out[key] as unknown[] | undefined) ? (out[key] as unknown[]).push(val) : (out[key] = [val]);
    } else {
      out[k] = val === "on" ? true : val;
    }
  }
  return out;
}
