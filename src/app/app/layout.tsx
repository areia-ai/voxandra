import { AppShell } from "@/components/layout/app-shell";
import { AuthenticatedProviders } from "@/components/providers/authenticated-providers";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthenticatedProviders>
      <AppShell>{children}</AppShell>
    </AuthenticatedProviders>
  );
}