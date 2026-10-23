/**
 * Catálogo de permissões de USUÁRIO dentro de uma empresa.
 * (Funcionalidades contratadas pela EMPRESA ficam em billing/catalog.ts — são conceitos distintos.)
 */
export const PERMISSIONS = {
  "dashboard.view": "Ver painel financeiro",
  "finance.view": "Ver contas, saldos e movimentações",
  "accounts.manage": "Gerenciar contas financeiras",
  "categories.manage": "Gerenciar categorias",
  "contacts.manage": "Gerenciar clientes e fornecedores",
  "payables.view": "Ver contas a pagar",
  "payables.manage": "Lançar e editar contas a pagar",
  "payables.settle": "Registrar pagamentos",
  "receivables.view": "Ver contas a receber",
  "receivables.manage": "Lançar e editar contas a receber",
  "receivables.settle": "Registrar recebimentos",
  "transfers.create": "Transferir entre contas",
  "movements.adjust": "Registrar ajustes e estornos",
  "reports.view": "Ver relatórios",
  "reports.export": "Exportar relatórios (CSV)",
  "users.manage": "Gerenciar usuários e convites",
  "settings.manage": "Gerenciar configurações da empresa e módulos",
  "billing.manage": "Gerenciar assinatura",
  "audit.view": "Ver auditoria",
  "padaria.caixa.operate": "Padaria: registrar fechamento de caixa",
  "padaria.caixa.manage": "Padaria: configurar caixa, confirmar repasses e estornar fechamentos",
  "padaria.producao.view": "Padaria: ver fichas técnicas e margens",
  "padaria.producao.manage": "Padaria: gerenciar insumos, produtos e perdas",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type Role = "owner" | "manager" | "finance" | "operator";
export const ROLE_LABELS: Record<Role, string> = {
  owner: "Proprietário",
  manager: "Gerente",
  finance: "Financeiro",
  operator: "Operador",
};

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  manager: [
    "dashboard.view", "finance.view", "categories.manage", "contacts.manage",
    "payables.view", "payables.manage", "receivables.view", "receivables.manage",
    "reports.view", "reports.export",
    "padaria.caixa.operate", "padaria.caixa.manage", "padaria.producao.view", "padaria.producao.manage",
  ],
  finance: [
    "dashboard.view", "finance.view", "accounts.manage", "categories.manage", "contacts.manage",
    "payables.view", "payables.manage", "payables.settle",
    "receivables.view", "receivables.manage", "receivables.settle",
    "transfers.create", "movements.adjust", "reports.view", "reports.export",
    "padaria.caixa.operate", "padaria.caixa.manage", "padaria.producao.view",
  ],
  operator: ["contacts.manage", "padaria.caixa.operate", "padaria.producao.view", "padaria.producao.manage"],
};

/** Permissões que nunca podem ser concedidas fora do papel de proprietário. */
export const OWNER_ONLY: readonly Permission[] = ["billing.manage"];

export function effectivePermissions(role: Role, extra: string[] = [], revoked: string[] = []): Permission[] {
  if (role === "owner") return [...ALL_PERMISSIONS];
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const p of extra) if (p in PERMISSIONS && !OWNER_ONLY.includes(p as Permission)) set.add(p as Permission);
  for (const p of revoked) set.delete(p as Permission);
  return ALL_PERMISSIONS.filter((p) => set.has(p));
}

export function isPermission(p: string): p is Permission {
  return p in PERMISSIONS;
}
