import { redirect } from "next/navigation";

// Call history is consolidated into Call Records. Individual call records
// still live at /app/calls/[id].
export default function CallsRedirectPage() {
  redirect("/app/memory");
}
