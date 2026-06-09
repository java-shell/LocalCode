import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { ChildProcessWithoutNullStreams } from 'child_process';
import { chatWithTools, listModels } from './backend/llmClient';
import { runOrchestration } from './backend/orchestrationEngine';
import { defaultPlan, validatePlan } from './backend/schema';
import { loadPlan, savePlan } from './backend/planStore';
import { ChatMessage, ChatStreamRequest, LLMConfig, OrchestrationPlan, WorkspaceState } from './shared/types';
import { executeTool, getAllowedToolDefinitions, toolDefinitions } from './backend/toolRuntime';
import { buildWorkspaceTree, readWorkspaceFile, writeWorkspaceFile } from './backend/workspaceFs';
import { TurboVecMemory } from './backend/turboVecMemory';

let mainWindow: BrowserWindow | null = null;
let selectedWorkspaceDir = process.cwd();
let activeTerminalProcess: ChildProcessWithoutNullStreams | null = null;
const fileWatchRefs = new Map<string, { count: number; listener: (curr: fs.Stats, prev: fs.Stats) => void }>();
let turboMemory: TurboVecMemory | null = null;

function memoryNamespace(mode: 'chat' | 'orchestration', workspaceDir: string, model: string): string {
  return `${mode}:${workspaceDir}:${model}`;
}

function runtimeContext(sender?: Electron.WebContents, eventChannel: 'chat:event' | 'orch:event' = 'chat:event') {
  return {
    workspaceDir: selectedWorkspaceDir,
    rootDir: selectedWorkspaceDir,
    onTerminalOutput: sender
      ? (payload: { source: 'stdout' | 'stderr'; text: string }) => {
          sender.send('terminal:output', payload);
        }
      : undefined,
    onTerminalEvent: sender
      ? (payload: {
          type: 'start' | 'end';
          command: string;
          cwd: string;
          code?: number | null;
          signal?: string | null;
        }) => {
          sender.send('terminal:event', payload);
        }
      : undefined,
    setActiveTerminalProcess: (child: ChildProcessWithoutNullStreams | null) => {
      activeTerminalProcess = child;
    },
    requestOutsideWorkspaceApproval: async (payload: {
      tool: string;
      summary: string;
      targets: string[];
    }) => {
      sender?.send(
        eventChannel,
        `[warning] ${payload.tool} targets path(s) outside workspace and needs approval: ${payload.summary}`
      );

      if (!mainWindow) {
        return false;
      }

      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Allow', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Approve File Mutation Outside Workspace',
        message: `Tool ${payload.tool} wants to modify files outside workspace scope.`,
        detail: `Intent: ${payload.summary}\n\nTargets:\n${payload.targets.join('\n')}`
      });

      const approved = result.response === 0;
      sender?.send(eventChannel, `[warning] outside-workspace operation ${approved ? 'approved' : 'denied'}.`);
      return approved;
    }
  };
}

function workspaceState(): WorkspaceState {
  return {
    workspaceDir: selectedWorkspaceDir,
    rootDir: selectedWorkspaceDir
  };
}

function resolveWatchedWorkspacePath(relativePath: string): { absolute: string; relative: string } {
  const absolute = path.resolve(selectedWorkspaceDir, relativePath);
  const relative = path.relative(selectedWorkspaceDir, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path must be inside selected workspace directory.');
  }
  return { absolute, relative };
}

