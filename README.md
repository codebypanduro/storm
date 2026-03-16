# storm-agent

Autonomous GitHub issue resolver powered by Claude Code. Fetches issues labeled "storm" and works them via an iterative agent loop — branching, coding, running checks, and opening PRs automatically.

## Requirements

- [Bun](https://bun.sh) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A GitHub personal access token with repo access

## Installation

### Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/codebypanduro/storm/main/install.sh | bash
```

### Manual install

```bash
git clone https://github.com/codebypanduro/storm.git
cd storm
bun install
```

To make the `storm` command available globally:

```bash
export PATH="$PWD:$PATH"
# or symlink it
ln -s "$PWD/index.ts" ~/.local/bin/storm
```

## Setup

### 1. Initialize a project

Navigate to your repo and run:

```bash
storm init
```

This creates a `.storm/` directory with default config and primitives.

### 2. Configure your repo

Edit `.storm/storm.json`:

```json
{
  "github": { "repo": "owner/repo", "label": "storm", "baseBranch": "main" },
  "agent": { "command": "claude", "args": ["-p", "--dangerously-skip-permissions"], "model": "sonnet" },
  "defaults": { "maxIterations": 10, "delay": 2, "stopOnError": false, "parallel": false }
}
```

### 3. Set your GitHub token

```bash
export GITHUB_TOKEN=ghp_...
```

## Usage

```bash
# List issues with the storm label
storm list

# Process all storm-labeled issues sequentially
storm run

# Process a single issue
storm run --issue 42

# Check storm branches and open PRs
storm status

# Analyze the codebase and generate GitHub issues
storm generate

# Preview generated issues without creating them
storm generate --dry-run

# Limit the number of issues created
storm generate --max-issues 5

# Update storm-agent to the latest version
storm update
```

## Generating issues

The `storm generate` command analyzes your codebase and automatically creates GitHub issues for improvements, bugs, and new features.

```bash
# Analyze and create issues
storm generate

# Preview what would be created without touching GitHub
storm generate --dry-run

# Cap the number of issues created
storm generate --max-issues 5
```

It uses `.storm/generate/GENERATE.md` as the prompt template (created by `storm init`). The agent explores the codebase and emits structured JSON blocks that storm parses and posts as GitHub issues — all with the configured label so `storm run` can pick them up automatically.

## Updating storm-agent

If you installed via the quick install script, update to the latest version with:

```bash
storm update
```

This pulls the latest changes from GitHub and reinstalls dependencies. Alternatively, re-run the original install script — it will `git pull` an existing installation:

```bash
curl -fsSL https://raw.githubusercontent.com/codebypanduro/storm/main/install.sh | bash
```

## How it works

For each issue, storm:

1. Checks out the base branch and creates `storm/issue-{n}-{slug}`
2. Enters an iteration loop (up to `maxIterations`):
   - Gathers context (runs commands or reads text from `.storm/contexts/`)
   - Loads instructions from `.storm/instructions/`
   - Resolves the workflow template with issue details, contexts, instructions, and any check failures
   - Spawns Claude Code with the resolved prompt
   - If the agent outputs `%%STORM_DONE%%`, the loop stops
   - Runs checks from `.storm/checks/` — failures are fed back into the next iteration
3. Commits, pushes, and opens a PR linking the issue

## Primitives

Primitives are markdown files with YAML frontmatter that live in `.storm/`. There are four kinds:

### Generate workflow (`.storm/generate/GENERATE.md`)

The prompt template used by `storm generate`. The agent reads this, explores the codebase, and emits issue JSON blocks.

```markdown
---
description: Analyze codebase and generate GitHub issues
---
You are a code review agent...
```

Supports `{{ contexts }}` and `{{ instructions }}` placeholders, same as the main workflow.

### Workflow (`.storm/workflow/WORKFLOW.md`)

The main prompt template. Supports placeholders:

| Placeholder | Description |
|---|---|
| `{{ issue.number }}` | Issue number |
| `{{ issue.title }}` | Issue title |
| `{{ issue.body }}` | Issue body |
| `{{ contexts }}` | All context entries combined |
| `{{ contexts.name }}` | A specific context by name |
| `{{ instructions }}` | All instruction entries combined |
| `{{ instructions.name }}` | A specific instruction by name |
| `{{ checks.failures }}` | Check failure output from previous iteration |

### Checks (`.storm/checks/{name}/CHECK.md`)

Commands that validate the agent's work. Failures are fed back so the agent can self-correct.

```markdown
---
command: bun tsc --noEmit
description: TypeScript type checking
---
```

### Instructions (`.storm/instructions/{name}/INSTRUCTION.md`)

Static text injected into the prompt to guide the agent.

```markdown
---
description: Default coding standards
---
- Write clean, readable TypeScript
- Follow existing project conventions
- Add tests for new functionality
```

### Contexts (`.storm/contexts/{name}/CONTEXT.md`)

Dynamic or static context. If a `command` is specified, its stdout is captured. Otherwise the body text is used.

```markdown
---
command: git log --oneline -20
description: Recent commit history
---
```

### Disabling a primitive

Set `enabled: false` in the frontmatter:

```markdown
---
command: bun test
description: Unit tests
enabled: false
---
```

## Parallel mode

Set `"parallel": true` in `storm.json` to process multiple issues concurrently using git worktrees. Each issue gets its own isolated working copy.

## Configuration reference

| Key | Default | Description |
|---|---|---|
| `github.repo` | `""` | GitHub repo in `owner/repo` format |
| `github.label` | `"storm"` | Issue label to filter by |
| `github.baseBranch` | `"main"` | Branch to base work on |
| `agent.command` | `"claude"` | Agent CLI command |
| `agent.args` | `["-p", "--dangerously-skip-permissions"]` | Agent CLI arguments |
| `agent.model` | `"sonnet"` | Claude model to use |
| `defaults.maxIterations` | `10` | Max agent iterations per issue |
| `defaults.delay` | `2` | Seconds between iterations |
| `defaults.stopOnError` | `false` | Stop on agent errors |
| `defaults.parallel` | `false` | Process issues in parallel via worktrees |

## License

MIT
