import { join } from "path";
import { loadConfig } from "../core/config.js";
import { CONFIG_DIR, ISSUE_START_MARKER, ISSUE_END_MARKER } from "../core/constants.js";
import { log } from "../core/output.js";
import { spawnAgent } from "../core/agent.js";
import { createIssue } from "../core/github.js";
import { loadContexts } from "../primitives/context.js";
import { loadInstructions } from "../primitives/instructions.js";
import { discoverGenerateWorkflow } from "../primitives/discovery.js";
import { resolveGenerateTemplate } from "../core/resolver.js";
import type { GeneratedIssue } from "../core/types.js";

function parseGeneratedIssues(output: string): GeneratedIssue[] {
  const issues: GeneratedIssue[] = [];
  const startEscaped = ISSUE_START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const endEscaped = ISSUE_END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${startEscaped}\\s*([\\s\\S]*?)\\s*${endEscaped}`, "g");

  for (const match of output.matchAll(regex)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (typeof parsed.title === "string" && typeof parsed.body === "string") {
        issues.push({
          title: parsed.title,
          body: parsed.body,
          labels: Array.isArray(parsed.labels) ? parsed.labels : [],
        });
      }
    } catch {
      // Skip invalid JSON blocks
    }
  }

  return issues;
}

export interface GenerateOptions {
  dryRun?: boolean;
  maxIssues?: number;
}

export async function generateCommand(cwd: string, options: GenerateOptions = {}) {
  const { dryRun = false, maxIssues } = options;

  const stormDir = join(cwd, CONFIG_DIR);
  const stormDirFile = Bun.file(join(stormDir, "storm.json"));
  if (!(await stormDirFile.exists())) {
    log.error("No .storm/ directory found. Run: storm init");
    process.exit(1);
  }

  const config = await loadConfig(cwd);

  if (!config.github.repo) {
    log.error('No repo configured. Set "repo" in .storm/storm.json');
    process.exit(1);
  }

  const workflow = await discoverGenerateWorkflow(cwd);
  if (!workflow) {
    log.error("No generate workflow found at .storm/generate/GENERATE.md");
    log.info("Run: storm init  (then customize .storm/generate/GENERATE.md)");
    process.exit(1);
  }

  log.info(`Analyzing codebase for ${config.github.repo}...`);
  if (dryRun) log.warn("Dry run mode — issues will not be created on GitHub");

  const [contexts, instructions] = await Promise.all([
    loadContexts(cwd),
    loadInstructions(cwd),
  ]);

  const prompt = resolveGenerateTemplate(workflow.body, { contexts, instructions });

  log.step("Running code analysis agent...");
  const result = await spawnAgent(prompt, config, { cwd });

  if (result.timedOut) {
    log.warn("Agent timed out");
  }
  if (result.exitCode !== 0) {
    log.warn(`Agent exited with code ${result.exitCode}`);
  }

  const allIssues = parseGeneratedIssues(result.output);

  if (allIssues.length === 0) {
    log.info("No issues generated.");
    return;
  }

  const issues = maxIssues !== undefined ? allIssues.slice(0, maxIssues) : allIssues;

  log.info(`Found ${allIssues.length} issue(s)${maxIssues !== undefined && allIssues.length > issues.length ? `, creating ${issues.length}` : ""}`);

  let created = 0;
  let failed = 0;

  for (const issue of issues) {
    if (dryRun) {
      log.issue(0, `[dry-run] ${issue.title}`);
      log.dim(`  Labels: ${issue.labels.join(", ") || "none"}`);
      continue;
    }

    try {
      const { number, url } = await createIssue(config.github.repo, issue);
      log.issue(number, issue.title);
      log.dim(`  ${url}`);
      created++;
    } catch (err) {
      log.error(`Failed to create issue "${issue.title}": ${err}`);
      failed++;
    }
  }

  if (!dryRun) {
    log.info("");
    if (created > 0) log.success(`${created} issue(s) created`);
    if (failed > 0) log.error(`${failed} issue(s) failed`);
  }
}
