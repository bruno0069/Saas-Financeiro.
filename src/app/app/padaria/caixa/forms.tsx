"use client";

import { useState } from "react";
import { ActionForm, MoneyInput, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { parseBRL, formatBRL } from "@/lib/money";
import { confirmCardAction, createClosingAction, saveCaixaSettingsAction } from "../actions";

type Opt = { id: string; name: string };
const FIELDS = ["openingFloat", "cashSales", "pixSales", "debitSales", "creditSales", "voucherSales", "withdrawals", "countedCash"] as const;

export function ClosingForm({ accounts, today, defaultAccount }: { accounts: Opt[]; today: string; defaultAccount?: string }) {
  const [v, setV] = useState<Record<string, string>>({});
  const n = (k: string) => parseBRL(v[k] ?? "") ?? 0;
  const expected = n("openingFloat") + n("cashSales") - n("withdrawals");
  const diff = n("countedCash") - expected;
  const total = n("cashSales") + n("pixSales") + n("debitSales") + n("creditSales") + n("voucherSales");
  const onInput = (e: React.FormEvent<HTMLDivElement>) => {
    const t = e.target as HTMLInputElement;
    if (FIELDS.includes(t.name as (typeof FIELDS)[number])) setV((s) => ({ ...s, [t.name]: t.value }));
  };
  const money = (name: string, label: string, hint?: string) => (
    <Field label={label} name={name} required hint={hint}><MoneyInput name={name} defaultValue="0,00" /></Field>
  );
  return (
    <div onInput={onInput}>
      <ActionForm action={createClosingAction} onSuccess={() => setV({})} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Data" name="closingDate" required><input id="closingDate" name="closingDate" type="date" max={today} defaultValue={today} required className={inputClass} /></Field>
          <Field label="Caixa" name="registerName" required><input id="registerName" name="registerName" defaultValue="Caixa 1" maxLength={40} required className={inputClass} /></Field>
          <Field label="Conta do caixa (dinheiro)" name="registerAccountId" required>
            <select id="registerAccountId" name="registerAccountId" required defaultValue={defaultAccount ?? ""} className={inputClass}>
              <option value="" disabled>Selecione…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <legend className="mb-2 text-sm font-semibold text-gray-900">Vendas do dia por forma de pagamento</legend>
          {money("cashSales", "Dinheiro")}
          {money("pixSales", "PIX")}
          {money("debitSales", "Cartão de débito")}
          {money("creditSales", "Cartão de crédito")}
          {money("voucherSales", "Vale-refeição")}
        </fieldset>
        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold text-gray-900">Conferência do caixa</legend>
          {money("openingFloat", "Troco inicial", "Dinheiro na gaveta ao abrir")}
          {money("withdrawals", "Sangrias", "Retiradas para o cofre/banco")}
          {money("countedCash", "Dinheiro contado", "Na gaveta ao fechar")}
          <Field label="Nº de atendimentos" name="ticketCount" hint="Para o ticket médio"><input id="ticketCount" name="ticketCount" type="number" min={0} className={inputClass} /></Field>
        </fieldset>
        <div className="grid grid-cols-1 gap-3 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-3" aria-live="polite">
          <div>Total vendido: <strong className="tabular">{formatBRL(total)}</strong></div>
          <div>Dinheiro esperado na gaveta: <strong className="tabular">{formatBRL(expected)}</strong></div>
          <div>Diferença: <strong className={`tabular ${diff < 0 ? "text-red-700" : diff > 0 ? "text-amber-700" : "text-emerald-700"}`}>{formatBRL(diff)} {diff < 0 ? "(falta)" : diff > 0 ? "(sobra)" : "(confere)"}</strong></div>
        </div>
        <Field label="Observações" name="notes"><input id="notes" name="notes" maxLength={500} className={inputClass} /></Field>
        <Submit pendingText="Lançando…">Fechar caixa</Submit>
      </ActionForm>
    </div>
  );
}

export function CaixaSettingsForm({ accounts, s }: { accounts: Opt[]; s: { pix_account_id: string | null; card_account_id: string | null; safe_account_id: string | null; debit_days: number; credit_days: number; voucher_days: number; debit_fee_bps: number; credit_fee_bps: number; voucher_fee_bps: number } }) {
  const sel = (name: string, label: string, value: string | null, hint: string) => (
    <Field label={label} name={name} hint={hint}>
      <select id={name} name={name} defaultValue={value ?? ""} className={inputClass}>
        <option value="">—</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </Field>
  );
  const num = (name: string, label: string, value: number | string, step = "1") => (
    <Field label={label} name={name} required><input id={name} name={name} type="number" step={step} min={0} defaultValue={value} className={inputClass} /></Field>
  );
  return (
    <ActionForm action={saveCaixaSettingsAction} resetOnSuccess={false} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {sel("pixAccountId", "Conta que recebe o PIX", s.pix_account_id, "Normalmente a conta bancária")}
      {sel("cardAccountId", "Conta que recebe os cartões", s.card_account_id, "Onde a adquirente deposita")}
      {sel("safeAccountId", "Destino das sangrias", s.safe_account_id, "Cofre ou banco")}
      {num("debitDays", "Prazo débito (dias)", s.debit_days)}
      {num("creditDays", "Prazo crédito (dias)", s.credit_days)}
      {num("voucherDays", "Prazo vale (dias)", s.voucher_days)}
      {num("debitFeePct", "Taxa débito (%)", s.debit_fee_bps / 100, "0.01")}
      {num("creditFeePct", "Taxa crédito (%)", s.credit_fee_bps / 100, "0.01")}
      {num("voucherFeePct", "Taxa vale (%)", s.voucher_fee_bps / 100, "0.01")}
      <div className="sm:col-span-3"><Submit>Salvar configurações</Submit></div>
    </ActionForm>
  );
}

export function ConfirmCardForm({ titleId, today }: { titleId: string; today: string }) {
  return (
    <ActionForm action={confirmCardAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="titleId" value={titleId} />
      <input type="date" name="date" defaultValue={today} max={today} aria-label="Data do repasse" className={`${inputClass} w-auto`} />
      <Submit variant="secondary" pendingText="…">Confirmar repasse</Submit>
    </ActionForm>
  );
}
