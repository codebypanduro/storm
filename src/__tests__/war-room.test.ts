import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import {
  createWarRoomSession,
  buildAgentPrompt,
  parseTransferKibble,
  formatEventsForPrompt,
  appendEvent,
} from "../core/war-room.js";
import { TRANSFER_KIBBLE_MARKER, STOP_MARKER } from "../core/constants.js";
import type { WarRoomEvent, WarRoomAgent, AgentConfig } from "../core/types.js";

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "test",
    name: "Test",
    role: "Tester",
    personality: "You are a test agent.",
    kibble: 20,
    ...overrides,
  };
}

function makeWarRoomAgent(overrides: Partial<WarRoomAgent> = {}): WarRoomAgent {
  return {
    config: makeAgent(),
    kibbleRemaining: 20,
    toolsUsed: 0,
    ...overrides,
  };
}

describe("createWarRoomSession", () => {
  it("creates a session with agents", () => {
    const agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" })];
    const session = createWarRoomSession("Do something", agents, 42);

    expect(session.task).toBe("Do something");
    expect(session.agents).toHaveLength(2);
    expect(session.agents[0].kibbleRemaining).toBe(20);
    expect(session.agents[1].kibbleRemaining).toBe(20);
    expect(session.turn).toBe(0);
    expect(session.maxTurns).toBe(30);
    expect(session.issueNumber).toBe(42);
    expect(session.id).toContain("war-room-");
    expect(session.events).toEqual([]);
  });

  it("creates session without issue number", () => {
    const session = createWarRoomSession("task", [makeAgent()]);
    expect(session.issueNumber).toBeUndefined();
  });

  it("initializes kibble from agent config", () => {
    const agents = [makeAgent({ kibble: 10 })];
    const session = createWarRoomSession("task", agents);
    expect(session.agents[0].kibbleRemaining).toBe(10);
  });
});

describe("buildAgentPrompt", () => {
  it("includes role, personality, task, and kibble info", () => {
    const agent = makeWarRoomAgent({
      config: makeAgent({ name: "Storm", role: "Architect", personality: "Lead the team." }),
      kibbleRemaining: 15,
    });
    agent.config.kibble = 20;

    const prompt = buildAgentPrompt(agent, "Build a feature", []);

    expect(prompt).toContain("# Role: Storm (Architect)");
    expect(prompt).toContain("Lead the team.");
    expect(prompt).toContain("# Task");
    expect(prompt).toContain("Build a feature");
    expect(prompt).toContain("15 kibble remaining out of 20 total");
    expect(prompt).toContain(TRANSFER_KIBBLE_MARKER);
    expect(prompt).toContain(STOP_MARKER);
  });

  it("includes recent events when provided", () => {
    const agent = makeWarRoomAgent();
    const events: WarRoomEvent[] = [
      { type: "system", message: "Started", timestamp: 1 },
      { type: "agent_end", agent: "Johnny", message: "Done coding", timestamp: 2 },
    ];

    const prompt = buildAgentPrompt(agent, "task", events);

    expect(prompt).toContain("# Recent Events");
    expect(prompt).toContain("[system] Started");
    expect(prompt).toContain("[Johnny] Done coding");
  });

  it("omits events section when no events", () => {
    const agent = makeWarRoomAgent();
    const prompt = buildAgentPrompt(agent, "task", []);
    expect(prompt).not.toContain("# Recent Events");
  });
});

describe("parseTransferKibble", () => {
  it("parses valid transfer marker", () => {
    const output = `Some text ${TRANSFER_KIBBLE_MARKER}:5:Johnny%%  more text`;
    const transfer = parseTransferKibble(output);

    expect(transfer).not.toBeNull();
    expect(transfer!.to).toBe("Johnny");
    expect(transfer!.amount).toBe(5);
  });

  it("returns null when no marker present", () => {
    expect(parseTransferKibble("just normal output")).toBeNull();
  });

  it("handles agent names with spaces", () => {
    const output = `${TRANSFER_KIBBLE_MARKER}:3:Alan Test%%`;
    const transfer = parseTransferKibble(output);
    expect(transfer).not.toBeNull();
    expect(transfer!.to).toBe("Alan Test");
    expect(transfer!.amount).toBe(3);
  });

  it("parses first match only", () => {
    const output = `${TRANSFER_KIBBLE_MARKER}:2:A%% ${TRANSFER_KIBBLE_MARKER}:3:B%%`;
    const transfer = parseTransferKibble(output);
    expect(transfer!.to).toBe("A");
    expect(transfer!.amount).toBe(2);
  });
});

describe("formatEventsForPrompt", () => {
  it("formats events with agent prefix", () => {
    const events: WarRoomEvent[] = [
      { type: "system", message: "Started", timestamp: 1 },
      { type: "agent_end", agent: "Storm", message: "Done planning", timestamp: 2 },
    ];

    const result = formatEventsForPrompt(events);
    expect(result).toBe("[system] Started\n[Storm] Done planning");
  });

  it("limits to maxEvents", () => {
    const events: WarRoomEvent[] = Array.from({ length: 30 }, (_, i) => ({
      type: "system" as const,
      message: `Event ${i}`,
      timestamp: i,
    }));

    const result = formatEventsForPrompt(events, 5);
    const lines = result.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("Event 25");
    expect(lines[4]).toContain("Event 29");
  });

  it("handles empty events", () => {
    expect(formatEventsForPrompt([])).toBe("");
  });
});

describe("appendEvent", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `war-room-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends JSONL to events file", () => {
    const event1: WarRoomEvent = { type: "system", message: "First", timestamp: 1 };
    const event2: WarRoomEvent = { type: "agent_start", agent: "Storm", message: "Start", timestamp: 2 };

    appendEvent(tempDir, event1);
    appendEvent(tempDir, event2);

    const content = readFileSync(join(tempDir, "events.jsonl"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed1 = JSON.parse(lines[0]);
    expect(parsed1.type).toBe("system");
    expect(parsed1.message).toBe("First");

    const parsed2 = JSON.parse(lines[1]);
    expect(parsed2.agent).toBe("Storm");
  });
});
