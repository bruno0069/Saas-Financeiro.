import { Alert, Badge, Card, btn } from "@/components/ui";
import { listSupportGrants } from "@/domains/access/support";
import { requirePerm } from "@/server/authz";
import { withTenantPage } from "@/server/web";
import { GrantSupportForm, RevokeSupport } from "./forms";

export const metadata = { title: "Suporte e dados" };

export default async function SupportPage() {
  const data = await withTenantPage(async (ctx) => {
    requirePerm(ctx, "settings.manage");
    return { grants: await listSupportGrants(ctx), isOwner: ctx.role === "owner", maxHours: ctx.platform.supportGrantMaxHours, retention: ctx.platform.readOnlyRetentionDays };
  });
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card title="Acesso da equipe de suporte">
        <p className="mb-4 text-sm text-gray-600">Nossa equipe não acessa seus dados financeiros sem autorização. Se precisar de ajuda, conceda um acesso temporário e somente leitura. Todos os acessos ficam registrados na auditoria.</p>
        {data.isOwner ? <GrantSupportForm maxHours={data.maxHours} /> : <Alert>Somente o proprietário pode conceder acesso de suporte.</Alert>}
        {data.grants.length > 0 && (
          <ul className="mt-4 divide-y divide-gray-100 text-sm">
            {data.grants.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{g.reason} <span className="text-gray-500">· até {new Date(g.expires_at).toLocaleString("pt-BR")}</span></span>
                {g.active ? <span className="flex items-center gap-2"><Badge tone="amber">Ativo</Badge><RevokeSupport id={g.id} /></span> : <Badge>Encerrado</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Seus dados (LGPD)">
        <p className="text-sm text-gray-600">Você pode exportar todos os dados da empresa a qualquer momento, inclusive com a assinatura suspensa ou encerrada.</p>
        {data.isOwner && <a href="/api/export/full" className={`${btn.secondary} mt-4`}>Exportar todos os dados (JSON)</a>}
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>Dados financeiros não são apagados por atraso ou cancelamento.</li>
          <li>Após o encerramento, os dados ficam disponíveis em modo somente leitura por {data.retention} dias.</li>
          <li>Pedidos de exclusão definitiva da empresa são atendidos pelo suporte, respeitando os prazos legais de guarda.</li>
        </ul>
      </Card>
    </div>
  );
}
