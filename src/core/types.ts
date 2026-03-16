export interface StormConfig {
  github: {
    repo: string;
    label: string;
    baseBranch: string;
  };
  agent: {
    command: string;
    args: string[];
    model: string;
  };
  defaults: {
    maxIterations: number;
    delay: number;
    stopOnError: boolean;
    parallel: boolean;
  };
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
}

export interface PrimitiveFrontmatter {
  command?: string;
  description?: string;
  enabled?: boolean;
  timeout?: number;
  completable?: boolean;
}

export interface PrimitiveEntry {
  name: string;
  kind: "check" | "instruction" | "context" | "workflow";
  frontmatter: PrimitiveFrontmatter;
  body: string;
  filePath: string;
}

export interface AgentResult {
  output: string;
  exitCode: number;
  done: boolean;
  timedOut: boolean;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  output: string;
  command: string;
}

export interface CheckResults {
  results: CheckResult[];
  allPassed: boolean;
  failureSummary: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}
