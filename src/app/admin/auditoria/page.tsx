import Link from "next/link";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { listAudit, runAsAdmin } from "@/domains/admin/service";
import { AUDIT_ACTION_LABELS } from "@/domains/audit/audit";
import { sessionToken } from "@/server/web";

export const metadata = { title: "Auditoria da plataforma" };

export default async function AdminAudit({ searchParams }: { searchParams: Promise<{ escopo?: string }> }) {
  const { escopo } = await searchParams;
  const list = await runAsAdmin(await sessionToken(), null, (a) => listAudit(a, escopo === "all" ? "all" : "platform"));
  return (
    <>
      <PageHeader title="Auditoria" subtitle="Ações administrativas, de suporte e de plataforma. Os registros não contêm valores financeiros."
        actions={<Link className="text-sm text-brand-700 hover:underline" href={escopo === "all" ? "/admin/auditoria" : "/admin/auditoria?escopo=all"}>{escopo === "all" ? "Somente plataforma" : "Incluir eventos das empresas"}</Link>} />
      <Card>
        <Table head={["Quando", "Ator", "Empresa", "Operação", "Resultado", "Justificativa"]}>
          {list.map((a) => (
            <tr key={a.id}><Td className="whitespace-nowrap">{new Date(a.created_at).toLocaleString("pt-BR")}</Td><Td>{a.actor_name ?? "Sistema"} <span className="text-xs text-gray-500">{a.actor_type}</span></Td>
              <Td>{a.trade_name ?? "—"}</Td><Td>{AUDIT_ACTION_LABELS[a.action] ?? a.action}</Td><Td><Badge tone={a.result === "success" ? "green" : "red"}>{a.result}</Badge></Td><Td>{a.reason ?? ""}</Td></tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
