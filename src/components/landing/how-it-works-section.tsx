"use client";

import { useRef, useState, useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";
import { motion, useReducedMotion } from "motion/react";
import { Reveal } from "@/components/landing/reveal";
import {
  Phone,
  FileSearch,
  BadgeCheck,
  FileText,
  CheckCircle2,
  FileCheck2,
  ListChecks,
  Languages,
  Bell,
  UserRoundCheck,
  FolderKanban,
  Users,
  Sparkles,
  ArrowRight,
  PhoneCall,
  Mic,
  Check,
  ChevronDown,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Stage = "setup" | "calling" | "processing" | "memory";

interface Step {
  id: Stage;
  number: string;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

interface ExtractionField {
  label: string;
  value: string;
  icon: React.ElementType;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const steps: Step[] = [
  {
    id: "setup",
    number: "01",
    title: "Choose your languages",
    description: "Pick both languages and dial their normal phone number.",
    icon: Phone,
    color: "#6d28d9",
    bgColor: "#f4efff",
  },
  {
    id: "calling",
    number: "02",
    title: "Talk naturally",
    description: "After a spoken notice, both sides hear translation; private Guidance helps you cover the details.",
    icon: FileSearch,
    color: "#7c3aed",
    bgColor: "#f4efff",
  },
  {
    id: "processing",
    number: "03",
    title: "Review what matters",
    description: "Check the bilingual transcript, notes, and follow-ups before accepting the Call Record.",
    icon: Sparkles,
    color: "#5b21b6",
    bgColor: "#f4efff",
  },
  {
    id: "memory",
    number: "04",
    title: "Pick up where you left off",
    description: "Find related calls, contacts, and open follow-ups together in the same work thread.",
    icon: BadgeCheck,
    color: "#4c1d95",
    bgColor: "#f4efff",
  },
];

const extractionFields: ExtractionField[] = [
  { label: "Institution", value: "Northstar Finance", icon: UserRoundCheck },
  { label: "Team", value: "AP Operations", icon: FolderKanban },
  { label: "Purchase order", value: "PO-8842", icon: FileCheck2 },
  { label: "Follow-up", value: "Upload certificate by 3 PM", icon: Bell },
  { label: "Blocker", value: "Payment held until tax certificate is uploaded", icon: CheckCircle2 },
  { label: "Participants", value: "Sofia -> Matthias @ Northstar Finance", icon: Users },
  { label: "Summary", value: "Payment approved; release waits on certificate.", icon: FileText },
  { label: "Action item", value: "Attach call to supplier payment thread", icon: ListChecks },
];

const transitionProps = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -12, scale: 0.98 },
  transition: { duration: 0.5, ease: "easeOut" as const },
};

// ─── Animation Components ───────────────────────────────────────────────────

function SoundWave() {
  return (
    <div className="flex items-center gap-[3px] h-6">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full bg-[#7c3aed]"
          animate={{ height: [8, 24 + i * 2, 8] }}
          transition={{
            duration: 0.6 + i * 0.1,
            repeat: Infinity,
            repeatType: "reverse",
            ease: "easeInOut",
            delay: i * 0.08,
          }}
        />
      ))}
    </div>
  );
}

function ScannerHighlight() {
  return (
    <motion.div
      className="absolute inset-0 bg-gradient-to-r from-transparent via-[#7c3aed]/8 to-transparent pointer-events-none"
      animate={{ x: ["-100%", "200%"] }}
      transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
    />
  );
}

// ─── Stage Components ───────────────────────────────────────────────────────

