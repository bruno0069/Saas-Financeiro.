import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { listOps, runAsAdmin } from "@/domains/admin/service";
import { sessionToken } from "@/server/web";

export const metadata = { title: "Operação" };

export default async function OpsPage() {
  const { events, jobs } = await runAsAdmin(await sessionToken(), null, (a) => listOps(a));
  return (
    <>
      <PageHeader title="Operação" subtitle="Execuções de tarefas agendadas e erros operacionais registrados (integrações, jobs)." />
      <Card title="Tarefas agendadas" className="mb-6">
        <Table head={["Início", "Tarefa", "Duração", "Situação", "Resultado"]}>
          {jobs.map((j) => (
            <tr key={j.id}><Td>{new Date(j.started_at).toLocaleString("pt-BR")}</Td><Td>{j.job}</Td>
              <Td>{j.finished_at ? `${((new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000).toFixed(1)}s` : "—"}</Td>
              <Td><Badge tone={j.status === "succeeded" ? "green" : j.status === "failed" ? "red" : "amber"}>{j.status}</Badge></Td>
              <Td className="font-mono text-xs">{JSON.stringify(j.stats)}</Td></tr>
          ))}
        </Table>
      </Card>
      <Card title="Eventos operacionais">
        <Table head={["Quando", "Nível", "Origem", "Mensagem"]}>
          {events.map((e) => <tr key={e.id}><Td>{new Date(e.created_at).toLocaleString("pt-BR")}</Td><Td><Badge tone={e.level === "error" ? "red" : e.level === "warn" ? "amber" : "gray"}>{e.level}</Badge></Td><Td>{e.source}</Td><Td>{e.message}</Td></tr>)}
        </Table>
      </Card>
    </>
  );
}
