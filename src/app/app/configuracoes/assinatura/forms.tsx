"use client";

import { ActionForm, ConfirmAction, Submit } from "@/components/forms";
import { inputClass } from "@/components/ui";
import { subscriptionAction } from "../actions";

export function ChangePlanForm({ plans, currentPlanId, currentInterval }: { plans: { id: string; name: string; prices: { billing_interval: string; label: string }[] }[]; currentPlanId: string; currentInterval: string }) {
  return (
    <ActionForm action={subscriptionAction} resetOnSuccess={false} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="op" value="change_plan" />
      <label className="text-sm"><span className="mb-1 block font-medium">Plano</span>
        <select name="planId" defaultValue={currentPlanId} className={`${inputClass} w-auto`}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="text-sm"><span className="mb-1 block font-medium">Periodicidade</span>
        <select name="interval" defaultValue={currentInterval} className={`${inputClass} w-auto`}><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label>
      <Submit>Alterar plano</Submit>
    </ActionForm>
  );
}

export function CancelSubscription() {
  return <ConfirmAction action={subscriptionAction} label="Cancelar assinatura" askReason reasonLabel="Motivo do cancelamento"
    confirmText="O acesso continua até o fim do período atual. Depois, a empresa fica em modo somente leitura; os dados não são apagados e podem ser exportados." hidden={{ op: "cancel" }} />;
}

export function Reactivate() {
  return (
    <ActionForm action={subscriptionAction} resetOnSuccess={false}>
      <input type="hidden" name="op" value="reactivate" />
      <Submit>Reativar assinatura</Submit>
    </ActionForm>
  );
}
