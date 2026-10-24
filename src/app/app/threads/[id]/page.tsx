import { CaseDetailClient } from "@/components/cases/case-detail-client";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CaseDetailClient id={id} />;
}