function clearAllFileWatches() {
  for (const [absolutePath, ref] of fileWatchRefs.entries()) {
    fs.unwatchFile(absolutePath, ref.listener);
  }
  fileWatchRefs.clear();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(process.cwd(), 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  const memoryRoot = path.join(app.getPath('userData'), 'turbovec-memory');
  const bridgeScript = path.join(process.cwd(), 'src', 'backend', 'turbovec_bridge.py');
  turboMemory = new TurboVecMemory(memoryRoot, bridgeScript);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle(
  'chat:stream',
  async (event, payload: ChatStreamRequest) => {
  const config = payload.config;
  const messages: ChatMessage[] = [];

    if (turboMemory) {
      const recalled = await turboMemory.retrieve(config, payload.prompt, {
        namespace: memoryNamespace('chat', selectedWorkspaceDir, config.model),
        k: 6
      });

      if (recalled.length > 0) {
        const memoryLines = recalled
          .map((item, index) => `${index + 1}. [${item.source}] ${item.text}`)
          .join('\n');
        messages.push({
          role: 'system',
          content:
            'Relevant long-term memory from prior interactions is available below. Use it only when useful and ignore stale items.\n\n' +
            memoryLines
        });
        event.sender.send('chat:event', `[memory] injected ${recalled.length} memory item(s).`);
      }
    }

    messages.push({ role: 'user', content: payload.prompt });

    const availableToolNames = toolDefinitions.map(def => def.function.name);
    const requestedToolNames = Array.isArray(payload.toolNames) && payload.toolNames.length > 0
      ? payload.toolNames
      : availableToolNames.filter(name => name !== 'delete_path' && name !== 'git_commit');

    const toolDefs = getAllowedToolDefinitions(requestedToolNames);

    const text = await chatWithTools(
      config,
      messages,
      toolDefs,
      async (name, args) => {
        if (!requestedToolNames.includes(name)) {
          throw new Error(`Tool ${name} is not enabled for chat.`);
        }
        return executeTool(name, args, runtimeContext(event.sender, 'chat:event'));
      },
      message => {
        event.sender.send('chat:event', message);
      },
      payload.maxToolTurns ?? 40
    );

    if (turboMemory) {
      try {
        await turboMemory.store(
          config,
          [
            {
              text: payload.prompt.slice(0, 4000),
              source: 'chat:user',
              metadata: { workspaceDir: selectedWorkspaceDir }
            },
            {
              text: text.slice(0, 6000),
              source: 'chat:assistant',
              metadata: { workspaceDir: selectedWorkspaceDir }
            }
          ],
          {
            namespace: memoryNamespace('chat', selectedWorkspaceDir, config.model)
          }
        );
        event.sender.send('chat:event', '[memory] stored latest conversation turn in TurboVec memory.');
      } catch (storeErr) {
        event.sender.send('chat:event', `[memory] store failed: ${storeErr instanceof Error ? storeErr.message : String(storeErr)}`);
      }
    }

    // Keep renderer streaming behavior by emitting text in chunks.
    const chunkSize = 16;
    for (let i = 0; i < text.length; i += chunkSize) {
      event.sender.send('chat:token', text.slice(i, i + chunkSize));
    }

    return { text };
  }
);

ipcMain.handle('chat:list-models', async (_event, payload: { endpoint: string; apiKey?: string }) => {
  const models = await listModels({
    endpoint: payload.endpoint,
    apiKey: payload.apiKey
  });
  return { models };
});

ipcMain.handle('memory:diagnostics', async (_event, payload?: { model?: string }) => {
  if (!turboMemory) {
    return {
      ok: false,
      reason: 'memory_not_initialized'
    };
  }

  const model = String(payload?.model ?? '').trim();
  const filter = model ? `${selectedWorkspaceDir}:${model}` : selectedWorkspaceDir;
  return turboMemory.diagnostics(filter);
});

ipcMain.handle('memory:clear-namespace', async (_event, payload?: { namespace?: string }) => {
  if (!turboMemory) {
    return {
      ok: false,
      reason: 'memory_not_initialized'
    };
  }

  const namespace = String(payload?.namespace ?? '').trim();
  if (!namespace) {
    return {
      ok: false,
      reason: 'namespace_required'
    };
  }

  const result = await turboMemory.clearNamespace(namespace);
  return {
    ok: true,
    ...result
  };
});

ipcMain.handle('terminal:send-input', async (_event, payload: { text: string }) => {
  if (!activeTerminalProcess || !activeTerminalProcess.stdin || activeTerminalProcess.stdin.destroyed) {
    return { sent: false, reason: 'no_active_process' };
  }

  const text = String(payload.text ?? '');
  activeTerminalProcess.stdin.write(text);
  return { sent: true };
});

ipcMain.handle('terminal:interrupt', async () => {
  if (!activeTerminalProcess) {
    return { interrupted: false, reason: 'no_active_process' };
  }
  const interrupted = activeTerminalProcess.kill('SIGINT');
  return { interrupted };
});

ipcMain.handle('workspace:get-state', async () => workspaceState());

ipcMain.handle('workspace:select-directory', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Workspace Directory',
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    clearAllFileWatches();
    selectedWorkspaceDir = result.filePaths[0];
  }

  return workspaceState();
});

