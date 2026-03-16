import { Octokit } from "@octokit/rest";
import type { GitHubIssue, GeneratedIssue, PRReview, PRReviewComment } from "./types.js";
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

export async function createIssue(
  repoStr: string,
  issue: GeneratedIssue
): Promise<{ number: number; url: string }> {
  const octokit = getOctokit();
  const { owner, repo } = parseRepo(repoStr);

  const { data } = await octokit.issues.create({
    owner,
    repo,
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
  });

  return { number: data.number, url: data.html_url };
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

export async function fetchPullRequest(
  repoStr: string,
  prNumber: number
): Promise<{ title: string; body: string; headBranch: string; baseBranch: string; url: string }> {
  const octokit = getOctokit();
  const { owner, repo } = parseRepo(repoStr);

  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  return {
    title: data.title,
    body: data.body || "",
    headBranch: data.head.ref,
    baseBranch: data.base.ref,
    url: data.html_url,
  };
}

export async function fetchPRReviews(
  repoStr: string,
  prNumber: number
): Promise<PRReview[]> {
  const octokit = getOctokit();
  const { owner, repo } = parseRepo(repoStr);

  const [{ data: reviews }, { data: comments }] = await Promise.all([
    octokit.pulls.listReviews({ owner, repo, pull_number: prNumber, per_page: 100 }),
    octokit.pulls.listReviewComments({ owner, repo, pull_number: prNumber, per_page: 100 }),
  ]);

  // Group comments by review ID, with top-level comments (no review) grouped separately
  const commentsByReview = new Map<number, PRReviewComment[]>();
  for (const c of comments) {
    const reviewId = c.pull_request_review_id ?? 0;
    if (!commentsByReview.has(reviewId)) {
      commentsByReview.set(reviewId, []);
    }
    commentsByReview.get(reviewId)!.push({
      author: c.user?.login ?? "unknown",
      body: c.body,
      path: c.path,
      line: c.line ?? c.original_line ?? null,
      diffHunk: c.diff_hunk,
    });
  }

  const result: PRReview[] = [];

  for (const review of reviews) {
    // Skip empty approvals with no body and no comments
    const reviewComments = commentsByReview.get(review.id) ?? [];
    if (!review.body && reviewComments.length === 0) continue;

    result.push({
      author: review.user?.login ?? "unknown",
      state: review.state,
      body: review.body || "",
      comments: reviewComments,
    });
    commentsByReview.delete(review.id);
  }

  // Add orphaned comments (not linked to a review)
  const orphaned = commentsByReview.get(0);
  if (orphaned && orphaned.length > 0) {
    result.push({
      author: orphaned[0].author,
      state: "COMMENTED",
      body: "",
      comments: orphaned,
    });
  }

  return result;
}

export async function fetchPRSessionId(
  repoStr: string,
  prNumber: number
): Promise<string | undefined> {
  const octokit = getOctokit();
  const { owner, repo } = parseRepo(repoStr);

  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const pattern = /<!-- storm:session_id=([a-f0-9-]+) -->/;
  for (const comment of comments) {
    const match = comment.body?.match(pattern);
    if (match) return match[1];
  }

  // Also check PR body
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  const bodyMatch = pr.body?.match(pattern);
  if (bodyMatch) return bodyMatch[1];

  return undefined;
}
