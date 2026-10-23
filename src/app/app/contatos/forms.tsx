"use client";

import { ActionForm, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { saveContactAction } from "../finance-actions";

type C = { id: string; name: string; kind: string; tax_id: string | null; email: string | null; phone: string | null; notes: string | null; is_active: boolean };

export function ContactForm({ c }: { c?: C }) {
  return (
    <ActionForm action={saveContactAction} resetOnSuccess={!c} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {(s) => (
        <>
          {c && <input type="hidden" name="id" value={c.id} />}
          <Field label="Nome" name="name" required error={s.fieldErrors?.name}>
            <input id={`name-${c?.id ?? "new"}`} name="name" required defaultValue={c?.name} className={inputClass} />
          </Field>
          <Field label="Tipo" name="kind" required>
            <select name="kind" defaultValue={c?.kind ?? "customer"} className={inputClass}>
              <option value="customer">Cliente</option><option value="supplier">Fornecedor</option><option value="both">Cliente e fornecedor</option>
            </select>
          </Field>
          <Field label="CPF/CNPJ" name="taxId" error={s.fieldErrors?.taxId}>
            <input name="taxId" defaultValue={c?.tax_id ?? ""} inputMode="numeric" className={inputClass} />
          </Field>
          <Field label="E-mail" name="email" error={s.fieldErrors?.email}><input name="email" type="email" defaultValue={c?.email ?? ""} className={inputClass} /></Field>
          <Field label="Telefone" name="phone"><input name="phone" type="tel" defaultValue={c?.phone ?? ""} className={inputClass} /></Field>
          <Field label="Observações" name="notes"><input name="notes" defaultValue={c?.notes ?? ""} className={inputClass} /></Field>
          {c && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={c.is_active} /> Ativo</label>}
          <div className="sm:col-span-2 lg:col-span-3"><Submit>{c ? "Salvar" : "Cadastrar"}</Submit></div>
        </>
      )}
    </ActionForm>
  );
}
