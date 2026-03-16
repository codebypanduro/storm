import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock all external dependencies before importing the module under test
const mockCheckoutBase = mock(async () => true);
const mockCreateBranch = mock(async () => true);
const mockCommitAndPush = mock(async () => true);
const mockOpenPR = mock(async () => "https://github.com/owner/repo/pull/1");
const mockSpawnAgent = mock(async () => ({ done: false, exitCode: 0 }));
const mockRunChecks = mock(async () => ({ allPassed: true, failureSummary: "", results: [] }));
const mockLoadContexts = mock(async () => new Map());
const mockLoadInstructions = mock(async () => new Map());
const mockDiscoverWorkflow = mock(async () => ({ body: "test workflow", name: "workflow" }));
const mockResolveTemplate = mock(() => "resolved prompt");

mock.module("../core/pr.js", () => ({
  branchName: () => "storm/issue-1-test",
  checkoutBase: mockCheckoutBase,
  createBranch: mockCreateBranch,
  commitAndPush: mockCommitAndPush,
  openPR: mockOpenPR,
  checkoutExistingBranch: mock(async () => true),
}));

mock.module("../core/agent.js", () => ({
  spawnAgent: mockSpawnAgent,
}));

mock.module("../core/checks.js", () => ({
  runChecks: mockRunChecks,
}));

mock.module("../primitives/context.js", () => ({
  loadContexts: mockLoadContexts,
}));

mock.module("../primitives/instructions.js", () => ({
  loadInstructions: mockLoadInstructions,
}));

mock.module("../primitives/discovery.js", () => ({
  discoverWorkflow: mockDiscoverWorkflow,
  discoverContinueWorkflow: mock(async () => null),
}));

mock.module("../core/resolver.js", () => ({
  resolveTemplate: mockResolveTemplate,
  resolveContinueTemplate: mock(() => "resolved continue prompt"),
}));

mock.module("../core/output.js", () => ({
  log: {
    issue: mock(() => {}),
    step: mock(() => {}),
    success: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    info: mock(() => {}),
    dim: mock(() => {}),
  },
  formatDuration: mock(() => "1s"),
}));

mock.module("../core/github.js", () => ({
  commentOnIssue: mock(async () => {}),
}));

import { processIssue } from "../core/loop.js";
import type { GitHubIssue, StormConfig } from "../core/types.js";

const issue: GitHubIssue = {
  number: 1,
  title: "Test issue",
  body: "Test body",
  labels: [],
  url: "https://github.com/owner/repo/issues/1",
};

const config: StormConfig = {
  defaults: { maxIterations: 5, delay: 0, stopOnError: false, parallel: false },
  agent: { command: "claude", args: [], model: "claude-sonnet-4-6" },
  github: { repo: "owner/repo", baseBranch: "main", label: "storm" },
};

describe("processIssue — final checks gate", () => {
  beforeEach(() => {
    mockSpawnAgent.mockReset();
    mockRunChecks.mockReset();
    mockResolveTemplate.mockReset();
    mockCheckoutBase.mockImplementation(async () => true);
    mockCreateBranch.mockImplementation(async () => true);
    mockCommitAndPush.mockImplementation(async () => true);
    mockOpenPR.mockImplementation(async () => "https://github.com/owner/repo/pull/1");
    mockLoadContexts.mockImplementation(async () => new Map());
    mockLoadInstructions.mockImplementation(async () => new Map());
    mockDiscoverWorkflow.mockImplementation(async () => ({ body: "workflow", name: "workflow" }));
    mockResolveTemplate.mockImplementation(() => "prompt");
  });

  it("breaks immediately when agent signals done and final checks pass", async () => {
    mockSpawnAgent.mockImplementation(async () => ({ done: true, exitCode: 0, usage: null, sessionId: null }));
    mockRunChecks.mockImplementation(async () => ({ allPassed: true, failureSummary: "", results: [] }));

    await processIssue(issue, config, "/tmp");

    // runChecks called exactly once (the final gate check)
    expect(mockRunChecks).toHaveBeenCalledTimes(1);
    // spawnAgent called exactly once
    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
  });

  it("continues iterating when agent signals done but final checks fail", async () => {
    const failChecks = {
      allPassed: false,
      failureSummary: "TypeScript errors found",
      results: [{ name: "typecheck", passed: false, output: "error TS2345", command: "tsc --noEmit" }],
    };
    const passChecks = { allPassed: true, failureSummary: "", results: [] };

    // First iteration: done=true, checks fail; second iteration: done=true, checks pass
    mockSpawnAgent.mockImplementation(async () => ({ done: true, exitCode: 0, usage: null, sessionId: null }));
    (mockRunChecks as ReturnType<typeof mock>)
      .mockImplementationOnce(async () => failChecks)
      .mockImplementationOnce(async () => passChecks);

    await processIssue(issue, config, "/tmp");

    // spawnAgent called twice (first fails final check, loops again)
    expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
    // runChecks called twice (one failed gate, one passed gate)
    expect(mockRunChecks).toHaveBeenCalledTimes(2);
  });

  it("feeds check failures back into next iteration prompt when final checks fail", async () => {
    const failChecks = {
      allPassed: false,
      failureSummary: "TypeScript errors found",
      results: [{ name: "typecheck", passed: false, output: "error TS2345", command: "tsc --noEmit" }],
    };
    const passChecks = { allPassed: true, failureSummary: "", results: [] };

    mockSpawnAgent.mockImplementation(async () => ({ done: true, exitCode: 0, usage: null, sessionId: null }));
    (mockRunChecks as ReturnType<typeof mock>)
      .mockImplementationOnce(async () => failChecks)
      .mockImplementationOnce(async () => passChecks);

    await processIssue(issue, config, "/tmp");

    // Second call to resolveTemplate should include checkFailures
    const calls = mockResolveTemplate.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(calls).toHaveLength(2);
    expect(calls[1]![1]!.checkFailures).toBe("TypeScript errors found");
  });
});
