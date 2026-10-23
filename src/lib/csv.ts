/** Gera CSV compatível com Excel em pt-BR (separador ";", BOM UTF-8) com proteção contra injeção de fórmulas. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map((r) => r.map(esc).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function centsToCsv(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
