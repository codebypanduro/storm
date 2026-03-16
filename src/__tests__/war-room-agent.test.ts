import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { loadWarRoomAgents, DEFAULT_AGENTS } from "../primitives/war-room-agent.js";

describe("loadWarRoomAgents", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `war-room-agent-test-${Date.now()}`);
    mkdirSync(join(tempDir, ".storm"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns default agents when no .storm/agents/ dir", async () => {
    const agents = await loadWarRoomAgents(tempDir);
    expect(agents).toHaveLength(3);
    expect(agents[0].id).toBe("storm");
    expect(agents[1].id).toBe("johnny");
    expect(agents[2].id).toBe("alan");
  });

  it("filters agents by IDs", async () => {
    const agents = await loadWarRoomAgents(tempDir, ["storm", "alan"]);
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.id)).toEqual(["storm", "alan"]);
  });

  it("filter is case-insensitive", async () => {
    const agents = await loadWarRoomAgents(tempDir, ["STORM"]);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("storm");
  });

  it("returns empty array for non-matching filter", async () => {
    const agents = await loadWarRoomAgents(tempDir, ["nonexistent"]);
    expect(agents).toHaveLength(0);
  });

  it("loads custom agents from .storm/agents/", async () => {
    const agentDir = join(tempDir, ".storm", "agents", "custom");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "AGENT.md"),
      `---
name: Custom Agent
role: Specialist
kibble: 10
model: opus
---
You are a custom specialist agent.`
    );

    const agents = await loadWarRoomAgents(tempDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("custom");
    expect(agents[0].name).toBe("Custom Agent");
    expect(agents[0].role).toBe("Specialist");
    expect(agents[0].kibble).toBe(10);
    expect(agents[0].model).toBe("opus");
    expect(agents[0].personality).toBe("You are a custom specialist agent.");
  });

  it("defaults values for custom agents with minimal frontmatter", async () => {
    const agentDir = join(tempDir, ".storm", "agents", "minimal");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "AGENT.md"),
      `---
---
Just a body.`
    );

    const agents = await loadWarRoomAgents(tempDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("minimal");
    expect(agents[0].role).toBe("Agent");
    expect(agents[0].kibble).toBe(20);
    expect(agents[0].model).toBeUndefined();
  });
});

describe("DEFAULT_AGENTS", () => {
  it("has three default agents", () => {
    expect(DEFAULT_AGENTS).toHaveLength(3);
  });

  it("each has required fields", () => {
    for (const agent of DEFAULT_AGENTS) {
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBeTruthy();
      expect(agent.role).toBeTruthy();
      expect(agent.personality).toBeTruthy();
      expect(agent.kibble).toBeGreaterThan(0);
    }
  });
});
