import { ActionForm, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Nova senha" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Criar nova senha</h1>
      <ActionForm action={resetPasswordAction} resetOnSuccess={false} className="space-y-4">
        <input type="hidden" name="token" value={token ?? ""} />
        <Field label="Nova senha" name="password" required hint="Mínimo de 10 caracteres.">
          <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
        </Field>
        <Field label="Confirme a nova senha" name="passwordConfirm" required>
          <input id="passwordConfirm" name="passwordConfirm" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
        </Field>
        <Submit className="w-full">Salvar nova senha</Submit>
      </ActionForm>
    </>
  );
}
