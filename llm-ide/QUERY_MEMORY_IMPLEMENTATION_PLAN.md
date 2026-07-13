# query_memory Tool Implementation Plan

## Overview

Add a `query_memory` tool that allows models to explicitly search the TurboVec-backed memory store during conversations, giving them on-demand access to past knowledge instead of relying solely on automatic pre-prompt injection.

## Current Architecture Analysis

### How Memory Works Today (Automatic)
1. **Pre-chat retrieval**: In `main.ts` lines 524-551, before each chat turn, the system automatically retrieves relevant memories from selected namespaces and injects them as a system message
2. **Post-chat storage**: After each conversation turn (lines 618-642), user prompts and assistant responses are stored in TurboVec memory
3. **Model has no control**: The model cannot request specific memory searches - it only sees what was pre-injected

### Tool System Pattern (from `toolRuntime.ts`)
Each tool follows this pattern:
1. **Definition** (lines 158-447): JSON Schema definition in `toolDefinitions[]` array
2. **Implementation function**: Async function that takes `args: Record<string, unknown>` and optional `context?: RuntimeContext`
3. **Dispatch** (lines 1294-1343): Switch case in `executeTool()` function
4. **Access to TurboVecMemory**: The `turboMemory` instance is created in `main.ts` line 481 but currently only accessible within main.ts IPC handlers

## Implementation Plan

### Phase 1: Core Tool Definition & Function

#### 1.1 Add Tool Definition to `toolRuntime.ts`

Add to the `toolDefinitions[]` array (after `complete_orchestration_task`):

```typescript
{
  type: 'function',
  function: {
    name: 'query_memory',
    description: 
      'Search persistent memory store for relevant past information, decisions, or knowledge. ' +
      'Use this when you need to recall previous conversations, learned patterns, user preferences, ' +
      'or domain-specific knowledge that may not be in the current context.',
    parameters: {
      type: 'object',
      properties: {
        query: { 
          type: 'string',
          description: 'Natural language search query describing what to find'
        },
        namespace: {
          type: 'string',
          description: 'Memory namespace to search. Use "global" for cross-workspace knowledge, ' +
                       'or specify a workspace-specific namespace name. Omit to search current active namespace.'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5, max: 20)',
          minimum: 1,
          maximum: 20
        },
        includeMetadata: {
          type: 'boolean',
          description: 'Include metadata like timestamps and source information (default: false)'
        }
      },
      required: ['query']
    }
  }
}
```

#### 1.2 Add Implementation Function to `toolRuntime.ts`

Add before the `executeTool()` function:

```typescript
// Reference to TurboVecMemory instance - set by main.ts
let memoryInstance: any = null;

export function setMemoryInstance(instance: any): void {
  memoryInstance = instance;
}

async function queryMemory(args: Record<string, unknown>): Promise<unknown> {
  const query = String(args.query ?? '').trim();
  if (!query) {
    throw new Error('query is required');
  }

  if (!memoryInstance) {
    return {
      results: [],
      totalResults: 0,
      warning: 'Memory store not initialized'
    };
  }

  const limit = Math.max(1, Math.min(20, Number(args.limit ?? 5)));
  const includeMetadata = Boolean(args.includeMetadata ?? false);
  
  // Get the LLM config from a stored reference or pass it differently
  // This is the tricky part - see Phase 2
  
  try {
    // Determine namespace(s) to search
    const requestedNamespace = String(args.namespace ?? '').trim();
    
    let results: Array<{id: number; text: string; score?: number; metadata?: any}> = [];
    
    if (requestedNamespace === 'global') {
      // Search global namespaces - need to get list of available global namespaces
      // This requires access to diagnostics or namespace listing
    } else if (requestedNamespace) {
      // Search specific namespace
      results = await memoryInstance.retrieve(
        llmConfig, // Need to figure out how to get this
        query,
        { namespace: requestedNamespace, k: limit }
      );
    } else {
      // Default: search current workspace chat namespace
      // This needs context about which namespace is active
    }

    const formattedResults = results.map(item => ({
      id: item.id,
      text: item.text,
      relevanceScore: item.score !== undefined ? (1 - item.score).toFixed(3) : undefined,
      ...(includeMetadata && {
        source: item.source,
        metadata: item.metadata
      })
    }));

    return {
      results: formattedResults,
      totalResults: formattedResults.length,
      query: query
    };
  } catch (error) {
    return {
      results: [],
      totalResults: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
```

#### 1.3 Add Dispatch Case to `executeTool()`

