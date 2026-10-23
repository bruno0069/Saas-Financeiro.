import { Badge, Card } from "@/components/ui";
import { getSegment } from "@/domains/segments/registry";
import { requirePerm } from "@/server/authz";
import { withTenantPage } from "@/server/web";
import { CompanyForm, ModuleToggle } from "./forms";

export const metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const data = await withTenantPage(async (ctx) => {
    requirePerm(ctx, "settings.manage");
    return { t: ctx.tenant, modules: ctx.modules, writable: ctx.access === "full" && !ctx.supportMode };
  });
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card title="Dados da empresa">
        <p className="mb-4 text-sm text-gray-600">Segmento: <strong>{getSegment(data.t.segment).name}</strong></p>
        <CompanyForm t={data.t} />
      </Card>
      <Card title="Módulos do segmento">
        {data.modules.length === 0 ? <p className="text-sm text-gray-600">Ainda não há módulos específicos para este segmento. O núcleo financeiro está completo.</p> : (
          <ul className="space-y-4">
            {data.modules.map((m) => (
              <li key={m.def.key} className="rounded-lg border border-gray-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{m.def.name}</div>
                  <div className="flex items-center gap-2">
                    {m.available ? <Badge tone="green">Ativo</Badge> : !m.entitled ? <Badge tone="amber">Não incluído no plano</Badge> : m.globallyDisabled ? <Badge tone="red">Indisponível</Badge> : <Badge>Desabilitado</Badge>}
                    {data.writable && m.entitled && !m.globallyDisabled && <ModuleToggle moduleKey={m.def.key} enabled={m.enabledByTenant} />}
                  </div>
                </div>
                <p className="mt-1 text-sm text-gray-600">{m.def.description}</p>
                <details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">Efeitos financeiros</summary>
                  <ul className="mt-1 list-disc pl-4">{m.def.financialEffects.map((e) => <li key={e}>{e}</li>)}</ul></details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
