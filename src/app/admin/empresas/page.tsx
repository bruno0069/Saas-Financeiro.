import Link from "next/link";
import { Badge, Card, PageHeader, Table, Td, btn, inputClass } from "@/components/ui";
import { listTenants, runAsAdmin } from "@/domains/admin/service";
import { STATUS_LABELS, type SubscriptionStatus } from "@/domains/billing/state-machine";
import { getSegment } from "@/domains/segments/registry";
import { sessionToken } from "@/server/web";

export const metadata = { title: "Empresas" };

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const list = await runAsAdmin(await sessionToken(), null, (a) => listTenants(a, q));
  return (
    <>
      <PageHeader title="Empresas" subtitle="Cadastro e situação comercial. Dados financeiros dos clientes não são exibidos." />
      <Card>
        <form className="mb-4 flex gap-2"><input name="q" defaultValue={q} placeholder="Buscar empresa" aria-label="Buscar empresa" className={`${inputClass} w-64`} /><button className={btn.secondary}>Buscar</button></form>
        <Table head={["Empresa", "Segmento", "Plano", "Assinatura", "Usuários", "Desde"]}>
          {list.map((t) => (
            <tr key={t.id}>
              <Td><Link href={`/admin/empresas/${t.id}`} className="font-medium hover:underline">{t.trade_name}</Link></Td>
              <Td>{getSegment(t.segment).name}</Td>
              <Td>{t.plan_name ?? "—"}</Td>
              <Td>{t.sub_status ? <Badge tone={["active", "trialing"].includes(t.sub_status) ? "green" : ["past_due", "pending_payment"].includes(t.sub_status) ? "amber" : "red"}>{STATUS_LABELS[t.sub_status as SubscriptionStatus]}</Badge> : "—"}</Td>
              <Td right>{t.members}</Td>
              <Td>{new Date(t.created_at).toLocaleDateString("pt-BR")}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
