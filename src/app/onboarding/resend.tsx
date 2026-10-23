"use client";

import { useActionState } from "react";
import { FormMessage, Submit } from "@/components/forms";
import { resendVerificationAction } from "../(auth)/actions";

export function ResendVerification() {
  const [state, action] = useActionState(resendVerificationAction, {});
  return (
    <form action={action}>
      <Submit variant="secondary" pendingText="Enviando…">Reenviar link de confirmação</Submit>
      <FormMessage state={state} />
    </form>
  );
}
