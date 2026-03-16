import { Octokit } from "@octokit/rest";
import type { GitHubIssue } from "./types.js";
import { log } from "./output.js";

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    log.error("GITHUB_TOKEN environment variable is not set.");
    log.info("Create a token at https://github.com/settings/tokens");
    log.info("Export it: export GITHUB_TOKEN=ghp_...");
    process.exit(1);
  }
  return new Octokit({ auth: token });
}

export function parseRepo(repo: string): { owner: string; repo: string } {
  const parts = repo.split("/");
  if (parts.length !== 2) {
    log.error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
    process.exit(1);
  }
  return { owner: parts[0], repo: parts[1] };
}

export async function fetchLabeledIssues(
  repoStr: string,
  label: string
): Promise<GitHubIssue[]> {
  const octokit = getOctokit();
  const { owner, repo } = parseRepo(repoStr);

  const { data } = await octokit.issues.listForRepo({
    owner,
    repo,
    labels: label,
    state: "open",
    per_page: 100,
  });

  return data
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body || "",
      labels: issue.labels
        .map((l) => (typeof l === "string" ? l : l.name || ""))
        .filter(Boolean),
      url: issue.html_url,
    }));
}

export async function fetchIssue(
  repoStr: string,
  issueNumber: number
): Promise<GitHubIssue> {
  const octokit = getOctokit();
  const { owner, repo } = parseRepo(repoStr);

  const { data } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  return {
    number: data.number,
    title: data.title,
    body: data.body || "",
    labels: data.labels
      .map((l) => (typeof l === "string" ? l : l.name || ""))
      .filter(Boolean),
    url: data.html_url,
  };
}

export async function createPullRequest(
  repoStr: string,
  options: {
    title: string;
    body: string;
    head: string;
    base: string;
  }
): Promise<{ number: number; url: string }> {
  const octokit = getOctokit();
  const { owner, repo } = parseRepo(repoStr);

  const { data } = await octokit.pulls.create({
    owner,
    repo,
    title: options.title,
    body: options.body,
    head: options.head,
    base: options.base,
  });

  return { number: data.number, url: data.html_url };
}

export async function commentOnIssue(
  repoStr: string,
  issueNumber: number,
  body: string
): Promise<void> {
  const octokit = getOctokit();
  const { owner, repo } = parseRepo(repoStr);

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

export async function listPullRequests(
  repoStr: string,
  head?: string
): Promise<Array<{ number: number; title: string; url: string; state: string }>> {
  const octokit = getOctokit();
  const { owner, repo } = parseRepo(repoStr);

  const params: Parameters<typeof octokit.pulls.list>[0] = {
    owner,
    repo,
    state: "open",
    per_page: 100,
  };
  if (head) params.head = `${owner}:${head}`;

  const { data } = await octokit.pulls.list(params);

  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    state: pr.state,
  }));
}
