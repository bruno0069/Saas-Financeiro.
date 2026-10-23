"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowDownCircle, ArrowUpCircle, BarChart3, Cake, LayoutDashboard, List, LogOut, Menu, Settings, Shield, Store, Tag,
  TrendingUp, Users, Wallet, X, Building2, UserCircle,
} from "lucide-react";
import type { NavSection } from "./nav";
import { cx } from "./ui";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  layout: LayoutDashboard, "arrow-up": ArrowUpCircle, "arrow-down": ArrowDownCircle, wallet: Wallet, list: List,
  trending: TrendingUp, chart: BarChart3, register: Store, cake: Cake, users: Users, tag: Tag, settings: Settings, shield: Shield,
};

export function AppShell({
  nav, tenantName, userName, banner, children, logout, multiCompany,
}: {
  nav: NavSection[]; tenantName: string; userName: string; banner?: React.ReactNode; children: React.ReactNode;
  logout: () => Promise<void>; multiCompany: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
  const sidebar = (
    <nav aria-label="Menu principal" className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white" aria-hidden>R$</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">{tenantName}</div>
          {multiCompany && <Link href="/empresas" className="text-xs text-brand-700 hover:underline">Trocar empresa</Link>}
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        {nav.map((section, i) => (
          <div key={i}>
            {section.title && <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{section.title}</div>}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = ICONS[item.icon] ?? Building2;
                return (
                  <li key={item.href}>
                    <Link href={item.href} onClick={() => setOpen(false)} aria-current={isActive(item.href) ? "page" : undefined}
                      className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm", isActive(item.href) ? "bg-brand-50 font-medium text-brand-700" : "text-gray-700 hover:bg-gray-100")}>
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-200 p-2">
        <Link href="/conta" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
          <UserCircle className="h-4 w-4" /> <span className="truncate">{userName}</span>
        </Link>
        <form action={logout}>
          <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </form>
      </div>
    </nav>
  );
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-gray-200 bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-gray-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white shadow-xl">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-2 top-3 rounded-md p-2 text-gray-500 hover:bg-gray-100" aria-label="Fechar menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="rounded-md p-1.5 text-gray-700 hover:bg-gray-100" aria-label="Abrir menu" aria-expanded={open}>
          <Menu className="h-5 w-5" />
        </button>
        <span className="truncate text-sm font-semibold">{tenantName}</span>
      </header>
      {banner}
      <main id="conteudo" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
