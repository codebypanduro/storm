import type { GitHubIssue, StormConfig, AgentUsage, PRReviewContext } from "./types.js";
import { log, formatDuration } from "./output.js";
import { loadContexts } from "../primitives/context.js";
import { loadInstructions } from "../primitives/instructions.js";
import { discoverWorkflow, discoverContinueWorkflow } from "../primitives/discovery.js";
import { resolveTemplate, resolveContinueTemplate } from "./resolver.js";
import { spawnAgent } from "./agent.js";
import { runChecks } from "./checks.js";
import { commentOnIssue } from "./github.js";
import { branchName, createBranch, checkoutBase, commitAndPush, openPR, checkoutExistingBranch } from "./pr.js";

let stopRequested = false;

export function requestStop() {
  stopRequested = true;
}

export async function processIssue(
  issue: GitHubIssue,
  config: StormConfig,
  cwd: string
): Promise<{ success: boolean; prUrl?: string }> {
  const start = Date.now();
  const branch = branchName(issue);
  const { maxIterations, delay, stopOnError } = config.defaults;

  log.issue(issue.number, `Starting: ${issue.title}`);

  // Checkout base and create branch
  if (!(await checkoutBase(config.github.baseBranch, cwd))) {
    return { success: false };
  }
  if (!(await createBranch(branch, cwd))) {
    return { success: false };
  }

  let checkFailures = "";
  let lastSessionId: string | undefined;
  const totalUsage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (stopRequested) {
      log.warn("Stop requested, finishing up...");
      break;
    }

    log.step(`Iteration ${iteration}/${maxIterations}`);
    const iterStart = Date.now();

    // Discover primitives
    const [contexts, instructions, workflow] = await Promise.all([
      loadContexts(cwd),
      loadInstructions(cwd),
      discoverWorkflow(cwd),
    ]);

    if (!workflow) {
      log.error("No WORKFLOW.md found in .storm/workflow/");
      return { success: false };
    }

    // Resolve template
    const prompt = resolveTemplate(workflow.body, {
      issue,
      contexts,
      instructions,
      checkFailures: checkFailures || undefined,
    });

    // Spawn agent
    const result = await spawnAgent(prompt, config, { cwd });

    if (result.sessionId) {
      lastSessionId = result.sessionId;
    }

    if (result.usage) {
      totalUsage.inputTokens += result.usage.inputTokens;
      totalUsage.outputTokens += result.usage.outputTokens;
      totalUsage.cacheReadTokens += result.usage.cacheReadTokens;
      totalUsage.cacheCreationTokens += result.usage.cacheCreationTokens;
    }

    if (result.timedOut) {
      log.error("Agent timed out");
      if (stopOnError) break;
    }

    if (result.done) {
      log.step("Running final checks...");
      const finalChecks = await runChecks(cwd);
      if (finalChecks.allPassed) {
        log.success(`Agent signaled completion (${formatDuration(Date.now() - iterStart)})`);
        break;
      }
      checkFailures = finalChecks.failureSummary;
      log.warn(`Agent signaled done but ${finalChecks.results.filter((r) => !r.passed).length} check(s) failed — continuing...`);
      log.dim(`  Iteration ${iteration} took ${formatDuration(Date.now() - iterStart)}`);
      continue;
    }

    if (result.exitCode !== 0 && stopOnError) {
      log.error(`Agent exited with code ${result.exitCode}, stopping`);
      break;
    }

    // Run checks
    log.step("Running checks...");
    const checkResults = await runChecks(cwd);

    if (checkResults.allPassed) {
      log.success("All checks passed");
      checkFailures = "";
    } else {
      checkFailures = checkResults.failureSummary;
      log.warn(`${checkResults.results.filter((r) => !r.passed).length} check(s) failed`);
    }

    log.dim(`  Iteration ${iteration} took ${formatDuration(Date.now() - iterStart)}`);

    // Delay between iterations
    if (iteration < maxIterations && delay > 0) {
      await Bun.sleep(delay * 1000);
    }
  }

  // Commit and push
  log.step("Committing and pushing...");
  const pushed = await commitAndPush(branch, issue, cwd);
  if (!pushed) {
    return { success: false };
  }

  // Create PR
  log.step("Creating pull request...");
  const totalDurationMs = Date.now() - start;
  const prUrl = await openPR(config, issue, branch, cwd, {
    model: config.agent.model,
    usage: totalUsage,
    durationMs: totalDurationMs,
    sessionId: lastSessionId,
  });

  const elapsed = formatDuration(totalDurationMs);
  if (prUrl) {
    log.success(`Done in ${elapsed}: ${prUrl}`);
  } else {
    log.warn(`Finished in ${elapsed} but PR creation failed`);
  }

  return { success: !!prUrl, prUrl: prUrl || undefined };
}

