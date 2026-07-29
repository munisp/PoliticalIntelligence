import { z } from "zod";

/** I7 — State domestication tracker contracts. */

export const DOMESTICATION_STATUSES = [
  "not_started",
  "in_assembly",
  "passed",
  "domesticated",
  "rejected",
] as const;
export type DomesticationStatus = (typeof DOMESTICATION_STATUSES)[number];

/** 36 states + FCT (ISO-3166-2:NG suffixes, uppercased). */
export const NG_STATES = [
  "AB", "AD", "AK", "AN", "BA", "BE", "BO", "BY", "CR", "DE",
  "EB", "ED", "EK", "EN", "FC", "GO", "IM", "JI", "KD", "KE",
  "KN", "KO", "KT", "KW", "LA", "NA", "NI", "OG", "ON", "OS",
  "OY", "PL", "RI", "SO", "TA", "YO", "ZA",
] as const;
export type NgStateCode = (typeof NG_STATES)[number];

export const STATE_NAMES: Record<NgStateCode, string> = {
  AB: "Abia", AD: "Adamawa", AK: "Akwa Ibom", AN: "Anambra", BA: "Bauchi",
  BE: "Benue", BO: "Borno", BY: "Bayelsa", CR: "Cross River", DE: "Delta",
  EB: "Ebonyi", ED: "Edo", EK: "Ekiti", EN: "Enugu", FC: "FCT Abuja",
  GO: "Gombe", IM: "Imo", JI: "Jigawa", KD: "Kaduna", KE: "Kebbi",
  KN: "Kano", KO: "Kogi", KT: "Katsina", KW: "Kwara", LA: "Lagos",
  NA: "Nasarawa", NI: "Niger", OG: "Ogun", ON: "Ondo", OS: "Osun",
  OY: "Oyo", PL: "Plateau", RI: "Rivers", SO: "Sokoto", TA: "Taraba",
  YO: "Yobe", ZA: "Zamfara",
};

/** Federal laws tracked by the seed matrix. */
export const TRACKED_FEDERAL_LAWS = [
  {
    lawRef: "startup-act-2022",
    title: "Nigeria Startup Act, 2022",
  },
  {
    lawRef: "ndpa-2023",
    title: "Nigeria Data Protection Act, 2023",
  },
  {
    lawRef: "land-use-act-amendment",
    title: "Land Use Act (amendment proposals)",
  },
] as const;

export const DomesticationMatrixInput = z.object({
  law_ref: z.string().min(1).max(128),
});

export const DomesticationUpdateInput = z.object({
  law_ref: z.string().min(1).max(128),
  state: z.enum(NG_STATES),
  status: z.enum(DOMESTICATION_STATUSES),
  bill_ref: z.string().max(128).nullish(),
  evidence_ref: z.string().max(512).nullish(),
});

export interface DomesticationCell {
  state: NgStateCode;
  state_name: string;
  status: DomesticationStatus;
  bill_ref: string | null;
  evidence_ref: string | null;
  updated_at: string | Date | null;
}

export interface DomesticationMatrix {
  law_ref: string;
  cells: DomesticationCell[];
  counts: Record<DomesticationStatus, number>;
}