function StageSetup({ isActive }: { isActive: boolean }) {
  const [displayedNumber, setDisplayedNumber] = useState("");
  const [activeButton, setActiveButton] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(0);
  const hasCompletedRef = useRef(false);

  const fullNumber = "3012345678";
  const keypad = [
    { digit: "1", letters: "" },
    { digit: "2", letters: "ABC" },
    { digit: "3", letters: "DEF" },
    { digit: "4", letters: "GHI" },
    { digit: "5", letters: "JKL" },
    { digit: "6", letters: "MNO" },
    { digit: "7", letters: "PQRS" },
    { digit: "8", letters: "TUV" },
    { digit: "9", letters: "WXYZ" },
    { digit: "*", letters: "" },
    { digit: "0", letters: "" },
    { digit: "#", letters: "" },
  ];

  useEffect(() => {
    if (!isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (hasCompletedRef.current) return;

    indexRef.current = 0;
    setDisplayedNumber("");
    setActiveButton(null);

    const typingInterval = setInterval(() => {
      if (indexRef.current < fullNumber.length) {
        const char = fullNumber[indexRef.current];
        if (char !== undefined) {
          setDisplayedNumber((prev) => prev + char);
          
          if (/[0-9]/.test(char)) {
            setActiveButton(char);
            setTimeout(() => setActiveButton(null), 200);
          }
        }
        
        indexRef.current++;
      } else {
        clearInterval(typingInterval);
        intervalRef.current = null;
        hasCompletedRef.current = true;
        setTimeout(() => {
          setActiveButton("CALL");
          setTimeout(() => setActiveButton(null), 300);
        }, 500);
      }
    }, 400);

    intervalRef.current = typingInterval;

    return () => {
      clearInterval(typingInterval);
      intervalRef.current = null;
    };
  }, [isActive]);

  return (
    <motion.div {...transitionProps} className="space-y-3">
      <div className="rounded-2xl bg-white p-5 shadow-sm border border-stone-100">
        <div className="flex items-center justify-between mb-4">
          <span className="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-2 text-xs font-semibold text-green-600">
            Rate shown before you dial
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4efff] px-3 py-2 text-xs font-semibold text-[#3b1676]">
            <Sparkles className="h-3.5 w-3.5" />
            AI call record
          </span>
        </div>

        <div className="flex gap-2 mb-4">
          <div className="h-11 w-20 shrink-0 rounded-full bg-[#fffaf4] border border-stone-200 flex items-center justify-center text-sm font-semibold text-stone-700">
            DE +49
          </div>
          {/* min-w-0 + overflow-hidden + nowrap keep the typed number on one
              line inside the pill on narrow phones; the digits scale down
              below sm so the full number fits without spilling. */}
          <div className="flex-1 min-w-0 h-11 rounded-full bg-white border border-stone-200 flex items-center px-3 sm:px-4 overflow-hidden">
            <span className="font-mono text-sm sm:text-lg text-stone-950 whitespace-nowrap">
              {displayedNumber}
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
                className="inline-block w-0.5 h-4 sm:h-5 bg-[#7c3aed] ml-0.5 align-middle"
              />
            </span>
          </div>
          {displayedNumber.length > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100"
            >
              <span className="text-lg">×</span>
            </motion.button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 max-w-[16rem] mx-auto mb-4">
          {keypad.map((key) => (
            <motion.div
              key={key.digit}
              animate={{
                scale: activeButton === key.digit ? 0.9 : 1,
                backgroundColor: activeButton === key.digit ? "#e9d5ff" : "#f7f3ed",
                borderColor: activeButton === key.digit ? "#7c3aed" : "#e7e5e4",
              }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="flex h-12 w-12 items-center justify-center rounded-full border-2 shadow-sm cursor-default"
            >
              <motion.span 
                className="text-lg font-semibold text-stone-800"
                animate={{
                  color: activeButton === key.digit ? "#3b1676" : "#1c1917",
                }}
              >
                {key.digit}
              </motion.span>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3 max-w-[16rem] mx-auto items-end">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f7f3ed] text-xs font-semibold text-stone-700 border border-stone-200">
            ABC
          </div>
          <motion.div
            animate={{
              scale: activeButton === "CALL" ? 0.9 : 1,
              boxShadow: activeButton === "CALL"
                ? "0 4px 12px rgba(59, 22, 118, 0.4)"
                : "0 10px 15px -3px rgba(59, 22, 118, 0.2)",
            }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[#3b1676] text-white shadow-lg"
          >
            <PhoneCall className="h-6 w-6" />
          </motion.div>
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f7f3ed] text-stone-600 border border-stone-200">
            <span className="text-lg">⌫</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function StageCalling({ isActive }: { isActive: boolean }) {
  const fullTranscript = "PO-8842 is approved, but payment is blocked until your team uploads the updated tax certificate. Once it is in the portal, we can release the invoice today.";
  const [displayedText, setDisplayedText] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(0);
  const hasCompletedRef = useRef(false);

  useEffect(() => {
    if (!isActive) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (hasCompletedRef.current) return;

    indexRef.current = 0;
    setDisplayedText("");

    const typingInterval = setInterval(() => {
      if (indexRef.current < fullTranscript.length) {
        const char = fullTranscript[indexRef.current];
        if (char !== undefined) {
          setDisplayedText((prev) => prev + char);
        }
        indexRef.current++;
      } else {
        clearInterval(typingInterval);
        intervalRef.current = null;
        hasCompletedRef.current = true;
      }
    }, 35);

    intervalRef.current = typingInterval;

    return () => {
      clearInterval(typingInterval);
      intervalRef.current = null;
    };
  }, [isActive]);

  return (
    <motion.div {...transitionProps} className="space-y-4">
      <div className="rounded-xl bg-white p-4 shadow-sm border border-stone-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#f4efff]">
              <Phone className="h-4 w-4 text-[#6d28d9]" />
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold text-stone-900">Northstar Finance</p>
              <p className="text-xs text-stone-500">Supplier payment call</p>
            </div>
          </div>
          <span className="text-xs font-mono text-stone-400">03:18</span>
        </div>

        <div className="flex items-center justify-center gap-4 py-3 bg-[#fbfaf8] rounded-lg">
          <SoundWave />
          <span className="text-xs font-medium text-[#7c3aed]">Drafting note</span>
          <SoundWave />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-violet-100 bg-violet-50/80 p-3">
          <div className="flex items-center gap-2">
            <ListChecks aria-hidden="true" className="h-3.5 w-3.5 text-[#6d28d9]" />
            <span className="text-xs font-semibold text-[#4c1d95]">Live Guidance</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[#5b21b6]">
            Confirm the PO number before ending.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
          <div className="flex items-center gap-2">
            <Languages aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-xs font-semibold text-emerald-900">
              Live Translation
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-emerald-800">
            Spoken in German to Matthias. Captions here are for you.
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-[#faf8f4] p-3 border border-stone-100">
        <div className="flex items-center gap-2 mb-2">
          <Mic className="h-3 w-3 text-stone-400" />
          <span className="text-xs text-stone-400">Live captions · what Matthias said, in English</span>
        </div>
        <div className="rounded-lg border border-stone-100 bg-white px-3 py-2">
          <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-amber-700">
            Matthias · Northstar Finance
          </p>
          <p className="mt-1 text-xs text-stone-700 leading-relaxed">
            {displayedText}
            {displayedText.length < fullTranscript.length && (
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity }}
                className="inline-block w-0.5 h-3 bg-stone-400 ml-0.5 align-middle"
              />
            )}
          </p>
          <p className="mt-1 text-[0.68rem] italic leading-4 text-stone-400">
            PO-8842 ist genehmigt, aber die Zahlung ist blockiert, bis das
            aktualisierte Steuerzertifikat hochgeladen ist.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function ProcessingStepPills() {
  // Mirrors the calling → processing → ready pills the app shows for every
  // call, so the demo is recognizable inside the real product.
  const pills = [
    { label: "calling", state: "done" as const },
    { label: "processing", state: "active" as const },
    { label: "ready", state: "todo" as const },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {pills.map((pill, index) => (
        <div key={pill.label} className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.68rem] font-semibold capitalize ${
              pill.state === "active"
                ? "bg-violet-100 text-violet-800"
                : pill.state === "done"
                  ? "text-violet-700"
                  : "text-stone-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                pill.state === "active"
                  ? "animate-pulse bg-violet-500"
                  : pill.state === "done"
                    ? "bg-violet-500"
                    : "bg-stone-300"
              }`}
            />
            {pill.label}
          </span>
          {index < pills.length - 1 ? <span className="h-px w-4 bg-stone-200" /> : null}
        </div>
      ))}
    </div>
  );
}

function StageProcessing() {
  return (
    <motion.div {...transitionProps} className="space-y-4">
      <ProcessingStepPills />
      <div className="flex items-center gap-3 rounded-xl bg-[#f4efff] p-3">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <Sparkles className="h-5 w-5 text-[#7c3aed]" />
        </motion.div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-[#3b1676]">Review queue</p>
          <p className="text-xs text-[#6d28d9]">Confirm details before call record updates...</p>
        </div>
        <motion.div
          className="flex gap-1"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <span className="h-2 w-2 rounded-full bg-[#7c3aed]" />
          <span className="h-2 w-2 rounded-full bg-[#7c3aed]" />
          <span className="h-2 w-2 rounded-full bg-[#7c3aed]" />
        </motion.div>
      </div>

      <div className="relative rounded-xl bg-white p-4 shadow-sm border border-stone-100 overflow-hidden">
        <ScannerHighlight />
        <div className="flex items-center gap-2 mb-2">
          <FileText className="h-3.5 w-3.5 text-stone-400" />
          <span className="text-xs text-stone-400">Draft note</span>
        </div>
        <p className="text-xs text-stone-600 leading-relaxed relative z-10">
          Matthias at Northstar Finance confirmed PO-8842 is approved, but payment is blocked by an <span className="bg-[#f4efff] text-[#3b1676] px-1 rounded">updated tax certificate</span>. <span className="bg-[#f4efff] text-[#3b1676] px-1 rounded">Upload the certificate by 3 PM</span> and attach the response to the supplier payment thread.
        </p>
      </div>

      <div className="space-y-2">
        {["Payment blocker", "Follow-up", "Owner", "Thread suggestion"].map((item, i) => (
          <motion.div
            key={item}
            className="flex items-center gap-2"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.15 }}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: i * 0.15 + 0.2, type: "spring", stiffness: 300 }}
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            </motion.div>
            <span className="text-xs text-stone-600">{item}</span>
            <motion.div
              className="flex-1 h-1 bg-stone-100 rounded-full overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.15 }}
            >
              <motion.div
                className="h-full bg-[#7c3aed] rounded-full"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ delay: i * 0.15 + 0.1, duration: 0.5 }}
              />
            </motion.div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function StageMemory() {
  const compactFields = extractionFields.slice(0, 4);
  
  return (
    <motion.div {...transitionProps} className="space-y-3">
      <motion.div
        className="flex items-center gap-2 rounded-xl bg-green-50 p-3 border border-green-100"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, delay: 0.1 }}
        >
          <Check className="h-5 w-5 text-green-600" />
        </motion.div>
        <div>
          <p className="text-sm font-semibold text-green-800">Thread updated after review</p>
          <p className="text-xs text-green-600">4 confirmed details, 1 open follow-up</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-2.5">
        {compactFields.map((field, index) => {
          const Icon = field.icon;
          return (
            <motion.div
              key={field.label}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                delay: index * 0.08,
                type: "spring",
                stiffness: 200,
                damping: 20,
              }}
              className="flex flex-col gap-1.5 rounded-lg bg-white p-2.5 shadow-sm border border-stone-100"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#f4efff]">
                  <Icon className="h-3.5 w-3.5 text-[#7c3aed]" />
                </div>
                <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-stone-500">
                  {field.label}
                </span>
              </div>
              <p className="text-xs font-medium text-stone-800 leading-snug pl-8">{field.value}</p>
            </motion.div>
          );
        })}
      </div>

      <motion.div
        className="rounded-xl border border-stone-100 bg-white p-3 shadow-sm"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.42 }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-stone-500">Work thread</p>
            <h4 className="mt-1 text-sm font-semibold text-stone-950">
              Supplier payment release - Northstar
            </h4>
          </div>
          <span className="rounded-full bg-green-50 px-2.5 py-1 text-[0.65rem] font-semibold text-green-700">
            Active
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-[#fbfaf8] p-2">
            <p className="font-semibold text-stone-950">2 related calls</p>
            <p className="mt-1 text-stone-500">Matthias, Sofia</p>
          </div>
          <div className="rounded-lg bg-[#fbfaf8] p-2">
            <p className="font-semibold text-stone-950">1 open follow-up</p>
            <p className="mt-1 text-stone-500">Certificate due today</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-stone-600">
          Known from this thread: supplier, PO, blocker, owner, deadline.
        </p>
      </motion.div>

      <motion.div
        className="flex items-center justify-between rounded-xl bg-[#f4efff] border border-[#e9d5ff] p-3 text-[#3b1676]"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <span className="text-sm font-medium">Reviewed record saved</span>
        <div className="flex items-center gap-1 rounded-full bg-[#3b1676] px-3 py-1.5 text-xs font-semibold text-white">
          Review <ArrowRight className="h-3.5 w-3.5" />
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Demo Wrapper ───────────────────────────────────────────────────────────

function DemoCard({ children }: { children: React.ReactNode }) {
  // No AnimatePresence here on purpose: with mode="wait", a stage change that
  // lands while the previous stage is still exiting (easy to trigger with fast
  // scrolling or the #how-it-works anchor jump) deadlocks the swap and the
  // demo freezes on stage 1 forever. The keyed children still play their
  // entrance animation on every stage switch; the old stage simply unmounts.
  return (
    <div className="min-h-[31rem] rounded-[1.5rem] border border-[var(--landing-line)] bg-[#fbfaf8] p-4 shadow-[var(--landing-shadow-soft)] sm:p-5 md:min-h-[34rem] md:p-6">
      {children}
    </div>
  );
}

function getStageComponent(stage: Stage, isActive: boolean) {
  // Use stable keys to prevent remounting and state reset
  switch (stage) {
    case "setup":
      return <StageSetup key="setup-demo" isActive={isActive} />;
    case "calling":
      return <StageCalling key="calling-demo" isActive={isActive} />;
    case "processing":
      return <StageProcessing key="processing-demo" />;
    case "memory":
      return <StageMemory key="memory-demo" />;
  }
}

// ─── Step Card Component ────────────────────────────────────────────────────

function StepCard({
  step,
  isActive,
}: {
  step: Step;
  isActive: boolean;
}) {
  const Icon = step.icon;

  return (
    <div className={`border-l-2 py-2 pl-4 transition-colors md:pl-5 ${isActive ? "border-[#6d28d9]" : "border-stone-200"}`}>
      <div className="flex items-center gap-3">
        <span className={`font-mono text-xs font-semibold ${isActive ? "text-[#6d28d9]" : "text-stone-400"}`}>
          {step.number}
        </span>
        <Icon aria-hidden="true" className={`h-4 w-4 ${isActive ? "text-[#6d28d9]" : "text-stone-400"}`} />
        <h3 className={`text-base font-semibold md:text-lg ${isActive ? "text-stone-950" : "text-stone-500"}`}>
          {step.title}
        </h3>
      </div>
      <p className={`mt-2 text-sm leading-6 md:text-base ${isActive ? "text-stone-600" : "text-stone-400"}`}>
        {step.description}
      </p>
    </div>
  );
}

function WalkthroughCta() {
  return (
    <>
      <Link href="/login?redirect=/app/dialer" className="mt-6 inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-[#3b1676] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2e1065]">
        Start a translated call <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </Link>
      <p className="mt-3 text-sm leading-6 text-stone-500">
        {publicTranslatedTrialEnabled() ? "Sign in, choose both languages, and try one free 90-second translated call. No card required." : "Create a workspace, pick a plan, dial. The person you call needs nothing."}
      </p>
    </>
  );
}

function MobileStagePreview({ stage }: { stage: Stage }) {
  switch (stage) {
    case "setup":
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-stone-200 bg-white p-3"><p className="text-xs text-stone-500">You speak</p><p className="mt-1 text-base font-semibold text-stone-950">English</p></div>
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3"><p className="text-xs text-violet-700">They speak</p><p className="mt-1 text-base font-semibold text-violet-950">German</p></div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm font-semibold text-stone-950">Northstar Finance</p>
            <p className="mt-1 font-mono text-sm text-stone-600">+49 30 1234 5678</p>
            <p className="mt-3 border-t border-stone-100 pt-3 text-xs leading-5 text-stone-500">Calling rate shown before you dial.</p>
          </div>
          <p className="flex items-center gap-2 text-sm font-medium text-violet-900"><CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" /> Both languages selected</p>
        </div>
      );
    case "calling":
      return (
        <div className="space-y-3">
          <div className="mr-3 rounded-xl border border-violet-100 bg-violet-50 p-3">
            <p className="text-xs font-semibold text-violet-800">You say · English</p>
            <p className="mt-1 text-sm leading-6 text-stone-950">What’s holding up payment?</p>
            <div className="mt-2 border-t border-violet-200 pt-2"><p className="text-xs text-violet-700">They hear · German</p><p lang="de" className="mt-1 text-sm leading-6 text-violet-950">Was hält die Zahlung auf?</p></div>
          </div>
          <div className="ml-3 rounded-xl border border-stone-200 bg-white p-3">
            <p className="text-xs font-semibold text-stone-600">They say · German</p>
            <p lang="de" className="mt-1 text-sm leading-6 text-stone-950">Uns fehlt die Steuerbescheinigung.</p>
            <div className="mt-2 border-t border-stone-200 pt-2"><p className="text-xs text-stone-500">You hear · English</p><p className="mt-1 text-sm leading-6 text-stone-950">We’re missing the tax certificate.</p></div>
          </div>
          <p className="flex items-start gap-2 text-xs leading-5 text-violet-900"><Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span><span className="font-semibold">Private Guidance · paid plans</span><br />Confirm the PO number before you finish.</span></p>
        </div>
      );
    case "processing":
      return (
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-stone-950">Call Record draft</p><span className="text-xs font-medium text-violet-800">Ready for review</span></div>
          <p className="mt-3 text-sm leading-6 text-stone-700">Matthias confirmed PO-8842 is approved. Payment needs an updated tax certificate.</p>
          <dl className="mt-4 space-y-3 border-t border-stone-100 pt-3 text-sm">
            <div><dt className="text-xs text-stone-500">Next step</dt><dd className="mt-1 font-medium text-stone-900">Upload the certificate by 3 PM.</dd></div>
            <div><dt className="text-xs text-stone-500">Work thread</dt><dd className="mt-1 text-stone-700">Supplier payment release · Northstar</dd></div>
          </dl>
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-violet-800"><FileCheck2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />Check the transcript and correct the draft before accepting.</p>
        </div>
      );
    case "memory":
      return (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-green-800"><CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />Reviewed Call Record saved</p>
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-500">Work thread</p><p className="mt-1 text-sm font-semibold leading-6 text-stone-950">Supplier payment release · Northstar</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600"><span>2 related calls</span><span>1 open follow-up</span></div>
            <div className="mt-4 flex items-start gap-2 border-t border-stone-100 pt-3"><Bell aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-800" /><div><p className="text-sm font-medium text-stone-900">Upload the tax certificate</p><p className="mt-1 text-xs text-stone-500">Due today, 3 PM</p></div></div>
          </div>
          <p className="text-sm leading-6 text-stone-600">The next call starts with the context you’ve already reviewed.</p>
        </div>
      );
  }
}

function MobileWalkthrough({ reduceMotion }: { reduceMotion: boolean }) {
  const [activeStage, setActiveStage] = useState<Stage>("setup");
  const [hasInteracted, setHasInteracted] = useState(false);
  const buttonRefs = useRef<Partial<Record<Stage, HTMLButtonElement | null>>>({});
  const pendingFocus = useRef<Stage | null>(null);

  function selectStage(stage: Stage) {
    if (stage === activeStage) return;
    setHasInteracted(true);
    pendingFocus.current = stage;
    setActiveStage(stage);
  }

  useLayoutEffect(() => {
    if (pendingFocus.current !== activeStage) return;
    pendingFocus.current = null;
    const button = buttonRefs.current[activeStage];
    if (!button) return;
    button.focus({ preventScroll: true });
    const rect = button.getBoundingClientRect();
    // Collapsing the old panel can move the selected heading above the viewport.
    // Reposition only after an explicit tap/Next action, never on page scroll.
    if (rect.top < 112 || rect.top > window.innerHeight * 0.45) {
      button.scrollIntoView({ block: "start", behavior: reduceMotion ? "instant" : "smooth" });
    }
  }, [activeStage, reduceMotion]);

  return (
    <div className="mt-8 max-w-2xl lg:hidden" data-mobile-walkthrough>
      <p className="mb-4 text-sm text-stone-500">Tap a step to see it in action.</p>
      <div className="divide-y divide-[var(--landing-line)] border-y border-[var(--landing-line)]">
        {steps.map((step, index) => {
          const active = activeStage === step.id;
          const nextStep = steps[index + 1];
          return (
            <div key={step.id}>
              <h3>
                <button ref={(element) => { buttonRefs.current[step.id] = element; }} id={`mobile-step-${step.id}`} type="button" aria-expanded={active} aria-controls={`mobile-panel-${step.id}`} onClick={() => selectStage(step.id)} className="flex min-h-16 w-full scroll-mt-28 items-center gap-3 rounded-lg py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-700">
                  <span className={`font-mono text-xs font-semibold ${active ? "text-violet-700" : "text-stone-400"}`}>{step.number}</span>
                  <span className={`min-w-0 flex-1 text-base font-semibold ${active ? "text-stone-950" : "text-stone-600"}`}>{step.title}</span>
                  <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-violet-800 motion-safe:transition-transform ${active ? "rotate-180" : ""}`} />
                </button>
              </h3>
              <div id={`mobile-panel-${step.id}`} role="region" aria-labelledby={`mobile-step-${step.id}`} hidden={!active}>
                {active && (
                  <div className="pb-5">
                    <p className="mb-4 max-w-xl text-sm leading-6 text-stone-600">{step.description}</p>
                    <motion.div initial={hasInteracted && !reduceMotion ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }} className="rounded-2xl border border-[var(--landing-line)] bg-[#fbfaf8] p-4 sm:p-5">
                      <p className="mb-4 text-xs font-medium text-stone-500">Illustrative example · {index + 1} of {steps.length}</p>
                      <MobileStagePreview stage={step.id} />
                    </motion.div>
                    <button type="button" onClick={() => selectStage(nextStep?.id ?? "setup")} className="mt-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-md py-2 text-left text-sm font-semibold text-violet-800 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-700">
                      <span>{nextStep ? `Next: ${nextStep.title}` : "Back to the first step"}</span><ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <WalkthroughCta />
    </div>
  );
}

// ─── Main Section ───────────────────────────────────────────────────────────

export function HowItWorksSection() {
  const [activeStage, setActiveStage] = useState<Stage>("setup");
  const [isDesktop, setIsDesktop] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const stepRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reduceMotion = useReducedMotion();
  const displayedStage: Stage = reduceMotion ? "memory" : activeStage;

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const syncViewport = () => setIsDesktop(query.matches);
    syncViewport();
    query.addEventListener("change", syncViewport);
    return () => query.removeEventListener("change", syncViewport);
  }, []);

  // Track section visibility
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const desktopQuery = window.matchMedia("(min-width: 1024px)");

    const updateStageFromScroll = () => {
      if (!desktopQuery.matches) return;
      const focusLine = window.innerHeight * 0.46;
      let closestStage = steps[0].id;
      let closestDistance = Number.POSITIVE_INFINITY;

      stepRefs.current.forEach((element, index) => {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - focusLine);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestStage = steps[index].id;
        }
      });

      setActiveStage((current) => current === closestStage ? current : closestStage);
    };

    window.addEventListener("scroll", updateStageFromScroll, { passive: true });
    desktopQuery.addEventListener("change", updateStageFromScroll);
    updateStageFromScroll();

    return () => {
      window.removeEventListener("scroll", updateStageFromScroll);
      desktopQuery.removeEventListener("change", updateStageFromScroll);
    };
  }, [reduceMotion]);

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      className="relative border-y landing-rule bg-white/45"
    >
      <div className="landing-section relative mx-auto max-w-7xl px-5 md:px-8">
        <Reveal className="max-w-3xl">
          <p className="landing-eyebrow"><span className="landing-eyebrow-index">01</span>How it works</p>
          <h2 className="mt-4 text-4xl font-semibold leading-[1.02] tracking-[-0.035em] text-stone-950 md:text-6xl">
            One call. <span className="font-editorial italic font-medium tracking-[-0.02em]">Less to carry.</span>
          </h2>
          <p className="mt-4 text-base leading-7 text-stone-600 md:text-lg">
            See a supplier call become a clear next step.
          </p>
        </Reveal>

        {!isDesktop && <MobileWalkthrough reduceMotion={Boolean(reduceMotion)} />}

        <div className="mt-10 hidden items-start gap-8 lg:grid lg:grid-cols-[0.78fr_1.22fr] lg:gap-14">
          <div className="flex flex-col gap-1 lg:pb-48">
            {steps.map((step, index) => (
              <button
                key={step.id}
                ref={(element) => {
                  stepRefs.current[index] = element;
                }}
                type="button"
                aria-pressed={displayedStage === step.id}
                onClick={() => setActiveStage(step.id)}
                className="rounded-r-xl py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 lg:flex lg:min-h-[18rem] lg:items-center"
              >
                <StepCard step={step} isActive={displayedStage === step.id} />
              </button>
            ))}
            <WalkthroughCta />
          </div>

          <div className="min-w-0 lg:sticky lg:top-24" aria-live="polite">
            <DemoCard>
              {isDesktop && getStageComponent(displayedStage, isInView)}
            </DemoCard>
          </div>
        </div>
      </div>
    </section>
  );
}
