import Link from "next/link";
import { ActionForm, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Recuperar senha" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Recuperar senha</h1>
      <p className="mb-6 text-sm text-gray-600">Informe seu e-mail para receber um link de redefinição.</p>
      <ActionForm action={forgotPasswordAction} className="space-y-4">
        <Field label="E-mail" name="email" required>
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        </Field>
        <Submit className="w-full" pendingText="Enviando…">Enviar link</Submit>
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">Voltar para o login</Link></p>
    </>
  );
}
