import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, monthEnd, monthStart } from "@/lib/dates";
import { applyBps } from "@/lib/money";
import { isoDate, moneyNonNegative, optionalText, optionalUuid, parse, uuid } from "@/lib/validation";
import { one, rows } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { requireModule, requirePerm, requireWrite } from "@/server/authz";
import { categoryIdByCode } from "@/domains/finance/categories";
import { createTitleInternal, cancelTitleInternal, settleInternal } from "@/domains/finance/titles";
import { reverseMovementInternal, transferInternal } from "@/domains/finance/movements";
import { audit } from "@/domains/finance/shared";
import { requireActiveAccount } from "@/domains/finance/accounts";

export const MODULE_KEY = "padaria.caixa";

export type BakerySettings = {
  pix_account_id: string | null;
  card_account_id: string | null;
  safe_account_id: string | null;
  debit_days: number;
  credit_days: number;
  voucher_days: number;
  debit_fee_bps: number;
  credit_fee_bps: number;
  voucher_fee_bps: number;
};

const DEFAULTS: BakerySettings = {
  pix_account_id: null, card_account_id: null, safe_account_id: null,
  debit_days: 1, credit_days: 30, voucher_days: 30, debit_fee_bps: 150, credit_fee_bps: 350, voucher_fee_bps: 500,
};

export async function getSettings(ctx: TenantCtx): Promise<BakerySettings> {
  requireModule(ctx, MODULE_KEY);
  const s = await one<BakerySettings>(ctx.db, "select * from saas.bakery_settings where tenant_id = $1", [ctx.tenant.id]);
  return s ?? DEFAULTS;
}

const settingsSchema = z.object({
  pixAccountId: optionalUuid,
  cardAccountId: optionalUuid,
  safeAccountId: optionalUuid,
  debitDays: z.coerce.number().int().min(0).max(60),
  creditDays: z.coerce.number().int().min(0).max(60),
  voucherDays: z.coerce.number().int().min(0).max(60),
  debitFeePct: z.coerce.number().min(0).max(20),
  creditFeePct: z.coerce.number().min(0).max(20),
  voucherFeePct: z.coerce.number().min(0).max(20),
});

export async function saveSettings(ctx: TenantCtx, input: unknown) {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.caixa.manage");
  requireWrite(ctx);
  const d = parse(settingsSchema, input);
  const bps = (pct: number) => Math.round(pct * 100);
  await ctx.db.query(
    `insert into saas.bakery_settings (tenant_id, pix_account_id, card_account_id, safe_account_id, debit_days, credit_days, voucher_days,
                                       debit_fee_bps, credit_fee_bps, voucher_fee_bps, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     on conflict (tenant_id) do update set pix_account_id = excluded.pix_account_id, card_account_id = excluded.card_account_id,
       safe_account_id = excluded.safe_account_id, debit_days = excluded.debit_days, credit_days = excluded.credit_days,
       voucher_days = excluded.voucher_days, debit_fee_bps = excluded.debit_fee_bps, credit_fee_bps = excluded.credit_fee_bps,
       voucher_fee_bps = excluded.voucher_fee_bps, updated_at = now()`,
    [ctx.tenant.id, d.pixAccountId, d.cardAccountId, d.safeAccountId, d.debitDays, d.creditDays, d.voucherDays,
     bps(d.debitFeePct), bps(d.creditFeePct), bps(d.voucherFeePct)]);
  await audit(ctx, "padaria.settings.update", "bakery_settings", ctx.tenant.id);
}

