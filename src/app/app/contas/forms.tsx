"use client";

import { ActionForm, MoneyInput, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { ACCOUNT_KIND_LABELS } from "@/domains/finance/labels";
import { adjustAction, createAccountAction, transferAction, updateAccountAction } from "../finance-actions";

type Opt = { id: string; name: string };

export function NewAccountForm({ today }: { today: string }) {
  return (
    <ActionForm action={createAccountAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {(s) => (
        <>
          <Field label="Nome" name="name" required error={s.fieldErrors?.name}>
            <input id="name" name="name" required maxLength={80} className={inputClass} placeholder="Ex.: Caixa da loja" />
          </Field>
          <Field label="Tipo" name="kind" required>
            <select id="kind" name="kind" className={inputClass} defaultValue="checking">
              {Object.entries(ACCOUNT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Saldo inicial" name="openingBalance" required hint="Use valor negativo para saldo devedor.">
            <MoneyInput name="openingBalance" defaultValue="0,00" />
          </Field>
          <Field label="Data do saldo inicial" name="openingDate" required>
            <input id="openingDate" name="openingDate" type="date" required defaultValue={today} className={inputClass} />
          </Field>
          <Field label="Banco/instituição" name="institution">
            <input id="institution" name="institution" maxLength={80} className={inputClass} />
          </Field>
          <div className="flex items-end sm:col-span-2 lg:col-span-3"><Submit>Cadastrar conta</Submit></div>
        </>
      )}
    </ActionForm>
  );
}

export function TransferForm({ accounts, today }: { accounts: Opt[]; today: string }) {
  return (
    <ActionForm action={transferAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="De" name="fromAccountId" required>
        <select id="fromAccountId" name="fromAccountId" required className={inputClass} defaultValue="">
          <option value="" disabled>Selecione…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Para" name="toAccountId" required>
        <select id="toAccountId" name="toAccountId" required className={inputClass} defaultValue="">
          <option value="" disabled>Selecione…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Valor" name="amount" required><MoneyInput name="amount" required /></Field>
      <Field label="Data" name="date" required><input id="date" name="date" type="date" required defaultValue={today} className={inputClass} /></Field>
      <div className="sm:col-span-2 lg:col-span-3">
        <Field label="Descrição" name="description"><input id="description" name="description" maxLength={200} className={inputClass} placeholder="Ex.: Depósito do caixa no banco" /></Field>
      </div>
      <div className="flex items-end"><Submit>Transferir</Submit></div>
      <p className="text-xs text-gray-500 sm:col-span-2 lg:col-span-4">Transferências entre contas próprias não são receitas nem despesas.</p>
    </ActionForm>
  );
}

export function AdjustForm({ accounts, today }: { accounts: Opt[]; today: string }) {
  return (
    <ActionForm action={adjustAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Conta" name="accountId" required>
        <select id="accountId" name="accountId" required className={inputClass} defaultValue="">
          <option value="" disabled>Selecione…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Tipo" name="direction" required>
        <select id="direction" name="direction" className={inputClass} defaultValue="in">
          <option value="in">Acréscimo ao saldo</option>
          <option value="out">Redução do saldo</option>
        </select>
      </Field>
      <Field label="Valor" name="amount" required><MoneyInput name="amount" required /></Field>
      <Field label="Data" name="date" required><input id="date-adj" name="date" type="date" required defaultValue={today} className={inputClass} /></Field>
      <div className="sm:col-span-2 lg:col-span-3">
        <Field label="Motivo" name="reason" required hint="Obrigatório. Fica registrado na auditoria.">
          <input id="reason" name="reason" required minLength={5} maxLength={300} className={inputClass} placeholder="Ex.: Conciliação com extrato de 31/10" />
        </Field>
      </div>
      <div className="flex items-end"><Submit variant="secondary">Registrar ajuste</Submit></div>
    </ActionForm>
  );
}

export function EditAccountForm({ a }: { a: { id: string; name: string; kind: string; institution: string | null; is_active: boolean } }) {
  return (
    <ActionForm action={updateAccountAction} resetOnSuccess={false} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={a.id} />
      <input aria-label="Nome" name="name" defaultValue={a.name} className={`${inputClass} w-40`} />
      <select aria-label="Tipo" name="kind" defaultValue={a.kind} className={`${inputClass} w-44`}>
        {Object.entries(ACCOUNT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input type="hidden" name="institution" value={a.institution ?? ""} />
      <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="isActive" defaultChecked={a.is_active} /> Ativa</label>
      <Submit variant="secondary">Salvar</Submit>
    </ActionForm>
  );
}
