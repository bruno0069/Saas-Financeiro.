"use client";

import { ActionForm, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { FEATURES, LIMITS } from "@/domains/billing/catalog";
import { centsToInput } from "@/lib/money";
import { enterSupportAction, featureOverrideAction, limitOverrideAction, markPaidAction, savePlanAction, saveSettingsAction, subscriptionAdminAction } from "./actions";

export function SubscriptionAdminForm({ tenantId, plans }: { tenantId: string; plans: { id: string; name: string }[] }) {
  return (
    <ActionForm action={subscriptionAdminAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <Field label="Operação" name="action" required>
        <select name="action" className={inputClass} defaultValue="change_plan">
          <option value="change_plan">Trocar plano</option><option value="cancel">Cancelar (fim do período)</option>
          <option value="reactivate">Reativar cancelada</option><option value="suspend">Suspender (somente leitura)</option><option value="end">Encerrar</option>
        </select>
      </Field>
      <Field label="Plano (para troca)" name="planId">
        <select name="planId" className={inputClass} defaultValue="">{[<option key="" value="">—</option>, ...plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)]}</select>
      </Field>
      <Field label="Periodicidade (para troca)" name="interval">
        <select name="interval" className={inputClass} defaultValue="monthly"><option value="monthly">Mensal</option><option value="yearly">Anual</option></select>
      </Field>
      <Field label="Motivo" name="reason" required><input name="reason" required minLength={5} className={inputClass} /></Field>
      <div className="sm:col-span-2"><Submit>Executar</Submit></div>
    </ActionForm>
  );
}

export function MarkPaidForm({ invoiceId }: { invoiceId: string }) {
  return (
    <ActionForm action={markPaidAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input name="method" placeholder="Forma (PIX…)" aria-label="Forma de pagamento" className={`${inputClass} w-28`} />
      <input name="reason" required minLength={5} placeholder="Referência/comprovante" aria-label="Referência do pagamento" className={`${inputClass} w-44`} />
      <Submit variant="secondary" pendingText="…">Confirmar pagamento</Submit>
    </ActionForm>
  );
}

export function FeatureOverrideForm({ tenantId }: { tenantId: string }) {
  return (
    <ActionForm action={featureOverrideAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <select name="feature" aria-label="Funcionalidade" className={inputClass}>{Object.entries(FEATURES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select name="mode" aria-label="Modo" className={inputClass} defaultValue="on"><option value="on">Conceder</option><option value="off">Bloquear</option><option value="plan">Seguir o plano</option></select>
      <input name="reason" required minLength={5} placeholder="Motivo" aria-label="Motivo" className={inputClass} />
      <Submit variant="secondary">Aplicar</Submit>
    </ActionForm>
  );
}

export function LimitOverrideForm({ tenantId }: { tenantId: string }) {
  return (
    <ActionForm action={limitOverrideAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <select name="limit" aria-label="Limite" className={inputClass}>{Object.entries(LIMITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input name="value" required placeholder="número, unlimited ou plan" aria-label="Valor" className={inputClass} />
      <input name="reason" required minLength={5} placeholder="Motivo" aria-label="Motivo" className={inputClass} />
      <Submit variant="secondary">Aplicar</Submit>
    </ActionForm>
  );
}

export function EnterSupportForm({ tenantId }: { tenantId: string }) {
  return (
    <ActionForm action={enterSupportAction} resetOnSuccess={false} className="space-y-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <Field label="Finalidade do acesso (registrada na auditoria do cliente)" name="justification" required>
        <input name="justification" required minLength={10} className={inputClass} />
      </Field>
      <Submit variant="secondary">Entrar em modo suporte (somente leitura)</Submit>
    </ActionForm>
  );
}

type Plan = { id: string; code: string; name: string; description: string; is_active: boolean; is_public: boolean; trial_days: number; sort_order: number;
  prices: { billing_interval: string; price_cents: number; is_active: boolean }[]; features: string[]; limits: Record<string, number | null> };

export function PlanForm({ plan }: { plan?: Plan }) {
  const price = (i: string) => plan?.prices.find((p) => p.billing_interval === i && p.is_active);
  return (
    <ActionForm action={savePlanAction} resetOnSuccess={!plan} className="space-y-4">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Código" name="code" required><input name="code" required defaultValue={plan?.code} pattern="[a-z0-9_]{2,40}" className={inputClass} /></Field>
        <Field label="Nome" name="name" required><input name="name" required defaultValue={plan?.name} className={inputClass} /></Field>
        <Field label="Preço mensal" name="monthlyPrice" required><input name="monthlyPrice" required defaultValue={price("monthly") ? centsToInput(price("monthly")!.price_cents) : ""} className={inputClass} /></Field>
        <Field label="Preço anual" name="yearlyPrice" hint="Vazio = sem opção anual"><input name="yearlyPrice" defaultValue={price("yearly") ? centsToInput(price("yearly")!.price_cents) : ""} className={inputClass} /></Field>
        <Field label="Dias de avaliação" name="trialDays" required><input name="trialDays" type="number" min={0} max={90} defaultValue={plan?.trial_days ?? 14} className={inputClass} /></Field>
        <Field label="Ordem" name="sortOrder" required><input name="sortOrder" type="number" min={0} defaultValue={plan?.sort_order ?? 0} className={inputClass} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={plan?.is_active ?? true} /> Ativo</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPublic" defaultChecked={plan?.is_public ?? true} /> Público</label>
      </div>
      <Field label="Descrição" name="description"><input name="description" defaultValue={plan?.description} className={inputClass} /></Field>
      <fieldset><legend className="mb-1 text-sm font-medium">Funcionalidades</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{Object.entries(FEATURES).map(([k, v]) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name="features[]" value={k} defaultChecked={plan?.features.includes(k)} /> {v}</label>
        ))}</div>
      </fieldset>
      <fieldset><legend className="mb-1 text-sm font-medium">Limites (vazio = ilimitado)</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{Object.entries(LIMITS).map(([k, v]) => (
          <label key={k} className="text-sm">{v}<input name={`limit_${k}`} type="number" min={0} defaultValue={plan?.limits[k] ?? ""} className={inputClass} /></label>
        ))}</div>
      </fieldset>
      <Submit>{plan ? "Salvar plano" : "Criar plano"}</Submit>
    </ActionForm>
  );
}

export function SettingsForm({ s, modules }: { s: { graceDaysBeforeSuspension: number; invoiceDueDays: number; readOnlyRetentionDays: number; supportGrantMaxHours: number; disabledModules: string[] }; modules: { key: string; name: string }[] }) {
  return (
    <ActionForm action={saveSettingsAction} resetOnSuccess={false} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Carência antes de suspender (dias)" name="graceDaysBeforeSuspension" required><input name="graceDaysBeforeSuspension" type="number" min={0} max={90} defaultValue={s.graceDaysBeforeSuspension} className={inputClass} /></Field>
        <Field label="Prazo de vencimento da fatura (dias)" name="invoiceDueDays" required><input name="invoiceDueDays" type="number" min={0} max={30} defaultValue={s.invoiceDueDays} className={inputClass} /></Field>
        <Field label="Retenção em somente leitura (dias)" name="readOnlyRetentionDays" required><input name="readOnlyRetentionDays" type="number" min={30} defaultValue={s.readOnlyRetentionDays} className={inputClass} /></Field>
        <Field label="Duração máx. do acesso de suporte (h)" name="supportGrantMaxHours" required><input name="supportGrantMaxHours" type="number" min={1} max={720} defaultValue={s.supportGrantMaxHours} className={inputClass} /></Field>
      </div>
      <fieldset><legend className="mb-1 text-sm font-medium">Desligar módulos globalmente (manutenção/incidente)</legend>
        {modules.map((m) => <label key={m.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name="disabledModules[]" value={m.key} defaultChecked={s.disabledModules.includes(m.key)} /> {m.name}</label>)}
      </fieldset>
      <Submit>Salvar</Submit>
    </ActionForm>
  );
}
