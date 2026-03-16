import type { GitHubIssue } from "./types.js";

export function resolveGenerateTemplate(
  template: string,
  options: {
    contexts: Map<string, string>;
    instructions: Map<string, string>;
  }
): string {
  let result = template;
  const { contexts, instructions } = options;

  // Named context placeholders: {{ contexts.name }}
  for (const [name, value] of contexts) {
    const pattern = new RegExp(`\\{\\{\\s*contexts\\.${escapeRegex(name)}\\s*\\}\\}`, "g");
    result = result.replace(pattern, value);
  }

  // Named instruction placeholders: {{ instructions.name }}
  for (const [name, value] of instructions) {
    const pattern = new RegExp(`\\{\\{\\s*instructions\\.${escapeRegex(name)}\\s*\\}\\}`, "g");
    result = result.replace(pattern, value);
  }

  // Bulk contexts placeholder: {{ contexts }}
  const allContexts = Array.from(contexts.entries())
    .map(([name, value]) => `### ${name}\n${value}`)
    .join("\n\n");
  result = result.replace(/\{\{\s*contexts\s*\}\}/g, allContexts || "_No contexts configured._");

  // Bulk instructions placeholder: {{ instructions }}
  const allInstructions = Array.from(instructions.entries())
    .map(([name, value]) => `### ${name}\n${value}`)
    .join("\n\n");
  result = result.replace(/\{\{\s*instructions\s*\}\}/g, allInstructions || "_No instructions configured._");

  return result;
}

export function resolveTemplate(
  template: string,
  options: {
    issue: GitHubIssue;
    contexts: Map<string, string>;
    instructions: Map<string, string>;
    checkFailures?: string;
  }
): string {
  let result = template;
  const { issue, contexts, instructions, checkFailures } = options;

  // Issue placeholders
  result = result.replace(/\{\{\s*issue\.number\s*\}\}/g, String(issue.number));
  result = result.replace(/\{\{\s*issue\.title\s*\}\}/g, issue.title);
  result = result.replace(/\{\{\s*issue\.body\s*\}\}/g, issue.body);

  // Named context placeholders: {{ contexts.name }}
  for (const [name, value] of contexts) {
    const pattern = new RegExp(`\\{\\{\\s*contexts\\.${escapeRegex(name)}\\s*\\}\\}`, "g");
    result = result.replace(pattern, value);
  }

  // Named instruction placeholders: {{ instructions.name }}
  for (const [name, value] of instructions) {
    const pattern = new RegExp(`\\{\\{\\s*instructions\\.${escapeRegex(name)}\\s*\\}\\}`, "g");
    result = result.replace(pattern, value);
  }

  // Bulk contexts placeholder: {{ contexts }}
  const allContexts = Array.from(contexts.entries())
    .map(([name, value]) => `### ${name}\n${value}`)
    .join("\n\n");
  result = result.replace(/\{\{\s*contexts\s*\}\}/g, allContexts || "_No contexts configured._");

  // Bulk instructions placeholder: {{ instructions }}
  const allInstructions = Array.from(instructions.entries())
    .map(([name, value]) => `### ${name}\n${value}`)
    .join("\n\n");
  result = result.replace(/\{\{\s*instructions\s*\}\}/g, allInstructions || "_No instructions configured._");

  // Check failures placeholder
  const failureBlock = checkFailures
    ? `## Previous Check Failures\nThe following checks failed in the previous iteration. Please fix them:\n\n${checkFailures}`
    : "";
  result = result.replace(/\{\{\s*checks\.failures\s*\}\}/g, failureBlock);

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
