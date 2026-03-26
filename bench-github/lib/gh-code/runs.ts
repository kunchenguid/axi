import { githubApi } from "./exec.js";

export interface Run {
  databaseId: number;
  displayTitle: string;
  status: string;
  conclusion: string;
  workflowName: string;
  headBranch: string;
  event: string;
  createdAt: string;
}

export interface RunDetail {
  databaseId: number;
  displayTitle: string;
  status: string;
  conclusion: string;
  workflowName: string;
  headBranch: string;
  jobs: Array<{
    name: string;
    status: string;
    conclusion: string;
  }>;
}

export interface ListRunsOpts {
  limit?: number;
}

/** List workflow runs for a repository. */
export function listRuns(repo: string, opts?: ListRunsOpts): Run[] {
  const [owner, name] = repo.split("/");
  const perPage = opts?.limit ?? 30;
  const raw = githubApi<{
    workflow_runs: Array<{
      id: number;
      display_title: string;
      status: string;
      conclusion: string | null;
      name: string;
      head_branch: string;
      event: string;
      created_at: string;
    }>;
  }>(`/repos/${owner}/${name}/actions/runs?per_page=${perPage}`);
  return (raw.workflow_runs ?? []).map((r) => ({
    databaseId: r.id,
    displayTitle: r.display_title,
    status: r.status,
    conclusion: r.conclusion ?? "",
    workflowName: r.name,
    headBranch: r.head_branch,
    event: r.event,
    createdAt: r.created_at,
  }));
}

/** View a single workflow run. */
export function viewRun(repo: string, id: number): RunDetail {
  const [owner, name] = repo.split("/");
  const run = githubApi<{
    id: number;
    display_title: string;
    status: string;
    conclusion: string | null;
    name: string;
    head_branch: string;
  }>(`/repos/${owner}/${name}/actions/runs/${id}`);
  const jobsRaw = githubApi<{
    jobs: Array<{
      name: string;
      status: string;
      conclusion: string | null;
    }>;
  }>(`/repos/${owner}/${name}/actions/runs/${id}/jobs`);
  return {
    databaseId: run.id,
    displayTitle: run.display_title,
    status: run.status,
    conclusion: run.conclusion ?? "",
    workflowName: run.name,
    headBranch: run.head_branch,
    jobs: (jobsRaw.jobs ?? []).map((j) => ({
      name: j.name,
      status: j.status,
      conclusion: j.conclusion ?? "",
    })),
  };
}
