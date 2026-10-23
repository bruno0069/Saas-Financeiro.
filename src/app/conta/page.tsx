import Link from "next/link";
import { Card, PageHeader, btn } from "@/components/ui";
import { requireUser } from "@/server/web";
import { DeleteAccountForm } from "./delete-form";

export const metadata = { title: "Minha conta" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <PageHeader title="Minha conta" subtitle={<><Link href="/app" className="text-brand-700 hover:underline">← Voltar ao painel</Link></>} />
      <div className="space-y-6">
        <Card title="Dados pessoais">
          <dl className="grid grid-cols-3 gap-2 text-sm"><dt className="text-gray-600">Nome</dt><dd className="col-span-2">{user.name}</dd>
            <dt className="text-gray-600">E-mail</dt><dd className="col-span-2">{user.email} {user.emailVerified ? "(confirmado)" : "(não confirmado)"}</dd></dl>
          <a href="/api/me/export" className={`${btn.secondary} mt-4`}>Exportar meus dados pessoais</a>
          {user.platformRole && <Link href="/admin" className={`${btn.secondary} ml-2 mt-4`}>Painel da plataforma</Link>}
        </Card>
        <Card title="Excluir conta">
          <p className="mb-3 text-sm text-gray-600">Seus dados pessoais serão anonimizados e todas as sessões encerradas. Os lançamentos financeiros das empresas são preservados (obrigação legal de guarda) e passam a indicar “Usuário removido”. Se você for proprietário de uma empresa ativa, transfira a propriedade antes.</p>
          <DeleteAccountForm />
        </Card>
      </div>
    </div>
  );
}
