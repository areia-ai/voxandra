import { redirect } from "next/navigation";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app/calls/${id}`);
}
