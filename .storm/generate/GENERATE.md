---
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

%%STORM_ISSUE_START%%
{"title": "Short descriptive title", "body": "Detailed description in markdown explaining what the problem is, why it matters, and what a solution might look like.", "labels": ["storm", "enhancement"]}
%%STORM_ISSUE_END%%

Use label `bug` for bugs, `enhancement` for improvements or new features. Always include the `storm` label so the issue can be picked up by `storm run`.

Focus on actionable, well-scoped issues. Aim for 3–10 high-quality issues rather than an exhaustive list.

When you have finished generating all issues, output %%STORM_DONE%% on its own line.
