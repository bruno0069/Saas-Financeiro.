import { z } from "zod";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/domains/audit/audit";
import { one, withAppTx, withSystemTx, ownerPool } from "../db/pool";
import { rateLimit } from "../system/rate-limit";
import { appUrl, sendMail } from "../system/mailer";
import { getDummyHash, hashPassword, newToken, sha256, verifyPassword } from "./crypto";

export const SESSION_TTL_DAYS = 30;

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email("E-mail inválido")),
  password: z.string().min(10, "A senha deve ter pelo menos 10 caracteres").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("E-mail inválido")),
  password: z.string().min(1, "Informe a senha").max(200),
});

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  platformRole: "superadmin" | "support" | "billing" | null;
};

export function emailVerificationRequired(): boolean {
  return process.env.REQUIRE_EMAIL_VERIFICATION !== "false";
}

async function createSession(userId: string, userAgent?: string | null): Promise<string> {
  const token = newToken();
  await ownerPool().query(
    `insert into saas.sessions (user_id, token_hash, expires_at, user_agent)
     values ($1, $2, now() + make_interval(days => $3), $4)`,
    [userId, sha256(token), SESSION_TTL_DAYS, userAgent?.slice(0, 200) ?? null],
  );
  return token;
}

async function issueToken(userId: string, purpose: "verify_email" | "reset_password", hours: number): Promise<string> {
  const token = newToken();
  await ownerPool().query(
    `insert into saas.auth_tokens (user_id, purpose, token_hash, expires_at) values ($1, $2, $3, now() + make_interval(hours => $4))`,
    [userId, purpose, sha256(token), hours],
  );
  return token;
}

export async function signup(input: unknown, meta: { ip: string; userAgent?: string | null }) {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const { name, email, password } = parsed.data;
  await rateLimit(`signup:ip:${meta.ip}`, 10, 3600);
  const hash = await hashPassword(password);
  const user = await withSystemTx(async (db) => {
    const exists = await one(db, "select 1 from saas.users where email = $1", [email]);
    if (exists) throw new ConflictError("Já existe uma conta com este e-mail. Entre ou recupere a senha.");
    const u = await one<{ id: string }>(db,
      "insert into saas.users (email, name, password_hash) values ($1, $2, $3) returning id", [email, name, hash]);
    await writeAudit(db, { tenantId: null, actorUserId: u!.id, actorType: "user", action: "auth.signup", entityType: "user", entityId: u!.id });
    return u!;
  });
  await sendVerificationEmail(user.id, email, name);
  const token = await createSession(user.id, meta.userAgent);
  return { userId: user.id, sessionToken: token };
}

export async function sendVerificationEmail(userId: string, email: string, name: string) {
  const token = await issueToken(userId, "verify_email", 48);
  await sendMail({
    to: email,
    subject: "Confirme seu e-mail",
    text: `Olá, ${name}!\n\nConfirme seu e-mail acessando o link abaixo (válido por 48 horas):\n${appUrl(`/verify-email?token=${token}`)}\n`,
  }).catch((err) => logger.error("verification email failed", { err: (err as Error).message }));
}

export async function login(input: unknown, meta: { ip: string; userAgent?: string | null }) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const { email, password } = parsed.data;
  await rateLimit(`login:ip:${meta.ip}`, 50, 900);
  await rateLimit(`login:email:${email}`, 10, 900);
  const row = (await ownerPool().query<{ id: string; password_hash: string; status: string }>(
    "select id, password_hash, status from saas.users where email = $1", [email])).rows[0];
  const ok = row ? await verifyPassword(password, row.password_hash) : await verifyPassword(password, await getDummyHash());
  if (!row || !ok || row.status !== "active") {
    await withSystemTx((db) => writeAudit(db, {
      tenantId: null, actorUserId: row?.id ?? null, actorType: "user", action: "auth.login_failed", result: "denied",
      metadata: { reason: !row ? "unknown_email" : !ok ? "bad_password" : "inactive" },
    }));
    throw new AppError("E-mail ou senha incorretos.", "invalid_credentials", 401);
  }
  const token = await createSession(row.id, meta.userAgent);
  await withSystemTx((db) => writeAudit(db, { tenantId: null, actorUserId: row.id, actorType: "user", action: "auth.login" }));
  return { userId: row.id, sessionToken: token };
}

