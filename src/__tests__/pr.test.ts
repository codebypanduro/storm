import { describe, it, expect } from "bun:test";
import { slugify, branchName } from "../core/pr.js";
import type { GitHubIssue } from "../core/types.js";

describe("slugify", () => {
  it("lowercases text", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("foo bar baz")).toBe("foo-bar-baz");
  });

  it("replaces special characters with hyphens", () => {
    expect(slugify("hello! world?")).toBe("hello-world");
  });

  it("collapses multiple consecutive non-alphanumeric chars into one hyphen", () => {
    expect(slugify("a---b")).toBe("a-b");
    expect(slugify("a   b")).toBe("a-b");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("  leading")).toBe("leading");
    expect(slugify("trailing  ")).toBe("trailing");
    expect(slugify("  both  ")).toBe("both");
  });

  it("handles unicode by stripping non-ascii characters", () => {
    // Non-ascii chars are not a-z0-9 so they become hyphens
    expect(slugify("café")).toMatch(/^caf/);
  });

  it("truncates to 50 characters", () => {
    const long = "a".repeat(60);
    expect(slugify(long).length).toBeLessThanOrEqual(50);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles string with only special characters", () => {
    expect(slugify("!@#$%")).toBe("");
  });

  it("handles numbers", () => {
    expect(slugify("Issue 123")).toBe("issue-123");
  });
});

describe("branchName", () => {
  const issue: GitHubIssue = {
    number: 12,
    title: "Add unit test suite",
    body: "",
    labels: [],
    url: "",
  };

  it("formats branch as storm/issue-{number}-{slug}", () => {
    expect(branchName(issue)).toBe("storm/issue-12-add-unit-test-suite");
  });

  it("uses slugified title", () => {
    const i: GitHubIssue = { ...issue, number: 7, title: "Fix: Bug in Auth!" };
    expect(branchName(i)).toBe("storm/issue-7-fix-bug-in-auth");
  });

  it("handles issue with number only in name", () => {
    const i: GitHubIssue = { ...issue, number: 1, title: "a" };
    expect(branchName(i)).toBe("storm/issue-1-a");
  });
});
