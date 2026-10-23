import type { Permission } from "@/domains/access/permissions";
import type { TenantCtx } from "@/server/context";

export type NavItem = { href: string; label: string; icon: string };
export type NavSection = { title?: string; items: NavItem[] };

/** Menu montado a partir das permissões e dos módulos disponíveis (a autorização real ocorre no servidor). */
export function buildNav(ctx: TenantCtx): NavSection[] {
  const can = (p: Permission) => ctx.permissions.has(p);
  const core: NavItem[] = [];
  if (can("dashboard.view")) core.push({ href: "/app", label: "Painel", icon: "layout" });
  if (can("payables.view")) core.push({ href: "/app/pagar", label: "Contas a pagar", icon: "arrow-up" });
  if (can("receivables.view")) core.push({ href: "/app/receber", label: "Contas a receber", icon: "arrow-down" });
  if (can("finance.view")) core.push({ href: "/app/contas", label: "Contas e saldos", icon: "wallet" });
  if (can("finance.view")) core.push({ href: "/app/lancamentos", label: "Movimentações", icon: "list" });
  if (can("reports.view")) core.push({ href: "/app/fluxo-de-caixa", label: "Fluxo de caixa", icon: "trending" });
  if (can("reports.view")) core.push({ href: "/app/relatorios", label: "Relatórios", icon: "chart" });
  const modules: NavItem[] = [];
  for (const m of ctx.modules) {
    if (!m.available) continue;
    for (const n of m.def.nav) if (can(n.permission)) modules.push({ href: n.href, label: n.label, icon: m.def.key === "padaria.caixa" ? "register" : "cake" });
  }
  const records: NavItem[] = [{ href: "/app/contatos", label: "Clientes e fornecedores", icon: "users" }];
  if (can("categories.manage") || can("reports.view")) records.push({ href: "/app/categorias", label: "Categorias", icon: "tag" });
  const admin: NavItem[] = [];
  if (can("settings.manage") || can("users.manage") || can("billing.manage")) admin.push({ href: "/app/configuracoes", label: "Configurações", icon: "settings" });
  if (can("audit.view")) admin.push({ href: "/app/auditoria", label: "Auditoria", icon: "shield" });
  return [
    { items: core },
    ...(modules.length ? [{ title: "Padaria", items: modules }] : []),
    { title: "Cadastros", items: records },
    ...(admin.length ? [{ title: "Empresa", items: admin }] : []),
  ];
}
