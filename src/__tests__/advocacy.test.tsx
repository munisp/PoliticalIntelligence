// @vitest-environment jsdom
/**
 * Advocacy Pathway tests:
 * 1. Idea intake renders + example fill-in populates the form.
 * 2. Pathways tab renders cards from a mocked tRPC backend.
 * 3. Stakeholder map renders SVG nodes from fixture data.
 * 4. Node click opens the stakeholder detail drawer.
 * 5. Checklist toggles persist to localStorage.
 *
 * Run with `npm run test`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------------ */
/* Mock tRPC client: path-keyed registry                                */
/* ------------------------------------------------------------------ */

const { registry, mutationResult } = vi.hoisted(() => {
  const registry = new Map<
    string,
    { data?: unknown; isLoading?: boolean; isError?: boolean }
  >();
  const mutationResult = { current: null as unknown };
  return { registry, mutationResult };
});

vi.mock("@/providers/trpc", () => {
  const make = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop) {
        const key = path.join(".");
        if (prop === "useQuery") {
          return () => {
            const entry = registry.get(key) ?? {};
            return {
              data:
                entry.data !== undefined
                  ? { data: entry.data, meta: { request_id: "test" } }
                  : undefined,
              isLoading: entry.isLoading ?? false,
              isError: entry.isError ?? false,
            };
          };
        }
        if (prop === "useMutation") {
          return (opts?: { onSuccess?: (p: unknown) => void }) => ({
            mutate: () =>
              opts?.onSuccess?.({
                data: mutationResult.current,
                meta: { request_id: "test" },
              }),
            isPending: false,
            isError: false,
          });
        }
        if (prop === "useUtils") return () => ({});
        return make([...path, String(prop)]);
      },
    });
  return { trpc: make([]) };
});

import Advocacy from "@/pages/Advocacy";
import StakeholderMap from "@/components/advocacy/StakeholderMap";
import { ChecklistItems } from "@/components/advocacy/ChecklistTab";
import type {
  ChecklistStep,
  StakeholderEdge,
  StakeholderNode,
} from "@/components/advocacy/types";

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */

const pathway = {
  pathwayId: "pw-tourism",
  sector: "Tourism & Culture",
  title: "State tourism concession pathway",
  summary: "Concession and licensing route for tourism operators.",
  jurisdictionScope: "state",
};

const pathwayDetail = {
  ...pathway,
  licenses: [
    {
      name: "Tourism operating licence",
      issuer: "Ministry of Culture & Tourism",
      requirement: "Registered entity + site inspection",
      typical_timeline: "6–8 weeks",
      cost_note: "₦250k application + annual renewal",
    },
  ],
  constraints: [
    {
      type: "Community consent",
      description: "Host-community benefit agreement required.",
      severity: "high",
    },
  ],
  supportingLawRefs: [
    {
      ref: "KD-TRM-2019",
      title: "Kaduna State Tourism Law 2019",
      relevance: "Establishes licensing authority.",
    },
  ],
  steps: [
    {
      step: "Incorporate entity",
      owner: "Applicant",
      description: "Register with CAC.",
      est_duration: "2 weeks",
    },
  ],
  associationRefs: ["Kaduna Tourism Stakeholders Forum"],
};

const stakeholders: StakeholderNode[] = [
  {
    stakeholderId: "st-1",
    kind: "ministry",
    name: "Ministry of Culture & Tourism",
    title: "State ministry",
    org: "Kaduna State Government",
    state: "Kaduna",
    chamber: "",
    sectorTags: ["Tourism & Culture"],
    bio: "Licenses tourism operators and manages state tourism sites.",
    influenceArea: "Licensing & concessions",
    lobbyAngle: "Frame the platform as a revenue-assurance tool.",
    contactNote: "Via the Permanent Secretary's office.",
    asOf: "2025-12",
  },
  {
    stakeholderId: "st-2",
    kind: "committee",
    name: "House Committee on Tourism",
    title: "Legislative committee",
    org: "Kaduna State House of Assembly",
    state: "Kaduna",
    chamber: "State House of Assembly",
    sectorTags: ["Tourism & Culture"],
    bio: "Oversight of tourism policy and budget.",
    influenceArea: "Legislative oversight",
    lobbyAngle: "Offer data on tourism revenue leakage.",
    contactNote: "Through the committee clerk.",
    asOf: "2025-12",
  },
];

