# storm-agent

Autonomous GitHub issue resolver powered by Claude Code. Fetches issues labeled "storm" and works them via an iterative agent loop — branching, coding, running checks, and opening PRs automatically.

## Requirements

- [Bun](https://bun.sh) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated, or a GitHub personal access token

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

### 3. Authenticate with GitHub

Storm automatically detects your GitHub credentials. Use either option:

**Option A: GitHub CLI (recommended)**

```bash
gh auth login
```

**Option B: Personal access token**

```bash
export GITHUB_TOKEN=ghp_...
```

If both are available, `GITHUB_TOKEN` takes priority.

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

# Multi-agent war room for complex tasks
storm war-room --issue 42

# War room with a free-form prompt
storm war-room --prompt "Refactor the auth module"

# War room with terminal UI enabled
storm war-room --issue 42 --ui

# Filter which agents participate
storm war-room --issue 42 --agents storm,johnny

# Preview war room setup without spawning agents
storm war-room --issue 42 --dry-run

# Address review feedback on an existing storm PR
storm continue 42

# Preview the continue prompt without executing
storm continue 42 --dry-run

# Update storm-agent to the latest version
storm update

# Register a project for global operations
storm global add .

# List all registered projects with issue counts
storm global list

# Run storm across all registered projects
storm global run

# Preview issues across all projects without executing
storm global run --dry-run

# Run all projects concurrently
storm global run --parallel

# Show branches and PRs across all projects
storm global status

# Unregister a project
storm global remove .
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

## Continuing PRs

The `storm continue` command picks up an existing PR, fetches reviewer feedback, and pushes follow-up commits to address it.

```bash
# Address review feedback on PR #42
storm continue 42

# Preview the resolved prompt without running the agent
storm continue 42 --dry-run
```

**How it works:**

1. Fetches the PR details and extracts the linked issue (`Closes #N`)
2. Fetches all review comments with file paths and diff hunks
3. Looks for a stored session ID from the original `storm run` (embedded in PR comments)
4. If a session ID is found, resumes the original Claude Code session — preserving full conversation context from the initial implementation
5. Runs the continue workflow (`.storm/continue/CONTINUE.md`) with reviewer feedback injected
6. Commits and pushes changes, then posts a summary comment on the PR

The continue template supports all standard placeholders plus PR-specific ones:

| Placeholder | Description |
|---|---|
| `{{ pr.number }}` | PR number |
| `{{ pr.title }}` | PR title |
| `{{ pr.body }}` | PR body |
| `{{ pr.diff }}` | Diff stat summary |
| `{{ pr.reviews }}` | Formatted review comments with file paths and diff hunks |

## War room

The `storm war-room` command launches a multi-agent session where several specialized agents collaborate on a complex task in a round-robin loop.

```bash
# Work on a GitHub issue with all default agents
storm war-room --issue 42

# Use a free-form prompt instead
storm war-room --prompt "Add dark mode support"

# Enable the real-time terminal UI
storm war-room --issue 42 --ui

# Only use specific agents
storm war-room --issue 42 --agents storm,johnny
```

**How it works:**

1. Loads agents — 3 defaults (Storm/Architect, Johnny/Engineer, Alan/QA) or custom agents from `.storm/agents/`
2. Creates a branch and enters a round-robin loop (up to 30 turns):
   - Each agent receives the task, its personality prompt, remaining kibble budget, and a log of all previous events
   - Agents can transfer kibble to other agents via `%%TRANSFER_KIBBLE:{amount}:{name}%%`
   - Tool uses that read or modify files cost 1 kibble; agents with 0 kibble are skipped
   - When an agent outputs `%%STORM_DONE%%`, the session ends
3. Commits, pushes, and opens a PR

**Terminal UI (`--ui`):**

When enabled (or auto-detected on a TTY), a split-panel ANSI interface renders in the alternate screen buffer:

- **Left panel** — agent list with kibble bars and tool counts
- **Right panel** — scrolling event log
- **Status bar** — current turn, active agent, last tool used, elapsed time

Falls back to plain log output on small terminals (< 60 cols or < 10 rows) or when piped.

**Custom agents:**

Create `.storm/agents/{id}/AGENT.md` with frontmatter:

```markdown
---
name: Designer
role: UI/UX
kibble: 15
model: opus
---
You are a UI/UX specialist. Focus on component structure, accessibility, and visual consistency.
```

| Field | Default | Description |
|---|---|---|
| `name` | directory name | Display name |
| `role` | `"Agent"` | Role label |
| `kibble` | `20` | Tool budget |
| `model` | config default | Override Claude model |

## Global mode

The `storm global` command lets you manage and run storm across multiple projects from a single place. Project paths are stored in `~/.storm/global.json`.

```bash
# Register projects
storm global add /path/to/project-a
storm global add .

# See all registered projects and their issue counts
storm global list

# Run storm across all projects sequentially
storm global run

# Run in parallel
storm global run --parallel

# Preview without executing
storm global run --dry-run

# Check status across all projects
storm global status

# Unregister a project
storm global remove /path/to/project-a
```

Projects must have a valid `.storm/storm.json` to be registered. Invalid or missing projects are skipped with a warning during `global run` and `global status`.

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
