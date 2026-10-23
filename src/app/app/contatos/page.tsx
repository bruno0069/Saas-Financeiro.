import { Disclosure } from "@/components/forms";
import { Badge, Card, EmptyState, PageHeader, btn, inputClass } from "@/components/ui";
import { listContacts } from "@/domains/finance/contacts";
import { formatTaxId } from "@/lib/tax-id";
import { withTenantPage } from "@/server/web";
import { ContactForm } from "./forms";

export const metadata = { title: "Clientes e fornecedores" };

const KIND = { customer: "Cliente", supplier: "Fornecedor", both: "Cliente e fornecedor" } as const;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const sp = await searchParams;
  const data = await withTenantPage(async (ctx) => ({
    contacts: await listContacts(ctx, { q: sp.q, kind: sp.kind === "customer" || sp.kind === "supplier" ? sp.kind : undefined }),
    canManage: ctx.permissions.has("contacts.manage") && ctx.access === "full" && !ctx.supportMode,
  }));
  return (
    <>
      <PageHeader title="Clientes e fornecedores" />
      {data.canManage && <div className="mb-6"><Disclosure summary="+ Novo cadastro"><ContactForm /></Disclosure></div>}
      <Card>
        <form className="mb-4 flex flex-wrap gap-2" role="search">
          <input name="q" defaultValue={sp.q} placeholder="Buscar por nome" aria-label="Buscar por nome" className={`${inputClass} w-full sm:w-64`} />
          <select name="kind" defaultValue={sp.kind ?? ""} aria-label="Tipo" className={`${inputClass} w-auto`}>
            <option value="">Todos</option><option value="customer">Clientes</option><option value="supplier">Fornecedores</option>
          </select>
          <button className={btn.secondary}>Filtrar</button>
        </form>
        {data.contacts.length === 0 ? <EmptyState title="Nenhum cadastro encontrado" /> : (
          <ul className="divide-y divide-gray-100">
            {data.contacts.map((c) => (
              <li key={c.id} className="py-3">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Badge tone={c.kind === "supplier" ? "amber" : "blue"}>{KIND[c.kind]}</Badge>
                    {!c.is_active && <Badge>Inativo</Badge>}
                    <span className="text-sm text-gray-500">{[c.tax_id ? formatTaxId(c.tax_id) : null, c.phone, c.email].filter(Boolean).join(" · ")}</span>
                  </summary>
                  {data.canManage && <div className="mt-3"><ContactForm c={c} /></div>}
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
