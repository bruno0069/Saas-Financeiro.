import Link from "next/link";
import { ActionForm, Submit } from "@/components/forms";
import { Card } from "@/components/ui";
import { currentUser } from "@/server/web";
import { acceptInviteAction } from "../../(auth)/actions";

export const metadata = { title: "Convite" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await currentUser();
  const next = `/invite/${token}`;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-2 text-xl font-semibold">Convite para uma empresa</h1>
        {user ? (
          <>
            <p className="mb-4 text-sm text-gray-600">Você está conectado como <strong>{user.email}</strong>. O convite só pode ser aceito pela conta do e-mail convidado.</p>
            <ActionForm action={acceptInviteAction} resetOnSuccess={false}>
              <input type="hidden" name="token" value={token} />
              <Submit pendingText="Aceitando…">Aceitar convite</Submit>
            </ActionForm>
          </>
        ) : (
          <div className="space-y-3 text-sm text-gray-700">
            <p>Para aceitar, entre ou crie sua conta com o e-mail que recebeu o convite.</p>
            <div className="flex gap-3">
              <Link className="text-brand-700 underline" href={`/login?next=${encodeURIComponent(next)}`}>Entrar</Link>
              <Link className="text-brand-700 underline" href={`/signup?next=${encodeURIComponent(next)}`}>Criar conta</Link>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
