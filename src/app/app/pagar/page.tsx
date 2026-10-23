import { TitlesPage } from "@/components/titles-page";

export const metadata = { title: "Contas a pagar" };

export default async function PayablesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <TitlesPage direction="payable" searchParams={await searchParams} />;
}