export async function processIssueInWorktree(
  issue: GitHubIssue,
  config: StormConfig,
  baseCwd: string
): Promise<{ success: boolean; prUrl?: string }> {
  const worktreeDir = `${baseCwd}/.storm-worktrees/issue-${issue.number}`;
  const branch = branchName(issue);

  // Create worktree
  const { runCommand } = await import("../primitives/runner.js");
  const setup = await runCommand(
    `git worktree add "${worktreeDir}" -b "${branch}" "${config.github.baseBranch}"`,
    { cwd: baseCwd }
  );

  if (setup.exitCode !== 0) {
    log.error(`Failed to create worktree: ${setup.stderr}`);
    return { success: false };
  }

  try {
    // Run the loop in the worktree (skip checkoutBase/createBranch since worktree handles it)
    return await processIssueInDir(issue, config, worktreeDir);
  } finally {
    // Cleanup worktree
    await runCommand(`git worktree remove "${worktreeDir}" --force`, {
      cwd: baseCwd,
    });
  }
}

async function processIssueInDir(
  issue: GitHubIssue,
  config: StormConfig,
  cwd: string
): Promise<{ success: boolean; prUrl?: string }> {
  const start = Date.now();
  const branch = branchName(issue);
  const { maxIterations, delay, stopOnError } = config.defaults;

  let checkFailures = "";
  let lastSessionId: string | undefined;
  const totalUsage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (stopRequested) break;

    log.issue(issue.number, `Iteration ${iteration}/${maxIterations}`);
    const iterStart = Date.now();

    const [contexts, instructions, workflow] = await Promise.all([
      loadContexts(cwd),
      loadInstructions(cwd),
      discoverWorkflow(cwd),
    ]);

    if (!workflow) {
      log.error("No WORKFLOW.md found");
      return { success: false };
    }

    const prompt = resolveTemplate(workflow.body, {
      issue,
      contexts,
      instructions,
      checkFailures: checkFailures || undefined,
    });

    const result = await spawnAgent(prompt, config, { cwd });

    if (result.sessionId) {
      lastSessionId = result.sessionId;
    }

    if (result.usage) {
      totalUsage.inputTokens += result.usage.inputTokens;
      totalUsage.outputTokens += result.usage.outputTokens;
      totalUsage.cacheReadTokens += result.usage.cacheReadTokens;
      totalUsage.cacheCreationTokens += result.usage.cacheCreationTokens;
    }

    if (result.timedOut) {
      log.error("Agent timed out");
      if (stopOnError) break;
    }

    if (result.done) {
      const finalChecks = await runChecks(cwd);
      if (finalChecks.allPassed) {
        log.issue(issue.number, `Agent signaled completion (${formatDuration(Date.now() - iterStart)})`);
        break;
      }
      checkFailures = finalChecks.failureSummary;
      log.warn(`Agent signaled done but ${finalChecks.results.filter((r) => !r.passed).length} check(s) failed — continuing...`);
      continue;
    }

    if (result.exitCode !== 0 && stopOnError) break;

    const checkResults = await runChecks(cwd);
    if (checkResults.allPassed) {
      checkFailures = "";
    } else {
      checkFailures = checkResults.failureSummary;
    }

    if (iteration < maxIterations && delay > 0) {
      await Bun.sleep(delay * 1000);
    }
  }

  // Commit and push
  const pushed = await commitAndPush(branch, issue, cwd);
  if (!pushed) return { success: false };

  const totalDurationMs = Date.now() - start;
  const prUrl = await openPR(config, issue, branch, cwd, {
    model: config.agent.model,
    usage: totalUsage,
    durationMs: totalDurationMs,
    sessionId: lastSessionId,
  });
  const elapsed = formatDuration(totalDurationMs);
  log.issue(issue.number, prUrl ? `Done in ${elapsed}: ${prUrl}` : `Finished in ${elapsed}`);

  return { success: !!prUrl, prUrl: prUrl || undefined };
}

const DEFAULT_CONTINUE_TEMPLATE = `---
completable: true
---
You are continuing work on a pull request. A reviewer has left feedback that needs to be addressed.

## Original Issue
**#{{ issue.number }}: {{ issue.title }}**
{{ issue.body }}

## Context
{{ contexts }}

## Instructions
{{ instructions }}

## Current Diff
{{ pr.diff }}

## Reviewer Feedback
{{ pr.reviews }}

## Task
Address the reviewer feedback above. Make the requested changes while maintaining code quality.
When done, output %%STORM_DONE%% on its own line.

{{ checks.failures }}
`;

