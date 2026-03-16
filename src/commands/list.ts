import { loadConfig } from "../core/config.js";
import { fetchLabeledIssues } from "../core/github.js";
import { log } from "../core/output.js";
import pc from "picocolors";

export async function listCommand(cwd: string) {
  const config = await loadConfig(cwd);

  if (!config.github.repo) {
    log.error('No repo configured. Set "repo" in .storm/storm.json');
    process.exit(1);
  }

  log.info(`Fetching issues labeled "${config.github.label}" from ${config.github.repo}...`);

  const issues = await fetchLabeledIssues(config.github.repo, config.github.label);

  if (issues.length === 0) {
    log.info("No open issues found with that label.");
    return;
  }

  console.log("");
  for (const issue of issues) {
    const num = pc.bold(pc.cyan(`#${issue.number}`));
    console.log(`  ${num}  ${issue.title}`);
  }
  console.log("");
  log.info(`${issues.length} issue(s) found`);
}
