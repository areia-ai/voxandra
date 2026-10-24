import type { Metadata } from "next";
import { ComparisonPage } from "@/components/compare/comparison-page";
import { microsoftTeamsPhoneComparison } from "@/components/compare/competitors/microsoft-teams-phone";

export const metadata: Metadata = {
  title: microsoftTeamsPhoneComparison.metaTitle,
  description: microsoftTeamsPhoneComparison.metaDescription,
  alternates: {
    canonical: "/compare/microsoft-teams-phone",
  },
  openGraph: {
    title: microsoftTeamsPhoneComparison.metaTitle,
    description: microsoftTeamsPhoneComparison.metaDescription,
  },
  twitter: {
    title: microsoftTeamsPhoneComparison.metaTitle,
    description: microsoftTeamsPhoneComparison.metaDescription,
  },
};

export default function MicrosoftTeamsPhoneComparisonPage() {
  return <ComparisonPage data={microsoftTeamsPhoneComparison} />;
}
