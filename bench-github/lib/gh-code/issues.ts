import { callMcpTool, githubApi } from "./exec.js";

export interface Issue {
  number: number;
  title: string;
  state: string;
  author: string;
}

export interface IssueDetail extends Issue {
  body: string;
  createdAt: string;
}

export interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface ListIssuesOpts {
  state?: "open" | "closed" | "all";
  limit?: number;
}

/** List issues for a repository. */
export function listIssues(repo: string, opts?: ListIssuesOpts): Issue[] {
  const [owner, name] = repo.split("/");
  const args: Record<string, unknown> = { owner, repo: name };
  if (opts?.state) args.state = opts.state;
  args.per_page = opts?.limit ?? 30;

  const response = callMcpTool<any>("list_issues", args);
  const raw = response.issues ?? response;
  return raw.map((i: any) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    author: i.user?.login ?? i.author?.login ?? "",
  }));
}

/** View a single issue. */
export function viewIssue(repo: string, number: number): IssueDetail {
  const [owner, name] = repo.split("/");
  const raw = callMcpTool<any>("issue_read", { owner, repo: name, issue_number: number, method: "get" });
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    author: raw.user?.login ?? raw.author?.login ?? "",
    body: raw.body ?? "",
    createdAt: raw.created_at ?? raw.createdAt ?? "",
  };
}

/** List comments on an issue. */
export function listComments(repo: string, issueNumber: number): IssueComment[] {
  const [owner, name] = repo.split("/");
  const raw = callMcpTool<Array<{
    user: { login: string };
    body: string;
    created_at: string;
  }>>("issue_read", { owner, repo: name, issue_number: issueNumber, method: "get_comments" });
  return raw.map((c) => ({
    author: c.user.login,
    body: c.body,
    createdAt: c.created_at,
  }));
}
