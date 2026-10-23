import Link from "next/link";
import { ConfirmAction } from "@/components/forms";
import { Badge, Card, EmptyState, Money, PageHeader, Table, Td, btn, inputClass } from "@/components/ui";
import { listAccountOptions } from "@/domains/finance/accounts";
import { MOVEMENT_KIND_LABELS, PAYMENT_METHOD_LABELS } from "@/domains/finance/labels";
import { listMovements } from "@/domains/finance/movements";
import { addDays, formatDateBR } from "@/lib/dates";
import { withTenantPage } from "@/server/web";
import { reverseMovementAction } from "../finance-actions";

export const metadata = { title: "Movimentações" };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; accountId?: string; kind?: string }> }) {
  const sp = await searchParams;
  const data = await withTenantPage(async (ctx) => {
    const from = sp.from || addDays(ctx.today, -30);
    const to = sp.to || ctx.today;
    return {
      from, to,
      movements: await listMovements(ctx, { from, to, accountId: sp.accountId, kind: sp.kind }),
      accounts: await listAccountOptions(ctx),
      canReverse: ctx.permissions.has("movements.adjust") && ctx.access === "full" && !ctx.supportMode,
      canExport: ctx.permissions.has("reports.export") && ctx.entitlements.features.has("export.csv"),
    };
  });
  const qs = new URLSearchParams({ from: data.from, to: data.to, ...(sp.accountId ? { accountId: sp.accountId } : {}) });
  return (
    <>
      <PageHeader title="Movimentações" subtitle="Histórico de tudo que entrou e saiu das contas. Registros realizados não são editados: correções são feitas por estorno."
        actions={data.canExport ? <a className={btn.secondary} href={`/api/export/movements?${qs}`}>Exportar CSV</a> : null} />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <input type="date" name="from" defaultValue={data.from} aria-label="De" className={`${inputClass} w-auto`} />
          <input type="date" name="to" defaultValue={data.to} aria-label="Até" className={`${inputClass} w-auto`} />
          <select name="accountId" defaultValue={sp.accountId ?? ""} aria-label="Conta" className={`${inputClass} w-auto`}>
            <option value="">Todas as contas</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select name="kind" defaultValue={sp.kind ?? ""} aria-label="Tipo" className={`${inputClass} w-auto`}>
            <option value="">Todos os tipos</option>
            {Object.entries(MOVEMENT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className={btn.secondary}>Filtrar</button>
        </form>
        {data.movements.length === 0 ? <EmptyState title="Sem movimentações no período" /> : (
          <Table head={["Data", "Descrição", "Conta", "Tipo", "Categoria", "Valor", ""]}>
            {data.movements.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap">{formatDateBR(m.occurred_on)}</Td>
                <Td>
                  {m.title_id ? <Link href={`/app/titulos/${m.title_id}`} className="hover:underline">{m.title_description}</Link> : m.description}
                  {m.reason && <div className="text-xs text-gray-500">Motivo: {m.reason}</div>}
                  <div className="text-xs text-gray-400">{m.payment_method ? PAYMENT_METHOD_LABELS[m.payment_method] + " · " : ""}{m.created_by_name ?? ""}</div>
                </Td>
                <Td>{m.account_name}</Td>
                <Td><Badge tone={m.kind === "reversal" ? "amber" : m.kind === "transfer" ? "blue" : "gray"}>{MOVEMENT_KIND_LABELS[m.kind]}</Badge></Td>
                <Td className="text-gray-600">{m.kind === "transfer" ? "Transferência (não operacional)" : m.category_name ?? "—"}</Td>
                <Td right><Money cents={m.direction === "in" ? m.amount_cents : -m.amount_cents} signed /></Td>
                <Td>
                  {m.reversed && <Badge>Estornado</Badge>}
                  {!m.reversed && data.canReverse && ["settlement", "transfer", "adjustment"].includes(m.kind) && !(m.kind === "transfer" && m.direction === "in") && (
                    <ConfirmAction action={reverseMovementAction} label="Estornar" small askReason reasonLabel="Motivo do estorno"
                      confirmText={m.kind === "transfer" ? "As duas pernas da transferência serão estornadas." : "Será criada uma movimentação inversa. O registro original permanece no histórico."}
                      hidden={{ movementId: m.id }} />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
