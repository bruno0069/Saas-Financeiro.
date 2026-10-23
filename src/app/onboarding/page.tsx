import Link from "next/link";
import { ActionForm, Submit } from "@/components/forms";
import { Alert, Field, inputClass } from "@/components/ui";
import { SEGMENTS } from "@/domains/segments/registry";
import { emailVerificationRequired } from "@/server/auth/service";
import { requireUser } from "@/server/web";
import { listMyCompanies } from "@/domains/tenants/service";
import { createCompanyAction } from "./actions";
import { ResendVerification } from "./resend";

export const metadata = { title: "Cadastrar empresa" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const companies = await listMyCompanies(user.id);
  const mustVerify = emailVerificationRequired() && !user.emailVerified;
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Olá, {user.name.split(" ")[0]}! Vamos cadastrar sua empresa</h1>
      <p className="mt-1 text-sm text-gray-600">Leva menos de um minuto. Você poderá completar os demais dados depois.</p>
      {companies.length > 0 && (
        <div className="mt-4"><Alert>Você já participa de {companies.length} empresa(s). <Link href="/empresas" className="underline">Acessar</Link></Alert></div>
      )}
      {mustVerify ? (
        <div className="mt-6 space-y-3">
          <Alert tone="warn">Confirme seu e-mail (<strong>{user.email}</strong>) para cadastrar a empresa. Enviamos um link para sua caixa de entrada.</Alert>
          <ResendVerification />
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <ActionForm action={createCompanyAction} resetOnSuccess={false} className="space-y-4">
            {(s) => (
              <>
                <Field label="Nome da empresa (nome fantasia)" name="tradeName" required error={s.fieldErrors?.tradeName}>
                  <input id="tradeName" name="tradeName" required minLength={2} maxLength={120} className={inputClass} placeholder="Ex.: Padaria Pão Dourado" />
                </Field>
                <Field label="Segmento" name="segment" required hint="Define categorias, módulos e indicadores iniciais. O núcleo financeiro é o mesmo para todos.">
                  <select id="segment" name="segment" required defaultValue="padaria" className={inputClass}>
                    {Object.values(SEGMENTS).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                  </select>
                </Field>
                <details className="text-sm">
                  <summary className="cursor-pointer text-brand-700">Dados fiscais (opcional)</summary>
                  <div className="mt-3 space-y-4">
                    <Field label="Razão social" name="legalName">
                      <input id="legalName" name="legalName" maxLength={160} className={inputClass} />
                    </Field>
                    <Field label="CNPJ ou CPF" name="taxId" error={s.fieldErrors?.taxId}>
                      <input id="taxId" name="taxId" inputMode="numeric" maxLength={20} className={inputClass} />
                    </Field>
                  </div>
                </details>
                <Submit className="w-full" pendingText="Criando empresa…">Criar empresa e começar avaliação</Submit>
              </>
            )}
          </ActionForm>
        </div>
      )}
    </div>
  );
}
