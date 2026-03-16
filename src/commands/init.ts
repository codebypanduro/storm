import { mkdir } from "fs/promises";
import { join } from "path";
import { CONFIG_DIR } from "../core/constants.js";
import { log } from "../core/output.js";

const STORM_JSON = `{
  "github": { "repo": "", "label": "storm", "baseBranch": "main" },
  "agent": { "command": "claude", "args": ["-p", "--dangerously-skip-permissions"], "model": "sonnet" },
  "defaults": { "maxIterations": 10, "delay": 2, "stopOnError": false, "parallel": false }
}
`;

const WORKFLOW_MD = `---
completable: true
---
You are an autonomous coding agent working on a GitHub issue.

## Issue
**#{{ issue.number }}: {{ issue.title }}**
{{ issue.body }}

## Context
{{ contexts }}

## Instructions
{{ instructions }}

## Task
Implement the changes described in the issue above. Follow the coding standards and conventions.
When you are confident the implementation is complete and all checks pass, output %%STORM_DONE%% on its own line.

{{ checks.failures }}
`;

const CHECK_MD = `---
command: bun tsc --noEmit
description: TypeScript type checking
---
`;

const INSTRUCTION_MD = `---
description: Default coding standards
---
- Write clean, readable TypeScript
- Follow existing project conventions
- Add tests for new functionality
`;

export async function initCommand(cwd: string) {
  const stormDir = join(cwd, CONFIG_DIR);

  const dirs = [
    stormDir,
    join(stormDir, "workflow"),
    join(stormDir, "checks", "typecheck"),
    join(stormDir, "instructions", "coding-standards"),
    join(stormDir, "contexts"),
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  const files: [string, string][] = [
    [join(stormDir, "storm.json"), STORM_JSON],
    [join(stormDir, "workflow", "WORKFLOW.md"), WORKFLOW_MD],
    [join(stormDir, "checks", "typecheck", "CHECK.md"), CHECK_MD],
    [join(stormDir, "instructions", "coding-standards", "INSTRUCTION.md"), INSTRUCTION_MD],
  ];

  for (const [path, content] of files) {
    const file = Bun.file(path);
    if (await file.exists()) {
      log.warn(`Skipping existing: ${path.replace(cwd + "/", "")}`);
      continue;
    }
    await Bun.write(path, content);
    log.success(`Created: ${path.replace(cwd + "/", "")}`);
  }

  log.info("");
  log.info("Storm initialized! Next steps:");
  log.info('  1. Set "repo" in .storm/storm.json (e.g. "owner/repo")');
  log.info("  2. Export GITHUB_TOKEN=ghp_...");
  log.info("  3. Run: storm list");
}
