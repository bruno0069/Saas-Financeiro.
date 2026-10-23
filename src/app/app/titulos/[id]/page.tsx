import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmAction, Disclosure } from "@/components/forms";
import { SettleForm } from "@/components/finance-forms";
import { EditTitleForm } from "./edit-form";
import { Alert, Badge, Card, Money, PageHeader, Table, Td } from "@/components/ui";
import { listAccountOptions } from "@/domains/finance/accounts";
import { listCategories } from "@/domains/finance/categories";
import { listContacts } from "@/domains/finance/contacts";
import { MOVEMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, TITLE_STATUS_LABELS } from "@/domains/finance/labels";
import { getTitle } from "@/domains/finance/titles";
import { NotFoundError } from "@/lib/errors";
import { formatDateBR } from "@/lib/dates";
import { centsToInput } from "@/lib/money";
import { withTenantPage } from "@/server/web";
import { cancelTitleAction, reverseMovementAction } from "../../finance-actions";

export const metadata = { title: "Título" };

export default async function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await withTenantPage(async (ctx) => {
    try {
      const { title, movements } = await getTitle(ctx, id);
      const isPay = title.direction === "payable";
      return {
        title, movements, isPay,
        accounts: await listAccountOptions(ctx),
        categories: await listCategories(ctx, { kind: isPay ? "expense" : "income" }),
        contacts: await listContacts(ctx, { kind: isPay ? "supplier" : "customer" }),
        canSettle: ctx.permissions.has(isPay ? "payables.settle" : "receivables.settle"),
        canManage: ctx.permissions.has(isPay ? "payables.manage" : "receivables.manage"),
        canReverse: ctx.permissions.has("movements.adjust"),
        writable: ctx.access === "full" && !ctx.supportMode,
        today: ctx.today,
      };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { title: t, isPay } = data;
  const open = t.status === "open" || t.status === "partial";
  return (
    <>
      <PageHeader
        title={t.description}
        subtitle={<><Link href={isPay ? "/app/pagar" : "/app/receber"} className="text-brand-700 hover:underline">{isPay ? "Contas a pagar" : "Contas a receber"}</Link> · {t.category_name}{t.contact_name ? ` · ${t.contact_name}` : ""}</>}
        actions={t.is_overdue ? <Badge tone="red">Vencido</Badge> : <Badge tone={t.status === "paid" ? "green" : t.status === "partial" ? "amber" : "blue"}>{TITLE_STATUS_LABELS[t.status]}</Badge>}
      />
      {t.source_module && <div className="mb-4"><Alert>Lançamento gerado automaticamente pelo módulo <strong>{t.source_module}</strong>. Correções devem ser feitas na origem.</Alert></div>}
      {t.status === "canceled" && <div className="mb-4"><Alert tone="warn">Cancelado: {t.cancel_reason}</Alert></div>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card><div className="text-sm text-gray-600">Valor</div><div className="text-xl font-semibold"><Money cents={t.amount_cents} /></div></Card>
        <Card><div className="text-sm text-gray-600">{isPay ? "Pago" : "Recebido"}</div><div className="text-xl font-semibold"><Money cents={t.paid_cents} /></div></Card>
        <Card><div className="text-sm text-gray-600">Em aberto</div><div className="text-xl font-semibold"><Money cents={t.open_cents} /></div></Card>
        <Card><div className="text-sm text-gray-600">Vencimento</div><div className="text-xl font-semibold">{formatDateBR(t.due_date)}</div>
          {t.installment_count > 1 && <div className="text-xs text-gray-500">Parcela {t.installment_number} de {t.installment_count}</div>}</Card>
      </div>

      {open && data.canSettle && data.writable && (
        <Card title={isPay ? "Registrar pagamento" : "Registrar recebimento"} className="mt-6">
          {data.accounts.length === 0 ? <p className="text-sm text-gray-600">Cadastre uma conta financeira primeiro.</p> : (
            <SettleForm titleId={t.id} openInput={centsToInput(t.open_cents)} accounts={data.accounts} today={data.today} isPay={isPay} />
          )}
        </Card>
      )}

      <Card title="Histórico de baixas e estornos" className="mt-6">
        {data.movements.length === 0 ? <p className="text-sm text-gray-500">Nenhuma movimentação ainda.</p> : (
          <Table head={["Data", "Tipo", "Conta", "Forma", "Valor", "Por", ""]}>
            {data.movements.map((m) => (
              <tr key={m.id}>
                <Td>{formatDateBR(m.occurred_on)}</Td>
                <Td>{MOVEMENT_KIND_LABELS[m.kind]}{m.reason ? <div className="text-xs text-gray-500">{m.reason}</div> : null}</Td>
                <Td>{m.account_name}</Td>
                <Td>{m.payment_method ? PAYMENT_METHOD_LABELS[m.payment_method] : "—"}</Td>
                <Td right><Money cents={m.kind === "reversal" ? -m.amount_cents : m.amount_cents} signed={m.kind === "reversal"} /></Td>
                <Td className="text-gray-600">{m.created_by_name ?? "—"}</Td>
                <Td>
                  {m.kind === "settlement" && m.reversed && <Badge>Estornado</Badge>}
                  {m.kind === "settlement" && !m.reversed && data.canReverse && data.writable && !t.source_module && (
                    <ConfirmAction action={reverseMovementAction} label="Estornar" small askReason reasonLabel="Motivo do estorno"
                      confirmText="O estorno cria uma movimentação inversa e reabre o saldo do título. A baixa original fica no histórico."
                      hidden={{ movementId: m.id }} />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {data.canManage && data.writable && t.status !== "canceled" && !t.source_module && (
        <div className="mt-6 space-y-4">
          <Disclosure summary="Editar dados do título">
            <EditTitleForm title={{ id: t.id, description: t.description, categoryId: t.category_id, contactId: t.contact_id, amount: centsToInput(t.amount_cents), dueDate: t.due_date, documentNumber: t.document_number, notes: t.notes, paid: t.paid_cents > 0 }}
              categories={data.categories} contacts={data.contacts} />
          </Disclosure>
          {t.paid_cents === 0 && (
            <ConfirmAction action={cancelTitleAction} label="Cancelar título" askReason reasonLabel="Motivo do cancelamento"
              confirmText="O título será cancelado e deixará de compor previsões e relatórios. A operação fica registrada na auditoria." hidden={{ id: t.id }} />
          )}
        </div>
      )}
    </>
  );
}
