import Link from "next/link";
import { Badge, Card, Money, PageHeader, Table, Td } from "@/components/ui";
import { listBillingEvents, listInvoices, runAsAdmin } from "@/domains/admin/service";
import { sessionToken } from "@/server/web";
import { MarkPaidForm } from "../forms";

export const metadata = { title: "Cobranças" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const { invoices, events, role } = await runAsAdmin(await sessionToken(), null, async (a) => ({ invoices: await listInvoices(a, status), events: await listBillingEvents(a), role: a.role }));
  return (
    <>
      <PageHeader title="Cobranças" />
      <Card title="Faturas" className="mb-6" actions={<nav className="flex gap-2 text-sm">{["", "pending", "overdue", "paid"].map((s) => <Link key={s} href={`/admin/cobrancas${s ? `?status=${s}` : ""}`} className="text-brand-700 hover:underline">{s || "todas"}</Link>)}</nav>}>
        <Table head={["Emitida", "Empresa", "Vencimento", "Valor", "Situação", ""]}>
          {invoices.map((i) => (
            <tr key={i.id}><Td>{new Date(i.issued_at).toLocaleDateString("pt-BR")}</Td><Td><Link href={`/admin/empresas/${i.tenant_id}`} className="hover:underline">{i.trade_name}</Link></Td>
              <Td>{i.due_date.split("-").reverse().join("/")}</Td><Td right><Money cents={i.amount_cents} /></Td>
              <Td><Badge tone={i.status === "paid" ? "green" : i.status === "overdue" ? "red" : "amber"}>{i.status}</Badge></Td>
              <Td>{role !== "support" && (i.status === "pending" || i.status === "overdue") && <MarkPaidForm invoiceId={i.id} />}</Td></tr>
          ))}
        </Table>
      </Card>
      <Card title="Eventos recebidos dos provedores (webhooks)">
        <Table head={["Recebido", "Provedor", "Evento", "ID", "Empresa", "Situação"]}>
          {events.map((e) => (
            <tr key={e.id}><Td>{new Date(e.received_at).toLocaleString("pt-BR")}</Td><Td>{e.provider}</Td><Td>{e.event_type}</Td><Td className="font-mono text-xs">{e.provider_event_id}</Td>
              <Td>{e.trade_name ?? "—"}</Td><Td><Badge tone={e.status === "processed" ? "green" : e.status === "failed" ? "red" : "gray"}>{e.status}</Badge>{e.error && <div className="text-xs text-red-700">{e.error}</div>}</Td></tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
