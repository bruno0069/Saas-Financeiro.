"use client";

import { ActionForm, ConfirmAction, Submit } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, type Role, type Permission } from "@/domains/access/permissions";
import { inviteAction, removeMemberAction, revokeInviteAction, transferOwnershipAction, updateMemberAction } from "../actions";

export function InviteForm() {
  return (
    <ActionForm action={inviteAction} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field label="E-mail" name="email" required><input id="invite-email" name="email" type="email" required className={inputClass} /></Field>
      <Field label="Função" name="role" required>
        <select name="role" defaultValue="operator" className={inputClass}>
          {(["manager", "finance", "operator"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </Field>
      <div className="flex items-end"><Submit>Enviar convite</Submit></div>
    </ActionForm>
  );
}

export function MemberEditor({ m, grantable }: { m: { id: string; role: Role; extra_permissions: string[]; revoked_permissions: string[] }; grantable: Permission[] }) {
  const base = new Set(ROLE_PERMISSIONS[m.role]);
  return (
    <ActionForm action={updateMemberAction} resetOnSuccess={false} className="space-y-3">
      <input type="hidden" name="membershipId" value={m.id} />
      <Field label="Função" name="role" required>
        <select name="role" defaultValue={m.role} className={`${inputClass} w-auto`}>
          {(["manager", "finance", "operator"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Ajustes de permissão (sobre a função atual)</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {grantable.map((p) => base.has(p) ? (
            <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" name="revoked[]" value={p} defaultChecked={m.revoked_permissions.includes(p)} /> Remover: {PERMISSIONS[p]}</label>
          ) : (
            <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" name="extra[]" value={p} defaultChecked={m.extra_permissions.includes(p)} /> Conceder: {PERMISSIONS[p]}</label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Submit variant="secondary">Salvar permissões</Submit>
      </div>
    </ActionForm>
  );
}

export function RemoveMember({ id }: { id: string }) {
  return <ConfirmAction action={removeMemberAction} label="Remover acesso" confirmText="O usuário perderá o acesso à empresa. Lançamentos feitos por ele serão preservados." hidden={{ membershipId: id }} />;
}

export function RevokeInvite({ id }: { id: string }) {
  return <ConfirmAction action={revokeInviteAction} label="Revogar" small confirmText="O link do convite deixará de funcionar." hidden={{ id }} />;
}

export function TransferOwnership({ members, tenantName }: { members: { id: string; name: string }[]; tenantName: string }) {
  return (
    <ActionForm action={transferOwnershipAction} className="space-y-3">
      <Field label="Novo proprietário" name="membershipId" required>
        <select name="membershipId" required defaultValue="" className={inputClass}><option value="" disabled>Selecione…</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      </Field>
      <Field label={`Para confirmar, digite o nome da empresa: ${tenantName}`} name="confirmName" required>
        <input name="confirmName" required autoComplete="off" className={inputClass} />
      </Field>
      <p className="text-xs text-gray-600">Você passará a ser Gerente. Esta ação é registrada na auditoria.</p>
      <Submit variant="danger">Transferir propriedade</Submit>
    </ActionForm>
  );
}
