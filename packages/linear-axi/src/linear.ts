const GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

export class LinearApiError extends Error {
  details: Array<{ message?: string }>;

  constructor(message: string, details: Array<{ message?: string }> = []) {
    super(message);
    this.name = "LinearApiError";
    this.details = details;
  }
}

export function requireApiKey(env = process.env): string {
  const token = env.LINEAR_API_KEY || env.LINEAR_TOKEN;
  if (!token) {
    throw new LinearApiError("missing LINEAR_API_KEY or LINEAR_TOKEN");
  }
  return token;
}

export async function graphql<TData>(
  query: string,
  variables: Record<string, unknown> = {},
  options: { token?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<TData> {
  const token = options.token || requireApiKey(options.env);
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = (await response.json().catch(() => null)) as {
    data?: TData;
    errors?: Array<{ message?: string }>;
  } | null;

  if (!response.ok) {
    throw new LinearApiError(
      `Linear API returned HTTP ${response.status}`,
      body?.errors || [],
    );
  }
  if (body?.errors?.length) {
    throw new LinearApiError("Linear API returned GraphQL errors", body.errors);
  }
  if (!body?.data) {
    throw new LinearApiError("Linear API returned no data");
  }
  return body.data;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number | null;
  url: string;
  createdAt?: string;
  updatedAt?: string;
  assignee?: { name?: string | null; email?: string | null } | null;
  creator?: { name?: string | null; email?: string | null } | null;
  state?: { id?: string; name?: string | null; type?: string | null } | null;
  team?: { id?: string; key?: string | null; name?: string | null } | null;
  project?: { name?: string | null; url?: string | null } | null;
  labels?: { nodes?: Array<{ name?: string | null }> };
  comments?: {
    nodes?: Array<{
      id: string;
      body?: string | null;
      createdAt?: string;
      user?: { name?: string | null; email?: string | null } | null;
    }>;
  };
}

export async function getViewer(): Promise<{
  id: string;
  name: string;
  email?: string | null;
  organization?: { name?: string | null; urlKey?: string | null } | null;
}> {
  const data = await graphql<{
    viewer: {
      id: string;
      name: string;
      email?: string | null;
      organization?: { name?: string | null; urlKey?: string | null } | null;
    };
  }>(`
    query Viewer {
      viewer {
        id
        name
        email
        organization {
          name
          urlKey
        }
      }
    }
  `);
  return data.viewer;
}

export async function listAssignedIssues({
  first = 10,
  includeArchived = false,
}: {
  first?: number;
  includeArchived?: boolean;
} = {}): Promise<LinearIssue[]> {
  const data = await graphql<{
    viewer: { assignedIssues: { nodes: LinearIssue[] } };
  }>(
    `
      query AssignedIssues($first: Int!, $includeArchived: Boolean!) {
        viewer {
          assignedIssues(
            first: $first
            includeArchived: $includeArchived
            orderBy: updatedAt
          ) {
            nodes {
              id
              identifier
              title
              priority
              url
              updatedAt
              state {
                name
                type
              }
              team {
                key
                name
              }
            }
          }
        }
      }
    `,
    { first, includeArchived },
  );
  return data.viewer.assignedIssues.nodes;
}

export async function getIssue(id: string): Promise<LinearIssue | null> {
  const data = await graphql<{ issue: LinearIssue | null }>(
    `
      query Issue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          priority
          url
          createdAt
          updatedAt
          assignee {
            name
            email
          }
          creator {
            name
            email
          }
          state {
            id
            name
            type
          }
          team {
            id
            key
            name
          }
          project {
            name
            url
          }
          labels {
            nodes {
              name
            }
          }
          comments(first: 10, orderBy: createdAt) {
            nodes {
              id
              body
              createdAt
              user {
                name
                email
              }
            }
          }
        }
      }
    `,
    { id },
  );
  return data.issue;
}

export async function listWorkflowStates({
  teamId,
  first = 50,
}: {
  teamId?: string;
  first?: number;
} = {}): Promise<
  Array<{
    id: string;
    name?: string | null;
    type?: string | null;
    team?: { key?: string | null; name?: string | null } | null;
  }>
> {
  const query = teamId
    ? `
      query WorkflowStates($teamId: String!, $first: Int!) {
        workflowStates(first: $first, filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name type team { key name } }
        }
      }
    `
    : `
      query WorkflowStates($first: Int!) {
        workflowStates(first: $first) {
          nodes { id name type team { key name } }
        }
      }
    `;
  const data = await graphql<{
    workflowStates: {
      nodes: Array<{
        id: string;
        name?: string | null;
        type?: string | null;
        team?: { key?: string | null; name?: string | null } | null;
      }>;
    };
  }>(query, teamId ? { teamId, first } : { first });
  return data.workflowStates.nodes;
}

export async function createComment(
  issueId: string,
  body: string,
): Promise<{
  success: boolean;
  comment?: { id: string; url?: string | null; createdAt?: string } | null;
}> {
  const data = await graphql<{
    commentCreate: {
      success: boolean;
      comment?: { id: string; url?: string | null; createdAt?: string } | null;
    };
  }>(
    `
      mutation CommentCreate($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
          comment {
            id
            url
            createdAt
          }
        }
      }
    `,
    { issueId, body },
  );
  return data.commentCreate;
}

export async function updateIssue(
  issueId: string,
  input: { stateId: string },
): Promise<{
  success: boolean;
  issue?: LinearIssue | null;
}> {
  const data = await graphql<{
    issueUpdate: { success: boolean; issue?: LinearIssue | null };
  }>(
    `
      mutation IssueUpdate($issueId: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $issueId, input: $input) {
          success
          issue {
            id
            identifier
            title
            url
            state {
              name
              type
            }
            assignee {
              name
              email
            }
          }
        }
      }
    `,
    { issueId, input },
  );
  return data.issueUpdate;
}
