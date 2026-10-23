import Link from "next/link";
import { ActionForm, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { signupAction } from "../actions";

export const metadata = { title: "Criar conta" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Criar conta</h1>
      <p className="mb-6 text-sm text-gray-600">Comece com 14 dias de avaliação gratuita. Sem cartão de crédito.</p>
      <ActionForm action={signupAction} resetOnSuccess={false} className="space-y-4">
        {(s) => (
          <>
            <input type="hidden" name="next" value={sp.next ?? ""} />
            <Field label="Seu nome" name="name" required error={s.fieldErrors?.name}>
              <input id="name" name="name" autoComplete="name" required minLength={2} className={inputClass} />
            </Field>
            <Field label="E-mail" name="email" required error={s.fieldErrors?.email}>
              <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
            </Field>
            <Field label="Senha" name="password" required hint="Mínimo de 10 caracteres." error={s.fieldErrors?.password}>
              <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
            </Field>
            <Field label="Confirme a senha" name="passwordConfirm" required error={s.fieldErrors?.passwordConfirm}>
              <input id="passwordConfirm" name="passwordConfirm" type="password" autoComplete="new-password" minLength={10} required className={inputClass} />
            </Field>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" name="acceptTerms" required className="mt-1" />
              <span>Li e aceito os <Link href="/termos" className="text-brand-700 underline">termos de uso</Link> e a <Link href="/privacidade" className="text-brand-700 underline">política de privacidade</Link>.</span>
            </label>
            <Submit className="w-full" pendingText="Criando conta…">Criar conta</Submit>
          </>
        )}
      </ActionForm>
      <p className="mt-6 text-center text-sm text-gray-600">Já tem conta? <Link href="/login" className="text-brand-700 hover:underline">Entrar</Link></p>
    </>
  );
}
