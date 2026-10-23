/**
 * Catálogo de FUNCIONALIDADES COMERCIAIS (o que a empresa contratou) e LIMITES de uso.
 * Os planos no banco referenciam estas chaves; preços e associações são configuráveis no painel admin.
 */
export const FEATURES = {
  "core.finance": "Núcleo financeiro (contas, pagar/receber, fluxo de caixa)",
  "reports.basic": "Relatórios básicos",
  "reports.advanced": "Relatórios avançados (comparativos, projeção estendida)",
  "export.csv": "Exportação CSV",
  "users.invite": "Convidar usuários",
  "module.padaria.caixa": "Módulo Padaria: fechamento de caixa e recebíveis de cartão",
  "module.padaria.producao": "Módulo Padaria: fichas técnicas, margens e perdas",
  "audit.view": "Consulta de auditoria",
} as const;
export type FeatureKey = keyof typeof FEATURES;

export const LIMITS = {
  max_users: "Usuários ativos",
  max_financial_accounts: "Contas financeiras",
  max_titles_per_month: "Lançamentos (títulos) por mês",
} as const;
export type LimitKey = keyof typeof LIMITS;

export function isFeatureKey(k: string): k is FeatureKey {
  return k in FEATURES;
}
export function isLimitKey(k: string): k is LimitKey {
  return k in LIMITS;
}
