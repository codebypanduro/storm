import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock all external dependencies before importing the module under test
const mockCheckoutBase = mock(() => Promise.resolve(true));
const mockCreateBranch = mock(() => Promise.resolve(true));
const mockCommitAndPush = mock(() => Promise.resolve(true));
const mockOpenPR = mock(() => Promise.resolve("https://github.com/owner/repo/pull/1"));
const mockCheckoutExistingBranch = mock(() => Promise.resolve(true));
const mockBranchName = mock((issue: { number: number }) => `storm/issue-${issue.number}`);
const mockSpawnAgent = mock(() =>
  Promise.resolve({ done: true, exitCode: 0, sessionId: "sess-1", usage: null, timedOut: false })
);
const mockRunChecks = mock(() =>
  Promise.resolve({ allPassed: true, results: [], failureSummary: "" })
);
const mockLoadContexts = mock(() => Promise.resolve(new Map()));
const mockLoadInstructions = mock(() => Promise.resolve(new Map()));
const mockDiscoverWorkflow = mock(() =>
  Promise.resolve({ body: "do the thing\n%%STORM_DONE%%\n", frontmatter: { completable: true } })
);
const mockDiscoverContinueWorkflow = mock(() => Promise.resolve(null));
const mockResolveTemplate = mock((tpl: string) => tpl);
const mockResolveContinueTemplate = mock((tpl: string) => tpl);
const mockCommentOnIssue = mock(() => Promise.resolve());

mock.module("./pr.js", () => ({
  checkoutBase: mockCheckoutBase,
  createBranch: mockCreateBranch,
  commitAndPush: mockCommitAndPush,
  openPR: mockOpenPR,
  checkoutExistingBranch: mockCheckoutExistingBranch,
  branchName: mockBranchName,
}));

mock.module("./agent.js", () => ({
  spawnAgent: mockSpawnAgent,
}));

mock.module("./checks.js", () => ({
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
  discoverContinueWorkflow: mockDiscoverContinueWorkflow,
}));

mock.module("./resolver.js", () => ({
  resolveTemplate: mockResolveTemplate,
  resolveContinueTemplate: mockResolveContinueTemplate,
}));

mock.module("./github.js", () => ({
  commentOnIssue: mockCommentOnIssue,
}));

mock.module("./output.js", () => ({
  log: {
    issue: mock(() => {}),
    step: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    success: mock(() => {}),
    info: mock(() => {}),
    dim: mock(() => {}),
  },
  formatDuration: mock(() => "1s"),
}));

const { processIssue, processContinue } = await import("./loop.js");

import type { GitHubIssue, StormConfig, PRReviewContext } from "./types.js";

const baseIssue: GitHubIssue = {
  number: 42,
  title: "Test issue",
  body: "Issue body",
  labels: ["storm"],
  url: "https://github.com/owner/repo/issues/42",
};

const baseConfig: StormConfig = {
  github: { repo: "owner/repo", label: "storm", baseBranch: "main" },
  agent: { command: "claude", args: [], model: "sonnet" },
  defaults: { maxIterations: 5, delay: 0, stopOnError: false, parallel: false },
};

const basePRContext: PRReviewContext = {
  prNumber: 1,
  prTitle: "Test PR",
  prBody: "Closes #42",
  prBranch: "storm/issue-42",
  baseBranch: "main",
  diffSummary: "+ some changes",
  reviews: [],
  linkedIssue: baseIssue,
};

beforeEach(() => {
  mockSpawnAgent.mockReset();
  mockSpawnAgent.mockImplementation(() =>
    Promise.resolve({ done: true, exitCode: 0, sessionId: "sess-1", usage: null, timedOut: false })
  );
  mockCheckoutBase.mockReset();
  mockCheckoutBase.mockImplementation(() => Promise.resolve(true));
  mockCreateBranch.mockReset();
  mockCreateBranch.mockImplementation(() => Promise.resolve(true));
  mockCommitAndPush.mockReset();
  mockCommitAndPush.mockImplementation(() => Promise.resolve(true));
  mockOpenPR.mockReset();
  mockOpenPR.mockImplementation(() => Promise.resolve("https://github.com/owner/repo/pull/1"));
  mockCheckoutExistingBranch.mockReset();
  mockCheckoutExistingBranch.mockImplementation(() => Promise.resolve(true));
});

describe("processIssue", () => {
  it("runs the agent when no signal is provided", async () => {
    const result = await processIssue(baseIssue, baseConfig, "/tmp/test");
    expect(result.success).toBe(true);
    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
  });

  it("skips the agent loop when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await processIssue(baseIssue, baseConfig, "/tmp/test", controller.signal);
    // Loop body never executes, but commit/push still runs
    expect(mockSpawnAgent).not.toHaveBeenCalled();
    // commitAndPush is called after the loop
    expect(mockCommitAndPush).toHaveBeenCalledTimes(1);
  });

  it("each call is independent — a used signal from one call does not affect the next", async () => {
    const controller = new AbortController();
    controller.abort();

    // First call with aborted signal — agent should not run
    await processIssue(baseIssue, baseConfig, "/tmp/test", controller.signal);
    expect(mockSpawnAgent).not.toHaveBeenCalled();

    mockSpawnAgent.mockReset();
    mockSpawnAgent.mockImplementation(() =>
      Promise.resolve({ done: true, exitCode: 0, sessionId: "sess-2", usage: null, timedOut: false })
    );

    // Second call with no signal — agent SHOULD run
    const result = await processIssue(baseIssue, baseConfig, "/tmp/test");
    expect(result.success).toBe(true);
    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
  });

  it("returns success with prUrl on happy path", async () => {
    const result = await processIssue(baseIssue, baseConfig, "/tmp/test");
    expect(result.success).toBe(true);
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/1");
  });
});

describe("processContinue", () => {
  it("runs the agent when no signal is provided", async () => {
    const result = await processContinue(basePRContext, baseConfig, "/tmp/test");
    expect(result.success).toBe(true);
    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
  });

  it("skips the agent loop when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await processContinue(basePRContext, baseConfig, "/tmp/test", controller.signal);
    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });

  it("each call is independent — aborted signal from prior call does not affect next call", async () => {
    const controller = new AbortController();
    controller.abort();

    await processContinue(basePRContext, baseConfig, "/tmp/test", controller.signal);
    expect(mockSpawnAgent).not.toHaveBeenCalled();

    mockSpawnAgent.mockReset();
    mockSpawnAgent.mockImplementation(() =>
      Promise.resolve({ done: true, exitCode: 0, sessionId: "sess-2", usage: null, timedOut: false })
    );

    const result = await processContinue(basePRContext, baseConfig, "/tmp/test");
    expect(result.success).toBe(true);
    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
  });
});
