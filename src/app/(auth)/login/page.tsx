import Link from "next/link";
import { ActionForm, Submit } from "@/components/forms";
import { Alert, Field, inputClass } from "@/components/ui";
import { loginAction } from "../actions";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Entrar</h1>
      <p className="mb-6 text-sm text-gray-600">Acesse a gestão financeira da sua empresa.</p>
      {sp.reset && <div className="mb-4"><Alert tone="success">Senha alterada. Entre com a nova senha.</Alert></div>}
      <ActionForm action={loginAction} resetOnSuccess={false} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <Field label="E-mail" name="email" required>
          <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
        </Field>
        <Field label="Senha" name="password" required>
          <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
        </Field>
        <Submit className="w-full" pendingText="Entrando…">Entrar</Submit>
      </ActionForm>
      <div className="mt-6 flex flex-col gap-2 text-sm sm:flex-row sm:justify-between">
        <Link href="/forgot-password" className="text-brand-700 hover:underline">Esqueci minha senha</Link>
        <Link href={`/signup${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`} className="text-brand-700 hover:underline">Criar conta grátis</Link>
      </div>
    </>
  );
}
