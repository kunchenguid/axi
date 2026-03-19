import { callMcpTool } from "./exec.js";

export interface Release {
  tagName: string;
  name: string;
  publishedAt: string;
}

export interface ReleaseDetail extends Release {
  body: string;
  author: string;
}

export interface ListReleasesOpts {
  limit?: number;
}

/** List releases for a repository. */
export function listReleases(repo: string, opts?: ListReleasesOpts): Release[] {
  const [owner, name] = repo.split("/");
  const raw = callMcpTool<any[]>("list_releases", {
    owner,
    repo: name,
    per_page: opts?.limit ?? 30,
  });
  return raw.map((r: any) => ({
    tagName: r.tag_name ?? r.tagName ?? "",
    name: r.name ?? "",
    publishedAt: r.published_at ?? r.publishedAt ?? "",
  }));
}

/** View a single release by tag. */
export function viewRelease(repo: string, tag: string): ReleaseDetail {
  const [owner, name] = repo.split("/");
  const raw = callMcpTool<any>("get_release_by_tag", { owner, repo: name, tag });
  return {
    tagName: raw.tag_name ?? raw.tagName ?? "",
    name: raw.name ?? "",
    body: raw.body ?? "",
    author: raw.author?.login ?? "",
    publishedAt: raw.published_at ?? raw.publishedAt ?? "",
  };
}
