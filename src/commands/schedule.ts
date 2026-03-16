import { existsSync } from "fs";
import { join } from "path";
import { CONFIG_DIR } from "../core/constants.js";
import { log } from "../core/output.js";
import {
  addSchedule,
  removeSchedule,
  loadSchedules,
  validateCron,
  formatNextRun,
  matchesCron,
  updateLastRun,
} from "../core/scheduler.js";
import { loadConfig } from "../core/config.js";
import { fetchLabeledIssues, fetchIssue } from "../core/github.js";
import { processIssue, processIssueInWorktree, requestStop } from "../core/loop.js";

export async function scheduleAddCommand(
  cwd: string,
  cron: string,
  options: { issue?: number; description?: string }
): Promise<void> {
  if (!existsSync(join(cwd, CONFIG_DIR))) {
    log.error("No .storm/ directory found. Run `storm init` first.");
    process.exit(1);
  }

  try {
    validateCron(cron);
  } catch (err) {
    log.error((err as Error).message);
    process.exit(1);
  }

  const schedule = addSchedule(cwd, cron, {
    issueNumber: options.issue,
    description: options.description,
  });

  log.success(`Schedule added: ${schedule.id}`);
  log.info(`  Cron:     ${schedule.cron}`);
  if (schedule.issueNumber) {
    log.info(`  Issue:    #${schedule.issueNumber}`);
  } else {
    log.info(`  Issue:    all storm-labeled issues`);
  }
  if (schedule.description) {
    log.info(`  Note:     ${schedule.description}`);
  }
  log.info(`  Next run: ${formatNextRun(schedule.cron)}`);
}

export async function scheduleListCommand(cwd: string): Promise<void> {
  if (!existsSync(join(cwd, CONFIG_DIR))) {
    log.error("No .storm/ directory found. Run `storm init` first.");
    process.exit(1);
  }

  const { schedules } = loadSchedules(cwd);

  if (schedules.length === 0) {
    log.info("No schedules configured. Use `storm schedule add` to create one.");
    return;
  }

  log.info(`${schedules.length} schedule(s):\n`);
  for (const s of schedules) {
    const target = s.issueNumber ? `issue #${s.issueNumber}` : "all issues";
    const next = formatNextRun(s.cron);
    const last = s.lastRun ? new Date(s.lastRun).toLocaleString() : "never";
    console.log(`  ${s.id}  ${s.cron.padEnd(20)} → ${target}`);
    if (s.description) console.log(`           ${s.description}`);
    console.log(`           next: ${next}  |  last: ${last}`);
    console.log();
  }
}

export async function scheduleRemoveCommand(cwd: string, id: string): Promise<void> {
  if (!existsSync(join(cwd, CONFIG_DIR))) {
    log.error("No .storm/ directory found. Run `storm init` first.");
    process.exit(1);
  }

  const removed = removeSchedule(cwd, id);
  if (removed) {
    log.success(`Schedule ${id} removed.`);
  } else {
    log.error(`No schedule found with id "${id}".`);
    process.exit(1);
  }
}

export async function scheduleDaemonCommand(cwd: string): Promise<void> {
  if (!existsSync(join(cwd, CONFIG_DIR))) {
    log.error("No .storm/ directory found. Run `storm init` first.");
    process.exit(1);
  }

  const { schedules } = loadSchedules(cwd);
  if (schedules.length === 0) {
    log.warn("No schedules configured. Use `storm schedule add` to create one.");
    process.exit(0);
  }

  log.info(`Storm scheduler started with ${schedules.length} schedule(s).`);
  log.info("Press Ctrl+C to stop.\n");

  for (const s of schedules) {
    const target = s.issueNumber ? `issue #${s.issueNumber}` : "all issues";
    log.info(`  ${s.id}  ${s.cron}  → ${target}  (next: ${formatNextRun(s.cron)})`);
  }
  console.log();

  process.on("SIGINT", () => {
    log.warn("SIGINT received, shutting down scheduler...");
    requestStop();
    process.exit(0);
  });

  // Check every minute whether any schedule fires
  const tick = async () => {
    const now = new Date();
    // Zero out seconds for consistent cron matching
    const checkTime = new Date(now);
    checkTime.setSeconds(0, 0);

    const { schedules: current } = loadSchedules(cwd);

    for (const schedule of current) {
      if (!matchesCron(schedule.cron, checkTime)) continue;

      const target = schedule.issueNumber ? `issue #${schedule.issueNumber}` : "all issues";
      log.step(`[${schedule.id}] Firing schedule for ${target}`);

      updateLastRun(cwd, schedule.id);

      try {
        const config = await loadConfig(cwd);

        let issues;
        if (schedule.issueNumber) {
          const issue = await fetchIssue(config.github.repo, schedule.issueNumber);
          issues = [issue];
        } else {
          issues = await fetchLabeledIssues(config.github.repo, config.github.label);
        }

        if (issues.length === 0) {
          log.info(`[${schedule.id}] No issues to process.`);
          continue;
        }

        log.info(`[${schedule.id}] Processing ${issues.length} issue(s)...`);

        if (config.defaults.parallel && issues.length > 1) {
          await Promise.allSettled(
            issues.map((issue) => processIssueInWorktree(issue, config, cwd))
          );
        } else {
          for (const issue of issues) {
            await processIssue(issue, config, cwd);
          }
        }

        log.success(`[${schedule.id}] Done.`);
      } catch (err) {
        log.error(`[${schedule.id}] Error: ${(err as Error).message}`);
      }
    }
  };

  // Wait until the start of the next minute, then tick every 60s
  const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds();

  setTimeout(() => {
    tick();
    setInterval(tick, 60_000);
  }, msUntilNextMinute);

  // Keep the process alive
  await new Promise<void>(() => {});
}
