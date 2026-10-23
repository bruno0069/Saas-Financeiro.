export const ACCOUNT_KIND_LABELS: Record<string, string> = {
  cash: "Caixa físico",
  checking: "Conta corrente",
  savings: "Poupança/aplicação",
  digital_wallet: "Carteira digital",
  card_receivables: "Recebíveis de cartão",
  other: "Outra",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Dinheiro",
  pix: "PIX",
  debit_card: "Cartão de débito",
  credit_card: "Cartão de crédito",
  voucher: "Vale-refeição/alimentação",
  boleto: "Boleto",
  bank_transfer: "Transferência bancária",
  other: "Outro",
};

export const MOVEMENT_KIND_LABELS: Record<string, string> = {
  opening_balance: "Saldo inicial",
  settlement: "Baixa de título",
  transfer: "Transferência",
  adjustment: "Ajuste",
  reversal: "Estorno",
};

export const TITLE_STATUS_LABELS: Record<string, string> = {
  open: "Em aberto",
  partial: "Parcial",
  paid: "Quitado",
  canceled: "Cancelado",
  overdue: "Vencido",
};
