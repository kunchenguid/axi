/** Shared interfaces for the benchmark harness. */

export type ConditionId = "cli" | "axi" | "mcp-with-toolsearch" | "mcp-no-toolsearch" | "mcp-with-code-mode";
export type TaskCategory = "single_step" | "multi_step" | "error_recovery";
export type AgentBackend = "codex" | "claude";

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
  setup_commands?: string[];
}

export interface RunSpec {
  condition: ConditionId;
  task: string;
  run: number;
  model: string;
  agent: AgentBackend;
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
