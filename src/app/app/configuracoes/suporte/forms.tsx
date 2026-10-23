"use client";

import { ActionForm, ConfirmAction, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { grantSupportAction, revokeSupportAction } from "../actions";

export function GrantSupportForm({ maxHours }: { maxHours: number }) {
  return (
    <ActionForm action={grantSupportAction} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="sm:col-span-2"><Field label="Motivo / nº do chamado" name="reason" required><input name="reason" required minLength={10} maxLength={500} className={inputClass} /></Field></div>
      <Field label="Duração (horas)" name="hours" required><input name="hours" type="number" min={1} max={maxHours} defaultValue={24} className={inputClass} /></Field>
      <div className="sm:col-span-3"><Submit>Conceder acesso temporário</Submit></div>
    </ActionForm>
  );
}

export function RevokeSupport({ id }: { id: string }) {
  return <ConfirmAction action={revokeSupportAction} label="Revogar" small confirmText="O suporte perderá o acesso imediatamente." hidden={{ id }} />;
}
