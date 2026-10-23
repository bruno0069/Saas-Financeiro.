"use server";

import { revalidatePath } from "next/cache";
import { adjustBalance, createAccount, updateAccount } from "@/domains/finance/accounts";
import { createCategory, updateCategory } from "@/domains/finance/categories";
import { createContact, updateContact } from "@/domains/finance/contacts";
import { createTransfer, reverseMovement } from "@/domains/finance/movements";
import { cancelTitle, createTitle, settleTitle, updateTitle } from "@/domains/finance/titles";
import { markOnboardingStep } from "@/domains/tenants/service";
import { formObject, tenantAction, type ActionState } from "@/server/web";

const done = (paths: string[]) => paths.forEach((p) => revalidatePath(p, "layout"));

export async function createTitleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const input = {
    ...d,
    settleNow: d.alreadySettled ? { accountId: d.settleAccountId, date: d.settleDate || d.dueDate, method: d.settleMethod || null } : null,
  };
  const r = await tenantAction(async (ctx) => {
    const ids = await createTitle(ctx, input);
    await markOnboardingStep(ctx, "first_entry");
    return ids;
  }, d.alreadySettled ? "Lançamento registrado e baixado." : "Lançamento registrado.");
  if (r.ok) done(["/app"]);
  return r;
}

export async function updateTitleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => updateTitle(ctx, formObject(fd)), "Título atualizado.");
  if (r.ok) done(["/app"]);
  return r;
}

export async function settleTitleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => settleTitle(ctx, formObject(fd)), "Baixa registrada.");
  if (r.ok) done(["/app"]);
  return r;
}

export async function cancelTitleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => cancelTitle(ctx, formObject(fd)), "Título cancelado.");
  if (r.ok) done(["/app"]);
  return r;
}

export async function reverseMovementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => reverseMovement(ctx, formObject(fd)), "Estorno registrado.");
  if (r.ok) done(["/app"]);
  return r;
}

export async function createAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction(async (ctx) => {
    const id = await createAccount(ctx, formObject(fd));
    await markOnboardingStep(ctx, "accounts");
    return id;
  }, "Conta cadastrada.");
  if (r.ok) done(["/app"]);
  return r;
}

export async function updateAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const r = await tenantAction((ctx) => updateAccount(ctx, { ...d, isActive: d.isActive === true }), "Conta atualizada.");
  if (r.ok) done(["/app"]);
  return r;
}

export async function transferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => createTransfer(ctx, formObject(fd)), "Transferência registrada.");
  if (r.ok) done(["/app"]);
  return r;
}

export async function adjustAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction((ctx) => adjustBalance(ctx, formObject(fd)), "Ajuste registrado.");
  if (r.ok) done(["/app"]);
  return r;
}

export async function createCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction(async (ctx) => {
    await createCategory(ctx, formObject(fd));
    await markOnboardingStep(ctx, "categories");
  }, "Categoria criada.");
  if (r.ok) done(["/app/categorias"]);
  return r;
}

export async function updateCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const r = await tenantAction(async (ctx) => {
    await updateCategory(ctx, { ...d, isActive: d.isActive === true });
    await markOnboardingStep(ctx, "categories");
  }, "Categoria atualizada.");
  if (r.ok) done(["/app/categorias"]);
  return r;
}

export async function saveContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const d = formObject(fd);
  const r = await tenantAction<unknown>((ctx) => (d.id ? updateContact(ctx, { ...d, isActive: d.isActive === true }) : createContact(ctx, d)), "Cadastro salvo.");
  if (r.ok) done(["/app/contatos"]);
  return r;
}
