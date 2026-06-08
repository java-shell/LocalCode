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

let mainWindow: BrowserWindow | null = null;
const appRootDir = process.cwd();
let selectedWorkspaceDir = appRootDir;
let activeTerminalProcess: ChildProcessWithoutNullStreams | null = null;
const fileWatchRefs = new Map<string, { count: number; listener: (curr: fs.Stats, prev: fs.Stats) => void }>();

function runtimeContext(sender?: Electron.WebContents, eventChannel: 'chat:event' | 'orch:event' = 'chat:event') {
  return {
    workspaceDir: selectedWorkspaceDir,
    rootDir: appRootDir,
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
    rootDir: appRootDir
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
  const messages: ChatMessage[] = [{ role: 'user', content: payload.prompt }];

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
  }, runtimeContext(event.sender, 'orch:event'));

  return { output: run.output };
});
