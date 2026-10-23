import { ConfirmAction, Disclosure } from "@/components/forms";
import { Alert, Badge, Card, EmptyState, Money, PageHeader, Stat, Table, Td, btn, inputClass } from "@/components/ui";
import { listAccountOptions } from "@/domains/finance/accounts";
import * as caixa from "@/domains/padaria/caixa";
import { MODULES } from "@/domains/modules/registry";
import { formatDateBR, isIsoDate, monthEnd, monthStart } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { withTenantPage } from "@/server/web";
import { reverseClosingAction } from "../actions";
import { CaixaSettingsForm, ClosingForm, ConfirmCardForm } from "./forms";

export const metadata = { title: "Fechamento de caixa" };

export default async function CaixaPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const data = await withTenantPage(async (ctx) => {
    const ref = sp.mes && isIsoDate(`${sp.mes}-01`) ? `${sp.mes}-01` : ctx.today;
    const canManage = ctx.permissions.has("padaria.caixa.manage");
    const settings = await caixa.getSettings(ctx);
    return {
      today: ctx.today, ref, canManage, settings,
      closings: await caixa.listClosings(ctx, monthStart(ref), monthEnd(ref)),
      pending: canManage ? await caixa.pendingCardReceivables(ctx) : [],
      kpis: await caixa.kpis(ctx),
      accounts: await listAccountOptions(ctx),
      writable: ctx.access === "full" && !ctx.supportMode,
    };
  });
  const cashAccount = data.accounts.find((a) => a.kind === "cash")?.id;
  const configured = data.settings.pix_account_id && data.settings.card_account_id && data.settings.safe_account_id;
  return (
    <>
      <PageHeader title="Fechamento de caixa" subtitle="Registre as vendas do dia por forma de pagamento. O sistema lança automaticamente recebimentos, recebíveis de cartão, taxas, sangrias e diferenças de caixa no financeiro." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Vendas no mês" value={<Money cents={data.kpis.sales_total_cents} />} hint={`${data.kpis.closings} fechamento(s)`} />
        <Stat label="Ticket médio" value={data.kpis.average_ticket_cents != null ? <Money cents={data.kpis.average_ticket_cents} /> : "—"} />
        <Stat label="Cartões a receber" value={<Money cents={data.kpis.card_receivables_open_cents} />} />
        <Stat label="Quebra / sobra no mês" value={<span><span className="text-red-700">-{formatBRL(data.kpis.cash_shortage_cents)}</span> / <span className="text-amber-700">+{formatBRL(data.kpis.cash_overage_cents)}</span></span>} />
      </div>
      {!configured && data.canManage && <div className="mb-4"><Alert tone="warn">Configure as contas de destino (PIX, cartões e sangrias) antes do primeiro fechamento.</Alert></div>}
      {data.writable && (
        <Card title="Novo fechamento" className="mb-6">
          {data.accounts.length === 0 ? <p className="text-sm text-gray-600">Cadastre o caixa da loja em Contas e saldos.</p> : <ClosingForm accounts={data.accounts} today={data.today} defaultAccount={cashAccount} />}
        </Card>
      )}
      {data.canManage && data.pending.length > 0 && (
        <Card title="Recebíveis de cartão aguardando repasse" className="mb-6">
          <Table head={["Previsão", "Descrição", "Bruto", "Taxa", "Líquido", ""]}>
            {data.pending.map((p) => (
              <tr key={p.id}>
                <Td>{formatDateBR(p.due_date)} {p.due_date < data.today && <Badge tone="amber">Atrasado</Badge>}</Td>
                <Td>{p.description}</Td>
                <Td right><Money cents={p.amount_cents} /></Td>
                <Td right><Money cents={p.fee_cents} /></Td>
                <Td right className="font-semibold"><Money cents={p.net_cents} /></Td>
                <Td>{data.writable && <ConfirmCardForm titleId={p.id} today={data.today} />}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-gray-500">Confirme quando o valor cair na conta. A baixa registra o bruto como receita e a taxa como despesa.</p>
        </Card>
      )}
      <Card title="Fechamentos do mês" actions={
        <form className="flex gap-2"><input type="month" name="mes" defaultValue={data.ref.slice(0, 7)} aria-label="Mês" className={`${inputClass} w-auto`} /><button className={btn.secondary}>Ver</button></form>}>
        {data.closings.length === 0 ? <EmptyState title="Nenhum fechamento neste mês" /> : (
          <Table head={["Data", "Caixa", "Operador", "Dinheiro", "PIX", "Cartões/vale", "Sangrias", "Diferença", ""]}>
            {data.closings.map((c) => (
              <tr key={c.id} className={c.status === "reversed" ? "opacity-60" : ""}>
                <Td>{formatDateBR(c.closing_date)}</Td>
                <Td>{c.register_name}<div className="text-xs text-gray-500">{c.account_name}</div></Td>
                <Td>{c.operator_name ?? "—"}</Td>
                <Td right><Money cents={c.cash_sales_cents} /></Td>
                <Td right><Money cents={c.pix_sales_cents} /></Td>
                <Td right><Money cents={c.debit_sales_cents + c.credit_sales_cents + c.voucher_sales_cents} /></Td>
                <Td right><Money cents={c.withdrawals_cents} /></Td>
                <Td right><Money cents={c.difference_cents} signed /></Td>
                <Td>
                  {c.status === "reversed" ? <Badge>Estornado</Badge> : data.canManage && data.writable && (
                    <ConfirmAction action={reverseClosingAction} label="Estornar" small askReason reasonLabel="Motivo do estorno"
                      confirmText="Todas as baixas e transferências geradas serão estornadas e os títulos cancelados." hidden={{ id: c.id }} />
                  )}
                  {c.reverse_reason && <div className="text-xs text-gray-500">{c.reverse_reason}</div>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {data.canManage && data.writable && (
        <div className="mt-6"><Disclosure summary="Configurações do caixa (contas, prazos e taxas)" defaultOpen={!configured}>
          <CaixaSettingsForm accounts={data.accounts} s={data.settings} />
        </Disclosure></div>
      )}
      <details className="mt-6 text-sm text-gray-600">
        <summary className="cursor-pointer">Como o fechamento afeta o financeiro</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{MODULES["padaria.caixa"].financialEffects.map((e) => <li key={e}>{e}</li>)}</ul>
      </details>
    </>
  );
}
