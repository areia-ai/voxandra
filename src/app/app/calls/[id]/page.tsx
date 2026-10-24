import { CallDetailClient } from "@/components/calls/call-detail-client";

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CallDetailClient id={id} />;
}
