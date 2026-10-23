"use client";

import { ActionForm, Submit } from "@/components/forms";
import { inputClass } from "@/components/ui";
import { createCategoryAction, updateCategoryAction } from "../finance-actions";

export function NewCategoryForm() {
  return (
    <ActionForm action={createCategoryAction} className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-sm"><span className="mb-1 block font-medium">Nome</span>
        <input name="name" required maxLength={80} className={inputClass} placeholder="Ex.: Fermento e aditivos" /></label>
      <label className="text-sm"><span className="mb-1 block font-medium">Tipo</span>
        <select name="kind" className={inputClass} defaultValue="expense"><option value="expense">Despesa</option><option value="income">Receita</option></select></label>
      <Submit>Adicionar</Submit>
    </ActionForm>
  );
}

export function EditCategoryForm({ c }: { c: { id: string; name: string; is_active: boolean } }) {
  return (
    <ActionForm action={updateCategoryAction} resetOnSuccess={false} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={c.id} />
      <input aria-label="Nome da categoria" name="name" defaultValue={c.name} className={`${inputClass} min-w-0 flex-1`} />
      <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="isActive" defaultChecked={c.is_active} /> Ativa</label>
      <Submit variant="secondary">Salvar</Submit>
    </ActionForm>
  );
}
