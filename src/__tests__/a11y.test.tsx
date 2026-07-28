// @vitest-environment jsdom
/**
 * Accessibility regression tests (audit UX rows):
 *
 * 1. Focus-return: hand-rolled dialogs (EvidenceDrawer + the shared
 *    useFocusReturn hook pattern) restore focus to the triggering element.
 * 2. aria-modal / role="dialog" semantics on the drawer surface.
 * 3. prefers-reduced-data CSS hook hides [data-decorative] imagery.
 * 4. Sweep guard: no icon-only button in src/ ships without an aria-label.
 *
 * Run with `npm run test`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import EvidenceDrawer from "@/components/shared/EvidenceDrawer";
import { useFocusReturn } from "@/hooks/use-focus-return";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

let host: HTMLDivElement;
let r: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => r?.unmount());
  host.remove();
});

function render(node: React.ReactNode) {
  r = createRoot(host);
  act(() => r.render(node));
}

/* ------------------------------------------------------------------ */

function MiniModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useFocusReturn(open);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Mini dialog">
      <button
        type="button"
        ref={(el) => el?.focus()}
        onClick={onClose}
        aria-label="Close dialog"
      >
        ×
      </button>
    </div>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      <MiniModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("useFocusReturn", () => {
  it("restores focus to the trigger after the dialog closes", () => {
    render(<Harness />);
    const trigger = host.querySelector<HTMLButtonElement>(
      "[data-testid='trigger']",
    )!;
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);

    // open → focus moves into the dialog
    act(() => trigger.click());
    const dialog = host.querySelector("[role='dialog']")!;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // close → focus returns to the trigger
    const closeBtn = dialog.querySelector("button")!;
    act(() => closeBtn.click());
    expect(host.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("EvidenceDrawer a11y semantics", () => {
  function DrawerHarness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          data-testid="trigger"
          onClick={() => setOpen(true)}
        >
          Evidence
        </button>
        <EvidenceDrawer
          open={open}
          onClose={() => setOpen(false)}
          title="Kaduna SME credit facility"
          sources={[
            {
              id: "s1",
              title: "BOI impact note",
              issuer: "BOI",
              date: "2025",
              relevance: 0.9,
            },
          ]}
        />
      </>
    );
  }

  it("renders role=dialog with aria-modal and an accessible close button", () => {
    render(<DrawerHarness />);
    const trigger = host.querySelector<HTMLButtonElement>(
      "[data-testid='trigger']",
    )!;
    act(() => trigger.click());

    const dialog = host.querySelector("[role='dialog']")!;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toContain(
      "Kaduna SME credit facility",
    );

    const closeBtn = dialog.querySelector<HTMLButtonElement>(
      "button[aria-label]",
    );
    expect(closeBtn?.getAttribute("aria-label")).toBeTruthy();
    // focus moved into the drawer on open
    expect(document.activeElement).toBe(closeBtn);
  });

  it("returns focus to the trigger when the drawer closes", () => {
    render(<DrawerHarness />);
    const trigger = host.querySelector<HTMLButtonElement>(
      "[data-testid='trigger']",
    )!;
    act(() => trigger.focus());
    act(() => trigger.click());
    const closeBtn = host.querySelector<HTMLButtonElement>(
      "[role='dialog'] button[aria-label]",
    )!;
    act(() => closeBtn.click());
    expect(document.activeElement).toBe(trigger);
  });
});

describe("prefers-reduced-data hook", () => {
  it("index.css hides [data-decorative] imagery under reduced data", () => {
    const css = read("src/index.css");
    const block = css.match(
      /@media\s*\(prefers-reduced-data:\s*reduce\)\s*\{([\s\S]*?)\}\s*\}/,
    );
    expect(block, "prefers-reduced-data media block").toBeTruthy();
    expect(block![1]).toContain("[data-decorative]");
    expect(block![1]).toMatch(/display:\s*none/);
  });

  it("the landing topo background is marked decorative", () => {
    const home = read("src/pages/Home.tsx");
    expect(home).toContain("data-decorative");
  });
});

describe("icon-only button sweep (shared components + pages)", () => {
  function* tsxFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) yield* tsxFiles(full);
      else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx"))
        yield full;
    }
  }

  it("every icon-only button has an aria-label/aria-labelledby", () => {
    const offenders: string[] = [];
    const btnRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
    for (const file of tsxFiles(path.join(root, "src"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(btnRe)) {
        const [attrs, inner] = [m[1], m[2]];
        if (/aria-label(ledby)?=/.test(attrs)) continue;
        // icon-only: body is just aria-hidden icon elements + whitespace
        const stripped = inner
          .replace(/<[A-Z]\w*[^>]*aria-hidden[^>]*\/>/g, "")
          .trim();
        if (stripped === "" && inner.includes("aria-hidden")) {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${path.relative(root, file)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
