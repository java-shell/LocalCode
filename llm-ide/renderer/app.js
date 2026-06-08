let editor;
// OpenWeatherMap API key modal handling will be initialized in main() after DOM is ready.

let untitledCounter = 1;
const editorTabs = new Map();
const watchedFilePaths = new Set();
const externalPromptLocks = new Set();
let activeEditorKey = null;
const SETTINGS_STORAGE_KEY = 'localcode.settings';

const settingsState = {
  maxToolTurns: 40,
  endpoint: 'http://localhost:11434/v1/chat/completions',
  model: 'llama3',
  apiKey: '',
  chatSettingsCollapsed: true
};

function clampMaxToolTurns(value) {
  if (!Number.isFinite(value)) return 40;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    settingsState.maxToolTurns = clampMaxToolTurns(Number(parsed.maxToolTurns ?? 40));
    settingsState.endpoint = String(parsed.endpoint ?? settingsState.endpoint).trim() || settingsState.endpoint;
  // OpenWeatherMap API key modal handling
  const openWeatherApiKeyModal = document.getElementById('openWeatherApiKeyModal');
  const openWeatherApiKeyInput = document.getElementById('openWeatherApiKeyInput');
  const openWeatherApiKeySave = document.getElementById('openWeatherApiKeySave');

  function openOpenWeatherModal() {
    const storedKey = window.localStorage.getItem('openWeatherApiKey');
    if (storedKey) {
      openWeatherApiKeyInput.value = storedKey;
    } else {
      openWeatherApiKeyInput.value = '';
    }
    openWeatherApiKeyModal.classList.add('open');
    openWeatherApiKeyModal.setAttribute('aria-hidden', 'false');
    openWeatherApiKeyInput.focus();
  }

  function closeOpenWeatherModal() {
    openWeatherApiKeyModal.classList.remove('open');
    openWeatherApiKeyModal.setAttribute('aria-hidden', 'true');
  }

  openWeatherApiKeySave.addEventListener('click', () => {
    const key = openWeatherApiKeyInput.value.trim();
    if (key) {
      window.localStorage.setItem('openWeatherApiKey', key);
    }
    closeOpenWeatherModal();
  });

  openWeatherApiKeyModal.addEventListener('click', event => {
    if (event.target === openWeatherApiKeyModal) {
      closeOpenWeatherModal();
    }
  });

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openWeatherApiKeyModal.classList.contains('open')) {
      closeOpenWeatherModal();
    }
  });

  // Show modal if key not set
  if (!window.localStorage.getItem('openWeatherApiKey')) {
    openOpenWeatherModal();
  }

    settingsState.model = String(parsed.model ?? settingsState.model).trim() || settingsState.model;
    settingsState.apiKey = String(parsed.apiKey ?? settingsState.apiKey);
    settingsState.chatSettingsCollapsed = Boolean(parsed.chatSettingsCollapsed ?? settingsState.chatSettingsCollapsed);
  } catch {
    settingsState.maxToolTurns = 40;
    settingsState.endpoint = 'http://localhost:11434/v1/chat/completions';
    settingsState.model = 'llama3';
    settingsState.apiKey = '';
    settingsState.chatSettingsCollapsed = true;
  }
}

function saveSettings() {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settingsState));
}

function basename(filePath) {
  if (!filePath) return '';
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

function inferLanguageFromPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  return 'plaintext';
}

function setActiveTab(which) {
  const chatTab = document.getElementById('chatTab');
  const orchTab = document.getElementById('orchTab');
  const chatView = document.getElementById('chatView');
  const orchView = document.getElementById('orchView');

  const chatOn = which === 'chat';
  chatTab.classList.toggle('active', chatOn);
  orchTab.classList.toggle('active', !chatOn);
  chatView.classList.toggle('active', chatOn);
  orchView.classList.toggle('active', !chatOn);
}

