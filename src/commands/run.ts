import { loadConfig } from "../core/config.js";
import { fetchLabeledIssues, fetchIssue } from "../core/github.js";
import { processIssue, processIssueInWorktree, requestStop } from "../core/loop.js";
import { log } from "../core/output.js";
import { CONFIG_DIR } from "../core/constants.js";
import { loadContexts } from "../primitives/context.js";
import { loadInstructions } from "../primitives/instructions.js";
import { discoverWorkflow } from "../primitives/discovery.js";
import { resolveTemplate } from "../core/resolver.js";
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

  if (!config.github.repo) {
    log.error('No repo configured. Set "repo" in .storm/storm.json');
    process.exit(1);
  }

  const { dryRun = false } = options;

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

  if (dryRun) {
    log.warn("Dry run mode — no agent will be spawned, no git operations will run");
    log.info(`Would process ${issues.length} issue(s):`);

    const [contexts, instructions, workflow] = await Promise.all([
      loadContexts(cwd),
      loadInstructions(cwd),
      discoverWorkflow(cwd),
    ]);

    if (!workflow) {
      log.error("No WORKFLOW.md found in .storm/workflow/");
      process.exit(1);
    }

    for (const issue of issues) {
      log.issue(issue.number, issue.title);
      const prompt = resolveTemplate(workflow.body, { issue, contexts, instructions });
      log.dim("--- Resolved prompt ---");
      console.log(prompt);
      log.dim("--- End of prompt ---");
    }

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
