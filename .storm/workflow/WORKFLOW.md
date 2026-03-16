---
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