function appendLog(el, line) {
  const row = document.createElement('div');
  row.className = 'log-line';
  row.textContent = line;
  el.appendChild(row);
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(raw) {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderMarkdownToHtml(markdownText) {
  const markdownLib = window.marked;
  const purifier = window.DOMPurify;

  if (markdownLib && typeof markdownLib.parse === 'function') {
    const rawHtml = markdownLib.parse(markdownText || '', {
      gfm: true,
      breaks: true
    });
    if (purifier && typeof purifier.sanitize === 'function') {
      return purifier.sanitize(rawHtml);
    }
    return rawHtml;
  }

  return `<pre>${escapeHtml(markdownText || '')}</pre>`;
}

function createModelUri(kind, value) {
  if (kind === 'file') {
    return monaco.Uri.parse(`file:///${value.replace(/^\/+/, '')}`);
  }
  return monaco.Uri.parse(`inmemory:///${value}`);
}

function renderEditorTabs() {
  const host = document.getElementById('editorTabs');
  host.innerHTML = '';

  for (const [key, tab] of editorTabs.entries()) {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = `editor-tab${key === activeEditorKey ? ' active' : ''}`;

    const label = document.createElement('span');
    label.className = 'editor-tab-label';
    label.textContent = tab.label;

    if (tab.isDirty) {
      const dirty = document.createElement('span');
      dirty.className = 'editor-tab-dirty';
      dirty.textContent = ' *';
      label.appendChild(dirty);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'editor-tab-close';
    close.textContent = 'x';
    close.title = 'Close tab';
    close.addEventListener('click', event => {
      event.stopPropagation();
      closeEditorTab(key);
    });

    tabButton.addEventListener('click', () => activateEditorTab(key));
    tabButton.appendChild(label);
    tabButton.appendChild(close);
    host.appendChild(tabButton);
  }
}

function activateEditorTab(key) {
  const tab = editorTabs.get(key);
  if (!tab) return;
  activeEditorKey = key;
  editor.setModel(tab.model);
  renderEditorTabs();
}

async function ensureFileWatch(relativePath) {
  if (watchedFilePaths.has(relativePath)) return;
  await window.llmIde.watchWorkspaceFile({ path: relativePath });
  watchedFilePaths.add(relativePath);
}

async function releaseFileWatch(relativePath) {
  if (!watchedFilePaths.has(relativePath)) return;
  await window.llmIde.unwatchWorkspaceFile({ path: relativePath });
  watchedFilePaths.delete(relativePath);
}

function attachDirtyTracking(tab) {
  tab.changeDisposable = tab.model.onDidChangeContent(() => {
    if (tab.suppressChange) return;
    tab.isDirty = tab.model.getValue() !== tab.lastSavedContent;
    renderEditorTabs();
  });
}

function openEditorTab(tabDef) {
  const existing = editorTabs.get(tabDef.key);
  if (existing) {
    if (typeof tabDef.content === 'string' && tabDef.content !== existing.model.getValue()) {
      existing.suppressChange = true;
      existing.model.setValue(tabDef.content);
      existing.suppressChange = false;
      existing.lastSavedContent = tabDef.content;
      existing.isDirty = false;
    }
    activateEditorTab(tabDef.key);
    return existing;
  }

  const uri = createModelUri(tabDef.kind, tabDef.uriValue);
  const model = monaco.editor.createModel(tabDef.content, tabDef.language, uri);
  const tab = {
    key: tabDef.key,
    label: tabDef.label,
    path: tabDef.path,
    kind: tabDef.kind,
    model,
    lastSavedContent: tabDef.content,
    isDirty: false,
    suppressChange: false,
    changeDisposable: null
  };

  attachDirtyTracking(tab);
  editorTabs.set(tabDef.key, tab);
  activateEditorTab(tabDef.key);
  return tab;
}

async function closeEditorTab(key) {
  const tab = editorTabs.get(key);
  if (!tab) return;

  const keys = Array.from(editorTabs.keys());
  const idx = keys.indexOf(key);

  if (tab.changeDisposable) {
    tab.changeDisposable.dispose();
  }
  tab.model.dispose();
  editorTabs.delete(key);

  if (tab.path) {
    await releaseFileWatch(tab.path);
  }

  if (!editorTabs.size) {
    openScratchTab();
    return;
  }

  const remaining = Array.from(editorTabs.keys());
  activateEditorTab(remaining[Math.max(0, Math.min(idx, remaining.length - 1))]);
}

function openScratchTab(content) {
  const id = `scratch-${untitledCounter++}`;
  openEditorTab({
    key: `scratch:${id}`,
    kind: 'scratch',
    uriValue: id,
    label: `${id}.ts`,
    path: null,
    language: 'typescript',
    content:
      content ||
      "// Scratch\nexport async function run() {\n  return 'Edit code here with Monaco and ask the LLM to help.';\n}\n"
  });
}

async function openWorkspaceFileTab(relativePath) {
  const result = await window.llmIde.readWorkspaceFile({ path: relativePath });
  openEditorTab({
    key: `file:${relativePath}`,
    kind: 'file',
    uriValue: relativePath,
    label: basename(relativePath),
    path: relativePath,
    language: inferLanguageFromPath(relativePath),
    content: result.content
  });
  await ensureFileWatch(relativePath);
}

async function saveTab(key) {
  const tab = editorTabs.get(key);
  if (!tab) return false;
  if (!tab.path) return false;

  const content = tab.model.getValue();
  await window.llmIde.writeWorkspaceFile({ path: tab.path, content });
  tab.lastSavedContent = content;
  tab.isDirty = false;
  renderEditorTabs();
  return true;
}

async function saveAllTabs() {
  const keys = Array.from(editorTabs.keys());
  for (const key of keys) {
    const tab = editorTabs.get(key);
    if (!tab || !tab.path || !tab.isDirty) continue;
    await saveTab(key);
  }
}

function applyDiskContentToTab(tab, content) {
  tab.suppressChange = true;
  tab.model.setValue(content);
  tab.suppressChange = false;
  tab.lastSavedContent = content;
  tab.isDirty = false;
  renderEditorTabs();
}

function initTerminalPanel() {
  const terminalOutput = document.getElementById('terminalOutput');
  const clearButton = document.getElementById('terminalClear');
  const terminalInput = document.getElementById('terminalInput');
  const terminalSend = document.getElementById('terminalSend');
  const MAX_TERMINAL_CHARS = 200000;

  function appendTerminalText(text) {
    terminalOutput.textContent += text;
    if (terminalOutput.textContent.length > MAX_TERMINAL_CHARS) {
      terminalOutput.textContent = terminalOutput.textContent.slice(
        terminalOutput.textContent.length - MAX_TERMINAL_CHARS
      );
    }
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }

  const offTerminalOutput = window.llmIde.onTerminalOutput(payload => {
    appendTerminalText(payload.text);
  });

  const offTerminalEvent = window.llmIde.onTerminalEvent(payload => {
    if (payload.type === 'start') {
      appendTerminalText(`\n$ (${payload.cwd}) ${payload.command}\n`);
      return;
    }

    const signalSuffix = payload.signal ? ` signal=${payload.signal}` : '';
    appendTerminalText(`\n[exit ${payload.code ?? 'unknown'}${signalSuffix}]\n`);
  });

  clearButton.addEventListener('click', () => {
    terminalOutput.textContent = '';
  });

  async function submitTerminalInput() {
    const raw = terminalInput.value;
    if (!raw.trim()) return;

    const command = raw.trim().toLowerCase();
    if (command === '(ctrl+c)' || command === '(ctl+c)') {
      const result = await window.llmIde.interruptTerminalProcess();
      appendTerminalText(result.interrupted ? '^C\n' : '[no active process]\n');
      terminalInput.value = '';
      return;
    }

    const result = await window.llmIde.sendTerminalInput({ text: `${raw}\n` });
    appendTerminalText(result.sent ? `> ${raw}\n` : '[no active process]\n');
    terminalInput.value = '';
  }

  terminalSend.addEventListener('click', submitTerminalInput);
  terminalInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitTerminalInput();
    }
  });

  window.addEventListener('beforeunload', () => {
    offTerminalOutput();
    offTerminalEvent();
  });
}

