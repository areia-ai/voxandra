import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { EthereumFix } from "@/components/ethereum-fix";
import { SessionIdentityBridge } from "@/components/providers/session-identity-bridge";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://voxandra.com"),
  title: {
    default: "Live AI Voice Translation for Business Calls | Voxandra",
    template: "%s | Voxandra",
  },
  description:
    "Voxandra is an AI platform for multilingual business calls. It translates both sides of live phone conversations, provides private guidance while people talk, and turns each call into a reviewed Call Record.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/voxandra-favicon-16.png", type: "image/png", sizes: "16x16" },
      { url: "/brand/voxandra-favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/brand/voxandra-favicon-48.png", type: "image/png", sizes: "48x48" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    // og:type is one of the four metadata signals agents use for entity
    // resolution (with canonical, html lang, and og:image). Post pages
    // override this with "article" in their own metadata.
    type: "website",
    url: "/",
    locale: "en_US",
    title: "Live AI Voice Translation for Business Calls | Voxandra",
    description:
      "Speak your language. They hear theirs. Keep the reviewed Call Record.",
    siteName: "Voxandra",
  },
  twitter: {
    card: "summary_large_image",
    title: "Live AI Voice Translation for Business Calls | Voxandra",
    description:
      "Speak your language. They hear theirs. Keep the reviewed Call Record.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <EthereumFix />
        <SessionIdentityBridge />
        {children}
      </body>
    </html>
  );
}
