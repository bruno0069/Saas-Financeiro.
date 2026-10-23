"use client";

import { useState } from "react";
import { ActionForm, MoneyInput, Submit } from "./forms";
import { Field, inputClass } from "./ui";
import { PAYMENT_METHOD_LABELS } from "@/domains/finance/labels";
import { createTitleAction, settleTitleAction } from "@/app/app/finance-actions";

type Opt = { id: string; name: string };

export function TitleForm({
  direction, categories, contacts, accounts, today, canSettle,
}: {
  direction: "payable" | "receivable"; categories: Opt[]; contacts: Opt[]; accounts: Opt[]; today: string; canSettle: boolean;
}) {
  const [settled, setSettled] = useState(false);
  const isPay = direction === "payable";
  return (
    <ActionForm action={createTitleAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {(s) => (
        <>
          <input type="hidden" name="direction" value={direction} />
          <div className="sm:col-span-2 lg:col-span-1">
            <Field label="Descrição" name="description" required error={s.fieldErrors?.description}>
              <input id="description" name="description" required maxLength={200} className={inputClass} placeholder={isPay ? "Ex.: Farinha de trigo — 10 sacos" : "Ex.: Encomenda de bolo"} />
            </Field>
          </div>
          <Field label="Valor total" name="amount" required error={s.fieldErrors?.amount}>
            <MoneyInput name="amount" required />
          </Field>
          <Field label="Vencimento" name="dueDate" required error={s.fieldErrors?.dueDate}>
            <input id="dueDate" name="dueDate" type="date" required defaultValue={today} className={inputClass} />
          </Field>
          <Field label="Categoria" name="categoryId" required error={s.fieldErrors?.categoryId}>
            <select id="categoryId" name="categoryId" required className={inputClass} defaultValue="">
              <option value="" disabled>Selecione…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={isPay ? "Fornecedor" : "Cliente"} name="contactId">
            <select id="contactId" name="contactId" className={inputClass} defaultValue="">
              <option value="">—</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Parcelas" name="installments" hint="Mensais, a partir do vencimento.">
            <input id="installments" name="installments" type="number" min={1} max={120} defaultValue={1} disabled={settled} className={inputClass} />
          </Field>
          <Field label="Nº do documento" name="documentNumber">
            <input id="documentNumber" name="documentNumber" maxLength={60} className={inputClass} placeholder="NF, boleto…" />
          </Field>
          {canSettle && (
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" name="alreadySettled" checked={settled} onChange={(e) => setSettled(e.target.checked)} />
                {isPay ? "Já foi pago" : "Já foi recebido"} (registrar a baixa agora)
              </label>
              {settled && (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Conta" name="settleAccountId" required>
                    <select id="settleAccountId" name="settleAccountId" required className={inputClass} defaultValue="">
                      <option value="" disabled>Selecione…</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Data do pagamento" name="settleDate" required>
                    <input id="settleDate" name="settleDate" type="date" required defaultValue={today} className={inputClass} />
                  </Field>
                  <Field label="Forma" name="settleMethod">
                    <select id="settleMethod" name="settleMethod" className={inputClass} defaultValue="">
                      <option value="">—</option>
                      {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </div>
          )}
          <div className="sm:col-span-2 lg:col-span-3"><Submit>Salvar lançamento</Submit></div>
        </>
      )}
    </ActionForm>
  );
}

export function SettleForm({ titleId, openInput, accounts, today, isPay }: { titleId: string; openInput: string; accounts: Opt[]; today: string; isPay: boolean }) {
  return (
    <ActionForm action={settleTitleAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <input type="hidden" name="titleId" value={titleId} />
      <Field label="Valor" name="amount" required hint="Pode ser parcial.">
        <MoneyInput name="amount" required defaultValue={openInput} />
      </Field>
      <Field label={isPay ? "Data do pagamento" : "Data do recebimento"} name="date" required>
        <input id="date" name="date" type="date" required defaultValue={today} className={inputClass} />
      </Field>
      <Field label="Conta" name="accountId" required>
        <select id="accountId" name="accountId" required className={inputClass} defaultValue="">
          <option value="" disabled>Selecione…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      <Field label="Forma" name="method">
        <select id="method" name="method" className={inputClass} defaultValue="">
          <option value="">—</option>
          {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2"><Submit>{isPay ? "Registrar pagamento" : "Registrar recebimento"}</Submit></div>
    </ActionForm>
  );
}
