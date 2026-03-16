#!/usr/bin/env bun
import { Command } from "commander";
import { initCommand } from "./src/commands/init.js";
import { listCommand } from "./src/commands/list.js";
import { runCommand } from "./src/commands/run.js";
import { statusCommand } from "./src/commands/status.js";
import { generateCommand } from "./src/commands/generate.js";
import { updateCommand } from "./src/commands/update.js";
import { continueCommand } from "./src/commands/continue.js";
import {
  globalAddCommand,
  globalRemoveCommand,
  globalListCommand,
  globalRunCommand,
  globalStatusCommand,
} from "./src/commands/global.js";

const program = new Command();

program
  .name("storm")
  .description("Autonomous GitHub issue resolver powered by Claude Code")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize .storm/ directory with default config and primitives")
  .action(async () => {
    await initCommand(process.cwd());
  });

program
  .command("list")
  .description("List open GitHub issues with the storm label")
  .action(async () => {
    await listCommand(process.cwd());
  });

program
  .command("run")
  .description("Process storm-labeled issues autonomously")
  .option("-i, --issue <number>", "Process a single issue by number", parseInt)
  .option("--dry-run", "Preview issues and resolved prompts without executing")
  .action(async (options) => {
    await runCommand(process.cwd(), { issue: options.issue, dryRun: options.dryRun });
  });

program
  .command("status")
  .description("Show storm branches and open PRs")
  .action(async () => {
    await statusCommand(process.cwd());
  });

program
  .command("generate")
  .description("Analyze the codebase and generate GitHub issues for improvements and new features")
  .option("--dry-run", "Preview issues without creating them on GitHub")
  .option("--max-issues <number>", "Maximum number of issues to create", parseInt)
  .action(async (options) => {
    await generateCommand(process.cwd(), {
      dryRun: options.dryRun,
      maxIssues: options.maxIssues,
    });
  });

program
  .command("continue <pr-number>")
  .description("Address review feedback on an existing storm PR")
  .option("--dry-run", "Preview the resolved prompt without executing")
  .action(async (prNumber: string, options: { dryRun?: boolean }) => {
    await continueCommand(process.cwd(), {
      prNumber: parseInt(prNumber, 10),
      dryRun: options.dryRun,
    });
  });

program
  .command("update")
  .description("Update storm-agent to the latest version")
  .action(async () => {
    await updateCommand();
  });

const globalCmd = program
  .command("global")
  .description("Manage and run storm across multiple projects");

globalCmd
  .command("add <path>")
  .description("Register a project path for global operations")
  .action(async (path: string) => {
    await globalAddCommand(path);
  });

globalCmd
  .command("remove <path>")
  .description("Unregister a project path")
  .action(async (path: string) => {
    await globalRemoveCommand(path);
  });

globalCmd
  .command("list")
  .description("Show registered projects with issue counts")
  .action(async () => {
    await globalListCommand();
  });

globalCmd
  .command("run")
  .description("Run storm across all registered projects")
  .option("--dry-run", "Preview issues without executing")
  .option("--parallel", "Run projects concurrently instead of sequentially")
  .action(async (options) => {
    await globalRunCommand({ dryRun: options.dryRun, parallel: options.parallel });
  });

globalCmd
  .command("status")
  .description("Show storm branches and PRs across all projects")
  .action(async () => {
    await globalStatusCommand();
  });

program.parse();
