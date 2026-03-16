import { loadConfig, validateConfig } from "../core/config.js";
import {
  fetchLabeledIssues,
  fetchIssue,
  findLinkedPR,
  fetchPullRequest,
  fetchPRReviews,
  fetchPRSessionId,
} from "../core/github.js";
import { processIssue, processIssueInWorktree, processContinue } from "../core/loop.js";
import { log } from "../core/output.js";
import { CONFIG_DIR } from "../core/constants.js";
import { loadContexts } from "../primitives/context.js";
import { loadInstructions } from "../primitives/instructions.js";
import { discoverWorkflow, discoverContinueWorkflow } from "../primitives/discovery.js";
import { resolveTemplate, resolveContinueTemplate } from "../core/resolver.js";
import { runCommandArgs } from "../primitives/runner.js";
import type { PRReviewContext } from "../core/types.js";
import { existsSync } from "fs";
import { join } from "path";

export async function runCommand(
  cwd: string,
  options: { issue?: number; dryRun?: boolean }
) {
  // Verify .storm/ exists
  if (!existsSync(join(cwd, CONFIG_DIR))) {
    log.error("No .storm/ directory found. Run `storm init` first.");
    process.exit(1);
  }

  const config = await loadConfig(cwd);

  const errors = validateConfig(config);
  if (errors.length > 0) {
    for (const err of errors) log.error(err);
    process.exit(1);
  }

  const { dryRun = false } = options;

  // Handle SIGINT
  const controller = new AbortController();
  process.on("SIGINT", () => {
    log.warn("SIGINT received, finishing current work...");
    controller.abort();
  });

  let issues;
  if (options.issue) {
    const issue = await fetchIssue(config.github.repo, options.issue);
    issues = [issue];
  } else {
    issues = await fetchLabeledIssues(config.github.repo, config.github.label);
  }

  if (issues.length === 0) {
    log.info("No issues to process.");
    return;
  }

  if (dryRun) {
    log.warn("Dry run mode — no agent will be spawned, no git operations will run");
    log.info(`Would process ${issues.length} issue(s):`);

    const [contexts, instructions, workflow, continueWorkflow] = await Promise.all([
      loadContexts(cwd),
      loadInstructions(cwd),
      discoverWorkflow(cwd),
      discoverContinueWorkflow(cwd),
    ]);

    if (!workflow) {
      log.error("No WORKFLOW.md found in .storm/workflow/");
      process.exit(1);
    }

    for (const issue of issues) {
      log.issue(issue.number, issue.title);

      const linked = await findLinkedPR(config.github.repo, issue.number);
      if (linked) {
        log.info(`  Found linked PR #${linked.number} — would use continue flow`);
        const pr = await fetchPullRequest(config.github.repo, linked.number);
        const [reviews, sessionId] = await Promise.all([
          fetchPRReviews(config.github.repo, linked.number),
          fetchPRSessionId(config.github.repo, linked.number),
        ]);
        const diffResult = await runCommandArgs(
          ["git", "diff", "--stat", `origin/${pr.baseBranch}...origin/${pr.headBranch}`],
          { cwd }
        );
        const prContext: PRReviewContext = {
          prNumber: linked.number,
          prTitle: pr.title,
          prBody: pr.body,
          prBranch: pr.headBranch,
          baseBranch: pr.baseBranch,
          diffSummary: diffResult.stdout.trim(),
          reviews,
          linkedIssue: issue,
          sessionId,
        };
        const template = continueWorkflow?.body ?? workflow.body;
        const prompt = resolveContinueTemplate(template, { pr: prContext, contexts, instructions });
        log.dim("--- Resolved continue prompt ---");
        console.log(prompt);
        log.dim("--- End of prompt ---");
      } else {
        const prompt = resolveTemplate(workflow.body, { issue, contexts, instructions });
        log.dim("--- Resolved prompt ---");
        console.log(prompt);
        log.dim("--- End of prompt ---");
      }
    }

    return;
  }

  log.info(`Processing ${issues.length} issue(s)...`);

  if (config.defaults.parallel && issues.length > 1) {
    // Parallel via worktrees
    log.info("Running in parallel with git worktrees");
    const results = await Promise.allSettled(
      issues.map(async (issue) => {
        const linked = await findLinkedPR(config.github.repo, issue.number);
        if (linked) {
          return runContinueForLinkedPR(linked.number, issue, config, cwd, controller.signal);
        }
        return processIssueInWorktree(issue, config, cwd, controller.signal);
      })
    );

    let succeeded = 0;
    let failed = 0;
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    log.info(`Done: ${succeeded} succeeded, ${failed} failed`);
  } else {
    // Sequential
    let succeeded = 0;
    let failed = 0;
    for (const issue of issues) {
      const linked = await findLinkedPR(config.github.repo, issue.number);
      let result: { success: boolean };
      if (linked) {
        result = await runContinueForLinkedPR(linked.number, issue, config, cwd, controller.signal);
      } else {
        result = await processIssue(issue, config, cwd, controller.signal);
      }
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    log.info(`Done: ${succeeded} succeeded, ${failed} failed`);
  }
}

async function runContinueForLinkedPR(
  prNumber: number,
  issue: import("../core/types.js").GitHubIssue,
  config: import("../core/types.js").StormConfig,
  cwd: string,
  signal?: AbortSignal
): Promise<{ success: boolean }> {
  log.info(`Issue #${issue.number} has linked PR #${prNumber}, switching to continue flow`);

  const pr = await fetchPullRequest(config.github.repo, prNumber);
  const [reviews, sessionId] = await Promise.all([
    fetchPRReviews(config.github.repo, prNumber),
    fetchPRSessionId(config.github.repo, prNumber),
  ]);

  const diffResult = await runCommandArgs(
    ["git", "diff", "--stat", `origin/${pr.baseBranch}...origin/${pr.headBranch}`],
    { cwd }
  );

  const prContext: PRReviewContext = {
    prNumber,
    prTitle: pr.title,
    prBody: pr.body,
    prBranch: pr.headBranch,
    baseBranch: pr.baseBranch,
    diffSummary: diffResult.stdout.trim(),
    reviews,
    linkedIssue: issue,
    sessionId,
  };

  return processContinue(prContext, config, cwd, signal);
}
