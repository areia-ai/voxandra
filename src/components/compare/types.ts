export interface ComparisonPoint {
  title: string;
  description: string;
}

export interface ComparisonRow {
  dimension: string;
  competitor: string;
  voxandra: string;
}

export interface ComparisonSource {
  label: string;
  url: string;
  confidence: "High" | "Medium" | "Low";
}

export interface ComparisonPricingBlock {
  title: string;
  points: string[];
  caveat?: string;
  href?: string;
  ctaText?: string;
}

// Data shape for a single "Voxandra vs {Competitor}" page. Every field maps
// to one section of the shared template in comparison-page.tsx — add a new
// competitor by writing one of these, not by touching the template.
export interface ComparisonPageData {
  slug: string;
  competitorName: string;
  competitorShortName: string;
  lastVerified: string;
  lastVerifiedISO: string;
  recheckCadence: string;
  metaTitle: string;
  metaDescription: string;
  heroKicker: string;
  heroSubhead: string;
  quickVerdict: string;
  offerIntro: string;
  offerItems: ComparisonPoint[];
  recordingPosture: string;
  strongerIntro: string;
  strongerPoints: ComparisonPoint[];
  advantageIntro: string;
  voxandraAdvantages: ComparisonPoint[];
  comparisonRows: ComparisonRow[];
  pricingCompetitor: ComparisonPricingBlock;
  pricingVoxandra: ComparisonPricingBlock;
  missingIntro: string;
  missingItems: string[];
  sources: ComparisonSource[];
}