export async function processContinue(
  pr: PRReviewContext,
  config: StormConfig,
  cwd: string
): Promise<{ success: boolean }> {
  const start = Date.now();
  const { maxIterations, delay, stopOnError } = config.defaults;
  const branch = pr.prBranch;
  const issue = pr.linkedIssue;

  log.info(`Continuing PR #${pr.prNumber}: ${pr.prTitle}`);

  // Checkout existing branch
  if (!(await checkoutExistingBranch(branch, cwd))) {
    return { success: false };
  }

  let checkFailures = "";
  let lastSessionId: string | undefined;
  const totalUsage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (stopRequested) {
      log.warn("Stop requested, finishing up...");
      break;
    }

    log.step(`Iteration ${iteration}/${maxIterations}`);
    const iterStart = Date.now();

    // Discover continue workflow (or use default)
    const [contexts, instructions, continueWorkflow] = await Promise.all([
      loadContexts(cwd),
      loadInstructions(cwd),
      discoverContinueWorkflow(cwd),
    ]);

    const template = continueWorkflow?.body ?? DEFAULT_CONTINUE_TEMPLATE;

    // Resolve template
    const prompt = resolveContinueTemplate(template, {
      pr,
      contexts,
      instructions,
      checkFailures: checkFailures || undefined,
    });

    // First iteration: try to resume session if available
    const resumeSessionId = iteration === 1 ? pr.sessionId : undefined;

    const result = await spawnAgent(prompt, config, {
      cwd,
      resumeSessionId,
    });

    if (result.sessionId) {
      lastSessionId = result.sessionId;
    }

    if (result.usage) {
      totalUsage.inputTokens += result.usage.inputTokens;
      totalUsage.outputTokens += result.usage.outputTokens;
      totalUsage.cacheReadTokens += result.usage.cacheReadTokens;
      totalUsage.cacheCreationTokens += result.usage.cacheCreationTokens;
    }

    if (result.timedOut) {
      log.error("Agent timed out");
      if (stopOnError) break;
    }

    if (result.done) {
      log.step("Running final checks...");
      const finalChecks = await runChecks(cwd);
      if (finalChecks.allPassed) {
        log.success(`Agent signaled completion (${formatDuration(Date.now() - iterStart)})`);
        break;
      }
      checkFailures = finalChecks.failureSummary;
      log.warn(`Agent signaled done but ${finalChecks.results.filter((r) => !r.passed).length} check(s) failed — continuing...`);
      log.dim(`  Iteration ${iteration} took ${formatDuration(Date.now() - iterStart)}`);
      continue;
    }

    if (result.exitCode !== 0 && stopOnError) {
      log.error(`Agent exited with code ${result.exitCode}, stopping`);
      break;
    }

    // Run checks
    log.step("Running checks...");
    const checkResults = await runChecks(cwd);

    if (checkResults.allPassed) {
      log.success("All checks passed");
      checkFailures = "";
    } else {
      checkFailures = checkResults.failureSummary;
      log.warn(`${checkResults.results.filter((r) => !r.passed).length} check(s) failed`);
    }

    log.dim(`  Iteration ${iteration} took ${formatDuration(Date.now() - iterStart)}`);

    if (iteration < maxIterations && delay > 0) {
      await Bun.sleep(delay * 1000);
    }
  }

  // Commit and push
  log.step("Committing and pushing...");
  const commitMsg = `storm: address review on PR #${pr.prNumber}`;
  const pushed = await commitAndPush(branch, issue, cwd, commitMsg);
  if (!pushed) {
    return { success: false };
  }

  // Comment on existing PR with summary
  const totalDurationMs = Date.now() - start;
  try {
    const fmt = (n: number) => n.toLocaleString("en-US");
    const totalTokens = totalUsage.inputTokens + totalUsage.outputTokens;
    const commentLines = [
      "## Storm Continue Summary",
      "",
      `| | |`,
      `|---|---|`,
      `| **Model** | \`${config.agent.model}\` |`,
      `| **Duration** | ${formatDuration(totalDurationMs)} |`,
      `| **Total tokens** | ${fmt(totalTokens)} |`,
      `| **Input tokens** | ${fmt(totalUsage.inputTokens)} |`,
      `| **Output tokens** | ${fmt(totalUsage.outputTokens)} |`,
    ];
    if (lastSessionId) {
      commentLines.push("", `<!-- storm:session_id=${lastSessionId} -->`);
    }
    await commentOnIssue(config.github.repo, pr.prNumber, commentLines.join("\n"));
  } catch (err) {
    log.error(`Failed to comment on PR: ${err}`);
  }

  const elapsed = formatDuration(totalDurationMs);
  log.success(`Done in ${elapsed}`);

  return { success: true };
}
