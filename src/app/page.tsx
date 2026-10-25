import type { Metadata } from "next";
import { FullLandingPage } from "@/components/landing/full-landing-page";

export const metadata: Metadata = {
  title: {
    absolute: "Live AI Voice Translation for Business Calls | Voxandra",
  },
  description:
    "Voxandra is an AI platform for multilingual business calls. It translates both sides of live phone conversations, provides private guidance while people talk, and turns each call into a reviewed Call Record. Open source under AGPL-3.0.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return <FullLandingPage />;
}
