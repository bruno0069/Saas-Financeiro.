/** Máquina de estados da assinatura. Toda mudança de situação passa por assertTransition(). */
export const SUBSCRIPTION_STATUSES = ["trialing", "pending_payment", "active", "past_due", "suspended", "canceled", "ended"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Avaliação gratuita",
  pending_payment: "Aguardando pagamento",
  active: "Ativa",
  past_due: "Em atraso",
  suspended: "Suspensa",
  canceled: "Cancelada",
  ended: "Encerrada",
};

export const TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  trialing: ["active", "pending_payment", "canceled", "ended"],
  pending_payment: ["active", "past_due", "canceled"],
  active: ["pending_payment", "past_due", "canceled"],
  past_due: ["active", "suspended", "canceled"],
  suspended: ["active", "canceled", "ended"],
  // Cancelada mantém acesso até o fim do período pago; pode ser reativada antes disso.
  canceled: ["active", "ended"],
  ended: [],
};

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(public from: string, public to: string) {
    super(`Transição de assinatura inválida: ${from} → ${to}`);
  }
}

export function assertTransition(from: SubscriptionStatus, to: SubscriptionStatus) {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/**
 * Política de acesso aos dados por situação (espelha saas.tenant_access_level no banco):
 *  - full: avaliação, ativa, aguardando pagamento, em atraso (carência) e cancelada até o fim do período.
 *  - read_only: suspensa, encerrada ou cancelada após o período. Consulta e exportação continuam disponíveis.
 *  Dados financeiros nunca são apagados automaticamente por inadimplência ou cancelamento.
 */
export function accessLevel(status: SubscriptionStatus, periodEnd: Date | null, now = new Date()): "full" | "read_only" {
  if (["trialing", "pending_payment", "active", "past_due"].includes(status)) return "full";
  if (status === "canceled" && periodEnd && periodEnd > now) return "full";
  return "read_only";
}

/** Receita recorrente mensal normalizada (anual / 12). */
export function monthlyValue(priceCents: number, interval: "monthly" | "yearly"): number {
  return interval === "yearly" ? Math.round(priceCents / 12) : priceCents;
}
