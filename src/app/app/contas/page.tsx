import { Disclosure } from "@/components/forms";
import { Badge, Card, EmptyState, Money, PageHeader, Table, Td } from "@/components/ui";
import { listAccounts } from "@/domains/finance/accounts";
import { ACCOUNT_KIND_LABELS } from "@/domains/finance/labels";
import { limitOf } from "@/server/authz";
import { formatDateBR } from "@/lib/dates";
import { withTenantPage } from "@/server/web";
import { AdjustForm, EditAccountForm, NewAccountForm, TransferForm } from "./forms";

export const metadata = { title: "Contas e saldos" };

export default async function AccountsPage() {
  const data = await withTenantPage(async (ctx) => ({
    accounts: await listAccounts(ctx, { includeInactive: true }),
    canManage: ctx.permissions.has("accounts.manage"),
    canTransfer: ctx.permissions.has("transfers.create"),
    canAdjust: ctx.permissions.has("movements.adjust"),
    writable: ctx.access === "full" && !ctx.supportMode,
    limit: limitOf(ctx, "max_financial_accounts"),
    today: ctx.today,
  }));
  const active = data.accounts.filter((a) => a.is_active);
  const total = active.reduce((s, a) => s + a.balance_cents, 0);
  return (
    <>
      <PageHeader title="Contas e saldos" subtitle="Caixa físico, contas bancárias, carteiras digitais e recebíveis. O saldo é a soma das movimentações realizadas." />
      <Card className="mb-6">
        {data.accounts.length === 0 ? (
          <EmptyState title="Cadastre suas contas" description="Comece pelo caixa da loja e pela conta bancária, informando o saldo de hoje." />
        ) : (
          <Table head={["Conta", "Tipo", "Saldo inicial", "Saldo atual", data.canManage && data.writable ? "Editar" : ""]}>
            {data.accounts.map((a) => (
              <tr key={a.id} className={a.is_active ? "" : "opacity-60"}>
                <Td><span className="font-medium">{a.name}</span> {!a.is_active && <Badge>Inativa</Badge>}{a.institution && <div className="text-xs text-gray-500">{a.institution}</div>}</Td>
                <Td>{ACCOUNT_KIND_LABELS[a.kind]}</Td>
                <Td><Money cents={a.opening_balance_cents} /> <div className="text-xs text-gray-500">em {formatDateBR(a.opening_date)}</div></Td>
                <Td right><Money cents={a.balance_cents} signed className="font-semibold" /></Td>
                <Td>{data.canManage && data.writable && <EditAccountForm a={a} />}</Td>
              </tr>
            ))}
          </Table>
        )}
        {data.accounts.length > 0 && <p className="mt-3 text-right text-sm">Total em contas ativas: <strong><Money cents={total} /></strong></p>}
      </Card>
      {data.writable && (
        <div className="space-y-4">
          {data.canManage && (
            <Disclosure summary={`+ Nova conta${data.limit != null ? ` (${active.length}/${data.limit} no plano)` : ""}`} defaultOpen={data.accounts.length === 0}>
              <NewAccountForm today={data.today} />
            </Disclosure>
          )}
          {data.canTransfer && active.length >= 2 && <Disclosure summary="Transferir entre contas"><TransferForm accounts={active} today={data.today} /></Disclosure>}
          {data.canAdjust && active.length >= 1 && <Disclosure summary="Ajuste de saldo (conciliação)"><AdjustForm accounts={active} today={data.today} /></Disclosure>}
        </div>
      )}
    </>
  );
}
