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

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface AgentResult {
  output: string;
  exitCode: number;
  done: boolean;
  timedOut: boolean;
  usage?: AgentUsage;
  sessionId?: string;
  durationMs: number;
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

export interface GeneratedIssue {
  title: string;
  body: string;
  labels: string[];
}

export interface ConflictInfo {
  conflictedFiles: string[];
  conflictDetails: string;
}

export interface PRComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface PRReviewContext {
  prNumber: number;
  prTitle: string;
  prBody: string;
  prBranch: string;
  baseBranch: string;
  diffSummary: string;
  reviews: PRReview[];
  linkedIssue: GitHubIssue;
  sessionId?: string;
  conflicts?: ConflictInfo;
  comments?: PRComment[];
}

export interface PRReview {
  author: string;
  state: string;
  body: string;
  comments: PRReviewComment[];
}

export interface PRReviewComment {
  author: string;
  body: string;
  path: string;
  line: number | null;
  diffHunk: string;
}
