import { existsSync } from "fs";
import { join } from "path";
import { loadConfig, validateConfig } from "../core/config.js";
import { fetchIssue } from "../core/github.js";
import { log } from "../core/output.js";
import { CONFIG_DIR } from "../core/constants.js";
import { loadWarRoomAgents } from "../primitives/war-room-agent.js";
import { createWarRoomSession, runWarRoom } from "../core/war-room.js";
import { branchName, checkoutBase, createBranch, commitAndPush, openPR } from "../core/pr.js";
import type { WarRoomOptions, GitHubIssue } from "../core/types.js";

export async function warRoomCommand(cwd: string, options: WarRoomOptions) {
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

  if (!options.issue && !options.prompt) {
    log.error("Either --issue <number> or --prompt <text> is required.");
    process.exit(1);
  }

  const { dryRun = false } = options;

  // SIGINT handler
  const controller = new AbortController();
  process.on("SIGINT", () => {
    log.warn("SIGINT received, finishing current turn...");
    controller.abort();
  });

  // Resolve task from issue or prompt
  let task: string;
  let issue: GitHubIssue | undefined;

  if (options.issue) {
    issue = await fetchIssue(config.github.repo, options.issue);
    task = `Issue #${issue.number}: ${issue.title}\n\n${issue.body}`;
  } else {
    task = options.prompt!;
  }

  // Load agents
  const agents = await loadWarRoomAgents(cwd, options.agents);
  log.info(
    `Loaded ${agents.length} agent(s): ${agents.map((a) => `${a.name} (${a.role})`).join(", ")}`
  );

  if (dryRun) {
    log.warn("Dry run — no agents will be spawned");
    log.info(`Task: ${task}`);
    for (const agent of agents) {
      log.info(`  ${agent.name} / ${agent.role} [kibble: ${agent.kibble}, model: ${agent.model}]`);
    }
    return;
  }

  // Create branch
  let branch: string;

  if (issue) {
    branch = branchName(issue);
    if (!(await checkoutBase(config.github.baseBranch, cwd))) {
      process.exit(1);
    }
    if (!(await createBranch(branch, cwd))) {
      process.exit(1);
    }
  } else {
    const slug = task
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    branch = `storm/war-room-${Date.now()}-${slug}`;
    if (!(await checkoutBase(config.github.baseBranch, cwd))) {
      process.exit(1);
    }
    if (!(await createBranch(branch, cwd))) {
      process.exit(1);
    }
  }

  // Create and run war room session
  const session = createWarRoomSession(task, agents, issue?.number);
  log.info(`Starting war room session ${session.id}`);

  const result = await runWarRoom(session, config, cwd, controller.signal);

  if (!result.success) {
    log.error("War room ended without completing the task");
    process.exit(1);
  }

  // Commit and push
  log.step("Committing and pushing...");
  const fakeIssue: GitHubIssue = issue ?? {
    number: 0,
    title: task.slice(0, 50),
    body: task,
    labels: [],
    url: "",
  };

  const commitMsg = issue
    ? `storm: war-room #${issue.number} - ${issue.title}`
    : `storm: war-room - ${fakeIssue.title}`;

  const pushed = await commitAndPush(branch, fakeIssue, cwd, commitMsg);
  if (!pushed) {
    log.error("Failed to commit and push");
    process.exit(1);
  }

  // Open PR if we have a linked issue
  if (issue) {
    log.step("Creating pull request...");
    const prUrl = await openPR(config, issue, branch, cwd);
    if (prUrl) {
      log.success(`War room complete: ${prUrl}`);
    } else {
      log.warn("War room complete but PR creation failed");
    }
  } else {
    log.success(`War room complete on branch: ${branch}`);
  }
}
