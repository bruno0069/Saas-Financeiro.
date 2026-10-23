"use server";

import { revalidatePath } from "next/cache";
import * as caixa from "@/domains/padaria/caixa";
import * as producao from "@/domains/padaria/producao";
import { formObject, tenantAction, type ActionState } from "@/server/web";

const refresh = () => revalidatePath("/app", "layout");

export async function createClosingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => caixa.createClosing(ctx, formObject(fd)), "Fechamento registrado e lançado no financeiro.");
  if (r.ok) refresh();
  return r;
}

export async function reverseClosingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => caixa.reverseClosing(ctx, formObject(fd)), "Fechamento estornado.");
  if (r.ok) refresh();
  return r;
}

export async function saveCaixaSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => caixa.saveSettings(ctx, formObject(fd)), "Configurações salvas.");
  if (r.ok) refresh();
  return r;
}

export async function confirmCardAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => caixa.confirmCardSettlement(ctx, formObject(fd)), "Repasse confirmado.");
  if (r.ok) refresh();
  return r;
}

export async function saveIngredientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => producao.saveIngredient(ctx, formObject(fd)), "Insumo salvo.");
  if (r.ok) refresh();
  return r;
}

export async function saveProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const ids = (d.ingredientId as string[] | undefined) ?? [];
  const qtys = (d.quantity as string[] | undefined) ?? [];
  const items = ids.map((ingredientId, i) => ({ ingredientId, quantity: qtys[i] })).filter((x) => x.ingredientId && x.quantity);
  const r = await tenantAction((ctx) => producao.saveProduct(ctx, { ...d, items }), "Produto salvo.");
  if (r.ok) refresh();
  return r;
}

export async function registerLossAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => producao.registerLoss(ctx, formObject(fd)), "Perda registrada.");
  if (r.ok) refresh();
  return r;
}
