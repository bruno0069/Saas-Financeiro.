import { logger } from "@/lib/logger";

export type Mail = { to: string; subject: string; text: string };

/**
 * Envio de e-mails. "console" existe apenas para desenvolvimento (imprime a mensagem no terminal
 * local). Em produção, sem provedor configurado, o envio falha de forma explícita.
 * PENDENTE: integração com provedor real (ex.: Resend/SMTP) — depende de credenciais.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const provider = process.env.MAIL_PROVIDER ?? "console";
  if (provider === "console") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MAIL_PROVIDER=console não é permitido em produção");
    }
    if (process.env.NODE_ENV !== "test") {
      console.log(`\n--- E-MAIL (dev) para ${mail.to} ---\nAssunto: ${mail.subject}\n\n${mail.text}\n--- fim ---\n`);
    }
    devOutbox.push(mail);
    if (devOutbox.length > 50) devOutbox.shift();
    return;
  }
  if (provider === "resend") {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY não configurada");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) {
      logger.error("mail send failed", { provider, status: res.status });
      throw new Error("Falha ao enviar e-mail");
    }
    return;
  }
  throw new Error(`MAIL_PROVIDER desconhecido: ${provider}`);
}

/** Caixa de saída em memória para testes/desenvolvimento. */
export const devOutbox: Mail[] = [];

export function appUrl(path: string): string {
  return new URL(path, process.env.APP_URL ?? "http://localhost:3000").toString();
}
