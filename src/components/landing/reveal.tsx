"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Scroll-triggered staggered reveal for a section's heading group (the
// transitions.dev texts reveal; styles in globals.css). Only groups that are
// still below the fold on mount are armed, so the server HTML never hides
// anything and content already on screen never flashes.
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (element.getBoundingClientRect().top < window.innerHeight) return;

    element.classList.add("is-armed");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        element.classList.add("is-shown");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`t-stagger ${className}`}>
      {children}
    </div>
  );
}
