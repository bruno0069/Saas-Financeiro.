import Link from "next/link";
import { BarChart3, CalendarClock, ShieldCheck, Store, Users, Wallet } from "lucide-react";
import { btn } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { rows, withAppTx } from "@/server/db/pool";
import { currentUser } from "@/server/web";

export const dynamic = "force-dynamic";

async function publicPlans() {
  try {
    return await withAppTx({ sessionToken: null }, async (db) => {
      const plans = await rows<{ id: string; name: string; description: string; trial_days: number }>(db,
        "select id, name, description, trial_days from saas.plans where is_active and is_public order by sort_order");
      const prices = await rows<{ plan_id: string; billing_interval: string; price_cents: number }>(db,
        "select plan_id, billing_interval, price_cents from saas.plan_prices where is_active");
      return plans.map((p) => ({ ...p, prices: prices.filter((x) => x.plan_id === p.id) }));
    });
  } catch {
    return [];
  }
}

const FEATURES = [
  { icon: Wallet, title: "Saldo de todas as contas", text: "Caixa da loja, banco e carteiras digitais em um só lugar." },
  { icon: CalendarClock, title: "Contas a pagar e a receber", text: "Vencimentos, pagamentos parciais, parcelas e alertas." },
  { icon: BarChart3, title: "Fluxo de caixa e previsão", text: "Saiba quanto entrou, quanto saiu e como o caixa vai ficar." },
  { icon: Store, title: "Feito para o seu segmento", text: "Padaria: fechamento de caixa, recebíveis de cartão, fichas técnicas e perdas." },
  { icon: Users, title: "Equipe com permissões", text: "Proprietário, gerente, financeiro e operador — cada um vê o que precisa." },
  { icon: ShieldCheck, title: "Dados isolados e auditados", text: "Cada empresa só acessa seus próprios dados. Operações críticas ficam registradas." },
];

export default async function Home() {
  const [user, plans] = await Promise.all([currentUser(), publicPlans()]);
  return (
    <div>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <span className="flex items-center gap-2 font-semibold text-brand-700"><span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">R$</span> Gestão Financeira</span>
        <nav className="flex gap-2">
          {user ? <Link href="/app" className={btn.primary}>Ir para o painel</Link> : <><Link href="/login" className={btn.secondary}>Entrar</Link><Link href="/signup" className={btn.primary}>Criar conta</Link></>}
        </nav>
      </header>
      <section className="mx-auto max-w-6xl px-4 py-12 text-center sm:py-20">
        <h1 className="mx-auto max-w-3xl text-3xl font-bold tracking-tight text-gray-900 sm:text-5xl">As finanças do seu negócio, sem planilhas complicadas</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">Quanto você tem, quanto entrou e saiu, o que vence esta semana e como vai ficar o caixa. Simples para começar, organizado para crescer.</p>
        <div className="mt-8 flex justify-center gap-3"><Link href="/signup" className={btn.primary}>Começar avaliação gratuita</Link></div>
      </section>
      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <f.icon className="h-6 w-6 text-brand-600" aria-hidden />
            <h2 className="mt-3 font-semibold">{f.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{f.text}</p>
          </div>
        ))}
      </section>
      {plans.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-center text-2xl font-semibold">Planos</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {plans.map((p) => {
              const monthly = p.prices.find((x) => x.billing_interval === "monthly");
              const yearly = p.prices.find((x) => x.billing_interval === "yearly");
              return (
                <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <p className="mt-1 min-h-10 text-sm text-gray-600">{p.description}</p>
                  {monthly && <p className="mt-4 text-2xl font-bold">{formatBRL(monthly.price_cents)}<span className="text-sm font-normal text-gray-500">/mês</span></p>}
                  {yearly && <p className="text-sm text-gray-500">ou {formatBRL(yearly.price_cents)}/ano</p>}
                  <Link href="/signup" className={`${btn.secondary} mt-4 w-full`}>Testar {p.trial_days} dias grátis</Link>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-500">
        <Link href="/termos" className="hover:underline">Termos de uso</Link> · <Link href="/privacidade" className="hover:underline">Privacidade</Link>
      </footer>
    </div>
  );
}