function initSettingsMenu() {
  const openButton = document.getElementById('openSettings');
  const modal = document.getElementById('settingsModal');
  const input = document.getElementById('settingMaxToolTurns');
  const endpointInput = document.getElementById('settingEndpoint');
  const modelInput = document.getElementById('settingModel');
  const apiKeyInput = document.getElementById('settingApiKey');
  const cancel = document.getElementById('settingsCancel');
  const save = document.getElementById('settingsSave');

  const chatEndpoint = document.getElementById('chatEndpoint');
  const chatModel = document.getElementById('chatModel');
  const chatApiKey = document.getElementById('chatApiKey');

  function openModal() {
    input.value = String(settingsState.maxToolTurns);
    endpointInput.value = settingsState.endpoint;
    modelInput.value = settingsState.model;
    apiKeyInput.value = settingsState.apiKey;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    input.focus();
    input.select();
  }

  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  openButton.addEventListener('click', openModal);
  cancel.addEventListener('click', closeModal);

  save.addEventListener('click', () => {
    settingsState.maxToolTurns = clampMaxToolTurns(Number(input.value));
    settingsState.endpoint = endpointInput.value.trim() || settingsState.endpoint;
    settingsState.model = modelInput.value.trim() || settingsState.model;
    settingsState.apiKey = apiKeyInput.value;

    chatEndpoint.value = settingsState.endpoint;
    chatApiKey.value = settingsState.apiKey;
    if (![...chatModel.options].some(option => option.value === settingsState.model)) {
      const option = document.createElement('option');
      option.value = settingsState.model;
      option.textContent = `${settingsState.model} (saved)`;
      chatModel.appendChild(option);
    }
    chatModel.value = settingsState.model;

    saveSettings();
    closeModal();
  });

  modal.addEventListener('click', event => {
    if (event.target === modal) {
      closeModal();
    }
  });

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('open')) {
      closeModal();
    }
  });
}

