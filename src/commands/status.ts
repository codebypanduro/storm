import { loadConfig, validateConfig } from "../core/config.js";
import { listPullRequests } from "../core/github.js";
import { runCommand } from "../primitives/runner.js";
import { log } from "../core/output.js";
import pc from "picocolors";

export async function statusCommand(cwd: string) {
  const config = await loadConfig(cwd);

  const errors = validateConfig(config);
  if (errors.length > 0) {
    for (const err of errors) log.error(err);
    process.exit(1);
  }

  // List storm/* branches
  log.step("Local storm branches:");
  const branchResult = await runCommand('git branch --list "storm/*"', { cwd });

  const branches = branchResult.stdout
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);

  if (branches.length === 0) {
    log.info("  No storm branches found");
  } else {
    for (const branch of branches) {
      console.log(`  ${pc.cyan(branch)}`);
    }
  }

  // Check for open PRs if repo is configured
  if (config.github.repo) {
    console.log("");
    log.step("Open storm pull requests:");

    try {
      const prs = await listPullRequests(config.github.repo);
      const stormPRs = prs.filter((pr) => pr.title.startsWith("storm:"));

      if (stormPRs.length === 0) {
        log.info("  No open storm PRs");
      } else {
        for (const pr of stormPRs) {
          console.log(`  ${pc.bold(pc.green(`#${pr.number}`))}  ${pr.title}`);
          console.log(`    ${pc.dim(pr.url)}`);
        }
      }
    } catch (err) {
      log.warn(`Could not fetch PRs: ${err}`);
    }
  }
}
