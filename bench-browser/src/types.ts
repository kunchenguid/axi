/** Shared interfaces for the browser benchmark harness. */

export type ConditionId = "agent-browser" | "pinchtab" | "chrome-devtools-mcp" | "chrome-devtools-mcp-search" | "chrome-devtools-mcp-code" | "chrome-devtools-mcp-compressed-cli";
export type TaskCategory = "single_step" | "multi_step" | "investigation" | "error_recovery";

export interface GradingSpec {
  /** Optional hint for the judge about what to look for. */
  grading_hint?: string;
}

export interface TaskDef {
  id: string;
  category: TaskCategory;
  prompt: string;
  grading: GradingSpec;
}

export interface ConditionDef {
  id: ConditionId;
  name: string;
  tool: string;
  agents_md: string;
  /** Daemon management mode: "auto" (self-managed), "explicit" (start/stop), "none" (MCP-managed). */
  daemon: "auto" | "explicit" | "none";
  /** One-time install command (agent-browser). */
  install_command?: string;
  /** Explicit daemon start command (pinchtab). */
  daemon_start?: string;
  /** Explicit daemon stop command (pinchtab). */
  daemon_stop?: string;
  /** MCP server config for MCP conditions. */
  mcp_config?: { mcpServers: Record<string, unknown> };
  /** MCP Compressor config for wrapped MCP conditions. */
  mcp_compressor?: {
    level: "low" | "medium" | "high" | "max";
    server_name?: string;
    cli_mode?: boolean;
    backend_command?: string[];
  };
}

export interface RunSpec {
  condition: ConditionId;
  task: string;
  run: number;
  model: string;
}

export interface UsageMetrics {
  input_tokens: number;
  input_tokens_cached: number;
  input_tokens_uncached: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_cost_usd: number;
  wall_clock_seconds: number;
  turn_count: number;
  command_count: number;
  error_count: number;
  command_log: string[];
}

export interface GradeResult {
  task_success: boolean;
  details: string;
}

export interface RunResult {
  condition: ConditionId;
  task: string;
  run: number;
  model: string;
  timestamp: string;
  usage: UsageMetrics;
  grade: GradeResult;
  agent_output: string;
}

export interface ConditionSummary {
  condition: ConditionId;
  name: string;
  total_tasks: number;
  success_rate: number;
  avg_input_tokens: number;
  avg_cached_pct: number;
  avg_output_tokens: number;
  avg_cost_usd: number;
  total_cost_usd: number;
  avg_duration_seconds: number;
  avg_turns: number;
}
