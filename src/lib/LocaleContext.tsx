/**
 * Locale provider + useT() hook for the lightweight i18n packs.
 *
 * Usage pattern: new pages may wrap themselves in <LocaleProvider> (or rely
 * on a provider higher in the tree) and call useT() for chrome strings.
 * Existing pages are intentionally NOT refactored.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getDict, type Dict, type LocaleCode } from "@/i18n";

const STORAGE_KEY = "meridian.locale";

interface LocaleContextValue {
  locale: LocaleCode;
  setLocale: (code: LocaleCode) => void;
  t: Dict;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => undefined,
  t: getDict("en"),
});

function initialLocale(): LocaleCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ha" || stored === "yo" || stored === "ig")
      return stored;
  } catch {
    /* storage unavailable */
  }
  return "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(initialLocale);

  const setLocale = useCallback((code: LocaleCode) => {
    setLocaleState(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: getDict(locale) }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** Translation hook: returns the active dictionary (typed). */
export function useT(): Dict {
  return useContext(LocaleContext).t;
}
