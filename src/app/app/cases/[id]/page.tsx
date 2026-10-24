import { redirect } from "next/navigation";

// Legacy route: threads (formerly "cases") now live at /app/threads.
export default async function CaseRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/app/threads/${id}`);
}
