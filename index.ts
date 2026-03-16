#!/usr/bin/env bun
import { Command } from "commander";
import { initCommand } from "./src/commands/init.js";
import { listCommand } from "./src/commands/list.js";
import { runCommand } from "./src/commands/run.js";
import { statusCommand } from "./src/commands/status.js";

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
  .action(async (options) => {
    await runCommand(process.cwd(), { issue: options.issue });
  });

program
  .command("status")
  .description("Show storm branches and open PRs")
  .action(async () => {
    await statusCommand(process.cwd());
  });

program.parse();
