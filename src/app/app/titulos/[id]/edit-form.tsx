"use client";

import { ActionForm, MoneyInput, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { updateTitleAction } from "../../finance-actions";

type Opt = { id: string; name: string };

export function EditTitleForm({ title, categories, contacts }: {
  title: { id: string; description: string; categoryId: string; contactId: string | null; amount: string; dueDate: string; documentNumber: string | null; notes: string | null; paid: boolean };
  categories: Opt[]; contacts: Opt[];
}) {
  return (
    <ActionForm action={updateTitleAction} resetOnSuccess={false} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={title.id} />
      <Field label="Descrição" name="description" required>
        <input id="description" name="description" required defaultValue={title.description} className={inputClass} />
      </Field>
      <Field label="Valor" name="amount" required hint={title.paid ? "Bloqueado: o título já possui baixas." : undefined}>
        {title.paid ? <><input type="hidden" name="amount" value={title.amount} /><input disabled value={title.amount} className={inputClass} /></> : <MoneyInput name="amount" required defaultValue={title.amount} />}
      </Field>
      <Field label="Vencimento" name="dueDate" required>
        <input id="dueDate" name="dueDate" type="date" required defaultValue={title.dueDate} className={inputClass} />
      </Field>
      <Field label="Categoria" name="categoryId" required>
        <select id="categoryId" name="categoryId" defaultValue={title.categoryId} className={inputClass}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Contato" name="contactId">
        <select id="contactId" name="contactId" defaultValue={title.contactId ?? ""} className={inputClass}>
          <option value="">—</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Nº do documento" name="documentNumber">
        <input id="documentNumber" name="documentNumber" defaultValue={title.documentNumber ?? ""} className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Observações" name="notes">
          <textarea id="notes" name="notes" rows={2} defaultValue={title.notes ?? ""} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2"><Submit>Salvar alterações</Submit></div>
    </ActionForm>
  );
}
