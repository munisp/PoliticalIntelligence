import { Languages } from "lucide-react";
import { LOCALES, type LocaleCode } from "@/i18n";
import { useLocale } from "@/lib/LocaleContext";
import { cn } from "@/lib/utils";

/**
 * Language switcher (EN / HA / YO / IG). Placed in the Onboarding wizard
 * and usable anywhere under a LocaleProvider.
 */
export default function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-ink-subtle bg-ink-elevated px-2.5 py-1.5",
        className,
      )}
    >
      <Languages aria-hidden className="h-4 w-4 text-ink-muted" />
      <span className="sr-only">{t.common.language}</span>
      <select
        aria-label={t.common.language}
        value={locale}
        onChange={(e) => setLocale(e.target.value as LocaleCode)}
        className="bg-transparent text-[13px] text-ink-primary outline-none"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} className="bg-ink-elevated text-ink-primary">
            {l.nativeLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