Add to the switch statement in `executeTool()`:

```typescript
case 'query_memory':
  return queryMemory(safeArgs);
```

### Phase 2: Wiring Up Dependencies

The challenge is that `queryMemory()` needs access to:
1. **TurboVecMemory instance** (`turboMemory` from main.ts)
2. **LLMConfig** (needed for embedding generation)
3. **Current namespace context** (which namespaces are active)

#### 2.1 Option A: Extend RuntimeContext (Recommended)

Modify the `RuntimeContext` interface in `toolRuntime.ts`:

```typescript
interface RuntimeContext {
  workspaceDir: string;
  rootDir: string;
  onTerminalOutput?: (payload: { source: 'stdout' | 'stderr'; text: string }) => void;
  onTerminalEvent?: (payload: { type: 'start' | 'end'; command: string; cwd: string; code?: number | null; signal?: string | null }) => void;
  setActiveTerminalProcess?: (child: ChildProcessWithoutNullStreams | null) => void;
  requestOutsideWorkspaceApproval?: (payload: {
    tool: string;
    summary: string;
    targets: string[];
  }) => Promise<boolean>;
  
  // NEW: Memory access
  memoryInstance?: any; // TurboVecMemory instance
  llmConfig?: LLMConfig;
  activeNamespaces?: string[]; // Currently selected namespaces
}
```

Then update the `queryMemory` function to use context:

```typescript
async function queryMemory(args: Record<string, unknown>, context?: RuntimeContext): Promise<unknown> {
  // ... validation ...
  
  if (!context?.memoryInstance) {
    return { results: [], totalResults: 0, warning: 'Memory store not available' };
  }

  if (!context?.llmConfig) {
    return { results: [], totalResults: 0, error: 'LLM configuration not available for embedding generation' };
  }

  // Use context.activeNamespaces to determine default search scope
  const namespaces = context.activeNamespaces || [];
  // ... rest of implementation
}
```

#### 2.2 Update main.ts to Pass Context

In `main.ts`, update the `runtimeContext()` function (around line 750):

```typescript
function runtimeContext(sender: IpcMainEvent, channel: string) {
  return {
    workspaceDir: selectedWorkspaceDir,
    rootDir: app.getPath('userData'),
    onTerminalOutput: (payload) => sender.send(channel, payload),
    onTerminalEvent: (payload) => sender.send(channel, payload),
    setActiveTerminalProcess: setActiveTerminalProcess,
    requestOutsideWorkspaceApproval: requestOutsideWorkspaceApproval,
    
    // NEW: Pass memory context
    memoryInstance: turboMemory,
    llmConfig: currentLlmConfig, // Need to store this somewhere accessible
    activeNamespaces: currentChatNamespaces // Need to track these
  };
}
```

**Note**: This requires storing `currentLlmConfig` and `currentChatNamespaces` as module-level variables that get updated with each chat request.

#### 2.3 Option B: IPC Handler Approach (Alternative)

If extending RuntimeContext feels too invasive, create a dedicated IPC handler:

In `main.ts`:
```typescript
ipcMain.handle(
  'memory:query',
  async (_event, payload: { query: string; namespace?: string; limit?: number }) => {
    if (!turboMemory) {
      return { results: [], error: 'Memory not initialized' };
    }
    
    // Need access to current LLM config - could pass it in payload
    const config = currentLlmConfig; // Module-level variable
    const namespaces = currentChatNamespaces; // Module-level variable
    
    try {
      let results: RetrievedMemoryItem[] = [];
      
      if (payload.namespace === 'global') {
        // Search global namespaces
        results = await turboMemory.retrieveMulti(config, payload.query, {
          namespaces: namespaces.filter(n => n.startsWith('global_')),
          k: payload.limit || 5
        });
      } else if (payload.namespace) {
        results = await turboMemory.retrieve(config, payload.query, {
          namespace: payload.namespace,
          k: payload.limit || 5
        });
      } else {
        // Search all active namespaces
        results = namespaces.length > 1
          ? await turboMemory.retrieveMulti(config, payload.query, {
              namespaces,
              k: payload.limit || 5
            })
          : await turboMemory.retrieve(config, payload.query, {
              namespace: namespaces[0] || 'default',
              k: payload.limit || 5
            });
      }
      
      return { results };
    } catch (error) {
      return { 
        results: [], 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }
);
```

Then in `toolRuntime.ts`, the `queryMemory` function calls IPC back to main process. **This is circular and problematic** since tools run in the main process already.

