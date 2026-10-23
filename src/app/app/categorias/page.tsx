import { Badge, Card, PageHeader } from "@/components/ui";
import { listCategories } from "@/domains/finance/categories";
import { withTenantPage } from "@/server/web";
import { EditCategoryForm, NewCategoryForm } from "./forms";

export const metadata = { title: "Categorias" };

export default async function CategoriesPage() {
  const data = await withTenantPage(async (ctx) => ({
    categories: await listCategories(ctx, { includeInactive: true }),
    canManage: ctx.permissions.has("categories.manage") && ctx.access === "full" && !ctx.supportMode,
  }));
  const groups = [["income", "Receitas"], ["expense", "Despesas"]] as const;
  return (
    <>
      <PageHeader title="Categorias" subtitle="Organizam receitas e despesas nos relatórios. Categorias não são excluídas para preservar o histórico — desative as que não usa." />
      {data.canManage && <Card className="mb-6" title="Nova categoria"><NewCategoryForm /></Card>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {groups.map(([kind, label]) => (
          <Card key={kind} title={label}>
            <ul className="divide-y divide-gray-100">
              {data.categories.filter((c) => c.kind === kind).map((c) => (
                <li key={c.id} className="py-2">
                  {data.canManage ? <EditCategoryForm c={c} /> : <span className={c.is_active ? "" : "text-gray-400"}>{c.name}</span>}
                  {c.code && <div className="mt-1"><Badge tone="blue">Padrão do segmento</Badge></div>}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
