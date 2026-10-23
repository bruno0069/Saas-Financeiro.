import Link from "next/link";
import { redirect } from "next/navigation";
import { ROLE_LABELS, type Role } from "@/domains/access/permissions";
import { getSegment } from "@/domains/segments/registry";
import { listMyCompanies } from "@/domains/tenants/service";
import { btn } from "@/components/ui";
import { requireUser } from "@/server/web";
import { selectCompanyAction } from "./actions";

export const metadata = { title: "Empresas" };

export default async function CompaniesPage() {
  const user = await requireUser();
  const companies = await listMyCompanies(user.id);
  if (companies.length === 0) redirect("/onboarding");
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Selecione a empresa</h1>
      <ul className="mt-6 space-y-3">
        {companies.map((c) => (
          <li key={c.id}>
            <form action={selectCompanyAction} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <input type="hidden" name="tenantId" value={c.id} />
              <div className="min-w-0">
                <div className="truncate font-medium">{c.trade_name}</div>
                <div className="text-xs text-gray-500">{getSegment(c.segment).name} · {ROLE_LABELS[c.role as Role]}</div>
              </div>
              <button type="submit" className={btn.primary}>Acessar</button>
            </form>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm"><Link href="/onboarding" className="text-brand-700 hover:underline">+ Cadastrar outra empresa</Link></p>
    </div>
  );
}
