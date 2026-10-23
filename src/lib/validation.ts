import { z } from "zod";
import { ValidationError } from "./errors";
import { parseBRL } from "./money";
import { isIsoDate } from "./dates";

/** Valor monetário positivo vindo de formulário ("1.234,56") ou número inteiro em centavos. */
export const moneyPositive = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const cents = typeof v === "number" ? v : parseBRL(v);
  if (cents === null || !Number.isSafeInteger(cents) || cents <= 0) {
    ctx.addIssue({ code: "custom", message: "Informe um valor maior que zero" });
    return z.NEVER;
  }
  if (cents > 100_000_000_000) {
    ctx.addIssue({ code: "custom", message: "Valor acima do permitido" });
    return z.NEVER;
  }
  return cents;
});

/** Valor monetário que pode ser zero ou negativo (ex.: saldo inicial). */
export const moneyAny = z.union([z.string(), z.number()]).transform((v, ctx) => {
  if (v === "" || v == null) return 0;
  const cents = typeof v === "number" ? v : parseBRL(v);
  if (cents === null || !Number.isSafeInteger(cents) || Math.abs(cents) > 100_000_000_000) {
    ctx.addIssue({ code: "custom", message: "Valor inválido" });
    return z.NEVER;
  }
  return cents;
});

export const moneyNonNegative = moneyAny.refine((v) => v >= 0, "Valor não pode ser negativo");

export const isoDate = z.string().trim().refine(isIsoDate, "Data inválida");
export const uuid = z.uuid("Identificador inválido");
export const optionalUuid = z
  .union([z.literal(""), z.uuid("Identificador inválido")])
  .nullish()
  .transform((v) => (v ? v : null));
export const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim().slice(0, max) : null));

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of r.error.issues) {
      const k = i.path.join(".") || "_";
      fieldErrors[k] ??= i.message;
    }
    throw new ValidationError(r.error.issues[0].message, fieldErrors);
  }
  return r.data;
}
