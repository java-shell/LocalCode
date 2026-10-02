import { chatWithTools } from './llmClient';
import { executeTool, getAllowedToolDefinitions } from './toolRuntime';
import {
  AgenticLink,
  AgenticStage,
  ChatMessage,
  LLMConfig,
  ModelUsage,
  MCPServerConfig,
  MCPServerRuntimeStatus,
  OrchestrationPlan,
  OrchestrationRunResult,
  OrchestrationRunStep,
  OrchestrationStep,
  PromptSpecVersion,
  ReferenceWorkspace,
  ToolDefinition,
  TokenUsage
} from '../shared/types';
import { RetrievedMemoryItem, computeAdaptiveInjectionLimits } from './turboVecMemory';
import { formatEnvironmentGuidance } from '../shared/environment';

export interface RuntimeContext {
  workspaceDir: string;
  rootDir: string;
  promptSpecVersion?: PromptSpecVersion;
  referenceWorkspaces?: ReferenceWorkspace[];
  turboMemory?: any; // TurboVecMemory instance for memory tools
  activeNamespaces?: string[]; // Namespaces to search by default
  llmConfig?: LLMConfig;
  subAgentConfig?: LLMConfig;
  subAgentProfiles?: Array<{
    id: string;
    label: string;
    maxConcurrentSpawns: number;
    config: LLMConfig;
  }>;
  subAgentActiveCounts?: Record<string, number>;
  mcpServers?: MCPServerConfig[];
  mcpServerStatuses?: MCPServerRuntimeStatus[];
  mcpToolDefinitions?: ToolDefinition[];
  invokeMcpTool?: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
  allowedToolNames?: string[];
  onAgentEvent?: (message: string) => void;
}

export interface OrchestrationMemoryAdapter {
  retrieve: (config: LLMConfig, query: string, stepName: string) => Promise<RetrievedMemoryItem[]>;
  store: (config: LLMConfig, text: string, stepName: string) => Promise<void>;
}

export interface OrchestrationRunOptions {
  requestTimeoutMs?: number;
}

