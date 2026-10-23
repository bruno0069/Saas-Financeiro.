import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/web";

export const dynamic = "force-dynamic";

const NAV = [
  ["/admin", "Visão geral"], ["/admin/empresas", "Empresas"], ["/admin/planos", "Planos"], ["/admin/cobrancas", "Cobranças"],
  ["/admin/auditoria", "Auditoria"], ["/admin/operacao", "Operação"], ["/admin/configuracoes", "Configurações"],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (!user.platformRole) redirect("/app");
  return (
    <div className="min-h-screen">
      <header className="bg-gray-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="font-semibold">Administração da plataforma</span>
          <span className="text-xs text-gray-300">{user.name} · {user.platformRole}</span>
        </div>
        <nav aria-label="Administração" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800">{label}</Link>)}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
