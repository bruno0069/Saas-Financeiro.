import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { isoDate, moneyAny, moneyPositive, optionalText, optionalUuid, parse, uuid } from "@/lib/validation";
import { one, rows } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { checkLimit, requirePerm, requireWrite } from "@/server/authz";
import { audit, lockTenantKey } from "./shared";

export type AccountRow = {
  id: string;
  name: string;
  kind: string;
  institution: string | null;
  is_active: boolean;
  opening_balance_cents: number;
  opening_date: string;
  balance_cents: number;
};

const ACCOUNT_KINDS = ["cash", "checking", "savings", "digital_wallet", "card_receivables", "other"] as const;

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da conta").max(80),
  kind: z.enum(ACCOUNT_KINDS, "Tipo de conta inválido"),
  institution: optionalText(80),
  openingBalance: moneyAny,
  openingDate: isoDate,
});

export const updateAccountSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(ACCOUNT_KINDS),
  institution: optionalText(80),
  isActive: z.boolean(),
});

export const adjustmentSchema = z.object({
  accountId: uuid,
  direction: z.enum(["in", "out"]),
  amount: moneyPositive,
  date: isoDate,
  reason: z.string().trim().min(5, "Descreva o motivo do ajuste (mínimo 5 caracteres)").max(300),
  categoryId: optionalUuid,
});

export async function listAccounts(ctx: TenantCtx, opts: { includeInactive?: boolean } = {}): Promise<AccountRow[]> {
  requirePerm(ctx, "finance.view");
  return rows<AccountRow>(ctx.db,
    `select a.id, a.name, a.kind, a.institution, a.is_active, a.opening_balance_cents, a.opening_date,
            coalesce(b.balance_cents, 0) as balance_cents
       from saas.financial_accounts a
       left join saas.account_balances b on b.account_id = a.id
      where a.tenant_id = $1 and ($2 or a.is_active)
      order by a.is_active desc, a.name`, [ctx.tenant.id, !!opts.includeInactive]);
}

/** Lista simplificada (sem saldos) para formulários; exige apenas acesso a lançamentos. */
export async function listAccountOptions(ctx: TenantCtx): Promise<{ id: string; name: string; kind: string }[]> {
  return rows(ctx.db,
    "select id, name, kind from saas.financial_accounts where tenant_id = $1 and is_active order by name", [ctx.tenant.id]);
}

export async function createAccount(ctx: TenantCtx, input: unknown): Promise<string> {
  requirePerm(ctx, "accounts.manage");
  requireWrite(ctx);
  const data = parse(createAccountSchema, input);
  await lockTenantKey(ctx, "accounts");
  const count = await one<{ n: number }>(ctx.db,
    "select count(*)::int as n from saas.financial_accounts where tenant_id = $1 and is_active", [ctx.tenant.id]);
  checkLimit(ctx, "max_financial_accounts", count!.n);
  const acc = await one<{ id: string }>(ctx.db,
    `insert into saas.financial_accounts (tenant_id, name, kind, institution, opening_balance_cents, opening_date, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [ctx.tenant.id, data.name, data.kind, data.institution, data.openingBalance, data.openingDate, ctx.user.id]);
  if (data.openingBalance !== 0) {
    await ctx.db.query(
      `insert into saas.cash_movements (tenant_id, account_id, direction, amount_cents, occurred_on, kind, description, created_by)
       values ($1, $2, $3, $4, $5, 'opening_balance', 'Saldo inicial', $6)`,
      [ctx.tenant.id, acc!.id, data.openingBalance > 0 ? "in" : "out", Math.abs(data.openingBalance), data.openingDate, ctx.user.id]);
  }
  await audit(ctx, "account.create", "financial_account", acc!.id, { kind: data.kind, has_opening_balance: data.openingBalance !== 0 });
  return acc!.id;
}

export async function updateAccount(ctx: TenantCtx, input: unknown): Promise<void> {
  requirePerm(ctx, "accounts.manage");
  requireWrite(ctx);
  const data = parse(updateAccountSchema, input);
  if (data.isActive) {
    const current = await one<{ is_active: boolean }>(ctx.db,
      "select is_active from saas.financial_accounts where id = $1 and tenant_id = $2", [data.id, ctx.tenant.id]);
    if (current && !current.is_active) {
      await lockTenantKey(ctx, "accounts");
      const count = await one<{ n: number }>(ctx.db,
        "select count(*)::int as n from saas.financial_accounts where tenant_id = $1 and is_active", [ctx.tenant.id]);
      checkLimit(ctx, "max_financial_accounts", count!.n);
    }
  }
  const r = await ctx.db.query(
    `update saas.financial_accounts set name = $3, kind = $4, institution = $5, is_active = $6
      where id = $1 and tenant_id = $2`,
    [data.id, ctx.tenant.id, data.name, data.kind, data.institution, data.isActive]);
  if (!r.rowCount) throw new NotFoundError("Conta não encontrada.");
  await audit(ctx, "account.update", "financial_account", data.id, { is_active: data.isActive });
}

/** Ajuste de saldo auditável (ex.: diferença de conciliação). Não é receita nem despesa operacional. */
export async function adjustBalance(ctx: TenantCtx, input: unknown): Promise<string> {
  requirePerm(ctx, "movements.adjust");
  requireWrite(ctx);
  const data = parse(adjustmentSchema, input);
  await requireActiveAccount(ctx, data.accountId);
  const mv = await one<{ id: string }>(ctx.db,
    `insert into saas.cash_movements (tenant_id, account_id, direction, amount_cents, occurred_on, kind, category_id, description, reason, created_by)
     values ($1, $2, $3, $4, $5, 'adjustment', $6, 'Ajuste de saldo', $7, $8) returning id`,
    [ctx.tenant.id, data.accountId, data.direction, data.amount, data.date, data.categoryId, data.reason, ctx.user.id]);
  await audit(ctx, "movement.adjust", "cash_movement", mv!.id, { direction: data.direction }, data.reason);
  return mv!.id;
}

export async function requireActiveAccount(ctx: TenantCtx, accountId: string) {
  const a = await one<{ is_active: boolean }>(ctx.db,
    "select is_active from saas.financial_accounts where id = $1 and tenant_id = $2", [accountId, ctx.tenant.id]);
  if (!a) throw new NotFoundError("Conta financeira não encontrada.");
  if (!a.is_active) throw new ValidationError("Conta financeira inativa.");
}
