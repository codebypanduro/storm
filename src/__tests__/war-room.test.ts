import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock external dependencies before importing modules under test
const mockAppendFileSync = mock(() => {});
const mockMkdirSync = mock(() => {});

mock.module("fs", () => ({
  appendFileSync: mockAppendFileSync,
  mkdirSync: mockMkdirSync,
  existsSync: mock(() => true),
}));

mock.module("../core/output.js", () => ({
  log: {
    info: mock(() => {}),
    step: mock(() => {}),
    success: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    dim: mock(() => {}),
  },
  formatDuration: mock(() => "1s"),
}));

import {
  buildAgentPrompt,
  parseTransferKibble,
  formatEventsForPrompt,
  createWarRoomSession,
  appendEvent,
} from "../core/war-room.js";
import type { WarRoomAgent, WarRoomEvent } from "../core/types.js";
import { STOP_MARKER, TRANSFER_KIBBLE_MARKER } from "../core/constants.js";

function makeAgent(overrides: Partial<WarRoomAgent> = {}): WarRoomAgent {
  return {
    id: "engineer",
    name: "Johnny",
    role: "Engineer",
    kibble: 20,
    kibbleRemaining: 20,
    model: "sonnet",
    personality: "You are Johnny, a pragmatic engineer.",
    toolUseCount: 0,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<WarRoomEvent> = {}): WarRoomEvent {
  return {
    ts: 1000,
    agent: "Johnny",
    type: "talk",
    room: "war-room",
    data: "Hello from Johnny",
    ...overrides,
  };
}

describe("formatEventsForPrompt", () => {
  it("returns placeholder when no events", () => {
    const result = formatEventsForPrompt([]);
    expect(result).toContain("no events yet");
  });

  it("formats events as [agent] (type): data", () => {
    const events = [makeEvent({ agent: "Storm", type: "talk", data: "Let's plan" })];
    const result = formatEventsForPrompt(events);
    expect(result).toContain("[Storm]");
    expect(result).toContain("(talk)");
    expect(result).toContain("Let's plan");
  });

  it("limits to maxEvents most recent events", () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      makeEvent({ data: `message ${i}` })
    );
    const result = formatEventsForPrompt(events, 5);
    expect(result).toContain("message 29");
    expect(result).toContain("message 25");
    expect(result).not.toContain("message 24");
  });

  it("serializes object data as JSON", () => {
    const event = makeEvent({ type: "transfer-kibble", data: { to: "Alan", amount: 5 } });
    const result = formatEventsForPrompt([event]);
    expect(result).toContain("Alan");
    expect(result).toContain("5");
  });
});

describe("buildAgentPrompt", () => {
  it("includes agent personality", () => {
    const agent = makeAgent({ personality: "You are a super agent." });
    const result = buildAgentPrompt(agent, "Fix the bug", []);
    expect(result).toContain("You are a super agent.");
  });

  it("includes task description", () => {
    const agent = makeAgent();
    const result = buildAgentPrompt(agent, "Build dark mode toggle", []);
    expect(result).toContain("Build dark mode toggle");
  });

  it("includes kibble remaining", () => {
    const agent = makeAgent({ kibbleRemaining: 7 });
    const result = buildAgentPrompt(agent, "task", []);
    expect(result).toContain("7");
  });

  it("includes agent role", () => {
    const agent = makeAgent({ role: "QA" });
    const result = buildAgentPrompt(agent, "task", []);
    expect(result).toContain("QA");
  });

  it("includes STOP_MARKER instructions", () => {
    const agent = makeAgent();
    const result = buildAgentPrompt(agent, "task", []);
    expect(result).toContain(STOP_MARKER);
  });

  it("includes TRANSFER_KIBBLE_MARKER instructions", () => {
    const agent = makeAgent();
    const result = buildAgentPrompt(agent, "task", []);
    expect(result).toContain(TRANSFER_KIBBLE_MARKER);
  });

  it("includes recent event history", () => {
    const agent = makeAgent();
    const events = [makeEvent({ agent: "Alan", data: "Tests are failing" })];
    const result = buildAgentPrompt(agent, "task", events);
    expect(result).toContain("Alan");
    expect(result).toContain("Tests are failing");
  });
});

describe("parseTransferKibble", () => {
  it("parses a single transfer", () => {
    const output = "I'll transfer some budget. %%TRANSFER_KIBBLE:5:Alan%%";
    const transfers = parseTransferKibble(output);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toEqual({ amount: 5, to: "Alan" });
  });

  it("parses multiple transfers", () => {
    const output = "%%TRANSFER_KIBBLE:3:Johnny%% and %%TRANSFER_KIBBLE:2:Storm%%";
    const transfers = parseTransferKibble(output);
    expect(transfers).toHaveLength(2);
    expect(transfers[0]).toEqual({ amount: 3, to: "Johnny" });
    expect(transfers[1]).toEqual({ amount: 2, to: "Storm" });
  });

  it("returns empty array when no transfers", () => {
    const output = "No kibble transfers here.";
    const transfers = parseTransferKibble(output);
    expect(transfers).toHaveLength(0);
  });

  it("handles multi-word agent names that are alphanumeric", () => {
    const output = "%%TRANSFER_KIBBLE:10:Storm%%";
    const transfers = parseTransferKibble(output);
    expect(transfers[0].to).toBe("Storm");
  });

  it("ignores malformed transfer markers", () => {
    const output = "%%TRANSFER_KIBBLE:notanumber:Alan%%";
    const transfers = parseTransferKibble(output);
    // parseInt("notanumber") returns NaN — should not match
    expect(transfers).toHaveLength(0);
  });
});

describe("createWarRoomSession", () => {
  it("creates a session with correct fields", () => {
    const agents = [makeAgent()];
    const session = createWarRoomSession("Fix the bug", agents, 42);
    expect(session.task).toBe("Fix the bug");
    expect(session.agents).toBe(agents);
    expect(session.issueNumber).toBe(42);
    expect(session.done).toBe(false);
    expect(typeof session.id).toBe("string");
    expect(session.id.length).toBeGreaterThan(0);
    expect(session.startedAt).toBeGreaterThan(0);
  });

  it("works without issue number", () => {
    const session = createWarRoomSession("prompt-based task", [makeAgent()]);
    expect(session.issueNumber).toBeUndefined();
  });

  it("generates unique session IDs", () => {
    const s1 = createWarRoomSession("task", [makeAgent()]);
    const s2 = createWarRoomSession("task", [makeAgent()]);
    expect(s1.id).not.toBe(s2.id);
  });
});

describe("appendEvent", () => {
  beforeEach(() => {
    mockAppendFileSync.mockClear();
  });

  it("appends a JSONL line to the events file", () => {
    const event = makeEvent();
    appendEvent("/tmp/session", event);
    expect(mockAppendFileSync).toHaveBeenCalledTimes(1);
    const call = mockAppendFileSync.mock.calls[0] as unknown as [string, string, string];
    expect(call[0]).toContain("events.jsonl");
    expect(call[1]).toContain('"agent":"Johnny"');
    expect(call[1]).toEndWith("\n");
  });

  it("serializes event data correctly", () => {
    const event = makeEvent({ type: "transfer-kibble", data: { to: "Storm", amount: 3 } });
    appendEvent("/tmp/session", event);
    const call = mockAppendFileSync.mock.calls[0] as unknown as [string, string, string];
    const parsed = JSON.parse(call[1].trim());
    expect(parsed.type).toBe("transfer-kibble");
    expect((parsed.data as { to: string; amount: number }).to).toBe("Storm");
    expect((parsed.data as { to: string; amount: number }).amount).toBe(3);
  });
});