function setupMonaco() {
  return new Promise((resolve, reject) => {
    window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' } });
    window.require(
      ['vs/editor/editor.main'],
      () => {
        editor = monaco.editor.create(document.getElementById('editor'), {
          value: '',
          language: 'typescript',
          theme: 'vs-dark',
          minimap: { enabled: false },
          automaticLayout: true,
          fontSize: 14
        });
        openScratchTab();
        resolve();
      },
      reject
    );
  });
}

async function initChat() {
  const conversation = document.getElementById('chatConversation');
  const status = document.getElementById('chatStatus');
  const endpoint = document.getElementById('chatEndpoint');
  const model = document.getElementById('chatModel');
  const settingsToggle = document.getElementById('chatSettingsToggle');
  const settingsPanel = document.getElementById('chatSettingsPanel');
  const refreshModels = document.getElementById('chatRefreshModels');
  const apiKey = document.getElementById('chatApiKey');
  const prompt = document.getElementById('chatPrompt');
  const send = document.getElementById('chatSend');

  endpoint.value = settingsState.endpoint;
  apiKey.value = settingsState.apiKey;

  function applyChatSettingsVisibility() {
    settingsPanel.classList.toggle('collapsed', settingsState.chatSettingsCollapsed);
    settingsToggle.textContent = settingsState.chatSettingsCollapsed ? 'Model Settings (Show)' : 'Model Settings (Hide)';
  }

  settingsToggle.addEventListener('click', () => {
    settingsState.chatSettingsCollapsed = !settingsState.chatSettingsCollapsed;
    saveSettings();
    applyChatSettingsVisibility();
  });

  applyChatSettingsVisibility();

  let assistantMarkdownRaw = '';
  let assistantMarkdownEl = null;
  let assistantRowEl = null;
  let assistantReceivedToken = false;
  let markdownRenderQueued = false;

  function scheduleAssistantMarkdownRender() {
    if (!assistantMarkdownEl || markdownRenderQueued) return;
    markdownRenderQueued = true;
    requestAnimationFrame(() => {
      markdownRenderQueued = false;
      if (!assistantMarkdownEl) return;
      assistantMarkdownEl.innerHTML = renderMarkdownToHtml(assistantMarkdownRaw);
      conversation.scrollTop = conversation.scrollHeight;
    });
  }

  const offToken = window.llmIde.onChatToken(token => {
    if (!assistantMarkdownEl) return;
    assistantReceivedToken = true;
    assistantMarkdownRaw += token;
    scheduleAssistantMarkdownRender();
  });

  const offChatEvent = window.llmIde.onChatEvent(event => {
    appendLog(conversation, `[tool] ${event}`);
  });

  function setModelOptions(models, preferred) {
    model.innerHTML = '';
    if (!models.length) {
      const option = document.createElement('option');
      option.value = 'llama3';
      option.textContent = 'llama3 (fallback)';
      model.appendChild(option);
      model.value = 'llama3';
      return;
    }

    for (const modelId of models) {
      const option = document.createElement('option');
      option.value = modelId;
      option.textContent = modelId;
      model.appendChild(option);
    }

    if (preferred && models.includes(preferred)) {
      model.value = preferred;
      settingsState.model = preferred;
      saveSettings();
      return;
    }

    if (settingsState.model && models.includes(settingsState.model)) {
      model.value = settingsState.model;
      return;
    }

    if (model.value) {
      settingsState.model = model.value;
      saveSettings();
    }
  }

  async function refreshModelOptions() {
    const currentModel = model.value;
    refreshModels.disabled = true;
    status.textContent = 'Loading models...';
    try {
      const result = await window.llmIde.listModels({
        endpoint: endpoint.value.trim(),
        apiKey: apiKey.value.trim() || undefined
      });
      setModelOptions(result.models, currentModel || 'llama3');
      status.textContent = `Loaded ${result.models.length} models`;
    } catch (error) {
      setModelOptions([], currentModel || 'llama3');
      status.textContent = `Model load failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      refreshModels.disabled = false;
    }
  }

  refreshModels.addEventListener('click', refreshModelOptions);
  endpoint.addEventListener('change', () => {
    settingsState.endpoint = endpoint.value.trim() || settingsState.endpoint;
    saveSettings();
    refreshModelOptions();
  });
  apiKey.addEventListener('change', () => {
    settingsState.apiKey = apiKey.value;
    saveSettings();
    refreshModelOptions();
  });
  model.addEventListener('change', () => {
    settingsState.model = model.value;
    saveSettings();
  });

  send.addEventListener('click', async () => {
    const text = prompt.value.trim();
    if (!text) return;

    appendLog(conversation, `You: ${text}`);
    const assistantRow = document.createElement('div');
    assistantRow.className = 'log-line log-line-assistant';

    const assistantLabel = document.createElement('div');
    assistantLabel.className = 'assistant-label';
    assistantLabel.textContent = 'Assistant:';

    assistantMarkdownEl = document.createElement('div');
    assistantMarkdownEl.className = 'assistant-markdown';
    assistantRowEl = assistantRow;
    assistantMarkdownRaw = '';
    assistantReceivedToken = false;

    assistantRow.appendChild(assistantLabel);
    assistantRow.appendChild(assistantMarkdownEl);
    conversation.appendChild(assistantRow);
    status.textContent = 'Streaming...';
    send.disabled = true;

    try {
      const result = await window.llmIde.chatStream({
        prompt: text,
        config: {
          endpoint: endpoint.value.trim(),
          model: model.value,
          apiKey: apiKey.value.trim() || undefined,
          temperature: 0.2,
          maxTokens: 0
        },
        maxToolTurns: settingsState.maxToolTurns,
        toolNames: [
          'list_dir',
          'file_search',
          'read_file',
          'create_file',
          'write_file',
          'replace_in_file',
          'insert_in_file',
          'create_directory',
          'move_path',
          'grep_search',
          'git_status',
          'git_diff',
          'git_add',
          'run_terminal_command'
        ]
      });

      if (assistantMarkdownEl && !assistantMarkdownRaw && result?.text) {
        if (!assistantReceivedToken && assistantRowEl) {
          conversation.appendChild(assistantRowEl);
        }
        assistantMarkdownRaw = result.text;
        scheduleAssistantMarkdownRender();
      }

      status.textContent = 'Done';
    } catch (error) {
      appendLog(conversation, `[error] ${error instanceof Error ? error.message : String(error)}`);
      status.textContent = 'Error';
    } finally {
      send.disabled = false;
    }
  });

  window.addEventListener('beforeunload', () => {
    offToken();
    offChatEvent();
  });

  await refreshModelOptions();
}

async function initOrchestration() {
  const status = document.getElementById('orchStatus');
  const prompt = document.getElementById('orchPrompt');
  const planEl = document.getElementById('orchPlan');
  const planNameEl = document.getElementById('orchPlanName');
  const planDescriptionEl = document.getElementById('orchPlanDescription');
  const workflowEl = document.getElementById('orchWorkflow');
  const addStepButton = document.getElementById('orchAddStep');
  const eventsEl = document.getElementById('orchEvents');
  const outputEl = document.getElementById('orchOutput');

  const availableTools = [
    'list_dir',
    'file_search',
    'read_file',
    'create_file',
    'write_file',
    'replace_in_file',
    'insert_in_file',
    'create_directory',
    'move_path',
    'delete_path',
    'grep_search',
    'git_status',
    'git_diff',
    'git_add',
    'git_commit',
    'run_terminal_command'
  ];

  let currentPlan = {
    version: 1,
    name: 'Workflow',
    description: 'Generated from workflow builder.',
    steps: []
  };

  function defaultTools() {
    return availableTools.map(name => ({ name, enabled: ['list_dir', 'read_file', 'grep_search'].includes(name) }));
  }

  function makeStep(index) {
    const id = `step-${Date.now()}-${index}`;
    return {
      id,
      name: `Step ${index + 1}`,
      provider: 'openai-compatible',
      endpoint: settingsState.endpoint,
      model: settingsState.model,
      apiKey: settingsState.apiKey || undefined,
      systemPrompt: '',
      temperature: 0.2,
      maxTokens: 0,
      tools: defaultTools(),
      passOutputToNext: true
    };
  }

  function normalizeStep(step, index) {
    const existingTools = Array.isArray(step.tools) ? step.tools : [];
    const enabledMap = new Map(existingTools.map(tool => [tool.name, Boolean(tool.enabled)]));

    return {
      id: step.id || `step-${index + 1}`,
      name: step.name || `Step ${index + 1}`,
      provider: step.provider === 'ollama' ? 'ollama' : 'openai-compatible',
      endpoint: step.endpoint || settingsState.endpoint,
      model: step.model || settingsState.model,
      apiKey: step.apiKey || '',
      systemPrompt: step.systemPrompt || '',
      temperature: Number.isFinite(step.temperature) ? Number(step.temperature) : 0.2,
      maxTokens: Number.isFinite(step.maxTokens) ? Number(step.maxTokens) : 0,
      tools: availableTools.map(name => ({ name, enabled: Boolean(enabledMap.get(name)) })),
      passOutputToNext: step.passOutputToNext !== false
    };
  }

  function normalizePlan(plan) {
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    return {
      version: 1,
      name: plan.name || 'Workflow',
      description: plan.description || 'Generated from workflow builder.',
      steps: steps.map((step, index) => normalizeStep(step, index))
    };
  }

  function syncPlanJson() {
    currentPlan.name = planNameEl.value.trim() || 'Workflow';
    currentPlan.description = planDescriptionEl.value.trim() || 'Generated from workflow builder.';
    planEl.value = JSON.stringify(currentPlan, null, 2);
  }

  function renderWorkflow() {
    workflowEl.innerHTML = '';

    if (!currentPlan.steps.length) {
      const empty = document.createElement('div');
      empty.className = 'settings-help';
      empty.textContent = 'No steps yet. Add a step to build your workflow.';
      workflowEl.appendChild(empty);
      syncPlanJson();
      return;
    }

    currentPlan.steps.forEach((step, index) => {
      const card = document.createElement('div');
      card.className = 'orch-step-card';

      const header = document.createElement('div');
      header.className = 'orch-step-header';
      const title = document.createElement('strong');
      title.textContent = `Step ${index + 1}`;

      const actions = document.createElement('div');
      actions.className = 'orch-step-actions';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.textContent = 'Up';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => {
        const prev = currentPlan.steps[index - 1];
        currentPlan.steps[index - 1] = currentPlan.steps[index];
        currentPlan.steps[index] = prev;
        renderWorkflow();
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.textContent = 'Down';
      downBtn.disabled = index === currentPlan.steps.length - 1;
      downBtn.addEventListener('click', () => {
        const next = currentPlan.steps[index + 1];
        currentPlan.steps[index + 1] = currentPlan.steps[index];
        currentPlan.steps[index] = next;
        renderWorkflow();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        currentPlan.steps.splice(index, 1);
        renderWorkflow();
      });

      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(deleteBtn);
      header.appendChild(title);
      header.appendChild(actions);

      const grid = document.createElement('div');
      grid.className = 'orch-step-grid';

      function addLabeledInput(labelText, value, onChange, options = {}) {
        const wrapper = document.createElement('div');
        if (options.wide) wrapper.className = 'orch-step-grid-wide';

        const label = document.createElement('label');
        label.className = 'label';
        label.textContent = labelText;

        let input;
        if (options.type === 'textarea') {
          input = document.createElement('textarea');
          input.value = value || '';
        } else if (options.type === 'select') {
          input = document.createElement('select');
          for (const opt of options.items || []) {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            input.appendChild(option);
          }
          input.value = value;
        } else {
          input = document.createElement('input');
          input.type = options.type || 'text';
          input.value = String(value ?? '');
          if (options.min !== undefined) input.min = String(options.min);
          if (options.step !== undefined) input.step = String(options.step);
        }

        input.addEventListener('input', () => onChange(input.value));
        wrapper.appendChild(label);
        wrapper.appendChild(input);
        grid.appendChild(wrapper);
      }

      addLabeledInput('Step ID', step.id, value => {
        step.id = value || `step-${index + 1}`;
        syncPlanJson();
      });
      addLabeledInput('Step Name', step.name, value => {
        step.name = value || `Step ${index + 1}`;
        syncPlanJson();
      });
      addLabeledInput(
        'Provider',
        step.provider,
        value => {
          step.provider = value;
          syncPlanJson();
        },
        {
          type: 'select',
          items: [
            { value: 'openai-compatible', label: 'openai-compatible' },
            { value: 'ollama', label: 'ollama' }
          ]
        }
      );
      addLabeledInput('Model', step.model, value => {
        step.model = value;
        syncPlanJson();
      });
      addLabeledInput('Endpoint', step.endpoint, value => {
        step.endpoint = value;
        syncPlanJson();
      }, { wide: true });
      addLabeledInput('API Key (optional)', step.apiKey || '', value => {
        step.apiKey = value;
        syncPlanJson();
      });
      addLabeledInput('Temperature', step.temperature ?? 0.2, value => {
        step.temperature = Number(value || 0.2);
        syncPlanJson();
      }, { type: 'number', min: 0, step: 0.1 });
      addLabeledInput('Max Tokens (0 = provider default)', step.maxTokens ?? 0, value => {
        step.maxTokens = Number(value || 0);
        syncPlanJson();
      }, { type: 'number', min: 0, step: 1 });
      addLabeledInput('System Prompt', step.systemPrompt || '', value => {
        step.systemPrompt = value;
        syncPlanJson();
      }, { type: 'textarea', wide: true });

      const passWrap = document.createElement('label');
      passWrap.className = 'orch-tool-item orch-step-grid-wide';
      const passCheckbox = document.createElement('input');
      passCheckbox.type = 'checkbox';
      passCheckbox.checked = step.passOutputToNext !== false;
      passCheckbox.addEventListener('change', () => {
        step.passOutputToNext = passCheckbox.checked;
        syncPlanJson();
      });
      passWrap.appendChild(passCheckbox);
      passWrap.appendChild(document.createTextNode('Pass output to next step'));
      grid.appendChild(passWrap);

      const toolsBlock = document.createElement('div');
      toolsBlock.className = 'orch-tools';
      const toolsLabel = document.createElement('div');
      toolsLabel.className = 'label';
      toolsLabel.textContent = 'Enabled Tools';
      const toolsList = document.createElement('div');
      toolsList.className = 'orch-tools-list';

      step.tools.forEach(tool => {
        const item = document.createElement('label');
        item.className = 'orch-tool-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(tool.enabled);
        checkbox.addEventListener('change', () => {
          tool.enabled = checkbox.checked;
          syncPlanJson();
        });
        item.appendChild(checkbox);
        item.appendChild(document.createTextNode(tool.name));
        toolsList.appendChild(item);
      });

      toolsBlock.appendChild(toolsLabel);
      toolsBlock.appendChild(toolsList);

      card.appendChild(header);
      card.appendChild(grid);
      card.appendChild(toolsBlock);
      workflowEl.appendChild(card);
    });

    syncPlanJson();
  }

  const offEvent = window.llmIde.onOrchestrationEvent(event => {
    appendLog(eventsEl, event);
  });

  async function reload() {
    const plan = await window.llmIde.loadPlan();
    currentPlan = normalizePlan(plan);
    planNameEl.value = currentPlan.name;
    planDescriptionEl.value = currentPlan.description;
    renderWorkflow();
  }

  function readPlanFromUi() {
    syncPlanJson();
    return JSON.parse(planEl.value);
  }

  planNameEl.addEventListener('input', syncPlanJson);
  planDescriptionEl.addEventListener('input', syncPlanJson);
  addStepButton.addEventListener('click', () => {
    currentPlan.steps.push(makeStep(currentPlan.steps.length));
    renderWorkflow();
  });

  document.getElementById('orchLoad').addEventListener('click', reload);

  document.getElementById('orchValidate').addEventListener('click', async () => {
    const errors = await window.llmIde.validatePlan(JSON.stringify(readPlanFromUi()));
    status.textContent = !errors.length ? 'Plan is valid' : `Invalid plan: ${errors.join(' | ')}`;
  });

  document.getElementById('orchSave').addEventListener('click', async () => {
    try {
      const parsed = readPlanFromUi();
      await window.llmIde.savePlan(parsed);
      status.textContent = 'Plan saved';
    } catch (error) {
      status.textContent = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  document.getElementById('orchRun').addEventListener('click', async () => {
    eventsEl.textContent = '';
    outputEl.textContent = '';
    status.textContent = 'Running orchestration...';

    try {
      const parsed = readPlanFromUi();
      const result = await window.llmIde.runOrchestration({ plan: parsed, prompt: prompt.value.trim() });
      outputEl.textContent = result.output || '(empty output)';
      status.textContent = 'Run complete';
    } catch (error) {
      outputEl.textContent = error instanceof Error ? error.message : String(error);
      status.textContent = 'Run failed';
    }
  });

  await reload();

  window.addEventListener('beforeunload', () => {
    offEvent();
  });
}

async function initWorkspaceTree() {
  const workspacePath = document.getElementById('workspacePath');
  const filetree = document.getElementById('filetree');
  const selectButton = document.getElementById('workspaceSelect');
  const refreshButton = document.getElementById('workspaceRefresh');

  const offWorkspaceChanged = window.llmIde.onWorkspaceFileChanged(async relativePath => {
    const tab = editorTabs.get(`file:${relativePath}`);
    if (!tab) return;
    if (externalPromptLocks.has(relativePath)) return;

    try {
      const result = await window.llmIde.readWorkspaceFile({ path: relativePath });
      const diskContent = result.content;
      const currentContent = tab.model.getValue();

      if (diskContent === currentContent) {
        tab.lastSavedContent = diskContent;
        tab.isDirty = false;
        renderEditorTabs();
        return;
      }

      if (!tab.isDirty) {
        applyDiskContentToTab(tab, diskContent);
        return;
      }

      externalPromptLocks.add(relativePath);
      const shouldReload = window.confirm(
        `File changed on disk: ${relativePath}\n\nReload from disk and discard unsaved editor changes?`
      );
      if (shouldReload) {
        applyDiskContentToTab(tab, diskContent);
      }
      externalPromptLocks.delete(relativePath);
    } catch {
      // Ignore read failures (for example if file was deleted).
      externalPromptLocks.delete(relativePath);
    }
  });

  function renderNode(node) {
    if (node.type === 'file') {
      const item = document.createElement('li');
      item.className = 'tree-item file';
      item.textContent = node.name;
      item.title = node.path;
      item.addEventListener('click', async () => {
        try {
          await openWorkspaceFileTab(node.path);
        } catch (error) {
          filetree.textContent = `Failed to open file: ${error instanceof Error ? error.message : String(error)}`;
        }
      });
      return item;
    }

    const item = document.createElement('li');
    item.className = 'tree-item';
    const details = document.createElement('details');
    details.open = node.path === '';
    const summary = document.createElement('summary');
    summary.textContent = node.name || '(workspace)';
    details.appendChild(summary);

    const list = document.createElement('ul');
    list.className = 'tree-list';
    for (const child of node.children || []) {
      list.appendChild(renderNode(child));
    }
    details.appendChild(list);
    item.appendChild(details);
    return item;
  }

  async function reloadTree() {
    const state = await window.llmIde.getWorkspaceState();
    workspacePath.textContent = `Workspace: ${state.workspaceDir}\nRoot: ${state.rootDir}`;
    filetree.textContent = 'Loading...';
    try {
      const tree = await window.llmIde.listWorkspaceTree();
      const list = document.createElement('ul');
      list.className = 'tree-list';
      list.appendChild(renderNode(tree));
      filetree.innerHTML = '';
      filetree.appendChild(list);
    } catch (error) {
      filetree.textContent = `Unable to load file tree: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  selectButton.addEventListener('click', async () => {
    await window.llmIde.selectWorkspaceDirectory();
    await reloadTree();
  });

  refreshButton.addEventListener('click', reloadTree);

  window.addEventListener('beforeunload', () => {
    offWorkspaceChanged();
  });

  await reloadTree();
}

async function main() {
  loadSettings();
  document.getElementById('chatTab').addEventListener('click', () => setActiveTab('chat'));
  document.getElementById('orchTab').addEventListener('click', () => setActiveTab('orchestration'));
  document.getElementById('openSample').addEventListener('click', () => {
    openScratchTab(
      "// Sample file\nexport async function run() {\n  return 'Edit code here with Monaco and ask the LLM to help.';\n}\n"
    );
  });

  document.getElementById('saveFile').addEventListener('click', async () => {
    if (!activeEditorKey) return;
    await saveTab(activeEditorKey);
  });

  document.getElementById('saveAllFiles').addEventListener('click', saveAllTabs);

  initSettingsMenu();
  initTerminalPanel();
  await setupMonaco();
  await initWorkspaceTree();
  await initChat();
  await initOrchestration();
}

main().catch(error => {
  const body = document.body;
  body.innerHTML = `<pre style=\"color:#ff6e7c;padding:20px\">${error instanceof Error ? error.stack : String(error)}</pre>`;
});
