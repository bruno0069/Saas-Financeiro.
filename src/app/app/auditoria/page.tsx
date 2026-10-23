import { Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui";
import { AUDIT_ACTION_LABELS } from "@/domains/audit/audit";
import { rows } from "@/server/db/pool";
import { requireFeature, requirePerm } from "@/server/authz";
import { withTenantPage } from "@/server/web";

export const metadata = { title: "Auditoria" };

export default async function AuditPage() {
  const data = await withTenantPage(async (ctx) => {
    requirePerm(ctx, "audit.view");
    requireFeature(ctx, "audit.view");
    return rows<{ id: string; created_at: Date; action: string; actor_type: string; actor_name: string | null; entity_type: string | null; result: string; reason: string | null }>(ctx.db,
      `select l.id, l.created_at, l.action, l.actor_type, u.name as actor_name, l.entity_type, l.result, l.reason
         from saas.audit_log l left join saas.users u on u.id = l.actor_user_id
        where l.tenant_id = $1 order by l.created_at desc limit 300`, [ctx.tenant.id]);
  });
  return (
    <>
      <PageHeader title="Auditoria" subtitle="Registro das operações críticas da empresa. Os registros não podem ser alterados." />
      <Card>
        {data.length === 0 ? <EmptyState title="Sem registros" /> : (
          <Table head={["Quando", "Quem", "Operação", "Resultado", "Justificativa"]}>
            {data.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap">{new Date(a.created_at).toLocaleString("pt-BR")}</Td>
                <Td>{a.actor_name ?? "Sistema"} {a.actor_type !== "user" && <Badge tone="amber">{a.actor_type === "support" ? "Suporte" : a.actor_type === "platform_admin" ? "Plataforma" : a.actor_type}</Badge>}</Td>
                <Td>{AUDIT_ACTION_LABELS[a.action] ?? a.action}</Td>
                <Td><Badge tone={a.result === "success" ? "green" : "red"}>{a.result === "success" ? "Sucesso" : a.result === "denied" ? "Negado" : "Erro"}</Badge></Td>
                <Td className="text-gray-600">{a.reason ?? ""}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
