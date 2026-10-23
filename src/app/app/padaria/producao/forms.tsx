"use client";

import { useState } from "react";
import { ActionForm, MoneyInput, Submit } from "@/components/forms";
import { Field, btn, inputClass } from "@/components/ui";
import { registerLossAction, saveIngredientAction, saveProductAction } from "../actions";

type Ing = { id: string; name: string; unit: string };

export function IngredientForm() {
  return (
    <ActionForm action={saveIngredientAction} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <Field label="Insumo" name="name" required><input id="ing-name" name="name" required maxLength={80} className={inputClass} placeholder="Farinha de trigo" /></Field>
      <Field label="Unidade" name="unit" required>
        <select name="unit" defaultValue="kg" className={inputClass}>{["kg", "g", "l", "ml", "un"].map((u) => <option key={u}>{u}</option>)}</select>
      </Field>
      <Field label="Quantidade da embalagem" name="packQuantity" required hint="Ex.: 25 (saco de 25 kg)"><input name="packQuantity" required inputMode="decimal" className={inputClass} /></Field>
      <Field label="Preço pago pela embalagem" name="packCost" required><MoneyInput name="packCost" required /></Field>
      <div className="sm:col-span-4"><Submit>Adicionar insumo</Submit></div>
    </ActionForm>
  );
}

export function ProductForm({ ingredients }: { ingredients: Ing[] }) {
  const [rows, setRows] = useState(1);
  return (
    <ActionForm action={saveProductAction} onSuccess={() => setRows(1)} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Field label="Produto" name="name" required><input id="prod-name" name="name" required maxLength={80} className={inputClass} placeholder="Pão francês" /></Field>
        <Field label="Unidade de venda" name="saleUnit" required>
          <select name="saleUnit" defaultValue="un" className={inputClass}><option value="un">unidade</option><option value="kg">kg</option><option value="cento">cento</option><option value="fatia">fatia</option></select>
        </Field>
        <Field label="Preço de venda" name="salePrice" required><MoneyInput name="salePrice" required /></Field>
        <Field label="Rendimento da receita" name="yieldQuantity" required hint="Quantas unidades de venda a receita produz"><input name="yieldQuantity" required inputMode="decimal" className={inputClass} /></Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Ficha técnica (insumos por receita)</legend>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <select name="ingredientId[]" aria-label={`Insumo ${i + 1}`} className={`${inputClass} w-auto min-w-48 flex-1`} defaultValue="">
              <option value="">Selecione o insumo…</option>
              {ingredients.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}
            </select>
            <input name="quantity[]" aria-label={`Quantidade ${i + 1}`} inputMode="decimal" placeholder="Quantidade" className={`${inputClass} w-32`} />
          </div>
        ))}
        <button type="button" onClick={() => setRows((r) => Math.min(60, r + 1))} className={btn.ghost}>+ Adicionar insumo</button>
      </fieldset>
      <Submit>Salvar produto</Submit>
    </ActionForm>
  );
}

export function LossForm({ products, today }: { products: { id: string; name: string }[]; today: string }) {
  return (
    <ActionForm action={registerLossAction} className="grid grid-cols-1 gap-4 sm:grid-cols-5">
      <Field label="Data" name="lossDate" required><input name="lossDate" type="date" max={today} defaultValue={today} required className={inputClass} /></Field>
      <Field label="Produto" name="productId" required>
        <select name="productId" required defaultValue="" className={inputClass}><option value="" disabled>Selecione…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </Field>
      <Field label="Quantidade" name="quantity" required><input name="quantity" required inputMode="decimal" className={inputClass} /></Field>
      <Field label="Motivo" name="reason" required>
        <select name="reason" defaultValue="sobra" className={inputClass}><option value="sobra">Sobra do dia</option><option value="queimado">Queimado</option><option value="vencido">Vencido</option><option value="avaria">Avaria</option><option value="outro">Outro</option></select>
      </Field>
      <div className="flex items-end"><Submit>Registrar perda</Submit></div>
    </ActionForm>
  );
}
