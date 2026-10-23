"use client";

import { ActionForm, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { deleteAccountAction } from "./actions";

export function DeleteAccountForm() {
  return (
    <ActionForm action={deleteAccountAction} className="space-y-3">
      <Field label="Confirme sua senha" name="password" required><input name="password" type="password" required autoComplete="current-password" className={inputClass} /></Field>
      <Submit variant="danger" pendingText="Excluindo…">Excluir minha conta</Submit>
    </ActionForm>
  );
}
