import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { isoDate, moneyPositive, optionalText, parse, uuid } from "@/lib/validation";
import { one, rows } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { requirePerm, requireWrite } from "@/server/authz";
import { requireActiveAccount } from "./accounts";
import { audit } from "./shared";

export type MovementRow = {
  id: string;
  occurred_on: string;
  kind: string;
  direction: "in" | "out";
  amount_cents: number;
  account_id: string;
  account_name: string;
  title_id: string | null;
  title_description: string | null;
  title_direction: string | null;
  transfer_id: string | null;
  reverses_id: string | null;
  category_name: string | null;
  payment_method: string | null;
  description: string | null;
  reason: string | null;
  reversed: boolean;
  created_by_name: string | null;
  created_at: string;
};

export type MovementFilter = { from?: string; to?: string; accountId?: string; kind?: string; limit?: number };

export async function listMovements(ctx: TenantCtx, f: MovementFilter = {}): Promise<MovementRow[]> {
  requirePerm(ctx, "finance.view");
  return rows<MovementRow>(ctx.db,
    `select m.id, m.occurred_on, m.kind, m.direction, m.amount_cents, m.account_id, a.name as account_name,
            m.title_id, t.description as title_description, t.direction as title_direction, m.transfer_id, m.reverses_id,
            coalesce(tc.name, mc.name) as category_name, m.payment_method, m.description, m.reason,
            exists (select 1 from saas.cash_movements r where r.reverses_id = m.id) as reversed,
            u.name as created_by_name, m.created_at
       from saas.cash_movements m
       join saas.financial_accounts a on a.id = m.account_id
       left join saas.titles t on t.id = m.title_id
       left join saas.categories tc on tc.id = t.category_id
       left join saas.categories mc on mc.id = m.category_id
       left join saas.users u on u.id = m.created_by
      where m.tenant_id = $1
        and ($2::date is null or m.occurred_on >= $2::date)
        and ($3::date is null or m.occurred_on <= $3::date)
        and ($4::uuid is null or m.account_id = $4::uuid)
        and ($5::text is null or m.kind = $5)
      order by m.occurred_on desc, m.created_at desc
      limit $6`,
    [ctx.tenant.id, f.from || null, f.to || null, f.accountId || null, f.kind || null, Math.min(f.limit ?? 500, 5000)]);
}

export const transferSchema = z.object({
  fromAccountId: uuid,
  toAccountId: uuid,
  amount: moneyPositive,
  date: isoDate,
  description: optionalText(200),
});

/** Transferência entre contas próprias: duas movimentações, sem efeito em receitas/despesas. */
export async function transferInternal(
  ctx: TenantCtx,
  d: z.output<typeof transferSchema>,
  opts: { sourceModule?: string; sourceRefId?: string } = {},
): Promise<string> {
  requireWrite(ctx);
  if (d.fromAccountId === d.toAccountId) throw new ValidationError("Escolha contas de origem e destino diferentes.");
  await requireActiveAccount(ctx, d.fromAccountId);
  await requireActiveAccount(ctx, d.toAccountId);
  const tr = await one<{ id: string }>(ctx.db,
    `insert into saas.transfers (tenant_id, from_account_id, to_account_id, amount_cents, transfer_date, description,
                                 source_module, source_ref_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [ctx.tenant.id, d.fromAccountId, d.toAccountId, d.amount, d.date, d.description, opts.sourceModule ?? null,
     opts.sourceRefId ?? null, ctx.user.id]);
  const desc = d.description ?? "Transferência entre contas";
  await ctx.db.query(
    `insert into saas.cash_movements (tenant_id, account_id, direction, amount_cents, occurred_on, kind, transfer_id, description, created_by)
     values ($1, $2, 'out', $4, $5, 'transfer', $6, $7, $8), ($1, $3, 'in', $4, $5, 'transfer', $6, $7, $8)`,
    [ctx.tenant.id, d.fromAccountId, d.toAccountId, d.amount, d.date, tr!.id, desc, ctx.user.id]);
  await audit(ctx, "transfer.create", "transfer", tr!.id, { source_module: opts.sourceModule ?? null });
  return tr!.id;
}

export async function createTransfer(ctx: TenantCtx, input: unknown) {
  requirePerm(ctx, "transfers.create");
  return transferInternal(ctx, parse(transferSchema, input));
}

/**
 * Estorno: cria movimentação oposta vinculada à original (que permanece intacta).
 * Estornar uma perna de transferência estorna as duas.
 */
export async function reverseMovementInternal(ctx: TenantCtx, movementId: string, reason: string, date?: string): Promise<string[]> {
  requireWrite(ctx);
  const m = await one<{
    id: string; kind: string; direction: "in" | "out"; amount_cents: number; account_id: string; title_id: string | null;
    transfer_id: string | null; reversed: boolean;
  }>(ctx.db,
    `select m.id, m.kind, m.direction, m.amount_cents, m.account_id, m.title_id, m.transfer_id,
            exists (select 1 from saas.cash_movements r where r.reverses_id = m.id) as reversed
       from saas.cash_movements m where m.id = $1 and m.tenant_id = $2`, [movementId, ctx.tenant.id]);
  if (!m) throw new NotFoundError("Movimentação não encontrada.");
  if (m.kind === "reversal") throw new ValidationError("Um estorno não pode ser estornado. Registre um novo lançamento.");
  if (m.kind === "opening_balance") throw new ValidationError("Saldo inicial não é estornado; utilize um ajuste de saldo.");
  if (m.reversed) throw new ValidationError("Esta movimentação já foi estornada.");

  const targets = m.transfer_id
    ? await rows<typeof m>(ctx.db,
        `select m.id, m.kind, m.direction, m.amount_cents, m.account_id, m.title_id, m.transfer_id, false as reversed
           from saas.cash_movements m where m.tenant_id = $1 and m.transfer_id = $2 and m.kind = 'transfer'`,
        [ctx.tenant.id, m.transfer_id])
    : [m];
  const ids: string[] = [];
  for (const t of targets) {
    const r = await one<{ id: string }>(ctx.db,
      `insert into saas.cash_movements (tenant_id, account_id, direction, amount_cents, occurred_on, kind, title_id, transfer_id,
                                        reverses_id, description, reason, created_by)
       values ($1, $2, $3, $4, $5, 'reversal', $6, $7, $8, 'Estorno', $9, $10) returning id`,
      [ctx.tenant.id, t.account_id, t.direction === "in" ? "out" : "in", t.amount_cents, date ?? ctx.today, t.title_id,
       t.transfer_id, t.id, reason, ctx.user.id]);
    ids.push(r!.id);
  }
  await audit(ctx, m.transfer_id ? "transfer.reverse" : "movement.reverse", m.transfer_id ? "transfer" : "cash_movement",
    m.transfer_id ?? m.id, { title_id: m.title_id, reversal_ids: ids }, reason);
  return ids;
}

export const reverseSchema = z.object({
  movementId: uuid,
  reason: z.string().trim().min(5, "Informe o motivo do estorno (mínimo 5 caracteres)").max(300),
});

export async function reverseMovement(ctx: TenantCtx, input: unknown) {
  requirePerm(ctx, "movements.adjust");
  const d = parse(reverseSchema, input);
  return reverseMovementInternal(ctx, d.movementId, d.reason);
}
