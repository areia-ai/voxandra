"use client";

import Link from "next/link";
import { ArrowRight, PhoneCall } from "lucide-react";
import { useState } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useMotionValueEvent,
  useTransform,
} from "motion/react";
import { VoxandraLogo } from "@/components/brand/voxandra-logo";
import { useSignedInHint } from "@/components/landing/use-signed-in-hint";

export function LandingHeader() {
  const prefersReducedMotion = useReducedMotion();
  const [isScrolled, setIsScrolled] = useState(false);
  const { scrollY } = useScroll();
  // Returning customers with a live session get one clear "Open dashboard"
  // action instead of Sign in + Free call. Until the session check resolves
  // we render the signed-out pair so first paint matches the static HTML.
  const isAuthenticated = useSignedInHint();

  const baseOpacity = useTransform(scrollY, [0, 8, 64, 180], [0, 0.18, 0.34, 0.52]);
  const crystalOpacity = useTransform(scrollY, [0, 64, 120, 220], [0, 0.08, 0.28, 1]);

  const headerAnimate = isScrolled
    ? {
        borderBottomLeftRadius: "1.5rem",
        borderBottomRightRadius: "1.5rem",
        borderColor: "rgba(59, 22, 118, 0.08)",
        backgroundColor: "rgba(255, 250, 244, 0.9)",
        boxShadow:
          "0 8px 30px rgba(124, 58, 237, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)",
        backdropFilter: "blur(6px) saturate(135%)",
        WebkitBackdropFilter: "blur(6px) saturate(135%)",
      }
    : {
        borderBottomLeftRadius: "0rem",
        borderBottomRightRadius: "0rem",
        borderColor: "rgba(59, 22, 118, 0)",
        backgroundColor: "rgba(255, 250, 244, 0)",
        boxShadow: "none",
        backdropFilter: "blur(0px) saturate(100%)",
        WebkitBackdropFilter: "blur(0px) saturate(100%)",
      };

  useMotionValueEvent(scrollY, "change", (latest) => {
    // Hysteresis band instead of one 48px trip point: a single threshold
    // flips back and forth on the smallest scroll jitter (momentum/rubber-
    // banding, or a layout-triggered scroll adjustment elsewhere on the
    // page), and each flip restarts the header's backdrop-filter/box-shadow
    // transition — that repeated restart is what read as the header
    // "blinking and flashing" while scrolling.
    setIsScrolled((prev) => (prev ? latest > 24 : latest > 64));
  });

  return (
    <div className="relative z-30 h-[5.25rem]">
      <motion.header
        aria-label="Site header"
        animate={headerAnimate}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        // Forces its own compositing layer so Safari doesn't have to
        // re-sample the blurred backdrop-filter every time something below
        // it repaints (e.g. a card's box-shadow animating in) — that
        // resampling is the other half of the flashing/flicker report.
        style={{ transform: "translateZ(0)", WebkitTransform: "translateZ(0)" }}
        className="fixed inset-x-0 z-50 mx-auto flex max-w-[96rem] items-center overflow-hidden border border-[#3b1676]/0 bg-[#fffaf4]/90 backdrop-blur-sm"
      >
        <motion.div
          aria-hidden="true"
          style={{ opacity: prefersReducedMotion ? (isScrolled ? 0.52 : 0) : baseOpacity }}
          className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgba(255,250,244,0.54),rgba(250,248,244,0.24)),radial-gradient(circle_at_75%_10%,rgba(124,58,237,0.10),transparent_44%),linear-gradient(110deg,rgba(255,255,255,0.22),rgba(255,255,255,0.04)_42%,rgba(34,197,94,0.05)_74%,rgba(255,250,244,0.18))]"
        />
        <motion.div
          aria-hidden="true"
          style={{ opacity: prefersReducedMotion ? (isScrolled ? 1 : 0) : crystalOpacity }}
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
        >
          <span className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(112deg,rgba(255,255,255,0.34),rgba(255,255,255,0.03)_26%,rgba(124,58,237,0.10)_52%,rgba(34,197,94,0.08)_70%,rgba(255,255,255,0.24))]" />
        </motion.div>

        <motion.div
          className="relative z-10 flex w-full origin-center items-center justify-between px-5 md:px-8 py-3"
        >
          <div>
            <VoxandraLogo href="/" />
          </div>
          <nav className="flex items-center gap-2">
            <Link
              href="#pricing"
              className="hidden rounded-md px-3 py-2 text-sm font-semibold text-[#2e1065] transition hover:bg-white/55 hover:text-[#1f0b49] md:inline-flex"
            >
              Pricing
            </Link>
            <Link
              href="#faq"
              className="hidden rounded-md px-3 py-2 text-sm font-semibold text-[#2e1065] transition hover:bg-white/55 hover:text-[#1f0b49] md:inline-flex"
            >
              FAQ
            </Link>
            <Link
              href="/blog"
              className="hidden rounded-md px-3 py-2 text-sm font-semibold text-[#2e1065] transition hover:bg-white/55 hover:text-[#1f0b49] md:inline-flex"
            >
              Blog
            </Link>
            {isAuthenticated ? (
              <Link
                href="/app"
                className="inline-flex items-center gap-2 rounded-md bg-[#3b1676] px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-950/10 transition hover:bg-[#2e1065] focus:outline-none focus:ring-4 focus:ring-violet-200/80"
              >
                Open dashboard
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login?mode=signIn"
                  className="inline-flex rounded-md border border-[#3b1676]/15 bg-white/45 px-3 py-2 text-sm font-semibold text-[#2e1065] shadow-sm shadow-violet-950/5 backdrop-blur-sm transition hover:border-[#3b1676]/25 hover:bg-white/75 hover:text-[#1f0b49] focus:outline-none focus:ring-4 focus:ring-violet-200/80 sm:px-4"
                >
                  Sign in
                </Link>
                <Link
                  href="/login?redirect=/app/dialer"
                  aria-label="Start a translated call"
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#3b1676] px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-950/10 transition hover:bg-[#2e1065] focus:outline-none focus:ring-4 focus:ring-violet-200/80 sm:gap-2 sm:px-4"
                >
                  {/* On phones the header CTA collapses to phone + arrow — the
                      landing has plenty of labeled CTAs below, and
                      this keeps room for Sign in. */}
                  <PhoneCall aria-hidden="true" className="h-4 w-4 sm:hidden" />
                  <span className="hidden sm:inline">Start a translated call</span>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </>
            )}
          </nav>
        </motion.div>
      </motion.header>
    </div>
  );
}
