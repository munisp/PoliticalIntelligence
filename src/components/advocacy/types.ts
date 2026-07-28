import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";
import { unwrapData } from "@/components/legislation/types";

export type RouterOutputs = inferRouterOutputs<AppRouter>;

export type PathwaySummary =
  RouterOutputs["advocacy"]["listPathways"]["data"]["pathways"][number];
export type PathwayDetail = RouterOutputs["advocacy"]["getPathway"]["data"]["pathway"];
export type StakeholderNode =
  RouterOutputs["advocacy"]["stakeholderMap"]["data"]["nodes"][number];
export type StakeholderEdge =
  RouterOutputs["advocacy"]["stakeholderMap"]["data"]["edges"][number];
export type StakeholderMapData =
  RouterOutputs["advocacy"]["stakeholderMap"]["data"];
export type AnalyzeIdeaResult = RouterOutputs["advocacy"]["analyzeIdea"]["data"];
export type ChecklistStep =
  RouterOutputs["advocacy"]["pathwayChecklist"]["data"]["steps"][number];

export type StakeholderKind = StakeholderNode["kind"];

export const STAKEHOLDER_KINDS: StakeholderKind[] = [
  "individual",
  "committee",
  "ministry",
  "agency",
  "association",
  "state_body",
  "development_partner",
];

export { unwrapData };
