import { githubApi } from "./exec.js";

export interface RepoInfo {
  name: string;
  stargazerCount: number;
  primaryLanguage: string;
  defaultBranch: string;
}

/** View repository metadata. */
export function viewRepo(repo: string): RepoInfo {
  const [owner, name] = repo.split("/");
  const raw = githubApi<{
    name: string;
    stargazers_count: number;
    language: string | null;
    default_branch: string;
  }>(`/repos/${owner}/${name}`);
  return {
    name: raw.name,
    stargazerCount: raw.stargazers_count,
    primaryLanguage: raw.language ?? "",
    defaultBranch: raw.default_branch,
  };
}