**Recommendation**: Go with Option A (extend RuntimeContext).

### Phase 3: Orchestration Engine Integration

The orchestration engine (`orchestrationEngine.ts`) also needs access to `query_memory`.

#### 3.1 Update Orchestration Context

In `orchestrationEngine.ts`, find where `executeTool` is called and ensure the context includes memory access.

Look for the tool execution callback (around line 286+):

```typescript
// Find this pattern and update it:
const result = await executeTool(toolCall.function.name, toolCall.function.arguments, {
  workspaceDir: plan.workspaceDir,
  rootDir: app.getPath('userData'),
  // ... existing context properties ...
  
  // ADD THESE:
  memoryInstance: turboMemory,
  llmConfig: config,
  activeNamespaces: orchestrationNamespaces // Whatever namespaces are active for this plan
});
```

### Phase 4: Model Prompting Guidance

The tool description should guide the model on when to use it. Consider adding system prompt guidance:

In the system prompt construction (main.ts around line 544), add:

```typescript
// After existing memory injection, add tool usage guidance if query_memory is enabled
if (requestedToolNames.includes('query_memory')) {
  messages.push({
    role: 'system',
    content: 
      'You have access to a query_memory tool that lets you search persistent memory for past conversations, ' +
      'decisions, and knowledge. Use it when:\n' +
      '- You need information that might be in past conversations\n' +
      '- The user references something discussed previously\n' +
      '- You want to verify assumptions against stored knowledge\n' +
      '- Working on a multi-session project and need context from earlier work\n\n' +
      'Prefer query_memory over web_search when the information is likely to be in your memory store.'
  });
}
```

### Phase 5: Testing

#### 5.1 Unit Tests

Create `llm-ide/src/tests/queryMemory.toolRuntime.test.ts`:

```typescript
import { executeTool } from '../backend/toolRuntime';

describe('query_memory tool', () => {
  it('should reject empty query', async () => {
    await expect(executeTool('query_memory', { query: '' })).rejects.toThrow('query is required');
  });

  it('should return warning when memory not initialized', async () => {
    const result = await executeTool('query_memory', { query: 'test' });
    expect(result).toHaveProperty('warning', 'Memory store not initialized');
  });

  // More tests with mocked TurboVecMemory instance
});
```

#### 5.2 Integration Tests

Test with actual TurboVec memory:
1. Store a known fact in memory
2. Query for it using the tool
3. Verify it appears in results

### Phase 6: Optional Enhancements

#### 6.1 `store_memory` Tool (Future)

Allow models to explicitly store important information:

```typescript
{
  type: 'function',
  function: {
    name: 'store_memory',
    description: 'Store important information, decisions, or knowledge for future retrieval',
    parameters: {
      type: 'object',
      properties: {
        content: { 
          type: 'string',
          description: 'Information to remember'
        },
        namespace: {
          type: 'string',
          description: 'Target namespace (default: current workspace)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization'
        }
      },
      required: ['content']
    }
  }
}
```

#### 6.2 `list_memory_namespaces` Tool

Let models discover available namespaces:

```typescript
{
  type: 'function',
  function: {
    name: 'list_memory_namespaces',
    description: 'List available memory namespaces and their record counts',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
}
```

## File Modification Summary

| File | Changes |
|------|---------|
| `llm-ide/src/backend/toolRuntime.ts` | Add tool definition, implementation function, dispatch case, extend RuntimeContext |
| `llm-ide/src/main.ts` | Update runtimeContext() to pass memory instance, LLM config, active namespaces; add system prompt guidance |
| `llm-ide/src/backend/orchestrationEngine.ts` | Update tool execution context to include memory access |
| `llm-ide/src/tests/queryMemory.toolRuntime.test.ts` | NEW: Unit tests |

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| LLM config not available in tool context | Store as module-level variable, update on each chat request |
| Namespace ambiguity | Default to active namespaces; require explicit namespace for global searches |
| Performance impact | Limit results to 20 max; reuse existing embedding infrastructure |
| Security (model accessing sensitive memories) | Same access controls as automatic injection; locked namespaces still enforced |

## Implementation Order

1. ✅ Extend `RuntimeContext` interface
2. ✅ Add tool definition to `toolDefinitions[]`
3. ✅ Implement `queryMemory()` function
4. ✅ Add dispatch case in `executeTool()`
5. ✅ Update `main.ts` runtime context creation
6. ✅ Update orchestration engine context
7. ✅ Add system prompt guidance
8. ✅ Write tests
9. ✅ Manual testing with real memory data
