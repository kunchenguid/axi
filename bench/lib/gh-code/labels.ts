import { githubApi } from "./exec.js";

export interface Label {
  name: string;
}

export interface ListLabelsOpts {
  limit?: number;
}

/** List labels for a repository. */
export function listLabels(repo: string, opts?: ListLabelsOpts): Label[] {
  const [owner, name] = repo.split("/");
  const perPage = opts?.limit ?? 30;
  const raw = githubApi<Array<{ name: string }>>(
    `/repos/${owner}/${name}/labels?per_page=${perPage}`,
  );
  return raw.map((l) => ({ name: l.name }));
}
