import { mkdir } from "fs/promises";
import { join } from "path";
import { CONFIG_DIR, ISSUE_START_MARKER, ISSUE_END_MARKER, STOP_MARKER } from "../core/constants.js";
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

const GENERATE_MD = `---
description: Analyze codebase and generate GitHub issues for improvements and new features
---
You are a code review agent. Your task is to analyze this codebase and identify opportunities for improvement.

## Context
{{ contexts }}

## Instructions
{{ instructions }}

## Task
Thoroughly explore the codebase and identify:

1. **Code quality issues** — bugs, performance problems, security vulnerabilities, or code smells
2. **Missing tests or documentation** — areas that lack adequate test coverage or documentation
3. **Refactoring opportunities** — duplicated logic, overly complex code, or poor abstractions
4. **New features** — capabilities that would meaningfully improve the application

For each issue you want to create, output it in the following format (one JSON object per block):

${ISSUE_START_MARKER}
{"title": "Short descriptive title", "body": "Detailed description in markdown explaining what the problem is, why it matters, and what a solution might look like.", "labels": ["storm", "enhancement"]}
${ISSUE_END_MARKER}

Use label \`bug\` for bugs, \`enhancement\` for improvements or new features. Always include the \`storm\` label so the issue can be picked up by \`storm run\`.

Focus on actionable, well-scoped issues. Aim for 3–10 high-quality issues rather than an exhaustive list.

When you have finished generating all issues, output ${STOP_MARKER} on its own line.
`;

export async function initCommand(cwd: string) {
  const stormDir = join(cwd, CONFIG_DIR);

  const dirs = [
    stormDir,
    join(stormDir, "workflow"),
    join(stormDir, "generate"),
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
    [join(stormDir, "generate", "GENERATE.md"), GENERATE_MD],
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
