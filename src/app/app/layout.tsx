import Link from "next/link";
import { AppShell } from "@/components/shell";
import { buildNav } from "@/components/nav";
import { STATUS_LABELS, type SubscriptionStatus } from "@/domains/billing/state-machine";
import { listMyCompanies } from "@/domains/tenants/service";
import { withTenantPage } from "@/server/web";
import { logoutAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const data = await withTenantPage(async (ctx) => ({
    nav: buildNav(ctx),
    tenantName: ctx.tenant.trade_name,
    userName: ctx.user.name,
    userId: ctx.user.id,
    support: ctx.supportMode,
    access: ctx.access,
    sub: ctx.subscription,
    canBilling: ctx.permissions.has("billing.manage"),
  }));
  const companies = data.support ? [] : await listMyCompanies(data.userId);
  const status = data.sub?.status as SubscriptionStatus | undefined;
  let banner: React.ReactNode = null;
  if (data.support) {
    banner = <div className="bg-purple-700 px-4 py-2 text-center text-sm text-white">Modo suporte (somente leitura, auditado). <Link href="/admin/sair-suporte" className="underline">Encerrar acesso</Link></div>;
  } else if (data.access === "read_only") {
    banner = (
      <div className="bg-red-700 px-4 py-2 text-center text-sm text-white">
        Assinatura {status ? STATUS_LABELS[status].toLowerCase() : "inexistente"}: a empresa está em modo somente leitura. Seus dados estão preservados e podem ser exportados.
        {data.canBilling && <> <Link href="/app/configuracoes/assinatura" className="underline">Regularizar</Link></>}
      </div>
    );
  } else if (status === "past_due" || status === "pending_payment") {
    banner = (
      <div className="bg-amber-500 px-4 py-2 text-center text-sm text-amber-950">
        {status === "past_due" ? "Pagamento em atraso." : "Fatura aguardando pagamento."}
        {data.canBilling && <> <Link href="/app/configuracoes/assinatura" className="underline">Ver assinatura</Link></>}
      </div>
    );
  } else if (status === "trialing" && data.sub?.trial_ends_at) {
    const days = Math.max(0, Math.ceil((new Date(data.sub.trial_ends_at).getTime() - Date.now()) / 86400000));
    banner = <div className="bg-brand-50 px-4 py-2 text-center text-sm text-brand-700">Avaliação gratuita: {days} dia(s) restante(s).</div>;
  }
  return (
    <AppShell nav={data.nav} tenantName={data.tenantName} userName={data.userName} banner={banner} logout={logoutAction} multiCompany={companies.length > 1}>
      {children}
    </AppShell>
  );
}
