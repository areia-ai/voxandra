import type { ReactNode } from "react";
import { AuthenticatedProviders } from "@/components/providers/authenticated-providers";

export default function JoinLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedProviders>{children}</AuthenticatedProviders>;
}
