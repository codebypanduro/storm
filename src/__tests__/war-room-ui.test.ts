import { describe, it, expect } from "bun:test";
import { renderKibbleBar, truncate, PlainRenderer } from "../core/war-room-ui.js";
import { createWarRoomSession } from "../core/war-room.js";
import type { AgentConfig, WarRoomAgent, WarRoomEvent, KibbleTransfer } from "../core/types.js";

function makeAgent(id = "test"): AgentConfig {
  return {
    id,
    name: "Test",
    role: "Tester",
    personality: "Test agent",
    kibble: 20,
  };
}

function makeWarRoomAgent(config?: AgentConfig): WarRoomAgent {
  return {
    config: config ?? makeAgent(),
    kibbleRemaining: 20,
    toolsUsed: 0,
  };
}

describe("renderKibbleBar", () => {
  it("renders full bar", () => {
    expect(renderKibbleBar(20, 20, 5)).toBe("█████");
  });

  it("renders empty bar", () => {
    expect(renderKibbleBar(0, 20, 5)).toBe("░░░░░");
  });

  it("renders partial bar", () => {
    expect(renderKibbleBar(10, 20, 5)).toBe("███░░");
  });

  it("handles custom width", () => {
    expect(renderKibbleBar(5, 10, 10)).toBe("█████░░░░░");
  });

  it("handles zero total", () => {
    expect(renderKibbleBar(0, 0, 5)).toBe("░░░░░");
  });

  it("rounds correctly", () => {
    // 3/20 * 5 = 0.75 → rounds to 1
    expect(renderKibbleBar(3, 20, 5)).toBe("█░░░░");
  });
});

describe("truncate", () => {
  it("returns string unchanged if within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long string with ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
  });

  it("handles exact length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("handles single char limit", () => {
    expect(truncate("hello", 1)).toBe("…");
  });
});

describe("PlainRenderer", () => {
  it("can be instantiated and methods called without error", () => {
    const renderer = new PlainRenderer();
    const session = createWarRoomSession("test task", [makeAgent()]);
    const agent = session.agents[0];
    const event: WarRoomEvent = { type: "system", message: "test", timestamp: Date.now() };
    const transfer: KibbleTransfer = { from: "A", to: "B", amount: 5 };

    // All methods should not throw
    renderer.init(session);
    renderer.onTurnStart(session, agent);
    renderer.onToolUse(session, agent, "Bash");
    renderer.onEvent(session, event);
    renderer.onTransfer(session, transfer);
    renderer.onDone(session, agent);
    renderer.onTimeout(session, agent);
    renderer.onAllKibbleExhausted(session);
    renderer.onAbort(session);
    renderer.onTurnEnd(session, agent);
    renderer.onComplete(session);
    renderer.destroy();
  });
});
