import { loadConfig, validateConfig } from "../core/config.js";
import { fetchLabeledIssues, findLinkedPRs } from "../core/github.js";
import { log } from "../core/output.js";
import pc from "picocolors";

export async function listCommand(cwd: string) {
  const config = await loadConfig(cwd);

  const errors = validateConfig(config);
  if (errors.length > 0) {
    for (const err of errors) log.error(err);
    process.exit(1);
  }

  log.info(`Fetching issues labeled "${config.github.label}" from ${config.github.repo}...`);

  const issues = await fetchLabeledIssues(config.github.repo, config.github.label);

  if (issues.length === 0) {
    log.info("No open issues found with that label.");
    return;
  }

  const linkedPRs = await findLinkedPRs(
    config.github.repo,
    issues.map((i) => i.number)
  );

  console.log("");
  for (const issue of issues) {
    const num = pc.bold(pc.cyan(`#${issue.number}`));
    const linked = linkedPRs.get(issue.number);
    const prTag = linked ? pc.dim(` → PR #${linked.number}`) : "";
    console.log(`  ${num}  ${issue.title}${prTag}`);
  }
  console.log("");
  log.info(`${issues.length} issue(s) found`);
}
