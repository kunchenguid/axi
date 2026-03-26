import { callMcpTool, githubApi } from "./exec.js";

export interface PR {
  number: number;
  title: string;
  state: string;
  author: string;
  isDraft: boolean;
  mergedAt: string | null;
}

export interface CheckSummary {
  name: string;
  status: string;
  conclusion: string;
}

/** View a single pull request. */
export function viewPR(repo: string, number: number): PR {
  const [owner, name] = repo.split("/");
  const raw = callMcpTool<any>("pull_request_read", { owner, repo: name, pullNumber: number, method: "get" });
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    author: raw.user?.login ?? raw.author?.login ?? "",
    isDraft: raw.draft ?? raw.isDraft ?? false,
    mergedAt: raw.merged_at ?? raw.mergedAt ?? null,
  };
}

/** List status checks for a pull request. */
export function listChecks(repo: string, prNumber: number): CheckSummary[] {
  const [owner, name] = repo.split("/");
  const raw = callMcpTool<{
    total_count: number;
    check_runs: Array<{
      name: string;
      status: string;
      conclusion: string | null;
    }>;
  }>("pull_request_read", { owner, repo: name, pullNumber: prNumber, method: "get_check_runs" });
  return (raw.check_runs ?? []).map((c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? "",
  }));
}
