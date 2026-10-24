import { redirect } from "next/navigation";

// Legacy route: threads (formerly "cases") now live at /app/threads.
export default function CasesRedirectPage() {
  redirect("/app/threads");
}
