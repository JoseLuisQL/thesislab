import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WINDOWS_COMMAND_RESOLVERS = ['where.exe', 'where'];

function commandExists(command: string) {
  const resolvers = process.platform === 'win32' ? WINDOWS_COMMAND_RESOLVERS : ['which'];

  for (const resolver of resolvers) {
    const result = spawnSync(resolver, [command], {
      encoding: 'utf8',
      stdio: 'pipe',
      shell: false,
    });

    if (result.status === 0) {
      return true;
    }
  }

  return false;
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function runOpenClawCommand(args: string[], timeoutMs = 10_000) {
  const result = await execFileAsync('openclaw', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });

  return (result.stdout ?? '').trim();
}

function runOpenClawCommandSync(args: string[]) {
  const result = spawnSync('openclaw', args, {
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
    windowsHide: true,
  });

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    throw new Error(stderr || `openclaw exited with status ${result.status ?? -1}`);
  }

  return (result.stdout ?? '').trim();
}

export type OpenClawAgentSummary = {
  id: string;
  workspace: string | null;
  agentDir: string | null;
  isDefault: boolean;
  routes: string[];
  bindingDetails: string[];
};

export type OpenClawGatewayStatus = {
  installed: boolean;
  statusAvailable: boolean;
  configPath: string | null;
  gatewayUrl: string | null;
  gatewayReachable: boolean;
  gatewayError: string | null;
  defaultAgentId: string | null;
  agents: OpenClawAgentSummary[];
  issues: string[];
};

export type OpenClawAgentTurnInput = {
  message: string;
  agentId?: string | null;
  sessionKey?: string | null;
  timeoutMs?: number;
  thinking?: string | null;
};

type OpenClawStatusCliPayload = {
  gateway?: {
    url?: string | null;
    reachable?: boolean;
    error?: string | null;
  };
  agents?: {
    defaultId?: string | null;
  };
};

type OpenClawAgentsCliPayload = Array<{
  id?: string;
  workspace?: string;
  agentDir?: string;
  isDefault?: boolean;
  routes?: string[];
  bindingDetails?: string[];
}>;

type OpenClawAgentTurnResult = {
  text?: string;
  message?: string;
  content?: string;
  result?: string;
  output?: string;
  runId?: string;
};

export function buildOpenClawSessionKey(agentId: string, label = 'main') {
  return `agent:${agentId}:${label}`;
}

export function probeOpenClawGatewaySync(): OpenClawGatewayStatus {
  if (!commandExists('openclaw')) {
    return {
      installed: false,
      statusAvailable: false,
      configPath: null,
      gatewayUrl: null,
      gatewayReachable: false,
      gatewayError: 'OpenClaw CLI is not installed.',
      defaultAgentId: null,
      agents: [],
      issues: ['Install the OpenClaw CLI and configure at least one agent.'],
    };
  }

  const issues: string[] = [];
  let statusPayload: OpenClawStatusCliPayload | null = null;
  let agentsPayload: OpenClawAgentsCliPayload | null = null;
  let gatewayError: string | null = null;

  try {
    statusPayload = parseJson<OpenClawStatusCliPayload>(runOpenClawCommandSync(['status', '--json']));
  } catch (error) {
    gatewayError = error instanceof Error ? error.message : 'Failed to read OpenClaw status.';
  }

  try {
    agentsPayload = parseJson<OpenClawAgentsCliPayload>(runOpenClawCommandSync(['agents', 'list', '--json', '--bindings']));
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'Failed to read OpenClaw agents.');
  }

  const configPath = process.env.OPENCLAW_CONFIG?.trim() || null;
  if (!configPath) {
    issues.push('OPENCLAW_CONFIG is not set; relying on OpenClaw local defaults only.');
  }

  const gatewayReachable = Boolean(statusPayload?.gateway?.reachable);
  if (!gatewayReachable) {
    issues.push(statusPayload?.gateway?.error ?? gatewayError ?? 'OpenClaw gateway is not reachable.');
  }

  return {
    installed: true,
    statusAvailable: Boolean(statusPayload),
    configPath,
    gatewayUrl: statusPayload?.gateway?.url ?? process.env.OPENCLAW_GATEWAY_URL?.trim() ?? null,
    gatewayReachable,
    gatewayError: statusPayload?.gateway?.error ?? gatewayError,
    defaultAgentId: statusPayload?.agents?.defaultId ?? null,
    agents: (agentsPayload ?? []).map((agent) => ({
      id: agent.id ?? '',
      workspace: agent.workspace ?? null,
      agentDir: agent.agentDir ?? null,
      isDefault: Boolean(agent.isDefault),
      routes: Array.isArray(agent.routes) ? agent.routes.filter((route): route is string => typeof route === 'string') : [],
      bindingDetails: Array.isArray(agent.bindingDetails)
        ? agent.bindingDetails.filter((binding): binding is string => typeof binding === 'string')
        : [],
    })).filter((agent) => agent.id),
    issues,
  };
}

export async function readOpenClawGatewayStatus(): Promise<OpenClawGatewayStatus> {
  return probeOpenClawGatewaySync();
}

export async function listOpenClawAgents(): Promise<OpenClawAgentSummary[]> {
  return (await readOpenClawGatewayStatus()).agents;
}

export async function callOpenClawAgentTurn(input: OpenClawAgentTurnInput): Promise<{
  runId: string | null;
  text: string;
}> {
  if (!commandExists('openclaw')) {
    throw new Error('OpenClaw CLI is not installed.');
  }

  const params = {
    message: input.message,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    ...(input.thinking ? { thinking: input.thinking } : {}),
    idempotencyKey: `thesis-os-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  };

  const args = [
    'gateway',
    'call',
    'agent',
    '--expect-final',
    '--json',
    '--params',
    JSON.stringify(params),
    '--timeout',
    String(input.timeoutMs ?? 60_000),
  ];

  if (process.env.OPENCLAW_GATEWAY_URL?.trim()) {
    args.push('--url', process.env.OPENCLAW_GATEWAY_URL.trim());
  }

  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || process.env.OPENCLAW_API_KEY?.trim();
  if (gatewayToken) {
    args.push('--token', gatewayToken);
  }

  const payload = parseJson<OpenClawAgentTurnResult>(await runOpenClawCommand(args, input.timeoutMs ?? 60_000));
  if (!payload) {
    throw new Error('OpenClaw gateway returned a non-JSON response.');
  }

  const text = payload.text ?? payload.message ?? payload.content ?? payload.result ?? payload.output;
  if (!text) {
    throw new Error('OpenClaw gateway did not return final text.');
  }

  return {
    runId: payload.runId ?? null,
    text,
  };
}