const stakeholderEdges: StakeholderEdge[] = [
  { fromId: "st-1", toId: "st-2", relation: "oversight", label: "oversees" },
];

const checklistSteps: ChecklistStep[] = [
  {
    step: "Incorporate entity",
    owner: "Applicant",
    description: "Register with CAC.",
    est_duration: "2 weeks",
  },
  {
    step: "Apply for licence",
    owner: "Applicant / Ministry",
    description: "Submit application with inspection fee.",
    est_duration: "6 weeks",
  },
];

/* ------------------------------------------------------------------ */
/* Harness                                                              */
/* ------------------------------------------------------------------ */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  registry.clear();
  mutationResult.current = null;
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

function render(node: React.ReactNode) {
  root = createRoot(host);
  act(() => root.render(node));
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/* ------------------------------------------------------------------ */

describe("Advocacy — idea intake", () => {
  it("renders the intake form and example fill-ins populate it", () => {
    render(<Advocacy />);
    expect(host.textContent).toContain("Describe your policy idea");

    const exampleBtn = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tourism payment platform"),
    );
    expect(exampleBtn).toBeTruthy();
    click(exampleBtn!);

    const titleInput = host.querySelector<HTMLInputElement>("input");
    expect(titleInput?.value).toBe("Tourism payment platform");
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea?.value).toContain("digital payment");
  });
});

describe("Advocacy — pathways tab", () => {
  it("renders pathway cards and detail from mocked tRPC", () => {
    registry.set("advocacy.listPathways", { data: { pathways: [pathway] } });
    registry.set("advocacy.getPathway", { data: { pathway: pathwayDetail } });
    render(<Advocacy />);

    const tab = [...host.querySelectorAll('[role="tab"]')].find((b) =>
      b.textContent?.includes("Pathways"),
    );
    click(tab!);

    expect(host.textContent).toContain("State tourism concession pathway");
    // Default-selects the first pathway and renders its detail.
    expect(host.textContent).toContain("Tourism operating licence");
    expect(host.textContent).toContain("Community consent");
    expect(host.textContent).toContain("Kaduna Tourism Stakeholders Forum");
  });
});

describe("Advocacy — stakeholder map", () => {
  it("renders SVG nodes from fixture data", () => {
    render(<StakeholderMap nodes={stakeholders} edges={stakeholderEdges} />);
    const svg = host.querySelector('[data-testid="stakeholder-map"]');
    expect(svg).toBeTruthy();
    expect(host.querySelector('[data-testid="stakeholder-node-st-1"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="stakeholder-node-st-2"]')).toBeTruthy();
  });

  it("opens the detail drawer on node click", () => {
    render(<StakeholderMap nodes={stakeholders} edges={stakeholderEdges} />);
    const node = host.querySelector('[data-testid="stakeholder-node-st-1"]')!;
    click(node);

    const drawer = host.ownerDocument.querySelector('[role="dialog"]');
    expect(drawer).toBeTruthy();
    expect(drawer!.textContent).toContain("Ministry of Culture & Tourism");
    expect(drawer!.textContent).toContain("Frame the platform as a revenue-assurance tool.");
    // Related stakeholders list navigates.
    expect(drawer!.textContent).toContain("House Committee on Tourism");
  });
});

describe("Advocacy — checklist", () => {
  it("toggles persist to localStorage per pathway+step", () => {
    render(<ChecklistItems pathwayId="pw-tourism" steps={checklistSteps} />);
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes.length).toBe(2);

    act(() => {
      boxes[0].click();
    });
    expect(boxes[0].checked).toBe(true);

    const stored = JSON.parse(
      localStorage.getItem("meridian.advocacy.checklist.pw-tourism") ?? "{}",
    );
    expect(stored["Incorporate entity"]).toBe(true);
    expect(stored["Apply for licence"]).toBeFalsy();

    // Remount restores persisted state.
    act(() => root.unmount());
    root = createRoot(host);
    act(() =>
      root.render(<ChecklistItems pathwayId="pw-tourism" steps={checklistSteps} />),
    );
    const boxes2 = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes2[0].checked).toBe(true);
    expect(boxes2[1].checked).toBe(false);
  });
});
