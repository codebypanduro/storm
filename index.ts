#!/usr/bin/env bun
import { Command } from "commander";
import { initCommand } from "./src/commands/init.js";
import { listCommand } from "./src/commands/list.js";
import { runCommand } from "./src/commands/run.js";
import { statusCommand } from "./src/commands/status.js";
import {
  scheduleAddCommand,
  scheduleListCommand,
  scheduleRemoveCommand,
  scheduleDaemonCommand,
} from "./src/commands/schedule.js";

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

const schedule = program
  .command("schedule")
  .description("Manage scheduled storm runs");

schedule
  .command("add <cron>")
  .description('Add a cron schedule (e.g. "0 8 * * *" for daily at 8:00)')
  .option("-i, --issue <number>", "Only process a single issue by number", parseInt)
  .option("-d, --description <text>", "Optional description for this schedule")
  .action(async (cron: string, options) => {
    await scheduleAddCommand(process.cwd(), cron, {
      issue: options.issue,
      description: options.description,
    });
  });

schedule
  .command("list")
  .description("List all configured schedules")
  .action(async () => {
    await scheduleListCommand(process.cwd());
  });

schedule
  .command("remove <id>")
  .description("Remove a schedule by its id")
  .action(async (id: string) => {
    await scheduleRemoveCommand(process.cwd(), id);
  });

schedule
  .command("start")
  .description("Start the scheduler daemon (runs in foreground)")
  .action(async () => {
    await scheduleDaemonCommand(process.cwd());
  });

program.parse();
