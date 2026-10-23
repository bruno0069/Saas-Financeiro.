import Link from "next/link";
import { Disclosure } from "./forms";
import { Badge, Card, EmptyState, Money, PageHeader, Table, Td, btn, inputClass } from "./ui";
import { TitleForm } from "./finance-forms";
import { listAccountOptions } from "@/domains/finance/accounts";
import { listCategories } from "@/domains/finance/categories";
import { listContacts } from "@/domains/finance/contacts";
import { listTitles, type TitleFilter } from "@/domains/finance/titles";
import { TITLE_STATUS_LABELS } from "@/domains/finance/labels";
import { formatDateBR } from "@/lib/dates";
import { withTenantPage } from "@/server/web";

type SP = { status?: string; q?: string; from?: string; to?: string; novo?: string };

export async function TitlesPage({ direction, searchParams }: { direction: "payable" | "receivable"; searchParams: SP }) {
  const isPay = direction === "payable";
  const status = (["open", "overdue", "paid", "canceled", "all"].includes(searchParams.status ?? "") ? searchParams.status : "open") as TitleFilter["status"];
  const data = await withTenantPage(async (ctx) => ({
    titles: await listTitles(ctx, { direction, status, q: searchParams.q, from: searchParams.from, to: searchParams.to }),
    categories: await listCategories(ctx, { kind: isPay ? "expense" : "income" }),
    contacts: await listContacts(ctx, { kind: isPay ? "supplier" : "customer" }),
    accounts: await listAccountOptions(ctx),
    canManage: ctx.permissions.has(isPay ? "payables.manage" : "receivables.manage"),
    canSettle: ctx.permissions.has(isPay ? "payables.settle" : "receivables.settle"),
    canExport: ctx.permissions.has("reports.export") && ctx.entitlements.features.has("export.csv"),
    writable: ctx.access === "full" && !ctx.supportMode,
    today: ctx.today,
  }));
  const total = data.titles.reduce((s, t) => s + t.open_cents, 0);
  const tabs: [string, string][] = [["open", "Em aberto"], ["overdue", "Vencidos"], ["paid", "Quitados"], ["canceled", "Cancelados"], ["all", "Todos"]];
  const base = isPay ? "/app/pagar" : "/app/receber";
  const qs = new URLSearchParams({ direction, status: status ?? "open", ...(searchParams.q ? { q: searchParams.q } : {}), ...(searchParams.from ? { from: searchParams.from } : {}), ...(searchParams.to ? { to: searchParams.to } : {}) });
  return (
    <>
      <PageHeader
        title={isPay ? "Contas a pagar" : "Contas a receber"}
        subtitle={isPay ? "Compromissos com fornecedores e despesas. Registre o pagamento quando ele acontecer." : "Valores a receber de clientes e vendas a prazo."}
        actions={data.canExport ? <a href={`/api/export/titles?${qs}`} className={btn.secondary}>Exportar CSV</a> : null}
      />
      {data.canManage && data.writable && (
        <div className="mb-6">
          <Disclosure summary={isPay ? "+ Nova conta a pagar / despesa" : "+ Nova conta a receber / receita"} defaultOpen={searchParams.novo === "1"}>
            {data.categories.length === 0 ? <p className="text-sm text-gray-600">Cadastre uma categoria primeiro.</p> : (
              <TitleForm direction={direction} categories={data.categories} contacts={data.contacts} accounts={data.accounts} today={data.today} canSettle={data.canSettle} />
            )}
          </Disclosure>
        </div>
      )}
      <Card>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Filtro de situação" className="flex flex-wrap gap-1">
            {tabs.map(([k, label]) => (
              <Link key={k} href={`${base}?status=${k}`} aria-current={status === k ? "page" : undefined}
                className={`rounded-full px-3 py-1 text-sm ${status === k ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>{label}</Link>
            ))}
          </nav>
          <form className="flex flex-wrap gap-2" role="search">
            <input type="hidden" name="status" value={status} />
            <label className="sr-only" htmlFor="q">Buscar</label>
            <input id="q" name="q" defaultValue={searchParams.q} placeholder="Buscar descrição, contato, documento" className={`${inputClass} w-full sm:w-64`} />
            <label className="sr-only" htmlFor="from">Vencimento de</label>
            <input id="from" name="from" type="date" defaultValue={searchParams.from} className={`${inputClass} w-auto`} aria-label="Vencimento a partir de" />
            <input id="to" name="to" type="date" defaultValue={searchParams.to} className={`${inputClass} w-auto`} aria-label="Vencimento até" />
            <button className={btn.secondary}>Filtrar</button>
          </form>
        </div>
        {data.titles.length === 0 ? (
          <EmptyState title="Nenhum título encontrado" description={status === "open" ? "Não há compromissos em aberto com esses filtros." : "Ajuste os filtros para ver outros registros."} />
        ) : (
          <>
            <Table head={["Vencimento", "Descrição", isPay ? "Fornecedor" : "Cliente", "Categoria", "Valor", "Em aberto", "Situação"]}>
              {data.titles.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <Td className="whitespace-nowrap">{formatDateBR(t.due_date)}</Td>
                  <Td><Link href={`/app/titulos/${t.id}`} className="font-medium text-gray-900 hover:text-brand-700 hover:underline">{t.description}</Link></Td>
                  <Td className="text-gray-600">{t.contact_name ?? "—"}</Td>
                  <Td className="text-gray-600">{t.category_name}</Td>
                  <Td right><Money cents={t.amount_cents} /></Td>
                  <Td right><Money cents={t.open_cents} /></Td>
                  <Td>
                    {t.is_overdue ? <Badge tone="red">Vencido</Badge> : <Badge tone={t.status === "paid" ? "green" : t.status === "partial" ? "amber" : t.status === "canceled" ? "gray" : "blue"}>{TITLE_STATUS_LABELS[t.status]}</Badge>}
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-right text-sm text-gray-700">{data.titles.length} título(s) · Em aberto: <strong className="tabular"><Money cents={total} /></strong></p>
          </>
        )}
      </Card>
    </>
  );
}
