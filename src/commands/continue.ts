import { loadConfig, validateConfig } from "../core/config.js";
import {
  fetchIssue,
  fetchPullRequest,
  fetchPRReviews,
  fetchPRSessionId,
} from "../core/github.js";
import { processContinue } from "../core/loop.js";
import { resolveContinueTemplate } from "../core/resolver.js";
import { discoverContinueWorkflow } from "../primitives/discovery.js";
import { loadContexts } from "../primitives/context.js";
import { loadInstructions } from "../primitives/instructions.js";
import { runCommandArgs } from "../primitives/runner.js";
import { log } from "../core/output.js";
import { CONFIG_DIR } from "../core/constants.js";
import { requestStop } from "../core/loop.js";
import type { PRReviewContext } from "../core/types.js";
import { existsSync } from "fs";
import { join } from "path";

export async function continueCommand(
  cwd: string,
  options: { prNumber: number; dryRun?: boolean }
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

  const { prNumber, dryRun = false } = options;

  // Handle SIGINT
  process.on("SIGINT", () => {
    log.warn("SIGINT received, finishing current work...");
    requestStop();
  });

  // Fetch PR details
  log.info(`Fetching PR #${prNumber}...`);
  const pr = await fetchPullRequest(config.github.repo, prNumber);

  // Extract linked issue number from PR body (Closes #N, Fixes #N, Resolves #N)
  const issueMatch = pr.body.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  if (!issueMatch) {
    log.error(
      `Could not find linked issue in PR #${prNumber} body. Expected "Closes #N", "Fixes #N", or "Resolves #N".`
    );
    process.exit(1);
  }
  const issueNumber = parseInt(issueMatch[1], 10);

  // Fetch issue, reviews, and session ID in parallel
  const [issue, reviews, sessionId] = await Promise.all([
    fetchIssue(config.github.repo, issueNumber),
    fetchPRReviews(config.github.repo, prNumber),
    fetchPRSessionId(config.github.repo, prNumber),
  ]);

  log.info(`Linked issue: #${issueNumber} — ${issue.title}`);
  log.info(`Reviews: ${reviews.length} review(s)`);
  if (sessionId) {
    log.info(`Session ID: ${sessionId} (will resume)`);
  } else {
    log.info("No session ID found (will start fresh)");
  }

  // Get diff summary
  const diffResult = await runCommandArgs(
    ["git", "diff", "--stat", `origin/${pr.baseBranch}...origin/${pr.headBranch}`],
    { cwd }
  );
  const diffSummary = diffResult.stdout.trim();

  // Build PRReviewContext
  const prContext: PRReviewContext = {
    prNumber,
    prTitle: pr.title,
    prBody: pr.body,
    prBranch: pr.headBranch,
    baseBranch: pr.baseBranch,
    diffSummary,
    reviews,
    linkedIssue: issue,
    sessionId,
  };

  if (dryRun) {
    log.warn("Dry run mode — no agent will be spawned, no git operations will run");

    const [contexts, instructions, continueWorkflow] = await Promise.all([
      loadContexts(cwd),
      loadInstructions(cwd),
      discoverContinueWorkflow(cwd),
    ]);

    const template =
      continueWorkflow?.body ??
      `---
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

    const prompt = resolveContinueTemplate(template, {
      pr: prContext,
      contexts,
      instructions,
    });

    log.dim("--- Resolved prompt ---");
    console.log(prompt);
    log.dim("--- End of prompt ---");
    return;
  }

  // Run the continue loop
  log.info(`Processing PR #${prNumber}...`);
  const result = await processContinue(prContext, config, cwd);

  if (result.success) {
    log.success(`Successfully addressed review feedback on PR #${prNumber}`);
  } else {
    log.error(`Failed to address review feedback on PR #${prNumber}`);
    process.exit(1);
  }
}