export const closingSchema = z.object({
  closingDate: isoDate,
  registerName: z.string().trim().min(1).max(40).default("Caixa 1"),
  registerAccountId: uuid,
  openingFloat: moneyNonNegative,
  cashSales: moneyNonNegative,
  pixSales: moneyNonNegative,
  debitSales: moneyNonNegative,
  creditSales: moneyNonNegative,
  voucherSales: moneyNonNegative,
  withdrawals: moneyNonNegative,
  countedCash: moneyNonNegative,
  ticketCount: z.union([z.literal(""), z.coerce.number().int().min(0).max(100000)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
  notes: optionalText(500),
});

/** Cálculo puro do fechamento (usado na tela para prévia e no servidor para gravação). */
export function computeClosing(d: { openingFloat: number; cashSales: number; withdrawals: number; countedCash: number;
  pixSales: number; debitSales: number; creditSales: number; voucherSales: number }) {
  const expectedCash = d.openingFloat + d.cashSales - d.withdrawals;
  const difference = d.countedCash - expectedCash;
  const totalSales = d.cashSales + d.pixSales + d.debitSales + d.creditSales + d.voucherSales;
  return { expectedCash, difference, totalSales };
}

/**
 * Registra o fechamento do dia e gera os efeitos financeiros pelos serviços centrais
 * (títulos, baixas e transferências). Tudo na mesma transação.
 */
export async function createClosing(ctx: TenantCtx, input: unknown): Promise<string> {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.caixa.operate");
  requireWrite(ctx);
  const d = parse(closingSchema, input);
  if (d.closingDate > ctx.today) throw new ValidationError("A data do fechamento não pode estar no futuro.");
  const s = await getSettings(ctx);
  const { difference, totalSales } = computeClosing(d);
  if (totalSales === 0 && difference === 0) throw new ValidationError("Informe ao menos um valor de venda.");
  if (d.withdrawals > d.openingFloat + d.cashSales) throw new ValidationError("Sangrias maiores que o dinheiro disponível no caixa.");
  await requireActiveAccount(ctx, d.registerAccountId);
  if (d.pixSales > 0 && !s.pix_account_id) throw new ValidationError("Configure a conta de destino do PIX nas configurações do caixa.");
  if (d.debitSales + d.creditSales + d.voucherSales > 0 && !s.card_account_id) {
    throw new ValidationError("Configure a conta de recebimento de cartões nas configurações do caixa.");
  }
  if (d.withdrawals > 0 && !s.safe_account_id) throw new ValidationError("Configure a conta de destino das sangrias (cofre/banco).");
  if (d.withdrawals > 0 && s.safe_account_id === d.registerAccountId) {
    throw new ValidationError("A conta das sangrias deve ser diferente da conta do caixa.");
  }

  const dup = await one(ctx.db,
    `select 1 from saas.bakery_cash_closings
      where tenant_id = $1 and closing_date = $2 and lower(register_name) = lower($3) and status = 'closed'`,
    [ctx.tenant.id, d.closingDate, d.registerName]);
  if (dup) throw new ValidationError("Já existe fechamento ativo deste caixa nesta data. Estorne o anterior para refazer.");
  const c = await one<{ id: string }>(ctx.db,
    `insert into saas.bakery_cash_closings (tenant_id, closing_date, register_name, register_account_id, operator_user_id,
        opening_float_cents, cash_sales_cents, pix_sales_cents, debit_sales_cents, credit_sales_cents, voucher_sales_cents,
        withdrawals_cents, counted_cash_cents, ticket_count, difference_cents, notes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $5) returning id`,
    [ctx.tenant.id, d.closingDate, d.registerName, d.registerAccountId, ctx.user.id, d.openingFloat, d.cashSales, d.pixSales,
     d.debitSales, d.creditSales, d.voucherSales, d.withdrawals, d.countedCash, d.ticketCount, difference, d.notes]);
  const closingId = c!.id;
  const src = { sourceModule: MODULE_KEY, sourceRefId: closingId };
  const salesCat = await categoryIdByCode(ctx, "padaria.vendas_balcao");
  const label = `Vendas ${d.registerName} ${d.closingDate.split("-").reverse().join("/")}`;

  const settledSale = async (amount: number, accountId: string, method: "cash" | "pix", name: string) => {
    if (amount <= 0) return;
    await createTitleInternal(ctx, {
      direction: "receivable", description: `${label} — ${name}`, contactId: null, categoryId: salesCat, amount,
      issueDate: d.closingDate, dueDate: d.closingDate, installments: 1, documentNumber: null, notes: null,
      settleNow: { accountId, date: d.closingDate, method },
    }, src);
  };
  await settledSale(d.cashSales, d.registerAccountId, "cash", "dinheiro");
  await settledSale(d.pixSales, s.pix_account_id!, "pix", "PIX");

  const feeCat = await categoryIdByCode(ctx, "core.card_fees");
  const cardSale = async (amount: number, days: number, bps: number, name: string, method: "debit" | "credit" | "voucher") => {
    if (amount <= 0) return;
    const due = addDays(d.closingDate, days);
    const [receivableId] = await createTitleInternal(ctx, {
      direction: "receivable", description: `${label} — ${name}`, contactId: null, categoryId: salesCat, amount,
      issueDate: d.closingDate, dueDate: due, installments: 1, documentNumber: null, notes: "Recebível de cartão", settleNow: null,
    }, src);
    const fee = applyBps(amount, bps);
    let feeId: string | null = null;
    if (fee > 0) {
      [feeId] = await createTitleInternal(ctx, {
        direction: "payable", description: `Taxa ${name} — ${label}`, contactId: null, categoryId: feeCat, amount: fee,
        issueDate: d.closingDate, dueDate: due, installments: 1, documentNumber: null, notes: "Taxa da maquininha", settleNow: null,
      }, src);
    }
    await ctx.db.query(
      `insert into saas.bakery_card_receivables (tenant_id, closing_id, method, receivable_title_id, fee_title_id)
       values ($1, $2, $3, $4, $5)`, [ctx.tenant.id, closingId, method, receivableId, feeId]);
  };
  await cardSale(d.debitSales, s.debit_days, s.debit_fee_bps, "débito", "debit");
  await cardSale(d.creditSales, s.credit_days, s.credit_fee_bps, "crédito", "credit");
  await cardSale(d.voucherSales, s.voucher_days, s.voucher_fee_bps, "vale-refeição", "voucher");

  if (d.withdrawals > 0) {
    await transferInternal(ctx, {
      fromAccountId: d.registerAccountId, toAccountId: s.safe_account_id!, amount: d.withdrawals, date: d.closingDate,
      description: `Sangrias ${d.registerName} ${d.closingDate.split("-").reverse().join("/")}`,
    }, src);
  }
  if (difference !== 0) {
    const isShort = difference < 0;
    await createTitleInternal(ctx, {
      direction: isShort ? "payable" : "receivable",
      description: `${isShort ? "Quebra" : "Sobra"} de caixa — ${label}`,
      contactId: null,
      categoryId: await categoryIdByCode(ctx, isShort ? "padaria.quebra_caixa" : "padaria.sobra_caixa"),
      amount: Math.abs(difference), issueDate: d.closingDate, dueDate: d.closingDate, installments: 1, documentNumber: null,
      notes: null, settleNow: { accountId: d.registerAccountId, date: d.closingDate, method: "cash" },
    }, src);
  }
  await audit(ctx, "padaria.closing.create", "bakery_cash_closing", closingId, { has_difference: difference !== 0 });
  return closingId;
}

export async function listClosings(ctx: TenantCtx, from: string, to: string) {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.caixa.operate");
  return rows<{
    id: string; closing_date: string; register_name: string; account_name: string; operator_name: string | null; status: string;
    cash_sales_cents: number; pix_sales_cents: number; debit_sales_cents: number; credit_sales_cents: number; voucher_sales_cents: number;
    withdrawals_cents: number; counted_cash_cents: number; opening_float_cents: number; difference_cents: number; ticket_count: number | null;
    reverse_reason: string | null;
  }>(ctx.db,
    `select c.id, c.closing_date, c.register_name, a.name as account_name, u.name as operator_name, c.status,
            c.cash_sales_cents, c.pix_sales_cents, c.debit_sales_cents, c.credit_sales_cents, c.voucher_sales_cents,
            c.withdrawals_cents, c.counted_cash_cents, c.opening_float_cents, c.difference_cents, c.ticket_count, c.reverse_reason
       from saas.bakery_cash_closings c
       join saas.financial_accounts a on a.id = c.register_account_id
       left join saas.users u on u.id = c.operator_user_id
      where c.tenant_id = $1 and c.closing_date between $2 and $3
      order by c.closing_date desc, c.created_at desc`, [ctx.tenant.id, from, to]);
}

/** Estorna um fechamento: estorna baixas/transferências geradas e cancela os títulos. */
export async function reverseClosing(ctx: TenantCtx, input: unknown) {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.caixa.manage");
  requireWrite(ctx);
  const d = parse(z.object({ id: uuid, reason: z.string().trim().min(5, "Informe o motivo (mínimo 5 caracteres)").max(300) }), input);
  const c = await one<{ status: string }>(ctx.db,
    "select status from saas.bakery_cash_closings where id = $1 and tenant_id = $2", [d.id, ctx.tenant.id]);
  if (!c) throw new NotFoundError("Fechamento não encontrado.");
  if (c.status !== "closed") throw new ValidationError("Fechamento já estornado.");
  const movements = await rows<{ id: string }>(ctx.db,
    `select m.id from saas.cash_movements m
       left join saas.titles t on t.id = m.title_id
       left join saas.transfers tr on tr.id = m.transfer_id
      where m.tenant_id = $1 and m.kind in ('settlement', 'transfer')
        and ((t.source_module = $2 and t.source_ref_id = $3) or (tr.source_module = $2 and tr.source_ref_id = $3))
        and not exists (select 1 from saas.cash_movements r where r.reverses_id = m.id)
        and (m.kind = 'settlement' or m.direction = 'out')`, [ctx.tenant.id, MODULE_KEY, d.id]);
  for (const m of movements) await reverseMovementInternal(ctx, m.id, `Estorno do fechamento: ${d.reason}`);
  const titles = await rows<{ id: string }>(ctx.db,
    "select id from saas.titles where tenant_id = $1 and source_module = $2 and source_ref_id = $3 and status <> 'canceled'",
    [ctx.tenant.id, MODULE_KEY, d.id]);
  for (const t of titles) await cancelTitleInternal(ctx, t.id, `Estorno do fechamento: ${d.reason}`);
  await ctx.db.query(
    "update saas.bakery_cash_closings set status = 'reversed', reversed_at = now(), reversed_by = $3, reverse_reason = $4 where id = $1 and tenant_id = $2",
    [d.id, ctx.tenant.id, ctx.user.id, d.reason]);
  await audit(ctx, "padaria.closing.reverse", "bakery_cash_closing", d.id, {}, d.reason);
}

/** Recebíveis de cartão em aberto gerados pelos fechamentos, com a taxa correspondente. */
export async function pendingCardReceivables(ctx: TenantCtx) {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.caixa.manage");
  return rows<{ id: string; description: string; due_date: string; amount_cents: number; fee_title_id: string | null; fee_cents: number;
                net_cents: number; closing_id: string; method: string }>(ctx.db,
    `select r.id, r.description, r.due_date, r.amount_cents, f.id as fee_title_id, coalesce(f.amount_cents, 0)::bigint as fee_cents,
            (r.amount_cents - coalesce(f.amount_cents, 0))::bigint as net_cents, cr.closing_id, cr.method
       from saas.bakery_card_receivables cr
       join saas.titles r on r.id = cr.receivable_title_id
       left join saas.titles f on f.id = cr.fee_title_id and f.status = 'open'
      where cr.tenant_id = $1 and r.status = 'open'
      order by r.due_date`, [ctx.tenant.id]);
}

/** Confirma o repasse da adquirente: baixa do recebível (bruto) e da taxa, na conta de cartões. */
export async function confirmCardSettlement(ctx: TenantCtx, input: unknown) {
  requireModule(ctx, MODULE_KEY);
  requirePerm(ctx, "padaria.caixa.manage");
  requireWrite(ctx);
  const d = parse(z.object({ titleId: uuid, date: isoDate }), input);
  const s = await getSettings(ctx);
  if (!s.card_account_id) throw new ValidationError("Configure a conta de recebimento de cartões.");
  const item = (await pendingCardReceivables(ctx)).find((x) => x.id === d.titleId);
  if (!item) throw new NotFoundError("Recebível não encontrado ou já liquidado.");
  await settleInternal(ctx, { titleId: item.id, accountId: s.card_account_id, amount: item.amount_cents, date: d.date, method: "other", notes: "Repasse da adquirente" });
  if (item.fee_title_id && item.fee_cents > 0) {
    await settleInternal(ctx, { titleId: item.fee_title_id, accountId: s.card_account_id, amount: item.fee_cents, date: d.date, method: "other", notes: "Taxa retida pela adquirente" });
  }
  await audit(ctx, "padaria.card.settle", "title", item.id);
}

/** Indicadores do segmento para o painel (somente fechamentos ativos). */
export async function kpis(ctx: TenantCtx) {
  const mStart = monthStart(ctx.today);
  const mEnd = monthEnd(ctx.today);
  const k = await one<{ cash: number; pix: number; debit: number; credit: number; voucher: number; tickets: number | null;
                        tickets_sales: number; diff_short: number; diff_over: number; closings: number }>(ctx.db,
    `select coalesce(sum(cash_sales_cents), 0)::bigint as cash, coalesce(sum(pix_sales_cents), 0)::bigint as pix,
            coalesce(sum(debit_sales_cents), 0)::bigint as debit, coalesce(sum(credit_sales_cents), 0)::bigint as credit,
            coalesce(sum(voucher_sales_cents), 0)::bigint as voucher,
            sum(ticket_count)::int as tickets,
            coalesce(sum(cash_sales_cents + pix_sales_cents + debit_sales_cents + credit_sales_cents + voucher_sales_cents)
                     filter (where ticket_count is not null), 0)::bigint as tickets_sales,
            coalesce(sum(-difference_cents) filter (where difference_cents < 0), 0)::bigint as diff_short,
            coalesce(sum(difference_cents) filter (where difference_cents > 0), 0)::bigint as diff_over,
            count(*)::int as closings
       from saas.bakery_cash_closings where tenant_id = $1 and status = 'closed' and closing_date between $2 and $3`,
    [ctx.tenant.id, mStart, mEnd]);
  const card = await one<{ v: number }>(ctx.db,
    `select coalesce(sum(amount_cents - paid_cents), 0)::bigint as v from saas.titles
      where tenant_id = $1 and source_module = $2 and direction = 'receivable' and status in ('open', 'partial')`,
    [ctx.tenant.id, MODULE_KEY]);
  const total = k!.cash + k!.pix + k!.debit + k!.credit + k!.voucher;
  return {
    sales_total_cents: total,
    by_method: { cash: k!.cash, pix: k!.pix, debit: k!.debit, credit: k!.credit, voucher: k!.voucher },
    average_ticket_cents: k!.tickets ? Math.round(k!.tickets_sales / k!.tickets) : null,
    card_receivables_open_cents: card!.v,
    cash_shortage_cents: k!.diff_short,
    cash_overage_cents: k!.diff_over,
    closings: k!.closings,
  };
}
