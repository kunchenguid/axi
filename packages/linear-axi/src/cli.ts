import { AxiError, runAxiCli } from "axi-sdk-js";
import {
  LinearApiError,
  createComment,
  getIssue,
  getViewer,
  listAssignedIssues,
  listWorkflowStates,
  updateIssue,
  type LinearIssue,
} from "./linear.js";

const VERSION = "0.1.0";

type AxiOutput = Record<string, unknown>;

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function intFlag(args: string[], name: string, fallback: number): number {
  const value = flag(args, name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) {
    throw new AxiError(`Missing ${name}`, "VALIDATION_ERROR", [
      "Run `linear-axi --help` for usage",
    ]);
  }
  return value;
}

function issueRow(issue: LinearIssue): Record<string, unknown> {
  return {
    id: issue.identifier,
    title: issue.title,
    state: issue.state?.name ?? "",
    priority: issue.priority ?? "",
    updated: issue.updatedAt ?? "",
    url: issue.url,
  };
}

async function home(): Promise<AxiOutput> {
  const [viewer, issues] = await Promise.all([
    getViewer(),
    listAssignedIssues({ first: 8 }),
  ]);

  return {
    workspace: viewer.organization?.name ?? "unknown",
    viewer: `${viewer.name} <${viewer.email ?? "unknown"}>`,
    assigned_issues: issues.map(issueRow),
    help: [
      "linear-axi issues --assigned --limit 20",
      "linear-axi issue get <id>",
      "linear-axi states",
      'linear-axi issue comment <id> --body "..."',
      "linear-axi issue update <id> --state-id <workflow-state-id>",
    ],
  };
}

async function issues(args: string[]): Promise<AxiOutput> {
  const limit = intFlag(args, "--limit", 20);
  const rows = await listAssignedIssues({ first: limit });
  return {
    count: rows.length,
    issues: rows.map(issueRow),
  };
}

async function issue(args: string[]): Promise<AxiOutput> {
  const [action, id] = args;
  if (!action || !id) {
    throw new AxiError(
      "Expected `issue <get|comment|update> <id>`",
      "VALIDATION_ERROR",
      [
        "linear-axi issue get LIN-123",
        'linear-axi issue comment LIN-123 --body "..."',
        "linear-axi issue update LIN-123 --state-id <workflow-state-id>",
      ],
    );
  }

  if (action === "get") {
    const item = await getIssue(id);
    if (!item) {
      throw new AxiError(`Issue not found: ${id}`, "NOT_FOUND", [
        "Check the issue identifier or UUID",
      ]);
    }
    return {
      issue: {
        id: item.identifier,
        title: item.title,
        state: item.state?.name ?? "",
        assignee: item.assignee?.name ?? "unassigned",
        team: item.team?.key ?? "",
        project: item.project?.name ?? "",
        priority: item.priority ?? "",
        url: item.url,
        labels:
          item.labels?.nodes?.map((label) => label.name).filter(Boolean) ?? [],
        description: item.description ?? "",
      },
      comments: (item.comments?.nodes ?? []).map((comment) => ({
        author: comment.user?.name ?? "",
        created: comment.createdAt ?? "",
        body: comment.body ?? "",
      })),
    };
  }

  if (action === "comment") {
    const body = requireFlag(args, "--body");
    const result = await createComment(id, body);
    return {
      success: result.success,
      comment: result.comment?.id ?? "",
      url: result.comment?.url ?? "",
    };
  }

  if (action === "update") {
    const stateId = requireFlag(args, "--state-id");
    const result = await updateIssue(id, { stateId });
    return {
      success: result.success,
      issue: {
        id: result.issue?.identifier ?? "",
        state: result.issue?.state?.name ?? "",
        url: result.issue?.url ?? "",
      },
    };
  }

  throw new AxiError(`Unknown issue action: ${action}`, "VALIDATION_ERROR", [
    "linear-axi issue get LIN-123",
  ]);
}

async function states(args: string[]): Promise<AxiOutput> {
  const teamId = flag(args, "--team-id");
  const rows = await listWorkflowStates({ teamId });
  return {
    count: rows.length,
    states: rows.map((state) => ({
      id: state.id,
      name: state.name ?? "",
      type: state.type ?? "",
      team: state.team?.key ?? "",
    })),
  };
}

function formatError(error: unknown): { output: string; exitCode: number } {
  if (error instanceof LinearApiError) {
    const details = error.details
      .map((detail) => detail.message)
      .filter(Boolean);
    return {
      output:
        [
          `error: ${error.message}`,
          "code: LINEAR_API_ERROR",
          ...details.map((detail) => `detail: ${detail}`),
          "help[2]:",
          "  Set LINEAR_API_KEY or LINEAR_TOKEN for direct Linear API access",
          "  Run `linear-axi --help` for supported commands",
        ].join("\n") + "\n",
      exitCode: 1,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    output: `error: ${message}\ncode: UNKNOWN\n`,
    exitCode: 1,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  await runAxiCli({
    description:
      "Linear issues, states, and comments through an AXI-style CLI.",
    version: VERSION,
    packageName: "linear-axi",
    argv,
    topLevelHelp: `Linear AXI exposes Linear as stable command output for agents.

Usage:
  linear-axi
  linear-axi issues [--assigned] [--limit N]
  linear-axi issue get <id>
  linear-axi issue comment <id> --body <text>
  linear-axi issue update <id> --state-id <stateId>
  linear-axi states [--team-id <teamId>]

Environment:
  LINEAR_API_KEY or LINEAR_TOKEN must contain a Linear API key.
`,
    commands: {
      issues,
      issue,
      states,
    },
    home,
    getCommandHelp(command) {
      if (command === "issue") {
        return `Usage:
  linear-axi issue get <id>
  linear-axi issue comment <id> --body <text>
  linear-axi issue update <id> --state-id <stateId>
`;
      }
      return null;
    },
    formatError,
  });
}
