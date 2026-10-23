import { Disclosure } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { listPlans, runAsAdmin } from "@/domains/admin/service";
import { formatBRL } from "@/lib/money";
import { sessionToken } from "@/server/web";
import { PlanForm } from "../forms";

export const metadata = { title: "Planos" };

export default async function PlansPage() {
  const { plans, role } = await runAsAdmin(await sessionToken(), null, async (a) => ({ plans: await listPlans(a), role: a.role }));
  return (
    <>
      <PageHeader title="Planos" subtitle="Nome, preços, periodicidade, funcionalidades e limites são configuráveis. Assinaturas existentes mantêm o valor contratado até uma troca de plano." />
      <div className="space-y-4">
        {plans.map((p) => (
          <Card key={p.id} title={<span>{p.name} {p.is_default && <Badge tone="blue">Padrão p/ avaliação</Badge>} {!p.is_active && <Badge>Inativo</Badge>}</span>}
            actions={<span className="text-sm text-gray-600">{p.subscriptions} assinatura(s)</span>}>
            <p className="text-sm text-gray-600">{p.prices.filter((x) => x.is_active).map((x) => `${formatBRL(x.price_cents)}/${x.billing_interval === "yearly" ? "ano" : "mês"}`).join(" · ")} · {p.features.length} funcionalidade(s)</p>
            {role === "superadmin" && <div className="mt-3"><Disclosure summary="Editar"><PlanForm plan={p} /></Disclosure></div>}
          </Card>
        ))}
        {role === "superadmin" && <Disclosure summary="+ Novo plano"><PlanForm /></Disclosure>}
      </div>
    </>
  );
}
