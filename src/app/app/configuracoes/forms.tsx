"use client";

import { ActionForm, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { toggleModuleAction, updateCompanyAction } from "./actions";

const TZ = ["America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha"];

export function CompanyForm({ t }: { t: { trade_name: string; legal_name: string | null; tax_id: string | null; timezone: string; notify_due_days: number; notify_email: boolean } }) {
  return (
    <ActionForm action={updateCompanyAction} resetOnSuccess={false} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {(s) => (
        <>
          <Field label="Nome fantasia" name="tradeName" required><input id="tradeName" name="tradeName" defaultValue={t.trade_name} required className={inputClass} /></Field>
          <Field label="Razão social" name="legalName"><input id="legalName" name="legalName" defaultValue={t.legal_name ?? ""} className={inputClass} /></Field>
          <Field label="CNPJ/CPF" name="taxId" error={s.fieldErrors?.taxId}><input id="taxId" name="taxId" defaultValue={t.tax_id ?? ""} className={inputClass} /></Field>
          <Field label="Fuso horário" name="timezone" required>
            <select id="timezone" name="timezone" defaultValue={t.timezone} className={inputClass}>{TZ.map((z) => <option key={z} value={z}>{z.replace("America/", "").replace("_", " ")}</option>)}</select>
          </Field>
          <Field label="Avisar vencimentos com antecedência de (dias)" name="notifyDueDays" required>
            <input id="notifyDueDays" name="notifyDueDays" type="number" min={0} max={30} defaultValue={t.notify_due_days} className={inputClass} />
          </Field>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="notifyEmail" defaultChecked={t.notify_email} /> Receber avisos por e-mail</label>
          <div className="sm:col-span-2"><Submit>Salvar</Submit></div>
        </>
      )}
    </ActionForm>
  );
}

export function ModuleToggle({ moduleKey, enabled, disabled }: { moduleKey: string; enabled: boolean; disabled?: boolean }) {
  return (
    <ActionForm action={toggleModuleAction} resetOnSuccess={false}>
      <input type="hidden" name="module" value={moduleKey} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      {!disabled && <Submit variant={enabled ? "secondary" : "primary"} pendingText="…">{enabled ? "Desabilitar" : "Habilitar"}</Submit>}
    </ActionForm>
  );
}
