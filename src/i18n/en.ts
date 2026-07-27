/**
 * English (source) dictionary. All other packs must satisfy this shape.
 */
const en = {
  nav: {
    dashboard: "Dashboard",
    opportunities: "Opportunities",
    legislation: "Legislation",
    simulation: "Simulation",
    briefs: "Briefs",
    dataHealth: "Data Source Health",
    copilot: "Copilot",
    innovations: "Innovations",
  },
  action: {
    save: "Save",
    cancel: "Cancel",
    retry: "Retry",
    next: "Next",
    back: "Back",
    submit: "Submit",
    install: "Install",
    publish: "Publish",
    export: "Export",
    close: "Close",
    search: "Search",
    loading: "Loading…",
  },
  status: {
    queued: "Queued",
    running: "Running",
    succeeded: "Succeeded",
    failed: "Failed",
    offline: "Offline",
    online: "Online",
    pending: "Pending",
  },
  provenance: {
    live: "Live source",
    derived: "Derived",
    seed: "Seed demo",
    liveDesc: "Fetched directly from an official live data source.",
    derivedDesc: "Computed by platform models from source data.",
    seedDesc: "Illustrative seed data for demonstration — not measured.",
    fetchedAt: "Fetched",
    sourceUrl: "Source",
    bannerTitle: "Demo data",
    bannerBody:
      "Most of this jurisdiction's data is seed/demo data. Connect live sources in Data Source Health to replace it with measured data.",
    bannerCta: "Open Data Source Health",
  },
  onboarding: {
    title: "Jurisdiction Onboarding",
    stepPack: "Choose a config pack",
    stepReview: "Review contents",
    stepRun: "Import data",
    stepDone: "Done",
  },
  common: {
    appName: "Meridian Policy Twin",
    language: "Language",
    emptyGeneric: "Nothing to show yet.",
    errorGeneric: "This service is not available yet. Please try again later.",
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Dict = Widen<typeof en>;
export default en;