export async function logout(sessionToken: string | null) {
  if (!sessionToken) return;
  await ownerPool().query("update saas.sessions set revoked_at = now() where token_hash = $1 and revoked_at is null", [sha256(sessionToken)]);
}

/** Resolve o usuário da sessão usando o papel da aplicação (a identidade é verificada no banco). */
export async function getSessionUser(sessionToken: string | null | undefined): Promise<SessionUser | null> {
  if (!sessionToken || sessionToken.length > 100) return null;
  const u = await withAppTx({ sessionToken }, (db) =>
    one<{ id: string; email: string; name: string; email_verified_at: string | null; platform_role: string | null }>(db,
      `select u.id, u.email, u.name, u.email_verified_at, saas.platform_admin_role() as platform_role
         from saas.users u where u.id = saas.current_user_id()`),
  );
  if (!u) return null;
  // Atualiza "visto por último" no máximo a cada 10 minutos.
  ownerPool().query(
    "update saas.sessions set last_seen_at = now() where token_hash = $1 and last_seen_at < now() - interval '10 minutes'",
    [sha256(sessionToken)],
  ).catch(() => {});
  return {
    id: u.id, email: u.email, name: u.name, emailVerified: !!u.email_verified_at,
    platformRole: (u.platform_role as SessionUser["platformRole"]) ?? null,
  };
}

async function consumeToken(token: string, purpose: "verify_email" | "reset_password") {
  if (!token || token.length > 100) return null;
  return withSystemTx(async (db) => {
    const t = await one<{ id: string; user_id: string }>(db,
      `update saas.auth_tokens set used_at = now()
        where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
        returning id, user_id`, [sha256(token), purpose]);
    return t;
  });
}

export async function verifyEmail(token: string): Promise<boolean> {
  const t = await consumeToken(token, "verify_email");
  if (!t) return false;
  await ownerPool().query("update saas.users set email_verified_at = coalesce(email_verified_at, now()) where id = $1", [t.user_id]);
  return true;
}

export async function resendVerification(userId: string, ip: string) {
  await rateLimit(`verify:resend:${userId}`, 5, 3600);
  await rateLimit(`verify:resend:ip:${ip}`, 20, 3600);
  const u = (await ownerPool().query("select email, name, email_verified_at from saas.users where id = $1", [userId])).rows[0];
  if (u && !u.email_verified_at) await sendVerificationEmail(userId, u.email, u.name);
}

/** Sempre responde igual, exista ou não o e-mail (evita enumeração de contas). */
export async function requestPasswordReset(emailInput: string, ip: string) {
  const email = String(emailInput ?? "").trim().toLowerCase();
  await rateLimit(`reset:ip:${ip}`, 10, 3600);
  if (!z.email().safeParse(email).success) return;
  await rateLimit(`reset:email:${email}`, 3, 3600);
  const u = (await ownerPool().query("select id, name from saas.users where email = $1 and status = 'active'", [email])).rows[0];
  if (!u) return;
  const token = await issueToken(u.id, "reset_password", 2);
  await sendMail({
    to: email,
    subject: "Redefinição de senha",
    text: `Olá, ${u.name}.\n\nPara criar uma nova senha, acesse (válido por 2 horas):\n${appUrl(`/reset-password?token=${token}`)}\n\nSe você não solicitou, ignore esta mensagem.`,
  }).catch((err) => logger.error("reset email failed", { err: (err as Error).message }));
}

export async function resetPassword(token: string, newPassword: string) {
  const pw = signupSchema.shape.password.safeParse(newPassword);
  if (!pw.success) throw new ValidationError(pw.error.issues[0].message);
  const hash = await hashPassword(pw.data);
  const t = await consumeToken(token, "reset_password");
  if (!t) throw new AppError("Link inválido ou expirado. Solicite um novo.", "invalid_token");
  await withSystemTx(async (db) => {
    await db.query("update saas.users set password_hash = $2 where id = $1", [t.user_id, hash]);
    // Encerra todas as sessões existentes após troca de senha.
    await db.query("update saas.sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [t.user_id]);
    await writeAudit(db, { tenantId: null, actorUserId: t.user_id, actorType: "user", action: "auth.password_reset" });
  });
}
