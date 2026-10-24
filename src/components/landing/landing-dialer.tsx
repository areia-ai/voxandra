"use client";

import { publicTranslatedTrialEnabled } from "@/lib/translated-trial";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, AudioLines, ChevronDown, FileCheck2, Languages, Phone, Sparkles, X } from "lucide-react";
import { SignupCallModal } from "@/components/landing/signup-call-modal";
import {
  formatRateCentsPerMinute,
  formatRateRangeCentsPerMinute,
  getDialerRoutePricing,
} from "@/lib/calling-rates";
import { compactDialerCountryLabel, dialerCountries, dialerCountryLabel } from "@/lib/countries";
import { loadRatePrefixTable } from "@/lib/rate-prefixes";
import {
  deserializeRatePrefixTable,
  describeResolvedRoute,
  resolveRateForDigits,
  type RatePrefixEntry,
} from "@/lib/rate-prefix-lookup";

export function LandingDialer() {
  const [countryCode, setCountryCode] = useState("+1");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalizedNumber = useMemo(() => `${countryCode} ${phoneDigits}`.trim(), [countryCode, phoneDigits]);
  const selectedCountryLabel = dialerCountryLabel(countryCode);
  const selectedCountryCompactLabel = compactDialerCountryLabel(countryCode, selectedCountryLabel);
  const routeLookupNumber = useMemo(
    () => `${countryCode}${phoneDigits.replace(/\D/g, "")}`,
    [countryCode, phoneDigits]
  );
  const routePricing = useMemo(() => getDialerRoutePricing(routeLookupNumber), [routeLookupNumber]);
  // The exact price depends on the number range, not the country — a Portuguese
  // landline is $0.06/min and a Portuguese mobile $1.00/min. The selected
  // country's prefix table is loaded on demand (0.1KB for the median country) so
  // the marketing page ships none of it until someone actually dials.
  // Keyed by country rather than reset per change, so switching back to a country
  // is instant and the effect never sets state synchronously.
  const [prefixTables, setPrefixTables] = useState<Record<string, RatePrefixEntry[]>>({});
  const destinationCountry = routePricing.destinationCountry;
  useEffect(() => {
    if (!destinationCountry || destinationCountry === "unknown") return;
    if (prefixTables[destinationCountry]) return;
    let cancelled = false;
    void loadRatePrefixTable(destinationCountry)
      .then((table) => {
        if (cancelled || !table) return;
        setPrefixTables((current) =>
          current[destinationCountry]
            ? current
            : { ...current, [destinationCountry]: deserializeRatePrefixTable(table) }
        );
      })
      // A failed chunk load must not break the dialer; the country range stays
      // as the fallback.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [destinationCountry, prefixTables]);
  const prefixEntries = destinationCountry ? prefixTables[destinationCountry] : undefined;

  const resolved = useMemo(
    () => (prefixEntries ? resolveRateForDigits(prefixEntries, routeLookupNumber) : null),
    [prefixEntries, routeLookupNumber]
  );

  // Until the typed number can only reach one price, show the country span. Going
  // straight to the longest-prefix match would display $0.06 at "+3519" and jump
  // to $1.00 at "+35191", which reads as a bait and switch.
  const countryRange = formatRateRangeCentsPerMinute(
    routePricing.rateCentsPerMinute,
    routePricing.maxRateCentsPerMinute
  );
  // Whole-country unavailability and a refused number range are different claims:
  // a UK premium number must not read as "the United Kingdom is unavailable".
  const countryUnavailable = routePricing.unavailable;
  const rangeRefused = !countryUnavailable && resolved?.status === "refused";
  const exactRate =
    resolved?.status === "resolved" ? formatRateCentsPerMinute(resolved.rateCentsPerMinute) : null;
  const routeLabel =
    resolved?.status === "resolved"
      ? describeResolvedRoute(routePricing.routeLabel, resolved.tier)
      : routePricing.routeLabel;

  const routeRateCopy = countryUnavailable
    ? `${routePricing.routeLabel} · not available for calling`
    : rangeRefused
      ? `${routePricing.routeLabel} · this number range is not available`
      : `${routeLabel} · ${exactRate ?? countryRange}`;
  const routeRateLabel = countryUnavailable
    ? `${routePricing.routeLabel} is not available for Voxandra calling`
    : rangeRefused
      ? `This ${routePricing.routeLabel} number range — premium or special-rate — is not available for Voxandra calling`
      : exactRate
        ? `Calling this ${routeLabel} number costs ${exactRate} from Voxandra calling credits`
        : `${routePricing.routeLabel} route costs ${countryRange} from Voxandra calling credits, depending on whether the number is a landline or a mobile`;

  function handleCountryChange(value: string) {
    setCountryCode(value);
  }

  return (
    <div id="hero-dialer" className="min-w-0 overflow-hidden rounded-2xl border landing-rule bg-white shadow-[var(--landing-shadow-focus)]">
      <section className="p-4 sm:p-5" aria-label="Try a call">
        <p className="text-sm font-semibold text-stone-950">Who will you call?</p>
        <div className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-2">
          <label className="relative flex h-11 items-center rounded-lg border border-stone-300 bg-[#fffaf4] px-3 pr-6 text-sm font-semibold text-stone-800 focus-within:ring-2 focus-within:ring-violet-500">
            <span className="sr-only">Country</span>
            <span aria-hidden="true" className="truncate">{selectedCountryCompactLabel}</span>
            <select value={countryCode} onChange={(event) => handleCountryChange(event.target.value)} title={selectedCountryLabel} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
              {dialerCountries.map(([code, label]) => <option key={`${label}-${code}`} value={code}>{label}</option>)}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 h-3 w-3" />
          </label>
          <label className="min-w-0">
            <span className="sr-only">Phone number</span>
            <input ref={inputRef} value={phoneDigits} onChange={(event) => setPhoneDigits(event.target.value.replace(/[^0-9*#+]/g, ""))} className="h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-950 outline-none focus:ring-2 focus:ring-violet-500" placeholder="Phone number" inputMode="tel" autoComplete="off" />
          </label>
          <button type="button" onClick={() => setPhoneDigits("")} className="flex h-11 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100" aria-label="Clear phone number"><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
        <p aria-live="polite" aria-label={routeRateLabel} className="mt-2 text-xs leading-5 text-stone-500">Calling rate: {routeRateCopy}</p>
        <button type="button" onClick={() => setModalOpen(true)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#3b1676] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2e1065]">
          Start a translated call <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
        <p className="mt-2 text-center text-xs leading-5 text-stone-500">{publicTranslatedTrialEnabled() ? "Sign in next. One free 90-second translated call." : "Sign in next, then choose a paid plan for translation."}</p>
      </section>
      <section aria-label="Translated call example" className="border-t landing-rule bg-[#f8f5fc] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 text-xs text-stone-500">
          <span className="font-semibold text-violet-950">Two languages. One conversation.</span>
          <span className="shrink-0">Product example</span>
        </div>
        <div className="my-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full border border-violet-100 bg-white text-xl">🇺🇸</span>
            <div><p className="text-sm font-semibold text-stone-950">You</p><p className="text-xs text-stone-500">English</p></div>
          </div>
          <div aria-hidden="true" className="flex flex-1 items-center justify-center gap-2 text-violet-400">
            <span className="h-px max-w-10 flex-1 bg-violet-200" /><AudioLines className="h-5 w-5" /><Phone className="h-4 w-4 text-violet-700" /><AudioLines className="h-5 w-5" /><span className="h-px max-w-10 flex-1 bg-violet-200" />
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right"><p className="text-sm font-semibold text-stone-950">Supplier</p><p className="text-xs text-stone-500">German</p></div>
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white text-xl">🇩🇪</span>
          </div>
        </div>
        <div className="grid gap-3 text-sm leading-5">
          <div className="mr-5 overflow-hidden rounded-2xl rounded-bl-sm border border-violet-200 bg-white">
            <div className="px-3 py-2.5">
              <p className="text-[11px] font-semibold text-violet-700">You say · English</p>
              <p className="mt-1 font-medium text-stone-950">What’s holding up payment?</p>
            </div>
            <div className="flex items-start gap-2 border-t border-violet-100 bg-violet-50/70 px-3 py-2.5">
              <Languages aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
              <div><p className="text-[11px] font-semibold text-violet-700">They hear · German</p><p lang="de" className="mt-0.5 text-violet-950">Was hält die Zahlung auf?</p></div>
            </div>
          </div>
          <div className="ml-5 overflow-hidden rounded-2xl rounded-br-sm border border-stone-200 bg-white">
            <div className="px-3 py-2.5">
              <p className="text-[11px] font-semibold text-stone-500">They reply in German</p>
              <p lang="de" className="mt-1 font-medium text-stone-950">Uns fehlt die Steuerbescheinigung.</p>
            </div>
            <div className="flex items-start gap-2 border-t border-stone-200 bg-[#fffaf4] px-3 py-2.5">
              <Languages aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
              <div><p className="text-[11px] font-semibold text-stone-500">You hear · English</p><p className="mt-0.5 text-stone-950">We’re missing the tax certificate.</p></div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-2 text-sm text-violet-950">
          <Sparkles aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p className="text-xs font-semibold">Private Guidance · paid plans</p><p className="mt-1">Confirm the PO number before you finish.</p></div>
        </div>
        <div className="mt-4 flex items-start gap-2 border-t border-violet-200 pt-3 text-sm">
          <FileCheck2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-1"><p className="font-semibold text-stone-900">Call Record</p><span className="text-xs font-medium text-violet-800">Ready for review</span></div>
            <p className="mt-1.5 leading-5 text-stone-600">PO-8842 · Tax certificate needed · Follow up by 3 PM</p>
          </div>
        </div>
      </section>
      <SignupCallModal open={modalOpen} phoneNumber={normalizedNumber} onClose={() => setModalOpen(false)} />
    </div>
  );
}
