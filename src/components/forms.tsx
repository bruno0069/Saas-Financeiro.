"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/server/web";
import { btn, cx, inputClass } from "./ui";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Formulário ligado a uma Server Action com mensagens de sucesso/erro e erros por campo.
 * A validação definitiva acontece sempre no servidor.
 */
export function ActionForm({
  action, children, className, resetOnSuccess = true, onSuccess, successMessage,
}: {
  action: Action;
  children: React.ReactNode | ((s: ActionState) => React.ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (s: ActionState) => void;
  successMessage?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stamp]);
  return (
    <form ref={ref} action={formAction} className={className} noValidate={false}>
      {typeof children === "function" ? children(state) : children}
      <FormMessage state={state} successMessage={successMessage} />
    </form>
  );
}

export function FormMessage({ state, successMessage }: { state: ActionState; successMessage?: string }) {
  if (state.error) {
    return <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>;
  }
  if (state.ok && (state.message || successMessage)) {
    return <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message ?? successMessage}</p>;
  }
  return null;
}

export function Submit({ children, variant = "primary", className, pendingText = "Salvando…" }: { children: React.ReactNode; variant?: keyof typeof btn; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={cx(btn[variant], className)}>
      {pending ? pendingText : children}
    </button>
  );
}

/** Botão de ação crítica com confirmação explícita (e motivo opcional). */
export function ConfirmAction({
  action, label, confirmText, hidden, variant = "danger", askReason, reasonLabel = "Motivo", small,
}: {
  action: Action; label: string; confirmText: string; hidden: Record<string, string>; variant?: keyof typeof btn;
  askReason?: boolean; reasonLabel?: string; small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, {});
  useEffect(() => { if (state.ok) setOpen(false); }, [state.stamp, state.ok]);
  if (!open) {
    return (
      <span className="inline-flex flex-col items-start">
        <button type="button" onClick={() => setOpen(true)} className={small ? btn.ghost : btn[variant === "danger" ? "secondary" : variant]}>{label}</button>
        {state.error && <span role="alert" className="mt-1 text-xs text-red-700">{state.error}</span>}
      </span>
    );
  }
  return (
    <form action={formAction} className="mt-2 w-full max-w-md space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="text-sm text-red-900">{confirmText}</p>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {askReason && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-800">{reasonLabel}</span>
          <input name="reason" required minLength={3} className={inputClass} autoFocus />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Submit variant={variant} pendingText="Processando…">Confirmar</Submit>
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>Voltar</button>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-800">{state.error}</p>}
    </form>
  );
}

export function MoneyInput({ name, defaultValue, required, id, placeholder = "0,00" }: { name: string; defaultValue?: string; required?: boolean; id?: string; placeholder?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-500">R$</span>
      <input id={id ?? name} name={name} inputMode="decimal" autoComplete="off" required={required} defaultValue={defaultValue}
        placeholder={placeholder} pattern="^-?[0-9.]*,?[0-9]{0,2}$|^-?[0-9]*\.?[0-9]{0,2}$" className={cx(inputClass, "pl-9 tabular")} />
    </div>
  );
}

/** Painel recolhível para formulários secundários (mantém a tela limpa). */
export function Disclosure({ summary, children, defaultOpen }: { summary: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-xl border border-gray-200 bg-white shadow-sm" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-gray-900 sm:px-5">
        {summary}
        <span className="text-gray-400 transition group-open:rotate-180" aria-hidden>▾</span>
      </summary>
      <div className="border-t border-gray-100 p-4 sm:p-5">{children}</div>
    </details>
  );
}
