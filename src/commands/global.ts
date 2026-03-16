import { existsSync } from "fs";
import { join, basename } from "path";
import pc from "picocolors";
import {
  loadGlobalConfig,
  addProject,
  removeProject,
} from "../core/global-config.js";
import { loadConfig, validateConfig } from "../core/config.js";
import { fetchLabeledIssues } from "../core/github.js";
import { log } from "../core/output.js";
import { CONFIG_DIR } from "../core/constants.js";
import { runCommand } from "./run.js";
import { statusCommand } from "./status.js";

export async function globalAddCommand(path: string) {
  const result = await addProject(path);
  if (result.added) {
    log.success(`Registered project: ${result.resolved}`);
  } else {
    log.error(result.error ?? `Failed to add: ${result.resolved}`);
    process.exit(1);
  }
}

export async function globalRemoveCommand(path: string) {
  const result = await removeProject(path);
  if (result.removed) {
    log.success(`Unregistered project: ${result.resolved}`);
  } else {
    log.warn(`Project not found in global config: ${result.resolved}`);
  }
}

export async function globalListCommand() {
  const globalConfig = await loadGlobalConfig();

  if (globalConfig.projects.length === 0) {
    log.info("No projects registered. Use `storm global add <path>` to add one.");
    return;
  }

  console.log("");
  for (const project of globalConfig.projects) {
    const name = basename(project.path);
    const configExists = existsSync(join(project.path, CONFIG_DIR));

    if (!configExists) {
      console.log(`  ${pc.bold(name)}  ${pc.dim(project.path)}  ${pc.red("(missing .storm/)")}`);
      continue;
    }

    try {
      const config = await loadConfig(project.path);
      const errors = validateConfig(config);
      if (errors.length > 0) {
        console.log(`  ${pc.bold(name)}  ${pc.dim(project.path)}  ${pc.yellow("(invalid config)")}`);
        continue;
      }

      const issues = await fetchLabeledIssues(config.github.repo, config.github.label);
      console.log(
        `  ${pc.bold(name)}  ${pc.dim(project.path)}  ${pc.cyan(`${issues.length} issue(s)`)}`
      );
    } catch (err) {
      console.log(`  ${pc.bold(name)}  ${pc.dim(project.path)}  ${pc.red("(error loading)")}`);
    }
  }
  console.log("");
}

export async function globalRunCommand(options: { dryRun?: boolean; parallel?: boolean }) {
  const globalConfig = await loadGlobalConfig();

  if (globalConfig.projects.length === 0) {
    log.info("No projects registered. Use `storm global add <path>` to add one.");
    return;
  }

  const projects = globalConfig.projects.filter((p) => {
    if (!existsSync(join(p.path, CONFIG_DIR))) {
      log.warn(`Skipping ${p.path} — missing ${CONFIG_DIR}/`);
      return false;
    }
    return true;
  });

  if (projects.length === 0) {
    log.info("No valid projects to run.");
    return;
  }

  if (options.parallel) {
    log.info(`Running across ${projects.length} project(s) in parallel...`);
    const results = await Promise.allSettled(
      projects.map(async (project) => {
        const name = basename(project.path);
        try {
          console.log("");
          log.step(`[${name}] Starting...`);
          await runCommand(project.path, { dryRun: options.dryRun });
          log.success(`[${name}] Completed`);
        } catch (err) {
          log.error(`[${name}] Failed: ${err}`);
        }
      })
    );
  } else {
    log.info(`Running across ${projects.length} project(s) sequentially...`);
    for (const project of projects) {
      const name = basename(project.path);
      console.log("");
      log.step(`${"=".repeat(40)}`);
      log.step(`Project: ${pc.bold(name)} (${project.path})`);
      log.step(`${"=".repeat(40)}`);

      try {
        await runCommand(project.path, { dryRun: options.dryRun });
      } catch (err) {
        log.error(`[${name}] Failed: ${err}`);
        log.warn("Continuing to next project...");
      }
    }
  }

  console.log("");
  log.success("Global run complete.");
}

export async function globalStatusCommand() {
  const globalConfig = await loadGlobalConfig();

  if (globalConfig.projects.length === 0) {
    log.info("No projects registered. Use `storm global add <path>` to add one.");
    return;
  }

  for (const project of globalConfig.projects) {
    const name = basename(project.path);

    if (!existsSync(join(project.path, CONFIG_DIR))) {
      log.warn(`Skipping ${name} — missing ${CONFIG_DIR}/`);
      continue;
    }

    console.log("");
    log.step(`${"=".repeat(40)}`);
    log.step(`Project: ${pc.bold(name)} (${project.path})`);
    log.step(`${"=".repeat(40)}`);

    try {
      await statusCommand(project.path);
    } catch (err) {
      log.error(`[${name}] Failed: ${err}`);
    }
  }
}
