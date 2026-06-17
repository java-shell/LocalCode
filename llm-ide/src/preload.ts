import { contextBridge, ipcRenderer } from 'electron';
import {
  ChatSession,
  ChatSessionSummary,
  ChatStreamResult,
  ChatStreamRequest,
  OrchestrationRunRequest,
  OrchestrationExportResult,
  LLMConfig,
  OrchestrationImportResult,
  OrchestrationPlan,
  OrchestrationRunResult,
  WorkspaceState,
  WorkspaceTreeNode
} from './shared/types';

type ChatTokenListener = (token: string) => void;
type ChatEventListener = (event: string) => void;
type OrchEventListener = (event: string) => void;
type WorkspaceFileChangeListener = (relativePath: string) => void;
type TerminalOutputListener = (payload: { source: 'stdout' | 'stderr'; text: string }) => void;
type TerminalEventListener = (payload: {
  type: 'start' | 'end';
  command: string;
  cwd: string;
  code?: number | null;
  signal?: string | null;
}) => void;

const api = {
  listModels: async (payload: { endpoint: string; apiKey?: string }): Promise<{ models: string[]; contextWindows?: Record<string, number> }> => {
    return ipcRenderer.invoke('chat:list-models', payload);
  },
  getMemoryDiagnostics: async (payload?: { model?: string }): Promise<unknown> => {
    return ipcRenderer.invoke('memory:diagnostics', payload);
  },
  clearMemoryNamespace: async (payload: { namespace: string }): Promise<unknown> => {
    return ipcRenderer.invoke('memory:clear-namespace', payload);
  },
  chatStream: async (payload: ChatStreamRequest): Promise<ChatStreamResult> => {
    return ipcRenderer.invoke('chat:stream', payload);
  },
  listChatSessions: async (): Promise<{ sessions: ChatSessionSummary[] }> => {
    return ipcRenderer.invoke('chat:list-sessions');
  },
  loadChatSession: async (payload: { id: string }): Promise<ChatSession | null> => {
    return ipcRenderer.invoke('chat:load-session', payload);
  },
  saveChatSession: async (payload: { session: ChatSession }): Promise<ChatSession> => {
    return ipcRenderer.invoke('chat:save-session', payload);
  },
  deleteChatSession: async (payload: { id: string }): Promise<{ deleted: boolean }> => {
    return ipcRenderer.invoke('chat:delete-session', payload);
  },
  stopChat: async (): Promise<{ stopped: boolean; reason?: string }> => {
    return ipcRenderer.invoke('chat:stop');
  },
  onChatToken: (listener: ChatTokenListener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, token: string) => listener(token);
    ipcRenderer.on('chat:token', wrapped);
    return () => ipcRenderer.removeListener('chat:token', wrapped);
  },
  onChatEvent: (listener: ChatEventListener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, message: string) => listener(message);
    ipcRenderer.on('chat:event', wrapped);
    return () => ipcRenderer.removeListener('chat:event', wrapped);
  },
  onTerminalOutput: (listener: TerminalOutputListener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { source: 'stdout' | 'stderr'; text: string }) =>
      listener(payload);
    ipcRenderer.on('terminal:output', wrapped);
    return () => ipcRenderer.removeListener('terminal:output', wrapped);
  },
  onTerminalEvent: (listener: TerminalEventListener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: {
        type: 'start' | 'end';
        command: string;
        cwd: string;
        code?: number | null;
        signal?: string | null;
      }
    ) => listener(payload);
    ipcRenderer.on('terminal:event', wrapped);
    return () => ipcRenderer.removeListener('terminal:event', wrapped);
  },
  sendTerminalInput: async (payload: { text: string }): Promise<{ sent: boolean; reason?: string }> => {
    return ipcRenderer.invoke('terminal:send-input', payload);
  },
  runTerminalCommand: async (payload: { command: string; cwd?: string }): Promise<{ started: boolean; reason?: string }> => {
    return ipcRenderer.invoke('terminal:run-command', payload);
  },
  interruptTerminalProcess: async (): Promise<{ interrupted: boolean; reason?: string }> => {
    return ipcRenderer.invoke('terminal:interrupt');
  },
  loadPlan: async (): Promise<OrchestrationPlan> => ipcRenderer.invoke('orch:load-plan'),
  importPlan: async (): Promise<OrchestrationImportResult | null> => ipcRenderer.invoke('orch:import-plan'),
  exportPlan: async (plan: OrchestrationPlan): Promise<OrchestrationExportResult | null> =>
    ipcRenderer.invoke('orch:export-plan', plan),
  savePlan: async (plan: OrchestrationPlan): Promise<void> => ipcRenderer.invoke('orch:save-plan', plan),
  validatePlan: async (raw: string): Promise<string[]> => ipcRenderer.invoke('orch:validate-plan', raw),
  runOrchestration: async (payload: OrchestrationRunRequest): Promise<OrchestrationRunResult> => {
    return ipcRenderer.invoke('orch:run', payload);
  },
  stopOrchestration: async (): Promise<{ stopped: boolean; reason?: string }> => {
    return ipcRenderer.invoke('orch:stop');
  },
  getWorkspaceState: async (): Promise<WorkspaceState> => ipcRenderer.invoke('workspace:get-state'),
  selectWorkspaceDirectory: async (): Promise<WorkspaceState> =>
    ipcRenderer.invoke('workspace:select-directory'),
  listWorkspaceTree: async (): Promise<WorkspaceTreeNode> => ipcRenderer.invoke('workspace:list-tree'),
  readWorkspaceFile: async (payload: { path: string }): Promise<{ content: string }> =>
    ipcRenderer.invoke('workspace:read-file', payload),
  writeWorkspaceFile: async (payload: { path: string; content: string }): Promise<{ ok: true }> =>
    ipcRenderer.invoke('workspace:write-file', payload),
  watchWorkspaceFile: async (payload: { path: string }): Promise<{ watching: boolean }> =>
    ipcRenderer.invoke('workspace:watch-file', payload),
  unwatchWorkspaceFile: async (payload: { path: string }): Promise<{ watching: boolean }> =>
    ipcRenderer.invoke('workspace:unwatch-file', payload),
  onWorkspaceFileChanged: (listener: WorkspaceFileChangeListener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, relativePath: string) => listener(relativePath);
    ipcRenderer.on('workspace:file-changed', wrapped);
    return () => ipcRenderer.removeListener('workspace:file-changed', wrapped);
  },
  onOrchestrationEvent: (listener: OrchEventListener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: string) => listener(value);
    ipcRenderer.on('orch:event', wrapped);
    return () => ipcRenderer.removeListener('orch:event', wrapped);
  }
};

contextBridge.exposeInMainWorld('llmIde', api);

declare global {
  interface Window {
    llmIde: typeof api;
  }
}
