import { describe, it, expect, mock } from "bun:test";

// We test loadWarRoomAgents by mocking the file system
const mockExistsSync = mock((path: string) => false);

mock.module("fs", () => ({
  existsSync: mockExistsSync,
  readdirSync: mock(() => []),
}));

import { loadWarRoomAgents } from "../primitives/war-room-agent.js";
import { DEFAULT_KIBBLE } from "../core/constants.js";

describe("loadWarRoomAgents (defaults)", () => {
  it("returns all three default agents when .storm/agents does not exist", async () => {
    mockExistsSync.mockImplementation(() => false);
    const agents = await loadWarRoomAgents("/fake/cwd");
    expect(agents).toHaveLength(3);
    const ids = agents.map((a) => a.id);
    expect(ids).toContain("architect");
    expect(ids).toContain("engineer");
    expect(ids).toContain("qa");
  });

  it("default agents have correct names", async () => {
    mockExistsSync.mockImplementation(() => false);
    const agents = await loadWarRoomAgents("/fake/cwd");
    const names = agents.map((a) => a.name);
    expect(names).toContain("Storm");
    expect(names).toContain("Johnny");
    expect(names).toContain("Alan");
  });

  it("default agents have correct roles", async () => {
    mockExistsSync.mockImplementation(() => false);
    const agents = await loadWarRoomAgents("/fake/cwd");
    const roles = agents.map((a) => a.role);
    expect(roles).toContain("Architect");
    expect(roles).toContain("Engineer");
    expect(roles).toContain("QA");
  });

  it("default agents start with DEFAULT_KIBBLE", async () => {
    mockExistsSync.mockImplementation(() => false);
    const agents = await loadWarRoomAgents("/fake/cwd");
    for (const agent of agents) {
      expect(agent.kibble).toBe(DEFAULT_KIBBLE);
      expect(agent.kibbleRemaining).toBe(DEFAULT_KIBBLE);
    }
  });

  it("filters default agents when agentIds provided", async () => {
    mockExistsSync.mockImplementation(() => false);
    const agents = await loadWarRoomAgents("/fake/cwd", ["architect", "qa"]);
    expect(agents).toHaveLength(2);
    const ids = agents.map((a) => a.id);
    expect(ids).toContain("architect");
    expect(ids).toContain("qa");
    expect(ids).not.toContain("engineer");
  });

  it("returns all defaults when agentIds filter matches nothing", async () => {
    mockExistsSync.mockImplementation(() => false);
    const agents = await loadWarRoomAgents("/fake/cwd", ["nonexistent"]);
    expect(agents).toHaveLength(3);
  });

  it("default agents have toolUseCount of 0", async () => {
    mockExistsSync.mockImplementation(() => false);
    const agents = await loadWarRoomAgents("/fake/cwd");
    for (const agent of agents) {
      expect(agent.toolUseCount).toBe(0);
    }
  });

  it("default agents have non-empty personality strings", async () => {
    mockExistsSync.mockImplementation(() => false);
    const agents = await loadWarRoomAgents("/fake/cwd");
    for (const agent of agents) {
      expect(agent.personality.length).toBeGreaterThan(0);
    }
  });
});
