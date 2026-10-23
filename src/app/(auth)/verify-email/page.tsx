import Link from "next/link";
import { verifyEmail } from "@/server/auth/service";
import { Alert } from "@/components/ui";

export const metadata = { title: "Confirmação de e-mail" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const ok = token ? await verifyEmail(token) : false;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Confirmação de e-mail</h1>
      {ok ? <Alert tone="success">E-mail confirmado com sucesso.</Alert> : <Alert tone="danger">Link inválido ou expirado. Entre e solicite um novo link.</Alert>}
      <Link href="/onboarding" className="inline-block text-brand-700 hover:underline">Continuar</Link>
    </div>
  );
}