ipcMain.handle('workspace:list-tree', async () => {
  return buildWorkspaceTree(selectedWorkspaceDir);
});

ipcMain.handle('workspace:read-file', async (_event, payload: { path: string }) => {
  const content = await readWorkspaceFile(selectedWorkspaceDir, payload.path);
  return { content };
});

ipcMain.handle('workspace:write-file', async (_event, payload: { path: string; content: string }) => {
  await writeWorkspaceFile(selectedWorkspaceDir, payload.path, payload.content);
  return { ok: true };
});

ipcMain.handle('workspace:watch-file', async (event, payload: { path: string }) => {
  const { absolute, relative } = resolveWatchedWorkspacePath(payload.path);
  const existing = fileWatchRefs.get(absolute);
  if (existing) {
    existing.count += 1;
    return { watching: true };
  }

  const listener = (curr: fs.Stats, prev: fs.Stats) => {
    if (curr.mtimeMs !== prev.mtimeMs) {
      event.sender.send('workspace:file-changed', relative);
    }
  };

  fs.watchFile(absolute, { interval: 700 }, listener);
  fileWatchRefs.set(absolute, { count: 1, listener });
  return { watching: true };
});

ipcMain.handle('workspace:unwatch-file', async (_event, payload: { path: string }) => {
  const { absolute } = resolveWatchedWorkspacePath(payload.path);
  const existing = fileWatchRefs.get(absolute);
  if (!existing) {
    return { watching: false };
  }

  existing.count -= 1;
  if (existing.count <= 0) {
    fs.unwatchFile(absolute, existing.listener);
    fileWatchRefs.delete(absolute);
    return { watching: false };
  }

  return { watching: true };
});

ipcMain.handle('orch:load-plan', async () => {
  return loadPlan();
});

ipcMain.handle('orch:save-plan', async (_event, plan: OrchestrationPlan) => {
  await savePlan(plan);
});

ipcMain.handle('orch:validate-plan', async (_event, raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    return validatePlan(parsed);
  } catch (error) {
    return [error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON'];
  }
});

ipcMain.handle('orch:run', async (event, payload: { plan: OrchestrationPlan; prompt: string }) => {
  const errors = validatePlan(payload.plan);
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }

  const run = await runOrchestration(payload.plan ?? defaultPlan, payload.prompt, message => {
    event.sender.send('orch:event', message);
  }, runtimeContext(event.sender, 'orch:event'), {
    retrieve: async (config, query, stepName) => {
      if (!turboMemory) {
        return [];
      }
      const items = await turboMemory.retrieve(config, query, {
        namespace: memoryNamespace('orchestration', selectedWorkspaceDir, config.model),
        k: 8
      });
      event.sender.send('orch:event', `[memory] ${stepName} retrieved ${items.length} memory item(s).`);
      return items;
    },
    store: async (config, text, stepName) => {
      if (!turboMemory) {
        return;
      }
      await turboMemory.store(
        config,
        [
          {
            text: text.slice(0, 7000),
            source: `orchestration:${stepName}`,
            metadata: { workspaceDir: selectedWorkspaceDir }
          }
        ],
        {
          namespace: memoryNamespace('orchestration', selectedWorkspaceDir, config.model)
        }
      );
      event.sender.send('orch:event', `[memory] ${stepName} stored output in TurboVec memory.`);
    }
  });

  return { output: run.output };
});
