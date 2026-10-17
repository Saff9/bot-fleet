// Shared types for the Bot Fleet mini-PaaS

export type BotStatus =
  | "pending" // created but never deployed
  | "cloning" // git clone in progress
  | "installing" // install command in progress (npm install / bun install)
  | "running" // child process is alive
  | "stopped" // child process killed manually
  | "error"; // crashed or failed to start

export interface LogLine {
  ts: number; // epoch ms
  level: "stdout" | "stderr" | "system";
  msg: string;
}

export interface BotRuntimeState {
  status: BotStatus;
  pid: number | null;
  startedAt: number | null;
  lastExitCode: number | null;
  lastError: string | null;
  restartCount: number;
  uptimeMs: number | null;
}

export interface BotDTO {
  id: string;
  name: string;
  githubUrl: string;
  branch: string;
  startCommand: string;
  installCommand: string | null;
  envVars: Record<string, string>;
  status: BotStatus;
  pid: number | null;
  startedAt: string | null;
  lastExitCode: number | null;
  lastError: string | null;
  restartCount: number;
  autoRestart: boolean;
  workDir: string | null;
  createdAt: string;
  updatedAt: string;
  runtime?: Partial<BotRuntimeState>;
}

export interface CreateBotInput {
  name: string;
  githubUrl: string;
  branch?: string;
  startCommand: string;
  installCommand?: string | null;
  envVars?: Record<string, string>;
  autoRestart?: boolean;
}

export interface UpdateBotInput {
  name?: string;
  branch?: string;
  startCommand?: string;
  installCommand?: string | null;
  envVars?: Record<string, string>;
  autoRestart?: boolean;
}
