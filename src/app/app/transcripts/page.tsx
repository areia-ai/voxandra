import { redirect } from "next/navigation";

export default function TranscriptsRedirectPage() {
  redirect("/app/memory?view=transcript");
}
