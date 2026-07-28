import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EventTopics } from "@contracts/entities";
import { dlqTopicFor } from "../utils/events";

/**
 * EVT-1 topic catalog manifest: infra/events/topics.json is the codified
 * provisioning source; this suite pins it to the contracts constant so the
 * manifest, the provisioner (scripts/kafka-topics.sh), and producers can
 * never drift.
 */
const manifest = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, "../../infra/events/topics.json"),
    "utf8",
  ),
) as {
  defaults: { partitions: number };
  dlq: { suffix: string };
  topics: { name: string; partition_key: string }[];
};

describe("topic catalog manifest (EVT-1)", () => {
  it("manifest topics match the contracts EventTopics catalog exactly", () => {
    const manifestTopics = manifest.topics.map((t) => t.name).sort();
    const contractTopics = Object.values(EventTopics).sort();
    expect(manifestTopics).toEqual(contractTopics);
  });

  it("every topic declares an ordering partition key", () => {
    for (const t of manifest.topics) {
      expect(t.partition_key, `${t.name} missing partition_key`).toBeTruthy();
    }
  });

  it("DLQ suffix matches the runtime dlqTopicFor convention", () => {
    for (const t of manifest.topics) {
      expect(dlqTopicFor(t.name)).toBe(`${t.name}${manifest.dlq.suffix}`);
    }
  });

  it("the provisioning script consumes the manifest (no inline topic list)", () => {
    const script = readFileSync(
      path.resolve(import.meta.dirname, "../../scripts/kafka-topics.sh"),
      "utf8",
    );
    expect(script).toContain("infra/events/topics.json");
    for (const topic of Object.values(EventTopics)) {
      expect(script).not.toContain(`\n${topic}\n`);
    }
  });
});
