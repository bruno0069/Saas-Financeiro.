/** Valores monetários são sempre inteiros em centavos. */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number): string {
  return brl.format(cents / 100);
}

/**
 * Converte texto digitado ("1.234,56", "1234.56", "R$ 10") em centavos.
 * Retorna null quando o valor é inválido.
 */
export function parseBRL(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!s) return null;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [int, frac = ""] = s.split(".");
  const cents = Number(int) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Divide um valor em n parcelas; a diferença de arredondamento vai para a primeira parcela. */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("Número de parcelas inválido");
  const base = Math.floor(totalCents / count);
  const rest = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + rest : base));
}

/** Aplica taxa em pontos-base (1% = 100) com arredondamento comercial. */
export function applyBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10000);
}
