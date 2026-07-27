/**
 * Meridian Policy Twin — civic-ink design tokens (design.md §2).
 * Single source of truth shared by Tailwind config, charts, and components.
 */

export const colors = {
  bg: {
    base: "#0B1220",
    surface: "#101A2E",
    elevated: "#16233C",
    inset: "#080E1A",
  },
  border: {
    subtle: "#1E2C47",
    strong: "#2C3F63",
  },
  text: {
    primary: "#E6ECF5",
    secondary: "#9AA8BF",
    muted: "#5E6D87",
  },
  accent: {
    primary: "#3FAE9E",
    primaryStrong: "#63C7B8",
    secondary: "#6C8BD4",
  },
  gold: "#C9A24B",
  status: {
    success: "#4FAE8C",
    warning: "#D9A441",
    danger: "#D9635F",
    info: "#5E93CF",
  },
  confidence: {
    high: "#4FAE8C",
    med: "#D9A441",
    low: "#D9635F",
  },
} as const;

/** Categorical chart series palette (design.md §2) */
export const chartSeries = [
  "#3FAE9E",
  "#6C8BD4",
  "#C9A24B",
  "#8B7BC7",
  "#5E93CF",
  "#7FAE6E",
] as const;

export type ConfidenceLevel = "high" | "med" | "low";

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "med";
  return "low";
}

export function confidenceLabel(score: number): string {
  const level = confidenceLevel(score);
  if (level === "high") return "High confidence";
  if (level === "med") return "Medium confidence";
  return "Low confidence — human review required";
}

export const confidenceColor: Record<ConfidenceLevel, string> = {
  high: colors.confidence.high,
  med: colors.confidence.med,
  low: colors.confidence.low,
};

/** Motion tokens (design.md §5) */
export const motion = {
  easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
  easeEntrance: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeExit: "cubic-bezier(0.7, 0, 0.84, 0)",
  duration: {
    micro: 0.12,
    ui: 0.2,
    drawer: 0.28,
    page: 0.24,
  },
} as const;
