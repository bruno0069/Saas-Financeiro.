import { z } from "zod";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { isValidTaxId, normalizeTaxId } from "@/lib/tax-id";
import { optionalText, parse, uuid } from "@/lib/validation";
import { one, rows } from "@/server/db/pool";
import type { TenantCtx } from "@/server/context";
import { requirePerm, requireWrite } from "@/server/authz";
import { audit } from "./shared";

export type ContactRow = {
  id: string; name: string; kind: "customer" | "supplier" | "both"; tax_id: string | null;
  email: string | null; phone: string | null; notes: string | null; is_active: boolean;
};

const baseSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120),
  kind: z.enum(["customer", "supplier", "both"]),
  taxId: optionalText(20),
  email: optionalText(120),
  phone: optionalText(30),
  notes: optionalText(500),
});

function normalize(d: z.output<typeof baseSchema>) {
  const tax = normalizeTaxId(d.taxId);
  if (tax && !isValidTaxId(tax)) throw new ValidationError("CPF/CNPJ inválido", { taxId: "CPF/CNPJ inválido" });
  if (d.email && !z.email().safeParse(d.email).success) throw new ValidationError("E-mail inválido", { email: "E-mail inválido" });
  return { ...d, taxId: tax };
}

export async function listContacts(ctx: TenantCtx, opts: { kind?: "customer" | "supplier"; q?: string } = {}) {
  return rows<ContactRow>(ctx.db,
    `select id, name, kind, tax_id, email, phone, notes, is_active from saas.contacts
      where tenant_id = $1
        and ($2::text is null or kind = $2 or kind = 'both')
        and ($3::text is null or name ilike '%' || $3 || '%')
      order by is_active desc, name limit 500`,
    [ctx.tenant.id, opts.kind ?? null, opts.q?.trim() || null]);
}

export async function createContact(ctx: TenantCtx, input: unknown) {
  requirePerm(ctx, "contacts.manage");
  requireWrite(ctx);
  const d = normalize(parse(baseSchema, input));
  const c = await one<{ id: string }>(ctx.db,
    `insert into saas.contacts (tenant_id, name, kind, tax_id, email, phone, notes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [ctx.tenant.id, d.name, d.kind, d.taxId, d.email, d.phone, d.notes, ctx.user.id]);
  await audit(ctx, "contact.create", "contact", c!.id, { kind: d.kind });
  return c!.id;
}

export async function updateContact(ctx: TenantCtx, input: unknown) {
  requirePerm(ctx, "contacts.manage");
  requireWrite(ctx);
  const d = parse(baseSchema.extend({ id: uuid, isActive: z.boolean() }), input);
  const n = normalize(d);
  const r = await ctx.db.query(
    `update saas.contacts set name = $3, kind = $4, tax_id = $5, email = $6, phone = $7, notes = $8, is_active = $9
      where id = $1 and tenant_id = $2`,
    [d.id, ctx.tenant.id, n.name, n.kind, n.taxId, n.email, n.phone, n.notes, d.isActive]);
  if (!r.rowCount) throw new NotFoundError("Contato não encontrado.");
  await audit(ctx, "contact.update", "contact", d.id);
}
