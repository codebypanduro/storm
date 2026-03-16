import { loadConfig, validateConfig } from "../core/config.js";
import { fetchLabeledIssues, fetchIssue } from "../core/github.js";
import { processIssue, processIssueInWorktree, requestStop } from "../core/loop.js";
import { log } from "../core/output.js";
import { CONFIG_DIR } from "../core/constants.js";
import { existsSync } from "fs";
import { join } from "path";

export async function runCommand(
  cwd: string,
  options: { issue?: number }
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

  // Handle SIGINT
  process.on("SIGINT", () => {
    log.warn("SIGINT received, finishing current work...");
    requestStop();
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

  log.info(`Processing ${issues.length} issue(s)...`);

  if (config.defaults.parallel && issues.length > 1) {
    // Parallel via worktrees
    log.info("Running in parallel with git worktrees");
    const results = await Promise.allSettled(
      issues.map((issue) => processIssueInWorktree(issue, config, cwd))
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
      const result = await processIssue(issue, config, cwd);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    log.info(`Done: ${succeeded} succeeded, ${failed} failed`);
  }
}