function truncateText(value: string, maxChars: number): string {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function buildStageInputEnvelope(originalPrompt: string, stepInput: string): string {
  const objective = truncateText(originalPrompt, 4000);
  const boundedInput = truncateText(stepInput, 9000);

  return truncateText(
    [
      'Orchestration context envelope:',
      '',
      'ORIGINAL_REQUEST:',
      objective,
      '',
      'STEP_INPUT:',
      boundedInput,
      '',
      'CONTINUITY_INVARIANTS:',
      '- Preserve the original objective and constraints.',
      '- Preserve unresolved blockers and pending next actions.',
      '- Keep handoff output concise and directly actionable.'
    ].join('\n'),
    12000
  );
}

function buildIterationContinuationPrompt(iteration: number, finalOutput: string): string {
  const normalizedOutput = String(finalOutput ?? '').trim();
  const outputSummary = truncateText(normalizedOutput.replace(/\s+/g, ' '), 2500);
  const unresolvedSignals = normalizedOutput
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => /failed|error|blocker|todo|remaining|next step|follow-up|retry/i.test(line))
    .slice(0, 8);

  const unresolvedBlock = unresolvedSignals.length > 0
    ? unresolvedSignals.map((line, index) => `${index + 1}. ${line}`).join('\n')
    : 'No explicit unresolved signals detected.';

  return truncateText([
    `Previous orchestration output (iteration ${iteration}) summary:`,
    outputSummary || '(empty output)',
    '',
    'Unresolved signals to preserve:',
    unresolvedBlock,
    '',
    'Continue from this output. When the task is fully complete, call the complete_orchestration_task tool with a brief summary of what was accomplished.',
    'Do not signal completion by emitting text — use the tool call.'
  ].join('\n'), 12000);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsCompletionMarker(output: string, marker: string): boolean {
  const rawMarker = String(marker ?? '').trim();
  const rawOutput = String(output ?? '');
  if (!rawMarker || !rawOutput) {
    return false;
  }

  const normalizedOutput = rawOutput
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n');

  const markers = new Set<string>([rawMarker]);
  const tagCore = rawMarker.replace(/^<\/?\s*|\s*\/?\s*>$/g, '').trim();
  if (tagCore && tagCore !== rawMarker) {
    markers.add(tagCore);
  }

  for (const candidate of markers) {
    const escaped = escapeRegex(candidate);
    const flexible = escaped.replace(/[\s_-]+/g, '[\\s_-]*');
    // Issue #3: word-boundary lookarounds so the marker must stand alone
    // (prevents TASK_COMPLETE from matching TASK_COMPLETELY, etc.).
    const bounded = `(?<![A-Za-z0-9_])${flexible}(?![A-Za-z0-9_])`;
    const regex = new RegExp(bounded, 'i');
    if (regex.test(normalizedOutput)) {
      return true;
    }
  }

  return false;
}

function aggregateUsageByModel(steps: OrchestrationRunStep[]): ModelUsage[] {
  const usageMap = new Map<string, ModelUsage>();

  for (const step of steps) {
    const model = String(step.model ?? '').trim();
    const usage = step.usage;
    if (!model || !usage) {
      continue;
    }

    const existing = usageMap.get(model) ?? {
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requests: 0,
      recalledPromptTokens: 0,
      contextWindowTokens: 0
    };

    existing.promptTokens += usage.promptTokens;
    existing.completionTokens += usage.completionTokens;
    existing.totalTokens += usage.totalTokens;
    existing.requests += usage.requests;
    existing.recalledPromptTokens = Math.max(0, Number(existing.recalledPromptTokens ?? 0)) + Math.max(0, Number(step.recalledPromptTokens ?? 0));
    const configuredContextWindow = Math.max(0, Number(step.contextWindowTokens ?? 0));
    if (configuredContextWindow > 0) {
      existing.contextWindowTokens = Math.max(Number(existing.contextWindowTokens ?? 0), configuredContextWindow);
    }
    usageMap.set(model, existing);
  }

  return Array.from(usageMap.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}

function estimateTokensFromText(text: string): number {
  const normalized = String(text ?? '').trim();
  if (!normalized) {
    return 0;
  }
  // Approximate conversion used only for UI attribution of memory recall usage.
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function formatRecalledMemory(items: RetrievedMemoryItem[], limits?: { maxItems?: number; maxCharsPerItem?: number; maxTotalChars?: number }): string {
  const maxItems = Math.max(1, Math.min(20, Number(limits?.maxItems ?? 4)));
  const maxCharsPerItem = Math.max(200, Math.min(4000, Number(limits?.maxCharsPerItem ?? 1000)));
  const maxTotalChars = Math.max(500, Math.min(12000, Number(limits?.maxTotalChars ?? 3500)));

  let used = 0;
  const lines: string[] = [];
  for (const [index, item] of items.slice(0, maxItems).entries()) {
    const remaining = maxTotalChars - used;
    if (remaining <= 0) {
      break;
    }

    const snippetLimit = Math.max(120, Math.min(maxCharsPerItem, remaining));
    const snippet = truncateText(String(item.text ?? '').replace(/\s+/g, ' '), snippetLimit);
    const line = `${index + 1}. [${item.source}] ${snippet}`;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join('\n');
}

function formatReferenceWorkspaceGuidance(
  referenceWorkspaces?: ReferenceWorkspace[],
  canUseDiscoveryTool = false
): string {
  const refs = Array.isArray(referenceWorkspaces) ? referenceWorkspaces : [];
  if (refs.length === 0) {
    return '';
  }

  const referenceLines = refs.map(ref => {
    const access = ref.allowWrite ? 'read/write' : 'read-only';
    return `- ref:${ref.id}: ${ref.label} (${access}) at ${ref.path}`;
  });

  const guidanceLines = [
    'Reference workspaces are available for scoped tools in this stage.',
    'Available scope IDs:',
    ...referenceLines
  ];

  if (canUseDiscoveryTool) {
    guidanceLines.splice(1, 0, 'Use list_reference_workspaces if you need to refresh the mappings.');
  }

  return guidanceLines.join('\n');
}

function formatStageToolAvailabilityGuidance(toolNames: string[]): string {
  if (!Array.isArray(toolNames) || toolNames.length === 0) {
    return '';
  }

  return [
    'Tools are enabled for this stage.',
    'Use exact function names with valid JSON arguments.',
    `Enabled tools: ${toolNames.join(', ')}`,
    'Loop prevention policy:',
    '- Do not repeat a failed tool call with identical arguments.',
    '- Read tool error output and adjust arguments, tool choice, or sequence before retrying.',
    '- If repeated attempts do not make progress, stop and report the blocker instead of looping.'
  ].join('\n');
}

function formatStageMcpServerGuidance(servers?: MCPServerConfig[]): string {
  const items = Array.isArray(servers) ? servers : [];
  if (items.length === 0) {
    return '';
  }

  const lines = items.map(server => {
    if (server.transport === 'stdio') {
      const args = Array.isArray(server.args) && server.args.length > 0 ? ` ${server.args.join(' ')}` : '';
      return `- ${server.id} (${server.label}) via stdio: ${server.command ?? ''}${args}`.trim();
    }
    return `- ${server.id} (${server.label}) via ${server.transport}: ${server.endpoint ?? ''}`.trim();
  });

  return [
    'MCP servers are enabled for this orchestration run:',
    ...lines,
    'Call list_mcp_servers when you need the exact runtime mapping before using MCP-dependent strategies.'
  ].join('\n');
}

function normalizePromptSpecVersion(value: unknown): PromptSpecVersion {
  return String(value ?? '').trim().toLowerCase() === 'v2' ? 'v2' : 'v1';
}

function formatStageToolDecisionPolicyV2(toolNames: string[]): string {
  if (!Array.isArray(toolNames) || toolNames.length === 0) {
    return '';
  }

  return [
    'Tool decision policy:',
    '- Tools are optional, not mandatory.',
    '- Use tools when external evidence or state mutation is required.',
    '- If no external verification or mutation is needed, respond directly.',
    '- Choose the least risky tool first and provide valid JSON arguments.',
    `Enabled tools: ${toolNames.join(', ')}`
  ].join('\n');
}

function formatStageLoopRetryPolicyV2(): string {
  return [
    'Loop and retry policy:',
    '- Never retry a failed tool call with identical arguments.',
    '- For bugs, test failures, or unexpected behavior, investigate root cause first before proposing or applying fixes.',
    '- After failure, change arguments, tool choice, sequence, or strategy before retrying.',
    '- If no new evidence appears after two investigation steps, summarize the best hypothesis and next action, then ask whether to continue deeper.',
    '- If two attempts on the same objective fail to make progress, stop and report a blocker.'
  ].join('\n');
}

function formatStageV2CorePromptSections(toolNames: string[]): string[] {
  const sections: string[] = [
    [
      'Identity and mission:',
      '- You are an agentic coding assistant operating inside an orchestration stage.',
      '- Complete this stage safely and produce handoff-ready output.'
    ].join('\n'),
    [
      'Behavioral policy:',
      '- Prefer the smallest sufficient change for this stage objective.',
      '- Preserve existing behavior unless explicitly asked to break it.',
      '- Prefer additive, reversible changes (flags/adapters) over replacing stable behavior.',
      '- Keep solutions simple and avoid unnecessary dependencies.',
      '- Surface blockers clearly when they occur.'
    ].join('\n')
  ];

  const toolDecisionPolicy = formatStageToolDecisionPolicyV2(toolNames);
  if (toolDecisionPolicy) {
    sections.push(toolDecisionPolicy);
  }

  sections.push(
    formatStageLoopRetryPolicyV2(),
    [
      'Ambiguity and escalation policy:',
      '- Ask a targeted clarification when required parameters are missing.',
      '- If assumptions are low-risk and reversible, proceed and state assumptions.',
      '- Request confirmation before destructive or high-impact actions.'
    ].join('\n'),
    [
      'Output contract:',
      '- Include what was done, current stage state, and next handoff step if unresolved.',
      '- Verify relevant changes using appropriate checks/tests and report what was verified.',
      '- Keep output concise and stage-completion oriented.'
    ].join('\n')
  );

  return sections;
}

function matchesBranchPattern(matchPattern: string | undefined, value: string): boolean {
  const pattern = String(matchPattern ?? '').trim();
  if (!pattern) {
    return true;
  }

  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }
}

function linkMatchesOutcome(link: AgenticLink, status: 'success' | 'error', detail: string): boolean {
  const condition = String(link.condition ?? '').trim();
  if (!condition || condition === 'always') {
    return matchesBranchPattern(link.matchPattern, detail);
  }

  if (condition === 'success') {
    return status === 'success' && matchesBranchPattern(link.matchPattern, detail);
  }

  if (condition === 'error') {
    return status === 'error' && matchesBranchPattern(link.matchPattern, detail);
  }

  if (condition.startsWith('error:')) {
    if (status !== 'error') {
      return false;
    }
    const tag = condition.slice('error:'.length).trim().toLowerCase();
    if (!tag) {
      return matchesBranchPattern(link.matchPattern, detail);
    }
    return detail.toLowerCase().includes(tag) && matchesBranchPattern(link.matchPattern, detail);
  }

  return false;
}

function clampMaxRetries(value: unknown): number {
  const parsed = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(10, parsed));
}

function normalizeAdvancedStage(stage: AgenticStage): OrchestrationStep {
  return {
    id: stage.id,
    name: stage.name,
    provider: stage.provider,
    endpoint: stage.endpoint,
    model: stage.model,
    contextWindowTokens: stage.contextWindowTokens,
    apiKey: stage.apiKey,
    systemPrompt: stage.systemPrompt,
    temperature: stage.temperature,
    maxTokens: stage.maxTokens,
    maxToolTurns: stage.maxToolTurns,
    maxRetries: stage.maxRetries,
    tools: Array.isArray(stage.tools) ? stage.tools : [],
    passOutputToNext: stage.passOutputToNext,
    allowCompletionTool: stage.allowCompletionTool
  };
}

interface StepExecutionResult {
  stepRecords: OrchestrationRunStep[];
  taskCompleted: boolean;
  completionSummary: string;
  handoffText: string;
  status: 'success' | 'error';
  errorDetail?: string;
  selectedDownstreamStageId?: string;
  // Issue #7: the LLM config this step used, so the caller can reuse it for a
  // consistent terminal-output memory store (same embedding model as the run).
  config?: LLMConfig;
}

interface DownstreamStageOption {
  id: string;
  title: string;
  description: string;
  model: string;
}

function buildDownstreamRoutingToolDefinition(options: DownstreamStageOption[]) {
  const choices = options
    .map(option => {
      const safeDescription = truncateText(option.description || 'No description provided.', 220);
      return `- ${option.id}: ${option.title} (${option.model}) - ${safeDescription}`;
    })
    .join('\n');

  return {
    type: 'function' as const,
    function: {
      name: 'call_downstream_stage',
      description:
        'Route execution to one directly linked downstream stage. ' +
        'Choose a stageId from the available downstream options below.\n\n' +
        'Available downstream stages:\n' +
        choices,
      parameters: {
        type: 'object' as const,
        properties: {
          stageId: {
            type: 'string',
            enum: options.map(option => option.id),
            description: 'Direct downstream stage ID to invoke next.'
          },
          handoff: {
            type: 'string',
            description: 'Optional custom handoff content for the selected stage. If omitted, the current stage output is used.'
          },
          reason: {
            type: 'string',
            description: 'Brief reason for choosing this downstream stage.'
          }
        },
        required: ['stageId']
      }
    }
  };
}

async function runStepWithRetries(
  step: OrchestrationStep,
  originalPrompt: string,
  stepInput: string,
  iteration: number,
  loopMode: boolean,
  downstreamStageOptions: DownstreamStageOption[],
  options?: OrchestrationRunOptions,
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext,
  memoryAdapter?: OrchestrationMemoryAdapter,
  signal?: AbortSignal,
  storeIntermediateOutputs?: boolean,
): Promise<StepExecutionResult> {
  const COMPLETION_TOOL = 'complete_orchestration_task';
  const DOWNSTREAM_STAGE_TOOL = 'call_downstream_stage';
  const stepToolCalls: Array<{ name: string; intent: string; timestamp: string }> = [];
  const stepMaxToolTurns = Math.max(1, Math.min(200, Math.floor(Number(step.maxToolTurns ?? 40) || 40)));
  const maxRetries = clampMaxRetries(step.maxRetries);
  const staticAllowedToolNames = step.tools.filter(tool => tool.enabled).map(tool => tool.name);
  const discoveredMcpToolNames = Array.isArray(runtimeContext?.mcpToolDefinitions)
    ? runtimeContext.mcpToolDefinitions.map(tool => tool.function.name)
    : [];
  const allowedToolNames = Array.from(new Set([...staticAllowedToolNames, ...discoveredMcpToolNames]));
  const allowCompletionTool = Boolean(step.allowCompletionTool);
  let selectedDownstreamStageId = '';
  let selectedDownstreamHandoff = '';

  const config: LLMConfig = {
    endpoint: step.endpoint,
    provider: step.provider,
    model: step.model,
    apiKey: step.apiKey,
    temperature: step.temperature ?? 0.2,
    maxTokens: step.maxTokens,
    contextWindowTokens: Math.max(0, Number(step.contextWindowTokens ?? 0)) || undefined,
    requestTimeoutMs: Number(options?.requestTimeoutMs || 0) || undefined
  };

  let attempt = 0;
  let lastErrorDetail = '';
  let recalledPromptTokens = 0;
  let completionSummary = '';
  let taskCompleted = false;
  const promptSpecVersion = normalizePromptSpecVersion(runtimeContext?.promptSpecVersion);

  while (attempt <= maxRetries) {
    const messages: ChatMessage[] = [];

    if (promptSpecVersion === 'v2') {
      for (const section of formatStageV2CorePromptSections(allowedToolNames)) {
        messages.push({ role: 'system', content: section });
      }
      messages.push({
        role: 'system',
        content: 'Orchestration stage overlay: honor stage objective and constraints, and emit completion-oriented handoff output.'
      });
    }

    if (step.systemPrompt?.trim()) {
      messages.push({ role: 'system', content: step.systemPrompt });
    }

    // Tell the model which OS it is running on so it emits correct shell
    // commands from the first attempt (Windows vs Linux/macOS).
    const environmentGuidance = formatEnvironmentGuidance(runtimeContext?.workspaceDir);
    if (environmentGuidance) {
      messages.push({ role: 'system', content: environmentGuidance });
    }

    if (lastErrorDetail) {
      messages.push({
        role: 'system',
        content:
          `Previous attempt failed in this stage with: ${truncateText(lastErrorDetail, 1200)}\n` +
          'Retry this stage by fixing the issue directly. Keep output concise and continue from the existing stage input.'
      });
    }

    recalledPromptTokens = 0;
    if (memoryAdapter) {
      const recalled = await memoryAdapter.retrieve(config, `${originalPrompt}\n\n${stepInput}`, step.name);
      if (recalled.length > 0) {
        // P3 #8: Use adaptive injection limits based on context window
        const injectionLimits = computeAdaptiveInjectionLimits(config.contextWindowTokens);
        const recalledBlock = formatRecalledMemory(recalled, injectionLimits);
        messages.push({
          role: 'system',
          content:
            'Relevant long-term memory for this orchestration step is available below. Use it when helpful and ignore stale items.\n\n' +
            recalledBlock
        });
        recalledPromptTokens = estimateTokensFromText(recalledBlock);
      }
    }

    const referenceGuidance = formatReferenceWorkspaceGuidance(
      runtimeContext?.referenceWorkspaces,
      allowedToolNames.includes('list_reference_workspaces')
    );
    if (promptSpecVersion === 'v1') {
      const stageToolGuidance = formatStageToolAvailabilityGuidance(allowedToolNames);
      if (stageToolGuidance) {
        messages.push({ role: 'system', content: stageToolGuidance });
      }
    }
    if (referenceGuidance) {
      messages.push({ role: 'system', content: referenceGuidance });
    }

    const mcpGuidance = formatStageMcpServerGuidance(runtimeContext?.mcpServers);
    if (mcpGuidance) {
      messages.push({ role: 'system', content: mcpGuidance });
    }

    messages.push({
      role: 'user',
      content: buildStageInputEnvelope(originalPrompt, stepInput)
    });

    selectedDownstreamStageId = '';
    selectedDownstreamHandoff = '';

    let toolDefs = getAllowedToolDefinitions(allowedToolNames, runtimeContext);
    if (downstreamStageOptions.length > 0) {
      toolDefs = [...toolDefs, buildDownstreamRoutingToolDefinition(downstreamStageOptions)];
    }
    if (loopMode && allowCompletionTool) {
      const completionDef = getAllowedToolDefinitions([COMPLETION_TOOL], runtimeContext);
      if (completionDef.length > 0 && !toolDefs.some(t => t.function.name === COMPLETION_TOOL)) {
        toolDefs = [...toolDefs, completionDef[0]];
      }
    }

    onEvent?.(`step:attempt:${step.name}:iteration:${iteration}:${attempt + 1}/${maxRetries + 1}`);
    const startedAt = Date.now();

    try {
      const result = await chatWithTools(
        config,
        messages,
        toolDefs,
        async (name, args) => {
          const stepRuntimeContext: RuntimeContext = {
            workspaceDir: runtimeContext?.workspaceDir ?? process.cwd(),
            rootDir: runtimeContext?.rootDir ?? process.cwd(),
            promptSpecVersion,
            referenceWorkspaces: runtimeContext?.referenceWorkspaces,
            turboMemory: runtimeContext?.turboMemory,
            activeNamespaces: runtimeContext?.activeNamespaces,
            llmConfig: config,
            subAgentConfig: runtimeContext?.subAgentConfig,
            subAgentProfiles: runtimeContext?.subAgentProfiles,
            subAgentActiveCounts: runtimeContext?.subAgentActiveCounts,
            mcpServers: runtimeContext?.mcpServers,
            mcpServerStatuses: runtimeContext?.mcpServerStatuses,
            mcpToolDefinitions: runtimeContext?.mcpToolDefinitions,
            invokeMcpTool: runtimeContext?.invokeMcpTool,
            allowedToolNames,
            onAgentEvent: (message: string) => {
              onEvent?.(`${step.name}:iteration:${iteration}:${message}`);
            }
          };
          if (name === COMPLETION_TOOL) {
            taskCompleted = true;
            completionSummary = String((args as Record<string, unknown>)?.summary ?? '');
            return { ok: true, message: 'Task completion acknowledged. Orchestration will stop after this step.' };
          }
          if (name === DOWNSTREAM_STAGE_TOOL) {
            const input = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {};
            const requestedStageId = String(input.stageId ?? '').trim();
            const option = downstreamStageOptions.find(candidate => candidate.id === requestedStageId);
            if (!option) {
              const allowed = downstreamStageOptions.map(candidate => candidate.id).join(', ') || '(none)';
              throw new Error(`Stage ${step.name} can only route to direct downstream stages: ${allowed}.`);
            }
            selectedDownstreamStageId = option.id;
            selectedDownstreamHandoff = String(input.handoff ?? '').trim();
            return {
              ok: true,
              selectedStageId: option.id,
              selectedStageTitle: option.title,
              selectedStageModel: option.model,
              message: `Downstream stage ${option.title} selected.`
            };
          }
          if (!allowedToolNames.includes(name)) {
            throw new Error(`Tool ${name} is not enabled in step ${step.name}.`);
          }
          if (name === 'run_terminal_command') {
            const input = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {};
            const rawTimeout = Number(input.timeoutMs ?? 30000);
            const boundedTimeoutMs = rawTimeout <= 0 ? 30000 : Math.max(1000, Math.min(120000, rawTimeout));
            return executeTool(name, { ...input, timeoutMs: boundedTimeoutMs }, stepRuntimeContext);
          }
          if (name === 'grep_search') {
            const input = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {};
            const rawTimeout = Number(input.timeoutMs ?? 30000);
            const boundedTimeoutMs = rawTimeout <= 0 ? 30000 : Math.max(1000, Math.min(120000, rawTimeout));
            return executeTool(name, { ...input, timeoutMs: boundedTimeoutMs }, stepRuntimeContext);
          }
          return executeTool(name, args, stepRuntimeContext);
        },
        event => {
          onEvent?.(`${step.name}:iteration:${iteration}:${event}`);
          const TOOL_PREFIX = 'tool:';
          const INTENT_SEP = ' | intent: ';
          if (event.startsWith(TOOL_PREFIX)) {
            const toolPart = event.slice(TOOL_PREFIX.length);
            const sepIdx = toolPart.indexOf(INTENT_SEP);
            const toolName = sepIdx >= 0 ? toolPart.slice(0, sepIdx) : toolPart;
            const intent = sepIdx >= 0 ? toolPart.slice(sepIdx + INTENT_SEP.length) : '';
            stepToolCalls.push({ name: toolName, intent, timestamp: new Date().toISOString() });
          }
        },
        stepMaxToolTurns,
        signal
      );

      const durationMs = Date.now() - startedAt;
      const rawOutput = String(result.text ?? '');
      const handoffSummary = String(result.continuationSummary ?? '').trim();
      const budgetExhausted = Boolean(result.toolBudgetExhausted);

      const handoffText = budgetExhausted
        ? truncateText(
            [
              `Stage ${step.name} exhausted its tool-call budget (${stepMaxToolTurns}).`,
              handoffSummary || rawOutput
            ].join('\n\n'),
            12000
          )
        : truncateText(rawOutput, 12000);

      // Issue #7: by default, intermediate step outputs are NOT stored to
      // memory (they accumulate noise and bloat). Only the terminal output is
      // stored (see runOrchestration). Opt in to per-step storage with
      // plan.storeIntermediateOutputs.
      if (memoryAdapter && storeIntermediateOutputs) {
        await memoryAdapter.store(config, rawOutput, step.name);
      }

      const effectiveHandoffText = selectedDownstreamHandoff || handoffText;

      return {
        stepRecords: [
          {
            id: step.id,
            name: step.name,
            output: rawOutput,
            iteration,
            model: step.model,
            usage: result.usage,
            recalledPromptTokens: Math.max(0, Number(recalledPromptTokens ?? 0)),
            contextWindowTokens: Math.max(0, Number(step.contextWindowTokens ?? 0)),
            toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined,
            durationMs,
            attempts: attempt + 1,
            success: true,
            toolBudgetExhausted: budgetExhausted,
            continuationSummary: handoffSummary || undefined
          }
        ],
        taskCompleted,
        completionSummary,
        handoffText: effectiveHandoffText,
        status: 'success',
        selectedDownstreamStageId: selectedDownstreamStageId || undefined,
        config
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/canceled$/i.test(detail) || /stopped by user/i.test(detail)) {
        throw new Error(`Orchestration stopped by user during step ${step.name} (iteration ${iteration}).`);
      }

      lastErrorDetail = detail;
      if (attempt < maxRetries) {
        onEvent?.(`step:retry:${step.name}:iteration:${iteration}:${attempt + 1}/${maxRetries} | ${truncateText(detail, 400)}`);
        // Issue #6: exponential backoff with jitter before retrying, so
        // transient failures (network, rate limits) get a chance to recover
        // instead of hammering the endpoint.
        const backoffMs = Math.min(8000, 500 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
        await new Promise(resolve => setTimeout(resolve, backoffMs));

        attempt += 1;
        continue;
      }

      const durationMs = Date.now() - startedAt;
      const errorText =
        `Stage ${step.name} failed after ${maxRetries + 1} attempt(s). ` +
        `Moving to next stage.\n\n${detail}`;

      return {
        stepRecords: [
          {
            id: step.id,
            name: step.name,
            output: errorText,
            iteration,
            model: step.model,
            recalledPromptTokens: Math.max(0, Number(recalledPromptTokens ?? 0)),
            contextWindowTokens: Math.max(0, Number(step.contextWindowTokens ?? 0)),
            toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined,
            durationMs,
            attempts: attempt + 1,
            success: false,
            error: detail
          }
        ],
        taskCompleted: false,
        completionSummary: '',
        handoffText: truncateText(errorText, 12000),
        status: 'error',
        errorDetail: detail,
        config
      };
    }
  }

  // Issue #10: the retry loop above always returns internally (maxRetries >= 0
  // guarantees at least one iteration), so this is a defensive terminal.
  throw new Error(`Unexpected orchestration retry state in step ${step.name}.`);
}

async function runSingleIteration(
  plan: OrchestrationPlan,
  originalPrompt: string,
  iterationPrompt: string,
  iteration: number,
  options?: OrchestrationRunOptions,
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext,
  memoryAdapter?: OrchestrationMemoryAdapter,
  signal?: AbortSignal,
  storeIntermediateOutputs?: boolean
): Promise<{ steps: OrchestrationRunStep[]; taskCompleted: boolean; completionSummary: string; lastSuccessfulConfig?: LLMConfig }> {
  let priorOutput = iterationPrompt;
  const iterationSteps: OrchestrationRunStep[] = [];
  let lastSuccessfulConfig: LLMConfig | undefined;

  for (const step of plan.steps) {
    onEvent?.(`step:start:${step.name}:iteration:${iteration}`);
    const outcome = await runStepWithRetries(
      step,
      originalPrompt,
      priorOutput,
      iteration,
      Boolean(plan.loopUntilComplete),
      [],
      options,
      onEvent,
      runtimeContext,
      memoryAdapter,
      signal,
      storeIntermediateOutputs
    );

    iterationSteps.push(...outcome.stepRecords);
    onEvent?.(`step:end:${step.name}:iteration:${iteration}`);
    if (outcome.status === 'success' && outcome.config) {
      lastSuccessfulConfig = outcome.config;
    }

    if (outcome.taskCompleted) {
      return { steps: iterationSteps, taskCompleted: true, completionSummary: outcome.completionSummary, lastSuccessfulConfig };
    }

    // Issue #5: default to chaining. Only skip passing output forward when the
    // step explicitly opts out (passOutputToNext === false). This prevents a
    // forgotten flag from silently feeding the original prompt to every step.
    if (step.passOutputToNext !== false || outcome.status === 'error' || outcome.stepRecords.some(s => s.toolBudgetExhausted)) {
      priorOutput = truncateText(outcome.handoffText, 12000);
    }
  }

  return { steps: iterationSteps, taskCompleted: false, completionSummary: '', lastSuccessfulConfig };
}

async function runAdvancedIteration(
  plan: OrchestrationPlan,
  originalPrompt: string,
  iterationPrompt: string,
  iteration: number,
  options?: OrchestrationRunOptions,
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext,
  memoryAdapter?: OrchestrationMemoryAdapter,
  signal?: AbortSignal,
  priorExecutions?: number,
  storeIntermediateOutputs?: boolean
): Promise<{ steps: OrchestrationRunStep[]; taskCompleted: boolean; completionSummary: string; lastSuccessfulConfig?: LLMConfig }> {
  const advanced = plan.advanced;
  if (!advanced?.enabled || !Array.isArray(advanced.stages) || advanced.stages.length === 0) {
    return runSingleIteration(
      plan,
      originalPrompt,
      iterationPrompt,
      iteration,
      options,
      onEvent,
      runtimeContext,
      memoryAdapter,
      signal,
      storeIntermediateOutputs
    );
  }

  const stages = advanced.stages.map(normalizeAdvancedStage);
  const stageById = new Map(stages.map(stage => [stage.id, stage]));
  // NOTE: stageIndexById removed (Issue #1) — the forward-only index filter it
  // powered silently dropped backward edges (e.g. qa_final -> impl_recovery).
  const links = Array.isArray(advanced.links) ? advanced.links : [];
  const entryStageId = (advanced.entryStageId && stageById.has(advanced.entryStageId)) ? advanced.entryStageId : stages[0].id;
  const maxStageExecutions = Math.max(1, Math.min(300, Math.floor(Number(advanced.maxStageExecutions ?? 100) || 100)));

  const queue: string[] = [entryStageId];
  const queued = new Set<string>([entryStageId]);
  const stageInputs = new Map<string, string[]>();
  stageInputs.set(entryStageId, [iterationPrompt]);

  const runSteps: OrchestrationRunStep[] = [];
  let lastSuccessfulConfig: LLMConfig | undefined;
  // Issue #11: seed the execution counter with prior iterations' executions so
  // the budget is enforced per-run (across loop iterations), not per-iteration.
  let stageExecutions = Math.max(0, Math.floor(Number(priorExecutions ?? 0) || 0));
  // Issue #1: per-stage execution cap so a single stage (e.g. a QA/recovery
  // feedback loop) cannot monopolize the whole budget. The global
  // `stageExecutions < maxStageExecutions` check still bounds total runs.
  const stageRunCounts = new Map<string, number>();
  const perStageCap = Math.max(1, Math.ceil(maxStageExecutions / Math.max(1, stages.length)));

  while (queue.length > 0 && stageExecutions < maxStageExecutions) {
    const stageId = String(queue.shift() ?? '');
    queued.delete(stageId);
    const stage = stageById.get(stageId);
    if (!stage) {
      continue;
    }
    // Issue #1: enforce per-stage execution cap to bound feedback loops.
    const stageRuns = Number(stageRunCounts.get(stageId) ?? 0);
    if (stageRuns >= perStageCap) {
      onEvent?.(`graph:stage-cap:${stage.name}:${stageRuns}/${perStageCap}`);
      continue;
    }


    const pendingInputs = stageInputs.get(stageId) ?? [iterationPrompt];
    stageInputs.delete(stageId);
    // Issue #8: per-source budget so one large upstream output cannot starve
    // the others (a single global cut would drop later sources entirely).
    const FAN_IN_BUDGET = 12000;
    const perSourceBudget = Math.max(800, Math.floor(FAN_IN_BUDGET / Math.max(1, pendingInputs.length)));
    const mergedInput = truncateText(
      pendingInputs.map(input => truncateText(input, perSourceBudget)).join('\n\n---\n\n'),
      FAN_IN_BUDGET
    );

    // Issue #1: allow backward edges (feedback loops) — no forward-only index filter.
    const directDownstreamLinks = links.filter(link => {
      if (link.fromStageId !== stageId) {
        return false;
      }
      if (!stageById.has(link.toStageId)) {
        return false;
      }
      // (forward-only index check removed — see Issue #1)
      return stageById.has(link.toStageId);
    });

    const directDownstreamStageOptions: DownstreamStageOption[] = [];
    const seenDownstreamStageIds = new Set<string>();
    for (const link of directDownstreamLinks) {
      if (seenDownstreamStageIds.has(link.toStageId)) {
        continue;
      }
      const downstream = stageById.get(link.toStageId);
      if (!downstream) {
        continue;
      }
      seenDownstreamStageIds.add(link.toStageId);
      directDownstreamStageOptions.push({
        id: downstream.id,
        title: downstream.name,
        description: String(downstream.systemPrompt ?? '').trim() || 'No description provided.',
        model: downstream.model
      });
    }

    // Issue #12: unified event naming — advanced mode now emits the same
    // `step:*` scheme as basic mode so UI consumers handle one format.
    onEvent?.(`step:start:${stage.name}:iteration:${iteration}`);
    const outcome = await runStepWithRetries(
      stage,
      originalPrompt,
      mergedInput,
      iteration,
      Boolean(plan.loopUntilComplete),
      directDownstreamStageOptions,
      options,
      onEvent,
      runtimeContext,
      memoryAdapter,
      signal,
      storeIntermediateOutputs
    );
    runSteps.push(...outcome.stepRecords);
    stageExecutions += 1;
    stageRunCounts.set(stageId, stageRuns + 1);
    if (outcome.status === 'success' && outcome.config) {
      lastSuccessfulConfig = outcome.config;
    }

    onEvent?.(`step:end:${stage.name}:iteration:${iteration}:${outcome.status}`);

    if (outcome.taskCompleted) {
      return {
        steps: runSteps,
        taskCompleted: true,
        completionSummary: outcome.completionSummary,
        lastSuccessfulConfig
      };
    }

    if (outcome.selectedDownstreamStageId) {
      const selectedStage = stageById.get(outcome.selectedDownstreamStageId);
      if (selectedStage) {
        const bucket = stageInputs.get(selectedStage.id) ?? [];
        bucket.push(`Input from ${stage.name} (toolcall: call_downstream_stage):\n${outcome.handoffText}`);
        stageInputs.set(selectedStage.id, bucket);
        if (!queued.has(selectedStage.id)) {
          queue.push(selectedStage.id);
          queued.add(selectedStage.id);
        }
        continue;
      }
    }

    const detailForBranching = `${outcome.handoffText}\n${outcome.errorDetail ?? ''}`;
    const nextLinks = directDownstreamLinks.filter(link => linkMatchesOutcome(link, outcome.status, detailForBranching));
    if (nextLinks.length === 0) {
      continue;
    }

    for (const link of nextLinks) {
      if (!stageById.has(link.toStageId)) {
        continue;
      }
      const bucket = stageInputs.get(link.toStageId) ?? [];
      bucket.push(`Input from ${stage.name} (${link.condition}):\n${outcome.handoffText}`);
      stageInputs.set(link.toStageId, bucket);
      if (!queued.has(link.toStageId)) {
        queue.push(link.toStageId);
        queued.add(link.toStageId);
      }
    }
  }

  if (stageExecutions >= maxStageExecutions) {
    onEvent?.(`graph:limit-reached:${maxStageExecutions}`);
  }

  return {
    steps: runSteps,
    taskCompleted: false,
    completionSummary: '',
    lastSuccessfulConfig
  };
}

export async function runOrchestration(
  plan: OrchestrationPlan,
  userPrompt: string,
  options?: OrchestrationRunOptions,
  onEvent?: (event: string) => void,
  runtimeContext?: RuntimeContext,
  memoryAdapter?: OrchestrationMemoryAdapter,
  signal?: AbortSignal
): Promise<OrchestrationRunResult> {
  const loopUntilComplete = Boolean(plan.loopUntilComplete);
  const maxLoops = Math.max(1, Math.min(20, Number(plan.maxLoops ?? 3)));
  const completionMarker = String(plan.completionMarker ?? 'TASK_COMPLETE').trim();
  const loopLimit = loopUntilComplete ? maxLoops : 1;

  const allSteps: OrchestrationRunStep[] = [];
  let iterationPrompt = userPrompt;
  let finalOutput = '';
  // Issue #2: `completed` now reflects actual success, not loop configuration.
  // It is set true when the completion tool/marker fires (below); otherwise it
  // is derived from step success after the loop.
  let completed = false;
  let iterations = 0;
  // Issue #7: track the last successful step's LLM config so the terminal
  // output can be stored to memory with the same embedding model as the run.
  let lastSuccessfulConfig: LLMConfig | undefined;
  const storeIntermediateOutputs = Boolean(plan.storeIntermediateOutputs);

  for (let iteration = 1; iteration <= loopLimit; iteration += 1) {
    onEvent?.(`loop:start:${iteration}`);

    const useAdvancedGraph = Boolean(plan.advanced?.enabled && Array.isArray(plan.advanced?.stages) && plan.advanced.stages.length > 0);
    const { steps: iterationSteps, taskCompleted, completionSummary, lastSuccessfulConfig: iterationLastConfig } = useAdvancedGraph
      ? await runAdvancedIteration(
          plan,
          userPrompt,
          iterationPrompt,
          iteration,
          options,
          onEvent,
          runtimeContext,
          memoryAdapter,
          signal,
          allSteps.length,
          storeIntermediateOutputs
        )
      : await runSingleIteration(
          plan,
          userPrompt,
          iterationPrompt,
          iteration,
          options,
          onEvent,
          runtimeContext,
          memoryAdapter,
          signal,
          storeIntermediateOutputs
        );

    allSteps.push(...iterationSteps);
    if (iterationLastConfig) {
      lastSuccessfulConfig = iterationLastConfig;
    }
    finalOutput = iterationSteps.length ? iterationSteps[iterationSteps.length - 1].output : '';
    const iterationOutput = iterationSteps.map(step => step.output || '').join('\n\n');
    iterations = iteration;

    onEvent?.(`loop:end:${iteration}`);

    if (!loopUntilComplete) {
      break;
    }

    // Primary: completion signalled via complete_orchestration_task tool call.
    if (taskCompleted) {
      completed = true;
      onEvent?.(`loop:complete:${iteration}${completionSummary ? `:${completionSummary}` : ''}`);
      break;
    }

    // Fallback: completion marker still present in text output (backward compat).
    if (containsCompletionMarker(iterationOutput, completionMarker)) {
      completed = true;
      onEvent?.(`loop:complete:${iteration}`);
      break;
    }

    iterationPrompt = buildIterationContinuationPrompt(iteration, finalOutput);
  }

  // Issue #2: derive `completed` from actual step success when no explicit
  // completion signal fired. Non-loop plans succeed only if every step
  // succeeded; loop plans that exhaust maxLoops without a completion signal
  // are not considered complete.
  if (!completed) {
    if (!loopUntilComplete) {
      completed = allSteps.length > 0 && allSteps.every(step => step.success);
    }
  }


  // Issue #7: by default, store only the terminal output to memory (not every
  // intermediate step). Use the last successful step's config so the embedding
  // model matches the run. Skipped when per-step storage is opted in (the
  // terminal output was already stored as a step) or when the run failed.
  if (!storeIntermediateOutputs && memoryAdapter && lastSuccessfulConfig && finalOutput.trim()) {
    try {
      await memoryAdapter.store(lastSuccessfulConfig, finalOutput, 'orchestration-final');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      onEvent?.(`memory:store-failed:${truncateText(detail, 200)}`);
    }
  }

  return {
    output: finalOutput,
    steps: allSteps,
    iterations,
    completed,
    completionMarker: loopUntilComplete ? completionMarker : undefined,
    usageByModel: aggregateUsageByModel(allSteps)
  };
}
