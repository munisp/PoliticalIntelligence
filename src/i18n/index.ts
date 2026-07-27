import en, { type Dict } from "./en";
import ha from "./ha";
import yo from "./yo";
import ig from "./ig";

export type LocaleCode = "en" | "ha" | "yo" | "ig";

export const LOCALES: { code: LocaleCode; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "ha", label: "Hausa", nativeLabel: "Hausa" },
  { code: "yo", label: "Yoruba", nativeLabel: "Yorùbá" },
  { code: "ig", label: "Igbo", nativeLabel: "Igbo" },
];

const DICTS: Record<LocaleCode, Dict> = { en, ha, yo, ig };

export function getDict(code: LocaleCode): Dict {
  return DICTS[code] ?? en;
}

export type { Dict };
export { en, ha, yo, ig };
