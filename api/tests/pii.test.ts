import { describe, expect, it } from "vitest";
import {
  redactPayload,
  redactText,
  type RedactionCounts,
} from "../utils/pii";

describe("PII redaction patterns", () => {
  it("redacts email addresses", () => {
    const r = redactText("reach me at amina.bello@example.gov.ng please");
    expect(r.text).toBe("reach me at [REDACTED:email] please");
    expect(r.counts.email).toBe(1);
  });

  it("redacts Nigerian phone formats", () => {
    for (const phone of ["08031234567", "+2348031234567", "2348031234567"]) {
      const r = redactText(`call ${phone} now`);
      expect(r.text).toBe("call [REDACTED:phone] now");
      expect(r.counts.phone_ng).toBe(1);
    }
  });

  it("redacts standalone 11-digit BVN/NIN", () => {
    const r = redactText("BVN 12345678901 on file");
    expect(r.text).toBe("BVN [REDACTED:id] on file");
    expect(r.counts.bvn_nin).toBe(1);
  });

  it("redacts labeled names in free text, keeping the label", () => {
    const r = redactText("my name is Adaeze Okafor and I approve");
    expect(r.text).toContain("[REDACTED:name]");
    expect(r.text).toContain("my name is");
    expect(r.text).not.toContain("Adaeze");
  });

  it("leaves clean text untouched", () => {
    const r = redactText("education jobs in jur:ng-kd for 2027");
    expect(r.total).toBe(0);
    expect(r.text).toBe("education jobs in jur:ng-kd for 2027");
  });
});

describe("payload redaction", () => {
  it("deep-redacts nested payloads and aggregates counts", () => {
    const counts: RedactionCounts = {};
    const out = redactPayload(
      {
        notes: ["mail obi@example.com", "id 12345678901"],
        meta: { contact: "08031234567" },
        keep: 42,
      },
      undefined,
      counts,
    ) as { notes: string[]; meta: { contact: string }; keep: number };
    expect(out.notes[0]).toContain("[REDACTED:email]");
    expect(out.notes[1]).toContain("[REDACTED:id]");
    expect(out.meta.contact).toBe("[REDACTED:phone]");
    expect(out.keep).toBe(42);
    expect(counts.email).toBe(1);
    expect(counts.bvn_nin).toBe(1);
    expect(counts.phone_ng).toBe(1);
  });
});
