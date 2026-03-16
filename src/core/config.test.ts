import { describe, it, expect } from "bun:test";
import { validateConfig, getDefaultConfig } from "./config.js";

describe("validateConfig", () => {
  it("returns no errors for a valid config", () => {
    const config = getDefaultConfig();
    config.github.repo = "owner/repo";
    expect(validateConfig(config)).toEqual([]);
  });

  it("errors when github.repo is empty", () => {
    const config = getDefaultConfig();
    config.github.repo = "";
    const errors = validateConfig(config);
    expect(errors).toContain('github.repo is required (e.g. "owner/repo")');
  });

  it("errors when github.repo has no slash", () => {
    const config = getDefaultConfig();
    config.github.repo = "justarepo";
    const errors = validateConfig(config);
    expect(errors).toContain('github.repo must be in "owner/repo" format');
  });

  it("does not double-error when repo is empty (no slash check)", () => {
    const config = getDefaultConfig();
    config.github.repo = "";
    const errors = validateConfig(config);
    expect(errors).not.toContain('github.repo must be in "owner/repo" format');
  });

  it("errors when maxIterations is 0", () => {
    const config = getDefaultConfig();
    config.github.repo = "owner/repo";
    config.defaults.maxIterations = 0;
    const errors = validateConfig(config);
    expect(errors).toContain("defaults.maxIterations must be >= 1");
  });

  it("errors when maxIterations is negative", () => {
    const config = getDefaultConfig();
    config.github.repo = "owner/repo";
    config.defaults.maxIterations = -5;
    const errors = validateConfig(config);
    expect(errors).toContain("defaults.maxIterations must be >= 1");
  });

  it("errors when agent.command is empty", () => {
    const config = getDefaultConfig();
    config.github.repo = "owner/repo";
    config.agent.command = "";
    const errors = validateConfig(config);
    expect(errors).toContain("agent.command is required");
  });

  it("collects multiple errors", () => {
    const config = getDefaultConfig();
    config.github.repo = "";
    config.defaults.maxIterations = 0;
    config.agent.command = "";
    const errors = validateConfig(config);
    expect(errors.length).toBe(3);
  });
});
