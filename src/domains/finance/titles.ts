import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { addMonths, monthStart } from "@/lib/dates";
import { splitInstallments } from "@/lib/money";
import { isoDate, moneyPositive, optionalText, optionalUuid, parse, uuid } from "@/lib/validation";
import { one, rows } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { checkLimit, requirePerm, requireWrite } from "@/server/authz";
import type { Permission } from "@/domains/access/permissions";
import { requireActiveAccount } from "./accounts";
import { audit, lockTenantKey } from "./shared";

export type Direction = "payable" | "receivable";

export const PAYMENT_METHODS = ["cash", "pix", "debit_card", "credit_card", "voucher", "boleto", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type TitleRow = {
  id: string;
  direction: Direction;
  description: string;
  contact_id: string | null;
  contact_name: string | null;
  category_id: string;
  category_name: string;
  amount_cents: number;
  paid_cents: number;
  open_cents: number;
  issue_date: string;
  due_date: string;
  status: "open" | "partial" | "paid" | "canceled";
  is_overdue: boolean;
  installment_number: number;
  installment_count: number;
  installment_group_id: string | null;
  document_number: string | null;
  notes: string | null;
  source_module: string | null;
  cancel_reason: string | null;
};

const perms = (d: Direction) => ({
  view: (d === "payable" ? "payables.view" : "receivables.view") as Permission,
  manage: (d === "payable" ? "payables.manage" : "receivables.manage") as Permission,
  settle: (d === "payable" ? "payables.settle" : "receivables.settle") as Permission,
});

export const createTitleSchema = z.object({
  direction: z.enum(["payable", "receivable"]),
  description: z.string().trim().min(1, "Informe a descrição").max(200),
  contactId: optionalUuid,
  categoryId: uuid,
  amount: moneyPositive,
  issueDate: isoDate.optional(),
  dueDate: isoDate,
  installments: z.coerce.number().int().min(1).max(120).default(1),
  documentNumber: optionalText(60),
  notes: optionalText(1000),
  /** Quando informado, registra a baixa imediata (receita/despesa já realizada). */
  settleNow: z
    .object({ accountId: uuid, date: isoDate, method: z.enum(PAYMENT_METHODS).nullable().optional() })
    .nullable()
    .optional(),
});
export type CreateTitleInput = z.input<typeof createTitleSchema>;

export const settleSchema = z.object({
  titleId: uuid,
  accountId: uuid,
  amount: moneyPositive,
  date: isoDate,
  method: z.enum(PAYMENT_METHODS).nullable().optional(),
  notes: optionalText(300),
});

export const updateTitleSchema = z.object({
  id: uuid,
  description: z.string().trim().min(1).max(200),
  contactId: optionalUuid,
  categoryId: uuid,
  amount: moneyPositive,
  dueDate: isoDate,
  documentNumber: optionalText(60),
  notes: optionalText(1000),
});

const TITLE_SELECT = `
  select t.id, t.direction, t.description, t.contact_id, c.name as contact_name, t.category_id, cat.name as category_name,
         t.amount_cents, t.paid_cents, (t.amount_cents - t.paid_cents) as open_cents, t.issue_date, t.due_date, t.status,
         (t.status in ('open', 'partial') and t.due_date < $2::date) as is_overdue,
         t.installment_number, t.installment_count, t.installment_group_id, t.document_number, t.notes, t.source_module,
         t.cancel_reason
    from saas.titles t
    join saas.categories cat on cat.id = t.category_id
    left join saas.contacts c on c.id = t.contact_id`;

export type TitleFilter = {
  direction: Direction;
  status?: "open" | "overdue" | "paid" | "canceled" | "all";
  q?: string;
  from?: string;
  to?: string;
  categoryId?: string;
  limit?: number;
};

export async function listTitles(ctx: TenantCtx, f: TitleFilter): Promise<TitleRow[]> {
  requirePerm(ctx, perms(f.direction).view);
  const status = f.status ?? "open";
  return rows<TitleRow>(ctx.db,
    `${TITLE_SELECT}
      where t.tenant_id = $1 and t.direction = $3
        and (case $4::text
               when 'open' then t.status in ('open', 'partial')
               when 'overdue' then t.status in ('open', 'partial') and t.due_date < $2::date
               when 'paid' then t.status = 'paid'
               when 'canceled' then t.status = 'canceled'
               else true end)
        and ($5::text is null or t.description ilike '%' || $5 || '%' or c.name ilike '%' || $5 || '%' or t.document_number = $5)
        and ($6::date is null or t.due_date >= $6::date)
        and ($7::date is null or t.due_date <= $7::date)
        and ($8::uuid is null or t.category_id = $8::uuid)
      order by t.due_date, t.created_at
      limit $9`,
    [ctx.tenant.id, ctx.today, f.direction, status, f.q?.trim() || null, f.from || null, f.to || null,
     f.categoryId || null, Math.min(f.limit ?? 500, 2000)]);
}

export async function getTitle(ctx: TenantCtx, id: string) {
  const t = await one<TitleRow>(ctx.db, `${TITLE_SELECT} where t.tenant_id = $1 and t.id = $3`, [ctx.tenant.id, ctx.today, id]);
  if (!t) throw new NotFoundError("Título não encontrado.");
  requirePerm(ctx, perms(t.direction).view);
  const movements = await rows<{
    id: string; kind: string; direction: string; amount_cents: number; occurred_on: string; account_name: string;
    payment_method: string | null; reason: string | null; description: string | null; reversed: boolean; created_by_name: string | null;
  }>(ctx.db,
    `select m.id, m.kind, m.direction, m.amount_cents, m.occurred_on, a.name as account_name, m.payment_method, m.reason,
            m.description, exists (select 1 from saas.cash_movements r where r.reverses_id = m.id) as reversed,
            u.name as created_by_name
       from saas.cash_movements m
       join saas.financial_accounts a on a.id = m.account_id
       left join saas.users u on u.id = m.created_by
      where m.tenant_id = $1 and m.title_id = $2
      order by m.created_at`, [ctx.tenant.id, id]);
  return { title: t, movements };
}

async function validateRefs(ctx: TenantCtx, direction: Direction, categoryId: string, contactId: string | null) {
  const cat = await one<{ kind: string; is_active: boolean }>(ctx.db,
    "select kind, is_active from saas.categories where id = $1 and tenant_id = $2", [categoryId, ctx.tenant.id]);
  if (!cat) throw new ValidationError("Categoria não encontrada.", { categoryId: "Categoria inválida" });
  const expected = direction === "payable" ? "expense" : "income";
  if (cat.kind !== expected) {
    throw new ValidationError(
      direction === "payable" ? "Contas a pagar exigem uma categoria de despesa." : "Contas a receber exigem uma categoria de receita.",
      { categoryId: "Categoria incompatível" });
  }
  if (!cat.is_active) throw new ValidationError("Categoria inativa.", { categoryId: "Categoria inativa" });
  if (contactId) {
    const c = await one(ctx.db, "select 1 from saas.contacts where id = $1 and tenant_id = $2", [contactId, ctx.tenant.id]);
    if (!c) throw new ValidationError("Contato não encontrado.", { contactId: "Contato inválido" });
  }
}

/**
 * Serviço central de criação de títulos. Usado pelas telas do núcleo e pelos módulos
 * (com `sourceModule`) — os módulos não gravam movimentações por conta própria.
 * A verificação de permissão de usuário é responsabilidade do chamador público.
 */
export async function createTitleInternal(
  ctx: TenantCtx,
  data: z.output<typeof createTitleSchema>,
  opts: { sourceModule?: string; sourceRefId?: string } = {},
): Promise<string[]> {
  requireWrite(ctx);
  await validateRefs(ctx, data.direction, data.categoryId, data.contactId);
  if (data.settleNow && data.installments > 1) {
    throw new ValidationError("A baixa imediata só é permitida para lançamentos sem parcelamento.");
  }
  await lockTenantKey(ctx, "titles");
  const used = await one<{ n: number }>(ctx.db,
    `select count(*)::int as n from saas.titles where tenant_id = $1 and created_at >= $2::date and source_module is null`,
    [ctx.tenant.id, monthStart(ctx.today)]);
  // Títulos gerados por módulos (ex.: fechamento de caixa) não consomem o limite de lançamentos manuais.
  if (!opts.sourceModule) checkLimit(ctx, "max_titles_per_month", used!.n, data.installments);

  const amounts = splitInstallments(data.amount, data.installments);
  const groupId = data.installments > 1 ? randomUUID() : null;
  const ids: string[] = [];
  for (let i = 0; i < data.installments; i++) {
    const suffix = data.installments > 1 ? ` (${i + 1}/${data.installments})` : "";
    const t = await one<{ id: string }>(ctx.db,
      `insert into saas.titles (tenant_id, direction, description, contact_id, category_id, amount_cents, issue_date, due_date,
                                installment_group_id, installment_number, installment_count, document_number, notes,
                                source_module, source_ref_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
      [ctx.tenant.id, data.direction, data.description.slice(0, 190) + suffix, data.contactId, data.categoryId, amounts[i],
       data.issueDate ?? ctx.today, addMonths(data.dueDate, i), groupId, i + 1, data.installments, data.documentNumber,
       data.notes, opts.sourceModule ?? null, opts.sourceRefId ?? null, ctx.user.id]);
    ids.push(t!.id);
  }
  await audit(ctx, "title.create", "title", ids[0], {
    direction: data.direction, installments: data.installments, group_id: groupId, source_module: opts.sourceModule ?? null,
  });
  if (data.settleNow) {
    await settleInternal(ctx, {
      titleId: ids[0], accountId: data.settleNow.accountId, amount: data.amount, date: data.settleNow.date,
      method: data.settleNow.method ?? null, notes: null,
    });
  }
  return ids;
}

export async function createTitle(ctx: TenantCtx, input: unknown): Promise<string[]> {
  const data = parse(createTitleSchema, input);
  const p = perms(data.direction);
  requirePerm(ctx, p.manage);
  if (data.settleNow) requirePerm(ctx, p.settle);
  return createTitleInternal(ctx, data);
}

export async function updateTitle(ctx: TenantCtx, input: unknown) {
  const d = parse(updateTitleSchema, input);
  const t = await one<{ direction: Direction; status: string; paid_cents: number; amount_cents: number; source_module: string | null }>(ctx.db,
    "select direction, status, paid_cents, amount_cents, source_module from saas.titles where id = $1 and tenant_id = $2",
    [d.id, ctx.tenant.id]);
  if (!t) throw new NotFoundError("Título não encontrado.");
  requirePerm(ctx, perms(t.direction).manage);
  requireWrite(ctx);
  if (t.status === "canceled") throw new ValidationError("Título cancelado não pode ser editado.");
  if (t.source_module) throw new ValidationError("Título gerado por módulo: altere pela origem (ex.: estorne o fechamento).");
  if (t.paid_cents > 0 && d.amount !== t.amount_cents) {
    throw new ValidationError("Este título já possui baixas. Para alterar o valor, estorne as baixas primeiro.");
  }
  await validateRefs(ctx, t.direction, d.categoryId, d.contactId);
  await ctx.db.query(
    `update saas.titles set description = $3, contact_id = $4, category_id = $5, amount_cents = $6, due_date = $7,
            document_number = $8, notes = $9
      where id = $1 and tenant_id = $2`,
    [d.id, ctx.tenant.id, d.description, d.contactId, d.categoryId, d.amount, d.dueDate, d.documentNumber, d.notes]);
  await audit(ctx, "title.update", "title", d.id, { amount_changed: d.amount !== t.amount_cents });
}

export async function cancelTitleInternal(ctx: TenantCtx, id: string, reason: string) {
  requireWrite(ctx);
  const t = await one<{ status: string; paid_cents: number }>(ctx.db,
    "select status, paid_cents from saas.titles where id = $1 and tenant_id = $2 for update", [id, ctx.tenant.id]);
  if (!t) throw new NotFoundError("Título não encontrado.");
  if (t.status === "canceled") return;
  if (t.paid_cents > 0) throw new ValidationError("Título com baixas não pode ser cancelado. Estorne as baixas antes.");
  await ctx.db.query(
    `update saas.titles set status = 'canceled', canceled_at = now(), canceled_by = $3, cancel_reason = $4
      where id = $1 and tenant_id = $2`, [id, ctx.tenant.id, ctx.user.id, reason]);
  await audit(ctx, "title.cancel", "title", id, {}, reason);
}

export async function cancelTitle(ctx: TenantCtx, input: unknown) {
  const d = parse(z.object({ id: uuid, reason: z.string().trim().min(3, "Informe o motivo do cancelamento").max(300) }), input);
  const t = await one<{ direction: Direction; source_module: string | null }>(ctx.db,
    "select direction, source_module from saas.titles where id = $1 and tenant_id = $2", [d.id, ctx.tenant.id]);
  if (!t) throw new NotFoundError("Título não encontrado.");
  requirePerm(ctx, perms(t.direction).manage);
  if (t.source_module) throw new ValidationError("Título gerado por módulo: cancele pela origem (ex.: estorne o fechamento).");
  await cancelTitleInternal(ctx, d.id, d.reason);
}

/** Baixa (total ou parcial) de um título. O banco garante que o total pago não ultrapasse o valor. */
export async function settleInternal(ctx: TenantCtx, d: z.output<typeof settleSchema>): Promise<string> {
  requireWrite(ctx);
  const t = await one<{ direction: Direction; status: string; amount_cents: number; paid_cents: number; description: string }>(ctx.db,
    "select direction, status, amount_cents, paid_cents, description from saas.titles where id = $1 and tenant_id = $2",
    [d.titleId, ctx.tenant.id]);
  if (!t) throw new NotFoundError("Título não encontrado.");
  if (t.status === "canceled") throw new ValidationError("Título cancelado.");
  if (d.amount > t.amount_cents - t.paid_cents) {
    throw new ValidationError("O valor informado é maior que o saldo em aberto do título.", { amount: "Acima do saldo em aberto" });
  }
  await requireActiveAccount(ctx, d.accountId);
  const mv = await one<{ id: string }>(ctx.db,
    `insert into saas.cash_movements (tenant_id, account_id, direction, amount_cents, occurred_on, kind, title_id, payment_method,
                                      description, created_by)
     values ($1, $2, $3, $4, $5, 'settlement', $6, $7, $8, $9) returning id`,
    [ctx.tenant.id, d.accountId, t.direction === "payable" ? "out" : "in", d.amount, d.date, d.titleId, d.method ?? null,
     d.notes ?? t.description, ctx.user.id]);
  await audit(ctx, "title.settle", "title", d.titleId, {
    movement_id: mv!.id, partial: d.amount < t.amount_cents - t.paid_cents,
  });
  return mv!.id;
}

export async function settleTitle(ctx: TenantCtx, input: unknown): Promise<string> {
  const d = parse(settleSchema, input);
  const t = await one<{ direction: Direction }>(ctx.db, "select direction from saas.titles where id = $1 and tenant_id = $2",
    [d.titleId, ctx.tenant.id]);
  if (!t) throw new NotFoundError("Título não encontrado.");
  requirePerm(ctx, perms(t.direction).settle);
  return settleInternal(ctx, d);
}
