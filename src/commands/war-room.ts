import { existsSync } from "fs";
import { join } from "path";
import { loadConfig, validateConfig } from "../core/config.js";
import { CONFIG_DIR } from "../core/constants.js";
import { log } from "../core/output.js";
import { fetchIssue } from "../core/github.js";
import { loadWarRoomAgents } from "../primitives/war-room-agent.js";
import { createWarRoomSession, runWarRoom } from "../core/war-room.js";
import { createRenderer } from "../core/war-room-ui.js";
import { checkoutBase, createBranch, commitAndPush, openPR } from "../core/pr.js";
import type { WarRoomOptions } from "../core/types.js";

export async function warRoomCommand(
  cwd: string,
  options: WarRoomOptions
): Promise<void> {
  // Validate .storm/ exists
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

  // Resolve task
  let task: string;
  let issueNumber: number | undefined;
  let issueTitle: string | undefined;

  if (options.issue) {
    const issue = await fetchIssue(config.github.repo, options.issue);
    task = `# Issue #${issue.number}: ${issue.title}\n\n${issue.body}`;
    issueNumber = issue.number;
    issueTitle = issue.title;
  } else if (options.prompt) {
    task = options.prompt;
  } else {
    log.error("Provide --issue or --prompt");
    process.exit(1);
  }

  // Load agents
  const agentConfigs = await loadWarRoomAgents(cwd, options.agents);
  if (agentConfigs.length === 0) {
    log.error("No agents found. Check --agents filter or .storm/agents/ directory.");
    process.exit(1);
  }

  // Create session
  const session = createWarRoomSession(task, agentConfigs, issueNumber);

  // Dry run
  if (options.dryRun) {
    log.warn("Dry run — no agents will be spawned");
    log.info(`Task: ${task.slice(0, 200)}`);
    log.info(`Agents (${agentConfigs.length}):`);
    for (const a of agentConfigs) {
      log.dim(`  ${a.name} (${a.role}) — kibble: ${a.kibble}`);
    }
    return;
  }

  // Handle SIGINT
  const controller = new AbortController();
  process.on("SIGINT", () => {
    log.warn("SIGINT received, aborting war room...");
    controller.abort();
  });

  // Create branch if working on an issue
  if (issueNumber && issueTitle) {
    const slug = issueTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    const branch = `storm/war-room-${issueNumber}-${slug}`;

    if (!(await checkoutBase(config.github.baseBranch, cwd))) {
      return;
    }
    if (!(await createBranch(branch, cwd))) {
      return;
    }
  }

  // Choose renderer
  const useUi = options.ui ?? (process.stdout.isTTY ?? false);
  const renderer = createRenderer(useUi);

  // Run war room
  const result = await runWarRoom(session, config, cwd, controller.signal, renderer);

  // Commit and push if on an issue
  if (issueNumber && issueTitle) {
    const slug = issueTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    const branch = `storm/war-room-${issueNumber}-${slug}`;
    const fakeIssue = { number: issueNumber, title: issueTitle, body: "", labels: [], url: "" };

    log.step("Committing and pushing...");
    const pushed = await commitAndPush(branch, fakeIssue, cwd);
    if (!pushed) return;

    log.step("Creating pull request...");
    const prUrl = await openPR(config, fakeIssue, branch, cwd);
    if (prUrl) {
      log.success(`PR created: ${prUrl}`);
    }
  }
}
