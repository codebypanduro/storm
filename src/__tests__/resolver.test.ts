import { describe, it, expect } from "bun:test";
import { resolveTemplate, resolveGenerateTemplate } from "../core/resolver.js";
import type { GitHubIssue } from "../core/types.js";

const baseIssue: GitHubIssue = {
  number: 42,
  title: "My Issue",
  body: "Issue body text",
  labels: ["bug"],
  url: "https://github.com/owner/repo/issues/42",
};

describe("resolveTemplate", () => {
  it("resolves issue.number", () => {
    const result = resolveTemplate("Fix #{{ issue.number }}", {
      issue: baseIssue,
      contexts: new Map(),
      instructions: new Map(),
    });
    expect(result).toBe("Fix #42");
  });

  it("resolves issue.title", () => {
    const result = resolveTemplate("Title: {{ issue.title }}", {
      issue: baseIssue,
      contexts: new Map(),
      instructions: new Map(),
    });
    expect(result).toBe("Title: My Issue");
  });

  it("resolves issue.body", () => {
    const result = resolveTemplate("Body: {{ issue.body }}", {
      issue: baseIssue,
      contexts: new Map(),
      instructions: new Map(),
    });
    expect(result).toBe("Body: Issue body text");
  });

  it("resolves multiple issue placeholders in one template", () => {
    const result = resolveTemplate(
      "Fix {{ issue.title }} (#{{ issue.number }})",
      { issue: baseIssue, contexts: new Map(), instructions: new Map() }
    );
    expect(result).toBe("Fix My Issue (#42)");
  });

  it("handles whitespace variants in placeholders", () => {
    const result = resolveTemplate("{{issue.number}} and {{  issue.title  }}", {
      issue: baseIssue,
      contexts: new Map(),
      instructions: new Map(),
    });
    expect(result).toBe("42 and My Issue");
  });

  it("resolves named context placeholder", () => {
    const contexts = new Map([["coding-standards", "Write clean code"]]);
    const result = resolveTemplate("{{ contexts.coding-standards }}", {
      issue: baseIssue,
      contexts,
      instructions: new Map(),
    });
    expect(result).toBe("Write clean code");
  });

  it("resolves named instruction placeholder", () => {
    const instructions = new Map([["deploy", "Run bun deploy"]]);
    const result = resolveTemplate("{{ instructions.deploy }}", {
      issue: baseIssue,
      contexts: new Map(),
      instructions,
    });
    expect(result).toBe("Run bun deploy");
  });

  it("resolves bulk {{ contexts }} with multiple entries", () => {
    const contexts = new Map([
      ["a", "Value A"],
      ["b", "Value B"],
    ]);
    const result = resolveTemplate("{{ contexts }}", {
      issue: baseIssue,
      contexts,
      instructions: new Map(),
    });
    expect(result).toBe("### a\nValue A\n\n### b\nValue B");
  });

  it("renders fallback for empty {{ contexts }}", () => {
    const result = resolveTemplate("{{ contexts }}", {
      issue: baseIssue,
      contexts: new Map(),
      instructions: new Map(),
    });
    expect(result).toBe("_No contexts configured._");
  });

  it("renders fallback for empty {{ instructions }}", () => {
    const result = resolveTemplate("{{ instructions }}", {
      issue: baseIssue,
      contexts: new Map(),
      instructions: new Map(),
    });
    expect(result).toBe("_No instructions configured._");
  });

  it("omits check failures block when not provided", () => {
    const result = resolveTemplate("Before {{ checks.failures }} After", {
      issue: baseIssue,
      contexts: new Map(),
      instructions: new Map(),
    });
    expect(result).toBe("Before  After");
  });

  it("includes check failures block when provided", () => {
    const result = resolveTemplate("{{ checks.failures }}", {
      issue: baseIssue,
      contexts: new Map(),
      instructions: new Map(),
      checkFailures: "test failed",
    });
    expect(result).toContain("test failed");
    expect(result).toContain("Previous Check Failures");
  });

  it("leaves unknown placeholders unchanged", () => {
    const result = resolveTemplate("{{ unknown.placeholder }}", {
      issue: baseIssue,
      contexts: new Map(),
      instructions: new Map(),
    });
    expect(result).toBe("{{ unknown.placeholder }}");
  });
});

describe("resolveGenerateTemplate", () => {
  it("resolves named context placeholder", () => {
    const contexts = new Map([["foo", "bar"]]);
    const result = resolveGenerateTemplate("{{ contexts.foo }}", {
      contexts,
      instructions: new Map(),
    });
    expect(result).toBe("bar");
  });

  it("resolves named instruction placeholder", () => {
    const instructions = new Map([["step", "do this"]]);
    const result = resolveGenerateTemplate("{{ instructions.step }}", {
      contexts: new Map(),
      instructions,
    });
    expect(result).toBe("do this");
  });

  it("renders fallback for empty {{ contexts }}", () => {
    const result = resolveGenerateTemplate("{{ contexts }}", {
      contexts: new Map(),
      instructions: new Map(),
    });
    expect(result).toBe("_No contexts configured._");
  });

  it("renders fallback for empty {{ instructions }}", () => {
    const result = resolveGenerateTemplate("{{ instructions }}", {
      contexts: new Map(),
      instructions: new Map(),
    });
    expect(result).toBe("_No instructions configured._");
  });
});
