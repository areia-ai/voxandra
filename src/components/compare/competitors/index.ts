import type { ComparisonPageData } from "../types";
import { microsoftTeamsPhoneComparison } from "./microsoft-teams-phone";

// Every published "Voxandra vs {Competitor}" page, in the order it should
// appear anywhere they're listed (footer, a future /compare index). Add a
// new competitor's data export here — nothing else needs updating.
export const comparisonPages: ComparisonPageData[] = [microsoftTeamsPhoneComparison];
