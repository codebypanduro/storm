import type { GitHubIssue, StormConfig } from "./types.js";
import { log, formatDuration } from "./output.js";
import { loadContexts } from "../primitives/context.js";
import { loadInstructions } from "../primitives/instructions.js";
import { discoverWorkflow } from "../primitives/discovery.js";
import { resolveTemplate } from "./resolver.js";
import { spawnAgent } from "./agent.js";
import { runChecks } from "./checks.js";
import { branchName, createBranch, checkoutBase, commitAndPush, openPR } from "./pr.js";

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

    if (result.timedOut) {
      log.error("Agent timed out");
      if (stopOnError) break;
    }

    if (result.done) {
      log.success(`Agent signaled completion (${formatDuration(Date.now() - iterStart)})`);
      break;
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
  const prUrl = await openPR(config, issue, branch, cwd);

  const elapsed = formatDuration(Date.now() - start);
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

    if (result.timedOut) {
      log.error("Agent timed out");
      if (stopOnError) break;
    }

    if (result.done) {
      log.issue(issue.number, `Agent signaled completion (${formatDuration(Date.now() - iterStart)})`);
      break;
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

  const prUrl = await openPR(config, issue, branch, cwd);
  const elapsed = formatDuration(Date.now() - start);
  log.issue(issue.number, prUrl ? `Done in ${elapsed}: ${prUrl}` : `Finished in ${elapsed}`);

  return { success: !!prUrl, prUrl: prUrl || undefined };
}
