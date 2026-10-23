import { TitlesPage } from "@/components/titles-page";

export const metadata = { title: "Contas a receber" };

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <TitlesPage direction="receivable" searchParams={await searchParams} />;
}
