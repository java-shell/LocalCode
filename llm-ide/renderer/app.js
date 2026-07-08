let editor;
let markdownViewToggleButton = null;
let markdownPreviewEl = null;
let markdownPreviewMode = false;

let untitledCounter = 1;
const editorTabs = new Map();
const watchedFilePaths = new Set();
const externalPromptLocks = new Set();
let activeEditorKey = null;
const SETTINGS_STORAGE_KEY = 'localcode.settings';
const PANEL_SIZES_STORAGE_KEY = 'localcode.panelSizes';

const settingsState = {
  maxToolTurns: 40,
  requestTimeoutMs: 180000,
  provider: 'ollama',
  endpoint: 'http://localhost:11434/v1/chat/completions',
  model: 'llama3',
  apiKey: '',
  modelContextWindows: {},
  chatMemoryNamespace: '',
  orchestrationMemoryNamespace: '',
  chatSettingsCollapsed: true
};

const usageByModel = new Map();

const contextWindowHints = [
  { pattern: /(gpt-5|gpt-4\.1|o4|o3)/i, tokens: 128000 },
  { pattern: /(claude-3|claude-4)/i, tokens: 200000 },
  { pattern: /(qwen2?\.5|llama3\.1|llama3\.2|mistral|gemma)/i, tokens: 32768 },
  { pattern: /(granite4\.1|granite41|granite4)/i, tokens: 65536 },
  { pattern: /(deepseek|phi-4)/i, tokens: 65536 }
];

function clampMaxToolTurns(value) {
  if (!Number.isFinite(value)) return 40;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

function clampRequestTimeoutMs(value) {
  if (!Number.isFinite(value)) return 180000;
  return Math.max(1000, Math.min(600000, Math.floor(value)));
}

function clampContextWindowTokens(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(4_000_000, Math.floor(value)));
}

function normalizeProvider(value) {
  return String(value || '').trim().toLowerCase() === 'ollama' ? 'ollama' : 'openai-compatible';
}

function modelKey(model) {
  return String(model || '').trim();
}

function getConfiguredContextWindow(model) {
  const key = modelKey(model);
  if (!key) return 0;
  return clampContextWindowTokens(Number(settingsState.modelContextWindows?.[key] || 0));
}

function setConfiguredContextWindow(model, tokens) {
  const key = modelKey(model);
  if (!key) return;
  const next = clampContextWindowTokens(tokens);
  settingsState.modelContextWindows = settingsState.modelContextWindows || {};
  if (next <= 0) {
    delete settingsState.modelContextWindows[key];
    return;
  }
  settingsState.modelContextWindows[key] = next;
}

function rememberDiscoveredContextWindows(contextWindows) {
  if (!contextWindows || typeof contextWindows !== 'object') {
    return false;
  }

  let changed = false;
  for (const [model, rawValue] of Object.entries(contextWindows)) {
    const key = modelKey(model);
    const discovered = clampContextWindowTokens(Number(rawValue || 0));
    if (!key || discovered <= 0) {
      continue;
    }

    const existing = getConfiguredContextWindow(key);
    if (existing <= 0) {
      setConfiguredContextWindow(key, discovered);
      changed = true;
    }
  }

  if (changed) {
    saveSettings();
  }

  return changed;
}

function resolveContextWindow(model, fallback) {
  const configured = Math.max(getConfiguredContextWindow(model), clampContextWindowTokens(Number(fallback || 0)));
  if (configured > 0) {
    return configured;
  }
  return estimateContextWindow(model);
}

function inferContextWindowFromModelLabel(model) {
  const label = String(model || '').trim().toLowerCase();
  if (!label) {
    return 0;
  }

  const match = label.match(/(?:ctx|context)[-_]?([0-9]{1,4})(k|m)\b|\b([0-9]{1,4})(k|m)\b/i);
  const amount = Number(match?.[1] || match?.[3] || 0);
  const unit = String(match?.[2] || match?.[4] || '').toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  if (unit === 'm') {
    return amount * 1024 * 1024;
  }
  if (unit === 'k') {
    return amount * 1024;
  }

  return 0;
}

function estimateContextWindow(model) {
  const label = String(model || '').trim();
  if (!label) {
    return 8192;
  }
  const inferred = clampContextWindowTokens(inferContextWindowFromModelLabel(label));
  if (inferred > 0) {
    return inferred;
  }
  for (const hint of contextWindowHints) {
    if (hint.pattern.test(label)) {
      return hint.tokens;
    }
  }
  return 8192;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function recordModelUsage(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) {
    return;
  }

  let changed = false;
  for (const entry of list) {
    const model = String(entry?.model || '').trim();
    if (!model) {
      continue;
    }

    const promptTokens = Math.max(0, Number(entry?.promptTokens || 0));
    const completionTokens = Math.max(0, Number(entry?.completionTokens || 0));
    const totalTokens = Math.max(0, Number(entry?.totalTokens || (promptTokens + completionTokens)));
    const requests = Math.max(1, Number(entry?.requests || 1));
    const recalledPromptTokens = Math.max(0, Number(entry?.recalledPromptTokens || 0));
    const contextWindowTokens = clampContextWindowTokens(Number(entry?.contextWindowTokens || 0));

    const existing = usageByModel.get(model) || {
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requests: 0,
      recalledPromptTokens: 0,
      contextWindowTokens: 0
    };

    existing.promptTokens += promptTokens;
    existing.completionTokens += completionTokens;
    existing.totalTokens += totalTokens;
    existing.requests += requests;
    existing.recalledPromptTokens += recalledPromptTokens;
    if (contextWindowTokens > 0) {
      existing.contextWindowTokens = Math.max(existing.contextWindowTokens || 0, contextWindowTokens);
    }
    usageByModel.set(model, existing);
    changed = true;
  }

  if (!changed) {
    return;
  }

  const stamp = document.getElementById('contextUsageStamp');
  if (stamp) {
    stamp.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }
  renderContextUsageGraph();
}

function renderContextUsageGraph() {
  const host = document.getElementById('contextUsageList');
  if (!host) {
    return;
  }

  host.innerHTML = '';
  const rows = Array.from(usageByModel.values()).sort((a, b) => b.totalTokens - a.totalTokens);
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'context-usage-empty';
    empty.textContent = 'Run chat or orchestration to populate usage metrics.';
    host.appendChild(empty);
    return;
  }

  for (const row of rows) {
    const avgRecalled = (row.recalledPromptTokens || 0) / Math.max(1, row.requests);
    const avgPrompt = row.promptTokens / Math.max(1, row.requests);
    const avgSession = Math.max(0, avgPrompt - avgRecalled);
    const contextWindow = resolveContextWindow(row.model, row.contextWindowTokens);
    const avgPct = Math.min(100, Math.round((avgPrompt / Math.max(1, contextWindow)) * 100));
    const recalledPct = Math.min(100, (avgRecalled / Math.max(1, contextWindow)) * 100);
    const sessionPct = Math.max(0, Math.min(100 - recalledPct, (avgSession / Math.max(1, contextWindow)) * 100));

    const card = document.createElement('div');
    card.className = 'context-usage-item';

    const title = document.createElement('div');
    title.className = 'context-usage-title';
    const modelEl = document.createElement('span');
    modelEl.className = 'context-usage-model';
    modelEl.title = row.model;
    modelEl.textContent = row.model;
    const pctEl = document.createElement('span');
    pctEl.className = 'context-usage-meta';
    pctEl.textContent = `~${avgPct}% context`;
    title.appendChild(modelEl);
    title.appendChild(pctEl);

    const bar = document.createElement('div');
    bar.className = 'context-usage-bar';

    const recalled = document.createElement('div');
    recalled.className = 'context-usage-memory';
    recalled.style.width = `${recalledPct}%`;

    const session = document.createElement('div');
    session.className = 'context-usage-session';
    session.style.width = `${sessionPct}%`;

    const meta = document.createElement('div');
    meta.className = 'context-usage-meta';
    meta.textContent = `TurboVec=${formatCount(avgRecalled)} avg | session=${formatCount(avgSession)} avg | prompt=${formatCount(avgPrompt)} avg | total=${formatCount(row.totalTokens)} over ${formatCount(row.requests)} req`;

    bar.appendChild(recalled);
    bar.appendChild(session);
    card.appendChild(title);
    card.appendChild(bar);
    card.appendChild(meta);
    host.appendChild(card);
  }
}

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    settingsState.maxToolTurns = clampMaxToolTurns(Number(parsed.maxToolTurns ?? 40));
    settingsState.requestTimeoutMs = clampRequestTimeoutMs(Number(parsed.requestTimeoutMs ?? 180000));
    settingsState.provider = normalizeProvider(parsed.provider ?? settingsState.provider);
    settingsState.endpoint = String(parsed.endpoint ?? settingsState.endpoint).trim() || settingsState.endpoint;
    settingsState.model = String(parsed.model ?? settingsState.model).trim() || settingsState.model;
    settingsState.apiKey = String(parsed.apiKey ?? settingsState.apiKey);
    settingsState.modelContextWindows =
      parsed.modelContextWindows && typeof parsed.modelContextWindows === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.modelContextWindows).map(([key, value]) => [String(key), clampContextWindowTokens(Number(value))])
          )
        : {};
    settingsState.chatMemoryNamespace = String(parsed.chatMemoryNamespace ?? settingsState.chatMemoryNamespace).trim();
    settingsState.orchestrationMemoryNamespace =
      String(parsed.orchestrationMemoryNamespace ?? settingsState.orchestrationMemoryNamespace).trim();
    settingsState.chatSettingsCollapsed = Boolean(parsed.chatSettingsCollapsed ?? settingsState.chatSettingsCollapsed);
  } catch {
    settingsState.maxToolTurns = 40;
    settingsState.requestTimeoutMs = 180000;
    settingsState.provider = 'ollama';
    settingsState.endpoint = 'http://localhost:11434/v1/chat/completions';
    settingsState.model = 'llama3';
    settingsState.apiKey = '';
    settingsState.modelContextWindows = {};
    settingsState.chatMemoryNamespace = '';
    settingsState.orchestrationMemoryNamespace = '';
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

function inferLanguageFromMonacoRegistry(filePath) {
  if (!window.monaco || !monaco.languages || typeof monaco.languages.getLanguages !== 'function') {
    return null;
  }

  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  const lowerPath = normalizedPath.toLowerCase();
  const fileName = basename(normalizedPath);
  const lowerFileName = fileName.toLowerCase();

  let bestMatch = { id: '', score: 0 };
  for (const entry of monaco.languages.getLanguages()) {
    const id = String(entry?.id || '').trim();
    if (!id) continue;

    let score = 0;

    const filenames = Array.isArray(entry.filenames) ? entry.filenames : [];
    for (const name of filenames) {
      const candidate = String(name || '');
      if (!candidate) continue;
      if (candidate === fileName) {
        score = Math.max(score, 1000 + candidate.length);
      } else if (candidate.toLowerCase() === lowerFileName) {
        score = Math.max(score, 950 + candidate.length);
      }
    }

    const extensions = Array.isArray(entry.extensions) ? entry.extensions : [];
    for (const ext of extensions) {
      const candidate = String(ext || '').toLowerCase();
      if (!candidate || candidate === '.') continue;
      if (lowerPath.endsWith(candidate)) {
        score = Math.max(score, 100 + candidate.length);
      }
    }

    if (score > bestMatch.score) {
      bestMatch = { id, score };
    }
  }

  return bestMatch.score > 0 ? bestMatch.id : null;
}

function inferLanguageFromContent(content) {
  const text = String(content || '');
  if (!text.trim()) return null;

  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  if (firstLine.startsWith('#!')) {
    const lower = firstLine.toLowerCase();
    if (/(python|python3)\b/.test(lower)) return 'python';
    if (/(node|deno)\b/.test(lower)) return 'javascript';
    if (/\b(bash|sh|zsh|fish|ksh)\b/.test(lower)) return 'shell';
    if (/\b(ruby)\b/.test(lower)) return 'ruby';
    if (/\b(php)\b/.test(lower)) return 'php';
    if (/\b(pwsh|powershell)\b/.test(lower)) return 'powershell';
  }

  const trimmedStart = text.trimStart();
  if (/^<!doctype\s+html>/i.test(trimmedStart) || /^<html[\s>]/i.test(trimmedStart)) return 'html';
  if (/^<\?xml\s/i.test(trimmedStart)) return 'xml';
  if (/^(\{|\[)/.test(trimmedStart)) {
    try {
      JSON.parse(text);
      return 'json';
    } catch {
      // Not JSON; fall through.
    }
  }

  return null;
}

function inferLanguageFromPath(filePath, content = '') {
  const fromRegistry = inferLanguageFromMonacoRegistry(filePath);
  if (fromRegistry) return fromRegistry;

  const lower = String(filePath || '').toLowerCase();
  const fileName = basename(filePath).toLowerCase();

  if (fileName === 'dockerfile') return 'dockerfile';
  if (fileName === 'makefile') return 'makefile';

  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.mts') || lower.endsWith('.cts')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.json') || lower.endsWith('.jsonc') || lower.endsWith('.code-workspace')) return 'json';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.xml') || lower.endsWith('.xaml') || lower.endsWith('.svg')) return 'xml';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.ini') || lower.endsWith('.cfg') || lower.endsWith('.conf')) return 'ini';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.py') || lower.endsWith('.pyi')) return 'python';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown';
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'shell';
  if (lower.endsWith('.ps1') || lower.endsWith('.psm1') || lower.endsWith('.psd1')) return 'powershell';

  const fromContent = inferLanguageFromContent(content);
  if (fromContent) return fromContent;
  return 'plaintext';
}

function normalizeMonacoLanguageId(languageId) {
  if (!window.monaco || !monaco.languages || typeof monaco.languages.getLanguages !== 'function') {
    return languageId || 'plaintext';
  }

  const id = String(languageId || '').trim() || 'plaintext';
  const known = monaco.languages.getLanguages().some(language => language.id === id);
  return known ? id : 'plaintext';
}

function applyTabLanguage(tab, languageId) {
  if (!tab || !tab.model || !window.monaco || !monaco.editor) {
    return;
  }

  const nextLanguage = normalizeMonacoLanguageId(languageId);
  const currentLanguage = typeof tab.model.getLanguageId === 'function' ? tab.model.getLanguageId() : '';
  if (currentLanguage !== nextLanguage) {
    monaco.editor.setModelLanguage(tab.model, nextLanguage);
  }
}

function sanitizeMemoryNamespacePart(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_') || 'default';
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function initResizablePanels() {
  const workspace = document.querySelector('.workspace');
  const editorPanel = document.querySelector('.editor-panel');
  const filetreeHandle = document.getElementById('filetreeResizeHandle');
  const sidePanelHandle = document.getElementById('sidePanelResizeHandle');
  const terminalHandle = document.getElementById('terminalResizeHandle');

  if (!workspace || !editorPanel || !filetreeHandle || !sidePanelHandle || !terminalHandle) {
    return;
  }

  let panelSizes = {};
  try {
    panelSizes = JSON.parse(window.localStorage.getItem(PANEL_SIZES_STORAGE_KEY) || '{}') || {};
  } catch {
    panelSizes = {};
  }

  function applyStoredSize(name, cssVar, min, max) {
    const value = Number(panelSizes[name]);
    if (Number.isFinite(value)) {
      document.documentElement.style.setProperty(cssVar, `${clampNumber(value, min, max)}px`);
    }
  }

  function saveSize(name, value) {
    panelSizes[name] = Math.round(value);
    window.localStorage.setItem(PANEL_SIZES_STORAGE_KEY, JSON.stringify(panelSizes));
  }

  function layoutEditor() {
    if (editor && typeof editor.layout === 'function') {
      requestAnimationFrame(() => editor.layout());
    }
  }

  applyStoredSize('filetreeWidth', '--filetree-width', 180, 560);
  applyStoredSize('sidePanelWidth', '--side-panel-width', 300, 760);
  applyStoredSize('terminalHeight', '--terminal-height', 120, 560);

  function startResize(kind, event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.classList.add('resizing');
    document.body.classList.add('panel-resizing');
    handle.setPointerCapture?.(event.pointerId);

    function update(pointerEvent) {
      if (kind === 'filetree') {
        const rect = workspace.getBoundingClientRect();
        const width = clampNumber(pointerEvent.clientX - rect.left, 180, Math.max(180, rect.width - 620));
        document.documentElement.style.setProperty('--filetree-width', `${width}px`);
        saveSize('filetreeWidth', width);
      } else if (kind === 'side') {
        const rect = workspace.getBoundingClientRect();
        const width = clampNumber(rect.right - pointerEvent.clientX, 300, Math.max(300, rect.width - 620));
        document.documentElement.style.setProperty('--side-panel-width', `${width}px`);
        saveSize('sidePanelWidth', width);
      } else {
        const rect = editorPanel.getBoundingClientRect();
        const height = clampNumber(rect.bottom - pointerEvent.clientY, 120, Math.max(120, rect.height - 180));
        document.documentElement.style.setProperty('--terminal-height', `${height}px`);
        saveSize('terminalHeight', height);
      }
      layoutEditor();
    }

    function stop(pointerEvent) {
      handle.classList.remove('resizing');
      document.body.classList.remove('panel-resizing');
      handle.releasePointerCapture?.(pointerEvent.pointerId);
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', stop);
      layoutEditor();
    }

    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', stop);
  }

  function keyboardResize(kind, event) {
    const horizontal = kind === 'filetree' || kind === 'side';
    const keyMap = horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (!keyMap.includes(event.key)) return;
    event.preventDefault();

    const step = event.shiftKey ? 40 : 16;
    if (kind === 'filetree') {
      const current = Number(panelSizes.filetreeWidth || 280);
      const next = clampNumber(current + (event.key === 'ArrowRight' ? step : -step), 180, 560);
      document.documentElement.style.setProperty('--filetree-width', `${next}px`);
      saveSize('filetreeWidth', next);
    } else if (kind === 'side') {
      const current = Number(panelSizes.sidePanelWidth || 440);
      const next = clampNumber(current + (event.key === 'ArrowLeft' ? step : -step), 300, 760);
      document.documentElement.style.setProperty('--side-panel-width', `${next}px`);
      saveSize('sidePanelWidth', next);
    } else {
      const current = Number(panelSizes.terminalHeight || 230);
      const next = clampNumber(current + (event.key === 'ArrowUp' ? step : -step), 120, 560);
      document.documentElement.style.setProperty('--terminal-height', `${next}px`);
      saveSize('terminalHeight', next);
    }
    layoutEditor();
  }

  filetreeHandle.addEventListener('pointerdown', event => startResize('filetree', event));
  sidePanelHandle.addEventListener('pointerdown', event => startResize('side', event));
  terminalHandle.addEventListener('pointerdown', event => startResize('terminal', event));
  filetreeHandle.addEventListener('keydown', event => keyboardResize('filetree', event));
  sidePanelHandle.addEventListener('keydown', event => keyboardResize('side', event));
  terminalHandle.addEventListener('keydown', event => keyboardResize('terminal', event));
}

function setActiveTab(which) {
  const chatTab = document.getElementById('chatTab');
  const orchTab = document.getElementById('orchTab');
  const diagTab = document.getElementById('diagTab');
  const chatView = document.getElementById('chatView');
  const orchView = document.getElementById('orchView');
  const diagView = document.getElementById('diagView');

  const chatOn = which === 'chat';
  const orchOn = which === 'orchestration';
  const diagOn = which === 'diagnostics';

  chatTab.classList.toggle('active', chatOn);
  orchTab.classList.toggle('active', orchOn);
  diagTab.classList.toggle('active', diagOn);
  chatView.classList.toggle('active', chatOn);
  orchView.classList.toggle('active', orchOn);
  diagView.classList.toggle('active', diagOn);
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

function renderBasicMarkdownToHtml(markdownText) {
  const source = String(markdownText || '').replace(/\r\n/g, '\n');
  if (!source.trim()) {
    return '';
  }

  const codeBlocks = [];
  let text = source.replace(/```([\w-]+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const languageClass = lang ? ` class="language-${escapeHtml(String(lang).trim())}"` : '';
    const html = `<pre><code${languageClass}>${escapeHtml(code)}</code></pre>`;
    const token = `@@CODEBLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(html);
    return token;
  });

  text = text
    .split('\n')
    .map(line => {
      if (/^\s*---\s*$/.test(line)) return '<hr />';
      if (/^\s*####\s+/.test(line)) return `<h4>${line.replace(/^\s*####\s+/, '')}</h4>`;
      if (/^\s*###\s+/.test(line)) return `<h3>${line.replace(/^\s*###\s+/, '')}</h3>`;
      if (/^\s*##\s+/.test(line)) return `<h2>${line.replace(/^\s*##\s+/, '')}</h2>`;
      if (/^\s*#\s+/.test(line)) return `<h1>${line.replace(/^\s*#\s+/, '')}</h1>`;
      if (/^\s*>\s?/.test(line)) return `<blockquote>${line.replace(/^\s*>\s?/, '')}</blockquote>`;
      if (/^\s*[-*]\s+/.test(line)) return `<li>${line.replace(/^\s*[-*]\s+/, '')}</li>`;
      if (/^\s*\d+\.\s+/.test(line)) return `<li data-ordered="true">${line.replace(/^\s*\d+\.\s+/, '')}</li>`;
      if (!line.trim()) return '';
      if (/^@@CODEBLOCK_\d+@@$/.test(line.trim())) return line.trim();
      return `<p>${line}</p>`;
    })
    .join('\n');

  text = text
    .replace(/(<li data-ordered="true">[\s\S]*?<\/li>\n?)+/g, match => {
      const items = match.replace(/\s*data-ordered="true"/g, '');
      return `<ol>${items}</ol>`;
    })
    .replace(/(<li>(?!<\/li>)[\s\S]*?<\/li>\n?)+/g, match => `<ul>${match}</ul>`);

  text = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeLabel = escapeHtml(label);
      const safeHref = escapeHtml(String(href || '').trim());
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
    });

  text = text.replace(/@@CODEBLOCK_(\d+)@@/g, (_, idx) => codeBlocks[Number(idx)] || '');
  return text;
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

  const fallbackHtml = renderBasicMarkdownToHtml(markdownText || '');
  if (purifier && typeof purifier.sanitize === 'function') {
    return purifier.sanitize(fallbackHtml);
  }
  return fallbackHtml;
}

function createModelUri(kind, value) {
  if (kind === 'file') {
    return monaco.Uri.parse(`file:///${value.replace(/^\/+/, '')}`);
  }
  return monaco.Uri.parse(`inmemory:///${value}`);
}

function getActiveEditorTab() {
  if (!activeEditorKey) return null;
  return editorTabs.get(activeEditorKey) || null;
}

function isMarkdownTab(tab) {
  if (!tab || !tab.model || typeof tab.model.getLanguageId !== 'function') {
    return false;
  }
  return tab.model.getLanguageId() === 'markdown';
}

function renderActiveMarkdownPreview() {
  if (!markdownPreviewEl) return;
  const tab = getActiveEditorTab();
  if (!isMarkdownTab(tab)) {
    markdownPreviewEl.innerHTML = '';
    return;
  }
  markdownPreviewEl.className = 'markdown-preview assistant-markdown';
  markdownPreviewEl.innerHTML = renderMarkdownToHtml(tab.model.getValue());
}

function syncMarkdownEditorView() {
  const editorEl = document.getElementById('editor');
  if (!editorEl || !markdownPreviewEl) return;

  const activeTab = getActiveEditorTab();
  const markdownActive = isMarkdownTab(activeTab);
  if (!markdownActive) {
    markdownPreviewMode = false;
  }

  if (markdownViewToggleButton) {
    markdownViewToggleButton.hidden = false;
    markdownViewToggleButton.classList.toggle('markdown-toggle-inert', !markdownActive);
    markdownViewToggleButton.disabled = !markdownActive;
    markdownViewToggleButton.textContent = markdownPreviewMode ? 'Raw Markdown' : 'Preview Markdown';
  }

  if (markdownActive && markdownPreviewMode) {
    renderActiveMarkdownPreview();
    markdownPreviewEl.hidden = false;
    markdownPreviewEl.classList.add('active');
    editorEl.classList.add('editor-hidden');
    return;
  }

  markdownPreviewEl.hidden = true;
  markdownPreviewEl.classList.remove('active');
  editorEl.classList.remove('editor-hidden');
  if (editor && typeof editor.layout === 'function') {
    editor.layout();
  }
}

function toggleActiveMarkdownViewMode() {
  const tab = getActiveEditorTab();
  if (!isMarkdownTab(tab)) {
    return;
  }
  markdownPreviewMode = !markdownPreviewMode;
  syncMarkdownEditorView();
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
  syncMarkdownEditorView();
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
    if (tab.key === activeEditorKey && markdownPreviewMode && isMarkdownTab(tab)) {
      renderActiveMarkdownPreview();
    }
    renderEditorTabs();
  });
}

function openEditorTab(tabDef) {
  const existing = editorTabs.get(tabDef.key);
  if (existing) {
    if (typeof tabDef.label === 'string' && tabDef.label) {
      existing.label = tabDef.label;
    }
    if (typeof tabDef.path === 'string') {
      existing.path = tabDef.path;
    }
    applyTabLanguage(existing, tabDef.language);

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
  const model = monaco.editor.createModel(tabDef.content, normalizeMonacoLanguageId(tabDef.language), uri);
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

function openScratchTab(content, options = {}) {
  const id = `scratch-${untitledCounter++}`;
  const language = String(options.language || 'markdown').trim() || 'markdown';
  const extension = String(options.extension || (language === 'markdown' ? 'md' : 'txt')).trim() || 'txt';
  const tab = openEditorTab({
    key: `scratch:${id}`,
    kind: 'scratch',
    uriValue: id,
    label: `${id}.${extension}`,
    path: null,
    language,
    content:
      content ||
      [
        '# LocalCode Quick Start',
        '',
        'Welcome to LocalCode. This scratch tab is markdown by default so you can keep notes, plans, and prompts while you work.',
        '',
        '## Core Workflow',
        '',
        '1. Select a workspace folder in the left panel.',
        '2. Open or edit files in Monaco.',
        '3. Use Chat for code generation and problem solving.',
        '4. Use Orchestration for multi-step workflows with tools.',
        '5. Save your file tabs before running external commands.',
        '',
        '## Chat Tips',
        '',
        '- Be explicit about target file paths and expected output format.',
        '- Ask for step-by-step updates when doing multi-file changes.',
        '- Request markdown output when you want structured summaries.',
        '',
        '## Orchestration Tips',
        '',
        '- Start with 2-3 steps, then expand once the flow is stable.',
        '- Keep tool sets minimal per step to reduce tool-call noise.',
        '- Use clear completion markers when looping is enabled.',
        '',
        '## Examples',
        '',
        '```text',
        'Chat prompt:',
        'Refactor src/backend/toolRuntime.ts to extract input validation into a helper and add tests.',
        '```',
        '',
        '```text',
        'Orchestration prompt:',
        'Audit renderer markdown rendering, fix ordering bugs, and summarize changed files.',
        '```',
        '',
        '## Markdown View',
        '',
        'Use the `Preview Markdown` button in the editor toolbar to switch between rendered markdown and raw markdown editing.',
        ''
      ].join('\n')
  });

  if (options.startInPreview === true && tab && isMarkdownTab(tab)) {
    markdownPreviewMode = true;
    syncMarkdownEditorView();
  }
}

async function openWorkspaceFileTab(relativePath) {
  const result = await window.llmIde.readWorkspaceFile({ path: relativePath });
  openEditorTab({
    key: `file:${relativePath}`,
    kind: 'file',
    uriValue: relativePath,
    label: basename(relativePath),
    path: relativePath,
    language: inferLanguageFromPath(relativePath, result.content),
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
    if (result.sent) {
      appendTerminalText(`> ${raw}\n`);
      terminalInput.value = '';
      return;
    }

    const runResult = await window.llmIde.runTerminalCommand({ command: raw });
    if (!runResult.started) {
      appendTerminalText(`[command not started: ${runResult.reason || 'unknown'}]\n`);
    }
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
  const timeoutInput = document.getElementById('settingRequestTimeoutMs');
  const endpointInput = document.getElementById('settingEndpoint');
  const providerInput = document.getElementById('settingProvider');
  const modelInput = document.getElementById('settingModel');
  const apiKeyInput = document.getElementById('settingApiKey');
  const cancel = document.getElementById('settingsCancel');
  const save = document.getElementById('settingsSave');

  const chatProvider = document.getElementById('chatProvider');
  const chatEndpoint = document.getElementById('chatEndpoint');
  const chatModel = document.getElementById('chatModel');
  const chatApiKey = document.getElementById('chatApiKey');

  function openModal() {
    input.value = String(settingsState.maxToolTurns);
    timeoutInput.value = String(settingsState.requestTimeoutMs);
    endpointInput.value = settingsState.endpoint;
    providerInput.value = normalizeProvider(settingsState.provider);
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
    settingsState.requestTimeoutMs = clampRequestTimeoutMs(Number(timeoutInput.value));
    settingsState.endpoint = endpointInput.value.trim() || settingsState.endpoint;
    settingsState.provider = normalizeProvider(providerInput.value);
    settingsState.model = modelInput.value.trim() || settingsState.model;
    settingsState.apiKey = apiKeyInput.value;

    chatProvider.value = settingsState.provider;
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
        markdownViewToggleButton = document.getElementById('markdownViewToggle');
        markdownPreviewEl = document.getElementById('markdownPreview');
        editor = monaco.editor.create(document.getElementById('editor'), {
          value: '',
          language: 'typescript',
          theme: 'vs-dark',
          minimap: { enabled: false },
          automaticLayout: true,
          fontSize: 14,
          mouseWheelZoom: true
        });
        if (markdownViewToggleButton) {
          markdownViewToggleButton.addEventListener('click', toggleActiveMarkdownViewMode);
        }
        openScratchTab(undefined, { startInPreview: true });
        syncMarkdownEditorView();
        resolve();
      },
      reject
    );
  });
}

async function initChat() {
  const conversation = document.getElementById('chatConversation');
  const chatSessionList = document.getElementById('chatSessionList');
  const chatSessionWorkspace = document.getElementById('chatSessionWorkspace');
  const chatNewSession = document.getElementById('chatNewSession');
  const chatDeleteSession = document.getElementById('chatDeleteSession');
  const status = document.getElementById('chatStatus');
  const provider = document.getElementById('chatProvider');
  const endpoint = document.getElementById('chatEndpoint');
  const model = document.getElementById('chatModel');
  const settingsToggle = document.getElementById('chatSettingsToggle');
  const settingsPanel = document.getElementById('chatSettingsPanel');
  const refreshModels = document.getElementById('chatRefreshModels');
  const chatContextWindowTokens = document.getElementById('chatContextWindowTokens');
  const apiKey = document.getElementById('chatApiKey');
  const chatMemoryNamespace = document.getElementById('chatMemoryNamespace');
  const chatNewMemoryNamespace = document.getElementById('chatNewMemoryNamespace');
  const prompt = document.getElementById('chatPrompt');
  const send = document.getElementById('chatSend');
  const stop = document.getElementById('chatStop');

  provider.value = normalizeProvider(settingsState.provider);
  endpoint.value = settingsState.endpoint;
  apiKey.value = settingsState.apiKey;
  chatNewMemoryNamespace.value = '';

  let currentWorkspaceDir = '';
  let chatSessions = [];
  let activeChatSessionId = '';
  let activeChatSessionTitle = '';
  let activeChatSessionCreatedAt = '';
  let activeChatMessages = [];
  let forceFreshContextForNextSend = false;
  let sessionListMutating = false;

  function workspaceLabel(workspaceDir) {
    const value = String(workspaceDir || '').trim();
    if (!value) return 'Unknown workspace';
    const parts = value.split(/[\\/]/).filter(Boolean);
    const leaf = parts[parts.length - 1] || value;
    return `${leaf} (${value})`;
  }

  function formatChatTimestamp(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return 'unknown time';
    }
    return date.toLocaleString();
  }

  function createChatSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `chat-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function buildChatTitleFromPrompt(text) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return `Chat ${new Date().toLocaleString()}`;
    }
    return cleaned.length > 56 ? `${cleaned.slice(0, 56)}...` : cleaned;
  }

  function renderAssistantMessage(markdownText) {
    const assistantRow = document.createElement('div');
    assistantRow.className = 'log-line log-line-assistant';

    const assistantLabel = document.createElement('div');
    assistantLabel.className = 'assistant-label';
    assistantLabel.textContent = 'Assistant:';

    const assistantMarkdown = document.createElement('div');
    assistantMarkdown.className = 'assistant-markdown';
    assistantMarkdown.innerHTML = renderMarkdownToHtml(markdownText || '');

    assistantRow.appendChild(assistantLabel);
    assistantRow.appendChild(assistantMarkdown);
    conversation.appendChild(assistantRow);
    conversation.scrollTop = conversation.scrollHeight;

    return { row: assistantRow, markdown: assistantMarkdown };
  }

  function renderConversationMessages(messages) {
    conversation.innerHTML = '';
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue;
      if (message.role === 'assistant') {
        renderAssistantMessage(String(message.content || ''));
        continue;
      }
      if (message.role === 'user') {
        appendLog(conversation, `You: ${String(message.content || '')}`);
      }
    }
  }

  function selectedChatMemoryNamespace() {
    if (chatMemoryNamespace.value === '__new__') {
      return chatNewMemoryNamespace.value.trim();
    }
    return chatMemoryNamespace.value.trim();
  }

  function resolveSelectedContextWindowTokens() {
    const selectedModel = model.value || settingsState.model;
    const typed = clampContextWindowTokens(Number(chatContextWindowTokens.value || 0));
    if (typed > 0) {
      return typed;
    }
    return resolveContextWindow(selectedModel);
  }

  function persistSelectedContextWindow(options = { syncInput: false, save: false }) {
    const selectedModel = model.value || settingsState.model;
    const typed = clampContextWindowTokens(Number(chatContextWindowTokens.value || 0));

    if (typed > 0) {
      setConfiguredContextWindow(selectedModel, typed);
      if (options.syncInput) {
        chatContextWindowTokens.value = String(typed);
      }
    } else {
      setConfiguredContextWindow(selectedModel, 0);
      if (options.syncInput) {
        chatContextWindowTokens.value = String(estimateContextWindow(selectedModel));
      }
    }

    if (options.save) {
      saveSettings();
      renderContextUsageGraph();
    }
  }

  function currentSessionConfig() {
    return {
      provider: normalizeProvider(provider.value),
      endpoint: endpoint.value.trim() || settingsState.endpoint,
      model: model.value || settingsState.model,
      contextWindowTokens: resolveSelectedContextWindowTokens(),
      memoryNamespace: selectedChatMemoryNamespace() || undefined
    };
  }

  async function persistActiveChatSession() {
    if (!activeChatSessionId) return;

    const nowIso = new Date().toISOString();
    const payload = {
      id: activeChatSessionId,
      title: activeChatSessionTitle || `Chat ${new Date().toLocaleString()}`,
      workspaceDir: currentWorkspaceDir || '(unknown workspace)',
      createdAt: activeChatSessionCreatedAt || nowIso,
      updatedAt: nowIso,
      messages: activeChatMessages,
      messageCount: activeChatMessages.length,
      lastMessagePreview: activeChatMessages.length
        ? String(activeChatMessages[activeChatMessages.length - 1].content || '').slice(0, 160)
        : '',
      config: currentSessionConfig()
    };

    const saved = await window.llmIde.saveChatSession({ session: payload });
    activeChatSessionId = saved.id;
    activeChatSessionTitle = saved.title;
    activeChatSessionCreatedAt = saved.createdAt;
    activeChatMessages = Array.isArray(saved.messages) ? saved.messages : [];
  }

  function updateChatSessionWorkspaceLabel(workspaceDir, updatedAt) {
    chatSessionWorkspace.textContent = `Workspace: ${workspaceLabel(workspaceDir)} | Updated: ${formatChatTimestamp(updatedAt)}`;
  }

  function renderChatSessionList() {
    sessionListMutating = true;
    chatSessionList.innerHTML = '';

    for (const session of chatSessions) {
      const option = document.createElement('option');
      option.value = session.id;
      option.textContent = `${session.title} | ${workspaceLabel(session.workspaceDir)}`;
      chatSessionList.appendChild(option);
    }

    if (activeChatSessionId && chatSessions.some(session => session.id === activeChatSessionId)) {
      chatSessionList.value = activeChatSessionId;
    } else if (chatSessions.length > 0) {
      chatSessionList.value = chatSessions[0].id;
    }

    sessionListMutating = false;
  }

  async function refreshChatSessions() {
    const result = await window.llmIde.listChatSessions();
    const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
    chatSessions = sessions
      .slice()
      .sort((a, b) => {
        const aCurrent = a.workspaceDir === currentWorkspaceDir ? 1 : 0;
        const bCurrent = b.workspaceDir === currentWorkspaceDir ? 1 : 0;
        if (aCurrent !== bCurrent) {
          return bCurrent - aCurrent;
        }
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });
    renderChatSessionList();
  }

  async function loadChatSessionById(id) {
    const selectedId = String(id || '').trim();
    if (!selectedId) return;

    const session = await window.llmIde.loadChatSession({ id: selectedId });
    if (!session) {
      await refreshChatSessions();
      return;
    }

    activeChatSessionId = session.id;
    activeChatSessionTitle = session.title;
    activeChatSessionCreatedAt = session.createdAt;
    activeChatMessages = Array.isArray(session.messages) ? session.messages : [];
    forceFreshContextForNextSend = false;

    provider.value = normalizeProvider(session.config?.provider || settingsState.provider);
    endpoint.value = session.config?.endpoint || settingsState.endpoint;

    await refreshModelOptions(session.config?.model || model.value || settingsState.model);
    if (session.config?.model) {
      model.value = session.config.model;
    }

    if (Number(session.config?.contextWindowTokens || 0) > 0) {
      setConfiguredContextWindow(model.value || settingsState.model, Number(session.config.contextWindowTokens));
      chatContextWindowTokens.value = String(clampContextWindowTokens(Number(session.config.contextWindowTokens)));
    } else {
      syncChatContextWindowInput();
    }

    settingsState.provider = normalizeProvider(provider.value);
    settingsState.endpoint = endpoint.value.trim() || settingsState.endpoint;
    settingsState.chatMemoryNamespace = String(session.config?.memoryNamespace || '');
    saveSettings();

    await refreshChatNamespaceOptions();
    if (settingsState.chatMemoryNamespace) {
      const namespaceKnown = Array.from(chatMemoryNamespace.options).some(
        option => option.value === settingsState.chatMemoryNamespace
      );
      if (namespaceKnown) {
        chatMemoryNamespace.value = settingsState.chatMemoryNamespace;
        chatNewMemoryNamespace.value = '';
      } else {
        chatMemoryNamespace.value = '__new__';
        chatNewMemoryNamespace.value = settingsState.chatMemoryNamespace;
      }
      syncNewNamespaceVisibility();
    }

    renderConversationMessages(activeChatMessages);
    updateChatSessionWorkspaceLabel(session.workspaceDir, session.updatedAt);
    status.textContent = `Loaded chat: ${session.title}`;
    chatDeleteSession.disabled = false;

    if (chatSessionList.value !== session.id) {
      sessionListMutating = true;
      chatSessionList.value = session.id;
      sessionListMutating = false;
    }
  }

  async function createNewChatSession() {
    const timestamp = new Date().toISOString();
    activeChatSessionId = createChatSessionId();
    activeChatSessionTitle = `Chat ${new Date().toLocaleString()}`;
    activeChatSessionCreatedAt = timestamp;
    activeChatMessages = [];
    forceFreshContextForNextSend = true;
    conversation.innerHTML = '';
    await persistActiveChatSession();
    await refreshChatSessions();
    updateChatSessionWorkspaceLabel(currentWorkspaceDir, timestamp);
    status.textContent = 'Started new chat';
    chatDeleteSession.disabled = false;
    sessionListMutating = true;
    chatSessionList.value = activeChatSessionId;
    sessionListMutating = false;
  }

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
  let assistantRowEl = null;
  let assistantMarkdownEl = null;
  let runningIndicatorEl = null;
  let assistantReceivedToken = false;
  let markdownRenderQueued = false;
  let chatRunning = false;

  function ensureRunningIndicator() {
    if (runningIndicatorEl && runningIndicatorEl.parentElement === conversation) {
      return;
    }
    const row = document.createElement('div');
    row.className = 'log-line log-line-running';

    const label = document.createElement('span');
    label.className = 'running-label';
    label.textContent = 'Assistant is running';

    const dots = document.createElement('span');
    dots.className = 'running-ellipsis';
    dots.setAttribute('aria-hidden', 'true');

    row.appendChild(label);
    row.appendChild(dots);
    conversation.appendChild(row);
    conversation.scrollTop = conversation.scrollHeight;
    runningIndicatorEl = row;
  }

  function removeRunningIndicator() {
    if (runningIndicatorEl && runningIndicatorEl.parentElement) {
      runningIndicatorEl.parentElement.removeChild(runningIndicatorEl);
    }
    runningIndicatorEl = null;
  }

  function setChatRunning(running) {
    chatRunning = running;
    send.disabled = running;
    stop.disabled = !running;
    if (running) {
      ensureRunningIndicator();
    } else {
      removeRunningIndicator();
    }
  }

  function ensureAssistantMessageRendered() {
    if (assistantRowEl && assistantMarkdownEl) {
      return;
    }
    removeRunningIndicator();
    const assistantRender = renderAssistantMessage('');
    assistantRowEl = assistantRender.row;
    assistantMarkdownEl = assistantRender.markdown;
  }

  function renderAssistantMarkdownNow() {
    if (!assistantMarkdownRaw) return;
    ensureAssistantMessageRendered();
    if (!assistantMarkdownEl) return;
    assistantMarkdownEl.innerHTML = renderMarkdownToHtml(assistantMarkdownRaw);
    conversation.scrollTop = conversation.scrollHeight;
  }

  function scheduleAssistantMarkdownRender() {
    if (!assistantMarkdownEl || markdownRenderQueued) return;
    markdownRenderQueued = true;
    requestAnimationFrame(() => {
      markdownRenderQueued = false;
      renderAssistantMarkdownNow();
    });
  }

  const offToken = window.llmIde.onChatToken(token => {
    assistantReceivedToken = true;
    assistantMarkdownRaw += token;
    if (!assistantMarkdownEl) {
      ensureAssistantMessageRendered();
    }
    scheduleAssistantMarkdownRender();
  });

  function parseChatEvent(rawEvent) {
    const raw = String(rawEvent ?? '').trim();
    if (!raw) {
      return null;
    }

    if (raw.startsWith('thought:')) {
      return {
        kind: 'thought',
        text: raw.slice('thought:'.length).trim()
      };
    }

    if (raw.startsWith('tool:')) {
      return {
        kind: 'tool',
        text: raw.slice('tool:'.length).trim()
      };
    }

    if (raw.startsWith('llm-turn:')) {
      return {
        kind: 'status',
        text: `llm turn ${raw.slice('llm-turn:'.length).trim()}`
      };
    }

    return {
      kind: 'status',
      text: raw
    };
  }

  function createEventVisibilityToggle(row, textNode, kind) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'log-line-visibility-toggle';
    button.setAttribute('aria-label', `Hide ${kind} segment`);
    button.setAttribute('aria-pressed', 'false');
    button.title = `Hide ${kind} segment`;
    button.innerHTML =
      '<svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M12 5c5.2 0 9.5 4.4 10.4 6.7.2.4.2.8 0 1.2C21.5 15.2 17.2 19.6 12 19.6S2.5 15.2 1.6 12.9a1.5 1.5 0 0 1 0-1.2C2.5 9.4 6.8 5 12 5Z"></path>' +
      '<circle cx="12" cy="12.3" r="3.1"></circle>' +
      '<path class="eye-slash" d="M4 4l16 16"></path>' +
      '</svg>';

    button.addEventListener('click', () => {
      const hidden = !row.classList.contains('segment-hidden');
      row.classList.toggle('segment-hidden', hidden);
      textNode.hidden = hidden;
      button.setAttribute('aria-pressed', hidden ? 'true' : 'false');
      button.setAttribute('aria-label', `${hidden ? 'Show' : 'Hide'} ${kind} segment`);
      button.title = `${hidden ? 'Show' : 'Hide'} ${kind} segment`;
    });

    return button;
  }

  const offChatEvent = window.llmIde.onChatEvent(event => {
    const parsed = parseChatEvent(event);
    if (!parsed || !parsed.text) {
      return;
    }

    const row = document.createElement('div');
    row.className = `log-line log-line-event log-line-event-${parsed.kind}`;
    const kindLabel = document.createElement('span');
    kindLabel.className = 'log-line-event-kind';
    kindLabel.textContent = `[${parsed.kind}]`;

    const text = document.createElement('span');
    text.className = 'log-line-event-text';
    text.textContent = parsed.text;

    const finalToggle = createEventVisibilityToggle(row, text, parsed.kind);
    row.appendChild(finalToggle);
    row.appendChild(kindLabel);
    row.appendChild(text);
    if (assistantRowEl && assistantRowEl.parentElement === conversation) {
      conversation.insertBefore(row, assistantRowEl);
    } else {
      conversation.appendChild(row);
    }
    conversation.scrollTop = conversation.scrollHeight;
  });

  function syncNewNamespaceVisibility() {
    const usingNew = chatMemoryNamespace.value === '__new__';
    chatNewMemoryNamespace.classList.toggle('visible', usingNew);
    chatNewMemoryNamespace.disabled = !usingNew;
  }

  function setChatNamespaceOptions(namespaces) {
    const preferred = settingsState.chatMemoryNamespace;
    chatMemoryNamespace.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = `Default: model-specific (${model.value || settingsState.model})`;
    chatMemoryNamespace.appendChild(defaultOption);

    const known = Array.from(new Set(namespaces.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    for (const namespace of known) {
      const option = document.createElement('option');
      option.value = namespace;
      option.textContent = namespace;
      chatMemoryNamespace.appendChild(option);
    }

    const newOption = document.createElement('option');
    newOption.value = '__new__';
    newOption.textContent = 'New namespace...';
    chatMemoryNamespace.appendChild(newOption);

    if (!preferred) {
      chatMemoryNamespace.value = '';
      chatNewMemoryNamespace.value = '';
    } else if (known.includes(preferred)) {
      chatMemoryNamespace.value = preferred;
      chatNewMemoryNamespace.value = '';
    } else {
      chatMemoryNamespace.value = '__new__';
      chatNewMemoryNamespace.value = preferred;
    }

    syncNewNamespaceVisibility();
  }

  function syncChatContextWindowInput() {
    const selectedModel = model.value || settingsState.model;
    const configured = getConfiguredContextWindow(selectedModel);
    chatContextWindowTokens.value = configured > 0 ? String(configured) : String(estimateContextWindow(selectedModel));
  }

  async function refreshChatNamespaceOptions() {
    try {
      const state = await window.llmIde.getWorkspaceState();
      const diagnostics = await window.llmIde.getMemoryDiagnostics();
      const entries = Array.isArray(diagnostics?.namespaces) ? diagnostics.namespaces : [];
      const prefix = `${sanitizeMemoryNamespacePart('chat')}_${sanitizeMemoryNamespacePart(state.workspaceDir)}_`;
      const namespaces = entries
        .map(item => String(item?.namespace ?? ''))
        .filter(namespace => namespace.startsWith(prefix))
        .map(namespace => namespace.slice(prefix.length))
        .filter(Boolean);
      setChatNamespaceOptions(namespaces);
    } catch {
      setChatNamespaceOptions([]);
    }
  }

  function setModelOptions(models, preferred) {
    model.innerHTML = '';
    if (!models.length) {
      const fallbackModel = preferred || settingsState.model || 'llama3';
      const option = document.createElement('option');
      option.value = fallbackModel;
      option.textContent = `${fallbackModel} (fallback)`;
      model.appendChild(option);
      model.value = fallbackModel;
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

    syncChatContextWindowInput();
  }

  async function refreshModelOptions(preferredModel) {
    const currentModel = model.value;
    refreshModels.disabled = true;
    status.textContent = 'Loading models...';
    try {
      const result = await window.llmIde.listModels({
        endpoint: endpoint.value.trim(),
        apiKey: apiKey.value.trim() || undefined
      });
      const discoveredContextWindows = result?.contextWindows;
      const contextWindowsChanged = rememberDiscoveredContextWindows(discoveredContextWindows);
      setModelOptions(result.models, preferredModel || currentModel || settingsState.model || 'llama3');
      if (contextWindowsChanged) {
        syncChatContextWindowInput();
        renderContextUsageGraph();
      }
      status.textContent = `Loaded ${result.models.length} models`;
    } catch (error) {
      setModelOptions([], preferredModel || currentModel || settingsState.model || 'llama3');
      status.textContent = `Model load failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      refreshModels.disabled = false;
    }
  }

  refreshModels.addEventListener('click', refreshModelOptions);
  provider.addEventListener('change', () => {
    settingsState.provider = normalizeProvider(provider.value);
    saveSettings();
  });
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
    refreshChatNamespaceOptions();
    syncChatContextWindowInput();
  });
  chatContextWindowTokens.addEventListener('change', () => {
    persistSelectedContextWindow({ syncInput: true, save: true });
  });
  chatContextWindowTokens.addEventListener('input', () => {
    persistSelectedContextWindow({ syncInput: false, save: true });
  });
  chatMemoryNamespace.addEventListener('change', () => {
    syncNewNamespaceVisibility();
    settingsState.chatMemoryNamespace = selectedChatMemoryNamespace();
    saveSettings();
  });
  chatNewMemoryNamespace.addEventListener('input', () => {
    if (chatMemoryNamespace.value !== '__new__') return;
    settingsState.chatMemoryNamespace = chatNewMemoryNamespace.value.trim();
    saveSettings();
  });
  chatSessionList.addEventListener('change', async () => {
    if (sessionListMutating) return;
    if (chatRunning) return;
    await loadChatSessionById(chatSessionList.value);
  });
  chatNewSession.addEventListener('click', async () => {
    await createNewChatSession();
  });
  chatDeleteSession.addEventListener('click', async () => {
    if (!activeChatSessionId) return;
    const removed = await window.llmIde.deleteChatSession({ id: activeChatSessionId });
    if (!removed?.deleted) {
      status.textContent = 'Delete failed: chat no longer exists';
      return;
    }

    activeChatSessionId = '';
    activeChatSessionTitle = '';
    activeChatSessionCreatedAt = '';
    activeChatMessages = [];
    conversation.innerHTML = '';
    await refreshChatSessions();
    if (chatSessions.length > 0) {
      await loadChatSessionById(chatSessions[0].id);
    } else {
      await createNewChatSession();
    }
    status.textContent = 'Chat deleted';
  });
  stop.addEventListener('click', async () => {
    if (!chatRunning) return;
    stop.disabled = true;
    status.textContent = 'Stopping chat...';
    try {
      await window.llmIde.stopChat();
    } catch (error) {
      status.textContent = `Stop failed: ${error instanceof Error ? error.message : String(error)}`;
      stop.disabled = false;
    }
  });

  send.addEventListener('click', async () => {
    const text = prompt.value.trim();
    if (!text) return;

    persistSelectedContextWindow({ syncInput: true, save: true });

    let priorMessages = [];
    try {
      if (!activeChatSessionId) {
        await createNewChatSession();
      }

      priorMessages = forceFreshContextForNextSend ? [] : activeChatMessages.slice();
      forceFreshContextForNextSend = false;
      const userMessage = { role: 'user', content: text };
      activeChatMessages.push(userMessage);
      if (!activeChatSessionTitle || /^Chat\s\d/.test(activeChatSessionTitle)) {
        activeChatSessionTitle = buildChatTitleFromPrompt(text);
      }
      await persistActiveChatSession();
      // Intentionally avoid refreshing the session list here to keep the live assistant DOM row attached.
    } catch (error) {
      appendLog(conversation, `[error] ${error instanceof Error ? error.message : String(error)}`);
      status.textContent = 'Error';
      return;
    }

    appendLog(conversation, `You: ${text}`);
    assistantRowEl = null;
    assistantMarkdownEl = null;
    assistantMarkdownRaw = '';
    assistantReceivedToken = false;
    status.textContent = 'Streaming...';
    setChatRunning(true);

    try {
      const result = await window.llmIde.chatStream({
        prompt: text,
        config: {
          provider: normalizeProvider(provider.value),
          endpoint: endpoint.value.trim(),
          model: model.value,
          apiKey: apiKey.value.trim() || undefined,
          temperature: 0.2,
          maxTokens: 0,
          requestTimeoutMs: settingsState.requestTimeoutMs
        },
        historyMessages: priorMessages,
        contextWindowTokens: resolveSelectedContextWindowTokens(),
        memoryNamespace: selectedChatMemoryNamespace() || undefined,
        maxToolTurns: settingsState.maxToolTurns,
        toolNames: [
          'browser_fetch',
          'web_search',
          'list_repo_tree',
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

      if (!assistantMarkdownRaw && result?.text) {
        assistantMarkdownRaw = result.text;
        renderAssistantMarkdownNow();
      } else if (assistantMarkdownRaw) {
        renderAssistantMarkdownNow();
      }

      if (assistantMarkdownRaw.trim()) {
        activeChatMessages.push({ role: 'assistant', content: assistantMarkdownRaw });
      }

      await persistActiveChatSession();
      await refreshChatSessions();
      updateChatSessionWorkspaceLabel(currentWorkspaceDir, new Date().toISOString());

      if (Array.isArray(result?.usageByModel)) {
        recordModelUsage(result.usageByModel);
      }

      status.textContent = 'Done';
    } catch (error) {
      appendLog(conversation, `[error] ${error instanceof Error ? error.message : String(error)}`);
      await persistActiveChatSession();
      await refreshChatSessions();
      status.textContent = /canceled/i.test(error instanceof Error ? error.message : String(error)) ? 'Chat stopped' : 'Error';
    } finally {
      setChatRunning(false);
      assistantRowEl = null;
      assistantMarkdownEl = null;
      assistantReceivedToken = false;
      assistantMarkdownRaw = '';
      refreshChatNamespaceOptions();
    }
  });

  window.addEventListener('beforeunload', () => {
    offToken();
    offChatEvent();
  });

  try {
    const state = await window.llmIde.getWorkspaceState();
    currentWorkspaceDir = String(state?.workspaceDir || '').trim();
  } catch {
    currentWorkspaceDir = '';
  }

  await refreshModelOptions();
  syncChatContextWindowInput();
  await refreshChatNamespaceOptions();
  await refreshChatSessions();

  if (chatSessions.length > 0) {
    await loadChatSessionById(chatSessions[0].id);
  } else {
    await createNewChatSession();
  }
}

async function initOrchestration() {
  const status = document.getElementById('orchStatus');
  const orchMemoryNamespace = document.getElementById('orchMemoryNamespace');
  const orchNewMemoryNamespace = document.getElementById('orchNewMemoryNamespace');
  const prompt = document.getElementById('orchPrompt');
  const planEl = document.getElementById('orchPlan');
  const planNameEl = document.getElementById('orchPlanName');
  const planDescriptionEl = document.getElementById('orchPlanDescription');
  const loopUntilCompleteEl = document.getElementById('orchLoopUntilComplete');
  const maxLoopsEl = document.getElementById('orchMaxLoops');
  const completionMarkerEl = document.getElementById('orchCompletionMarker');
  const workflowEl = document.getElementById('orchWorkflow');
  const addStepButton = document.getElementById('orchAddStep');
  const importButton = document.getElementById('orchImport');
  const exportButton = document.getElementById('orchExport');
  const stopButton = document.getElementById('orchStop');
  const clearOutputLogButton = document.getElementById('orchClearOutputLog');
  const popoutOutputLogButton = document.getElementById('orchPopoutOutputLog');
  const logModal = document.getElementById('orchLogModal');
  const logMarkdownEl = document.getElementById('orchLogMarkdown');
  const logCloseButton = document.getElementById('orchLogClose');
  const logExpandAllButton = document.getElementById('orchLogExpandAll');
  const logCollapseAllButton = document.getElementById('orchLogCollapseAll');
  const eventsEl = document.getElementById('orchEvents');
  const outputEl = document.getElementById('orchOutput');
  const outputLogEl = document.getElementById('orchOutputLog');

  const availableTools = [
    'browser_fetch',
    'web_search',
    'list_repo_tree',
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
    loopUntilComplete: false,
    maxLoops: 3,
    completionMarker: 'TASK_COMPLETE',
    steps: []
  };
  let orchestrationRunning = false;
  const outputLogEntries = [];

  function selectedOrchestrationMemoryNamespace() {
    if (orchMemoryNamespace.value === '__new__') {
      return orchNewMemoryNamespace.value.trim();
    }
    return orchMemoryNamespace.value.trim();
  }

  function syncOrchestrationNewNamespaceVisibility() {
    const usingNew = orchMemoryNamespace.value === '__new__';
    orchNewMemoryNamespace.classList.toggle('visible', usingNew);
    orchNewMemoryNamespace.disabled = !usingNew;
  }

  function setOrchestrationNamespaceOptions(namespaces) {
    const preferred = settingsState.orchestrationMemoryNamespace;
    orchMemoryNamespace.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Default: workspace orchestration namespace';
    orchMemoryNamespace.appendChild(defaultOption);

    const known = Array.from(new Set(namespaces.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    for (const namespace of known) {
      const option = document.createElement('option');
      option.value = namespace;
      option.textContent = namespace;
      orchMemoryNamespace.appendChild(option);
    }

    const newOption = document.createElement('option');
    newOption.value = '__new__';
    newOption.textContent = 'New namespace...';
    orchMemoryNamespace.appendChild(newOption);

    if (!preferred) {
      orchMemoryNamespace.value = '';
      orchNewMemoryNamespace.value = '';
    } else if (known.includes(preferred)) {
      orchMemoryNamespace.value = preferred;
      orchNewMemoryNamespace.value = '';
    } else {
      orchMemoryNamespace.value = '__new__';
      orchNewMemoryNamespace.value = preferred;
    }

    syncOrchestrationNewNamespaceVisibility();
  }

  async function refreshOrchestrationNamespaceOptions() {
    try {
      const state = await window.llmIde.getWorkspaceState();
      const diagnostics = await window.llmIde.getMemoryDiagnostics();
      const entries = Array.isArray(diagnostics?.namespaces) ? diagnostics.namespaces : [];
      const prefix = `${sanitizeMemoryNamespacePart('orchestration')}_${sanitizeMemoryNamespacePart(state.workspaceDir)}_`;
      const namespaces = entries
        .map(item => String(item?.namespace ?? ''))
        .filter(namespace => namespace.startsWith(prefix))
        .map(namespace => namespace.slice(prefix.length))
        .filter(Boolean);
      setOrchestrationNamespaceOptions(namespaces);
    } catch {
      setOrchestrationNamespaceOptions([]);
    }
  }

  function setOrchestrationRunning(running) {
    orchestrationRunning = running;
    stopButton.disabled = !running;
    addStepButton.disabled = running;
    importButton.disabled = running;
    exportButton.disabled = running;
    document.getElementById('orchLoad').disabled = running;
    document.getElementById('orchValidate').disabled = running;
    document.getElementById('orchSave').disabled = running;
    document.getElementById('orchRun').disabled = running;
  }

  function defaultTools() {
    return availableTools.map(name => ({
      name,
      enabled: ['list_repo_tree', 'list_dir', 'read_file', 'grep_search'].includes(name)
    }));
  }

  function makeStep(index) {
    const id = `step-${Date.now()}-${index}`;
    return {
      id,
      name: `Step ${index + 1}`,
      provider: 'openai-compatible',
      endpoint: settingsState.endpoint,
      model: settingsState.model,
      contextWindowTokens: resolveContextWindow(settingsState.model),
      apiKey: settingsState.apiKey || undefined,
      systemPrompt: '',
      temperature: 0.2,
      maxTokens: 0,
      maxToolTurns: 40,
      tools: defaultTools(),
      passOutputToNext: true,
      allowCompletionTool: false
    };
  }

  function normalizeStep(step, index, totalSteps) {
    const existingTools = Array.isArray(step.tools) ? step.tools : [];
    const enabledMap = new Map(existingTools.map(tool => [tool.name, Boolean(tool.enabled)]));
    const fallbackAllowsCompletion = index === totalSteps - 1;

    return {
      id: step.id || `step-${index + 1}`,
      name: step.name || `Step ${index + 1}`,
      provider: step.provider === 'ollama' ? 'ollama' : 'openai-compatible',
      endpoint: step.endpoint || settingsState.endpoint,
      model: step.model || settingsState.model,
      contextWindowTokens: clampContextWindowTokens(Number(step.contextWindowTokens || 0)) || resolveContextWindow(step.model || settingsState.model),
      apiKey: step.apiKey || '',
      systemPrompt: step.systemPrompt || '',
      temperature: Number.isFinite(step.temperature) ? Number(step.temperature) : 0.2,
      maxTokens: Number.isFinite(step.maxTokens) ? Number(step.maxTokens) : 0,
      maxToolTurns: clampMaxToolTurns(Number(step.maxToolTurns || 40)),
      tools: availableTools.map(name => ({ name, enabled: Boolean(enabledMap.get(name)) })),
      passOutputToNext: step.passOutputToNext !== false,
      allowCompletionTool: typeof step.allowCompletionTool === 'boolean' ? step.allowCompletionTool : fallbackAllowsCompletion
    };
  }

  function normalizePlan(plan) {
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const maxLoops = Math.max(1, Math.min(20, Number(plan.maxLoops ?? 3)));
    return {
      version: 1,
      name: plan.name || 'Workflow',
      description: plan.description || 'Generated from workflow builder.',
      loopUntilComplete: Boolean(plan.loopUntilComplete),
      maxLoops,
      completionMarker: String(plan.completionMarker || 'TASK_COMPLETE').trim() || 'TASK_COMPLETE',
      steps: steps.map((step, index) => normalizeStep(step, index, steps.length))
    };
  }

  function syncPlanJson() {
    currentPlan.name = planNameEl.value.trim() || 'Workflow';
    currentPlan.description = planDescriptionEl.value.trim() || 'Generated from workflow builder.';
    currentPlan.loopUntilComplete = Boolean(loopUntilCompleteEl.checked);
    currentPlan.maxLoops = Math.max(1, Math.min(20, Number(maxLoopsEl.value || 3)));
    currentPlan.completionMarker = completionMarkerEl.value.trim() || 'TASK_COMPLETE';
    planEl.value = JSON.stringify(currentPlan, null, 2);
  }

  function renderOutputLogPopout() {
    logMarkdownEl.innerHTML = '';

    if (!outputLogEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'settings-help';
      empty.textContent = 'No orchestration output has been logged yet.';
      logMarkdownEl.appendChild(empty);
      return;
    }

    outputLogEntries.forEach((entry, entryIndex) => {
      const runDetails = document.createElement('details');
      runDetails.className = 'orchestration-log-section';
      runDetails.open = entryIndex === outputLogEntries.length - 1;

      const summary = document.createElement('summary');
      summary.textContent = `${entry.timestamp} | ${entry.planName} | ${entry.iterations} iteration(s)`;
      runDetails.appendChild(summary);

      const meta = document.createElement('div');
      meta.className = 'orchestration-log-meta assistant-markdown orchestration-log-markdown-content';
      meta.innerHTML = renderMarkdownToHtml([
        `**Prompt:** ${entry.promptText || '(empty prompt)'}`,
        `**Completion:** ${entry.markerInfo}`
      ].join('\n\n'));
      runDetails.appendChild(meta);

      if (!entry.steps.length) {
        const emptyStep = document.createElement('div');
        emptyStep.className = 'settings-help';
        emptyStep.textContent = '(no step output)';
        runDetails.appendChild(emptyStep);
      } else {
        entry.steps.forEach((step, stepIndex) => {
          const stepDetails = document.createElement('details');
          stepDetails.className = 'orchestration-log-step';
          stepDetails.open = entryIndex === outputLogEntries.length - 1 && stepIndex === entry.steps.length - 1;

          const stepSummary = document.createElement('summary');
          const toolCallCount = Array.isArray(step.toolCalls) ? step.toolCalls.length : 0;
          stepSummary.textContent = `Iteration ${step.iteration} | ${step.name} (${step.id})${toolCallCount > 0 ? ` | ${toolCallCount} tool call(s)` : ''}`;
          stepDetails.appendChild(stepSummary);

          const body = document.createElement('div');
          body.className = 'assistant-markdown orchestration-log-markdown-content orchestration-log-step-body';
          body.innerHTML = renderMarkdownToHtml(step.output || '(empty output)');
          stepDetails.appendChild(body);

          if (toolCallCount > 0) {
            const tcDetails = document.createElement('details');
            tcDetails.className = 'orchestration-log-tool-calls';

            const tcSummary = document.createElement('summary');
            tcSummary.textContent = `Tool Calls (${toolCallCount})`;
            tcDetails.appendChild(tcSummary);

            const tcList = document.createElement('div');
            tcList.className = 'orchestration-log-tool-calls-list';

            for (const tc of step.toolCalls) {
              const row = document.createElement('div');
              row.className = 'orchestration-log-tool-call-row';

              const timeEl = document.createElement('span');
              timeEl.className = 'orchestration-log-tool-call-time';
              timeEl.textContent = new Date(tc.timestamp).toLocaleTimeString();

              const nameEl = document.createElement('span');
              nameEl.className = 'orchestration-log-tool-call-name';
              nameEl.textContent = tc.name;

              const intentEl = document.createElement('span');
              intentEl.className = 'orchestration-log-tool-call-intent';
              intentEl.textContent = tc.intent;

              row.appendChild(timeEl);
              row.appendChild(nameEl);
              row.appendChild(intentEl);
              tcList.appendChild(row);
            }

            tcDetails.appendChild(tcList);
            stepDetails.appendChild(tcDetails);
          }

          runDetails.appendChild(stepDetails);
        });
      }

      logMarkdownEl.appendChild(runDetails);
    });
  }

  function setOrchestrationLogModalOpen(open) {
    if (open) {
      renderOutputLogPopout();
    }
    logModal.classList.toggle('open', open);
    logModal.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function setAllLogSectionsOpen(open) {
    logMarkdownEl.querySelectorAll('details').forEach(details => {
      details.open = open;
    });
  }

  function renderOrchestrationOutput(result, promptText, planSnapshot) {
    outputEl.innerHTML = '';

    const markerInfo = result.completionMarker
      ? `marker=${result.completionMarker} completed=${result.completed ? 'yes' : 'no'}`
      : 'single-pass run';
    const steps = Array.isArray(result.steps) ? result.steps : [];

    const container = document.createElement('div');
    container.className = 'orchestration-output-cards';

    const summaryCard = document.createElement('div');
    summaryCard.className = 'assistant-markdown orchestration-log-markdown-content orchestration-output-card';
    summaryCard.innerHTML = renderMarkdownToHtml([
      `## ${planSnapshot.name || 'Workflow'} output`,
      `**Prompt:** ${promptText || '(empty prompt)'}`,
      `**Iterations:** ${result.iterations || 1}`,
      `**Completion:** ${markerInfo}`
    ].join('\n\n'));
    container.appendChild(summaryCard);

    if (!steps.length) {
      const emptyCard = document.createElement('div');
      emptyCard.className = 'orchestration-output-card settings-help';
      emptyCard.textContent = '(no step output)';
      container.appendChild(emptyCard);
    } else {
      steps.forEach((step, index) => {
        const stepDetails = document.createElement('details');
        stepDetails.className = 'orchestration-log-step orchestration-output-step';
        stepDetails.open = index === steps.length - 1;

        const stepSummary = document.createElement('summary');
        const toolCalls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
        stepSummary.textContent = `Iteration ${step.iteration} | ${step.name} (${step.id})${toolCalls.length ? ` | ${toolCalls.length} tool call(s)` : ''}`;
        stepDetails.appendChild(stepSummary);

        const stepBody = document.createElement('div');
        stepBody.className = 'assistant-markdown orchestration-log-markdown-content orchestration-log-step-body';
        stepBody.innerHTML = renderMarkdownToHtml(step.output || '(empty output)');
        stepDetails.appendChild(stepBody);

        if (toolCalls.length) {
          const tcDetails = document.createElement('details');
          tcDetails.className = 'orchestration-log-tool-calls';

          const tcSummary = document.createElement('summary');
          tcSummary.textContent = `Tool Calls (${toolCalls.length})`;
          tcDetails.appendChild(tcSummary);

          const tcList = document.createElement('div');
          tcList.className = 'orchestration-log-tool-calls-list';

          for (const tc of toolCalls) {
            const row = document.createElement('div');
            row.className = 'orchestration-log-tool-call-row';

            const timeEl = document.createElement('span');
            timeEl.className = 'orchestration-log-tool-call-time';
            timeEl.textContent = new Date(tc.timestamp).toLocaleTimeString();

            const nameEl = document.createElement('span');
            nameEl.className = 'orchestration-log-tool-call-name';
            nameEl.textContent = tc.name;

            const intentEl = document.createElement('span');
            intentEl.className = 'orchestration-log-tool-call-intent';
            intentEl.textContent = tc.intent;

            row.appendChild(timeEl);
            row.appendChild(nameEl);
            row.appendChild(intentEl);
            tcList.appendChild(row);
          }

          tcDetails.appendChild(tcList);
          stepDetails.appendChild(tcDetails);
        }

        container.appendChild(stepDetails);
      });
    }

    outputEl.appendChild(container);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function renderOrchestrationError(errorText) {
    outputEl.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'assistant-markdown orchestration-log-markdown-content orchestration-output-card';
    card.innerHTML = renderMarkdownToHtml(`## Run failed\n\n\`\`\`\n${String(errorText || 'Unknown orchestration error')}\n\`\`\``);
    outputEl.appendChild(card);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function renderOutputLogEntry(result, promptText, planSnapshot) {
    const markerInfo = result.completionMarker
      ? `marker=${result.completionMarker} completed=${result.completed ? 'yes' : 'no'}`
      : 'single-pass run';
    const steps = Array.isArray(result.steps) ? result.steps : [];
    const timestamp = new Date().toLocaleString();

    outputLogEntries.push({
      timestamp,
      planName: planSnapshot.name,
      promptText,
      iterations: result.iterations || 1,
      markerInfo,
      steps: steps.map(step => ({
        id: step.id,
        name: step.name,
        iteration: step.iteration,
        output: step.output || '',
        toolCalls: Array.isArray(step.toolCalls) ? step.toolCalls : []
      }))
    });

    const lines = [
      `Run @ ${timestamp}`,
      `Plan: ${planSnapshot.name}`,
      `Prompt: ${promptText || '(empty prompt)'}`,
      `Iterations: ${result.iterations || 1} | ${markerInfo}`,
      ''
    ];

    if (!steps.length) {
      lines.push('(no step output)');
    } else {
      for (const step of steps) {
        lines.push(`Iteration ${step.iteration} | ${step.name} (${step.id})`);
        const toolCalls = Array.isArray(step.toolCalls) ? step.toolCalls : [];
        if (toolCalls.length > 0) {
          lines.push(`Tool calls (${toolCalls.length}):`);
          for (const tc of toolCalls) {
            const time = new Date(tc.timestamp).toLocaleTimeString();
            lines.push(`  [${time}] ${tc.name} — ${tc.intent}`);
          }
        }
        lines.push(step.output || '(empty output)');
        lines.push('');
      }
    }

    const block = lines.join('\n').trimEnd();
    if (outputLogEl.textContent && outputLogEl.textContent.trim()) {
      outputLogEl.textContent += '\n\n========================================\n\n';
    }
    outputLogEl.textContent += block;
    outputLogEl.scrollTop = outputLogEl.scrollHeight;
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

      const insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.textContent = 'Insert';
      insertBtn.addEventListener('click', () => {
        currentPlan.steps.splice(index + 1, 0, makeStep(index + 1));
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
        actions.appendChild(insertBtn);
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
        step.contextWindowTokens = step.contextWindowTokens || resolveContextWindow(value || settingsState.model);
        syncPlanJson();
      });
      addLabeledInput('Context Window Tokens', step.contextWindowTokens ?? resolveContextWindow(step.model), value => {
        step.contextWindowTokens = clampContextWindowTokens(Number(value || 0)) || resolveContextWindow(step.model);
        syncPlanJson();
      }, { type: 'number', min: 1, step: 1 });
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
      addLabeledInput('Max Tool Calls', step.maxToolTurns ?? 40, value => {
        step.maxToolTurns = clampMaxToolTurns(Number(value || 40));
        syncPlanJson();
      }, { type: 'number', min: 1, step: 1 });
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

      const completionWrap = document.createElement('label');
      completionWrap.className = 'orch-tool-item orch-step-grid-wide';
      const completionCheckbox = document.createElement('input');
      completionCheckbox.type = 'checkbox';
      completionCheckbox.checked = Boolean(step.allowCompletionTool);
      completionCheckbox.addEventListener('change', () => {
        step.allowCompletionTool = completionCheckbox.checked;
        syncPlanJson();
      });
      completionWrap.appendChild(completionCheckbox);
      completionWrap.appendChild(document.createTextNode('Allow orchestration completion tool call in this step'));
      grid.appendChild(completionWrap);

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
    loopUntilCompleteEl.checked = currentPlan.loopUntilComplete;
    maxLoopsEl.value = String(currentPlan.maxLoops);
    completionMarkerEl.value = currentPlan.completionMarker;
    renderWorkflow();
  }

  function readPlanFromUi() {
    syncPlanJson();
    return JSON.parse(planEl.value);
  }

  planNameEl.addEventListener('input', syncPlanJson);
  planDescriptionEl.addEventListener('input', syncPlanJson);
  loopUntilCompleteEl.addEventListener('change', syncPlanJson);
  maxLoopsEl.addEventListener('input', syncPlanJson);
  completionMarkerEl.addEventListener('input', syncPlanJson);
  orchMemoryNamespace.addEventListener('change', () => {
    syncOrchestrationNewNamespaceVisibility();
    settingsState.orchestrationMemoryNamespace = selectedOrchestrationMemoryNamespace();
    saveSettings();
  });
  orchNewMemoryNamespace.addEventListener('input', () => {
    if (orchMemoryNamespace.value !== '__new__') return;
    settingsState.orchestrationMemoryNamespace = orchNewMemoryNamespace.value.trim();
    saveSettings();
  });
  addStepButton.addEventListener('click', () => {
    currentPlan.steps.push(makeStep(currentPlan.steps.length));
    renderWorkflow();
  });
  clearOutputLogButton.addEventListener('click', () => {
    outputLogEntries.length = 0;
    outputLogEl.textContent = '';
    renderOutputLogPopout();
    status.textContent = 'Output log cleared';
  });

  popoutOutputLogButton.addEventListener('click', () => {
    setOrchestrationLogModalOpen(true);
  });

  logCloseButton.addEventListener('click', () => {
    setOrchestrationLogModalOpen(false);
  });

  logModal.addEventListener('click', event => {
    if (event.target === logModal) {
      setOrchestrationLogModalOpen(false);
    }
  });

  logExpandAllButton.addEventListener('click', () => setAllLogSectionsOpen(true));
  logCollapseAllButton.addEventListener('click', () => setAllLogSectionsOpen(false));
  stopButton.addEventListener('click', async () => {
    if (!orchestrationRunning) return;
    stopButton.disabled = true;
    status.textContent = 'Stopping orchestration...';
    try {
      await window.llmIde.stopOrchestration();
    } catch (error) {
      status.textContent = `Stop failed: ${error instanceof Error ? error.message : String(error)}`;
      stopButton.disabled = false;
    }
  });

  document.getElementById('orchLoad').addEventListener('click', reload);

  importButton.addEventListener('click', async () => {
    try {
      const imported = await window.llmIde.importPlan();
      if (!imported) {
        status.textContent = 'Import canceled';
        return;
      }

      currentPlan = normalizePlan(imported.plan);
      planNameEl.value = currentPlan.name;
      planDescriptionEl.value = currentPlan.description;
      loopUntilCompleteEl.checked = currentPlan.loopUntilComplete;
      maxLoopsEl.value = String(currentPlan.maxLoops);
      completionMarkerEl.value = currentPlan.completionMarker;
      renderWorkflow();

      const fileName = imported.filePath.split(/[/\\]/).pop() || imported.filePath;
      status.textContent = `Imported plan: ${fileName}`;
    } catch (error) {
      status.textContent = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  exportButton.addEventListener('click', async () => {
    try {
      const parsed = readPlanFromUi();
      const exported = await window.llmIde.exportPlan(parsed);
      if (!exported) {
        status.textContent = 'Export canceled';
        return;
      }

      const fileName = exported.filePath.split(/[/\\]/).pop() || exported.filePath;
      status.textContent = `Exported plan: ${fileName}`;
    } catch (error) {
      status.textContent = `Export failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

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
    outputEl.innerHTML = '';
    status.textContent = 'Running orchestration...';
    setOrchestrationRunning(true);

    try {
      const parsed = readPlanFromUi();
      const promptText = prompt.value.trim();
      const result = await window.llmIde.runOrchestration({
        plan: parsed,
        prompt: promptText,
        memoryNamespace: selectedOrchestrationMemoryNamespace() || undefined,
        requestTimeoutMs: settingsState.requestTimeoutMs
      });
      renderOrchestrationOutput(result, promptText, parsed);
      renderOutputLogEntry(result, promptText, parsed);
      if (Array.isArray(result.usageByModel)) {
        recordModelUsage(result.usageByModel);
      }
      status.textContent = 'Run complete';
    } catch (error) {
      renderOrchestrationError(error instanceof Error ? error.message : String(error));
      status.textContent = /stopped by user|canceled/i.test(error instanceof Error ? error.message : String(error)) ? 'Run stopped' : 'Run failed';
    }
    finally {
      setOrchestrationRunning(false);
      refreshOrchestrationNamespaceOptions();
    }
  });

  orchNewMemoryNamespace.value = '';
  await reload();
  await refreshOrchestrationNamespaceOptions();

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
      applyTabLanguage(tab, inferLanguageFromPath(relativePath, diskContent));

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

function bytesToHuman(size) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let current = value;
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024;
    idx += 1;
  }
  return `${current.toFixed(current >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

async function initDiagnostics() {
  const status = document.getElementById('diagStatus');
  const summary = document.getElementById('diagSummary');
  const graphRagEl = document.getElementById('diagGraphRag');
  const namespaces = document.getElementById('diagNamespaces');
  const rawEl = document.getElementById('diagRaw');
  const refreshBtn = document.getElementById('diagRefresh');
  const copyBtn = document.getElementById('diagCopy');
  const namespaceSelect = document.getElementById('diagNamespaceSelect');
  const clearNamespaceBtn = document.getElementById('diagClearNamespace');
  const modelEl = document.getElementById('chatModel');

  let lastPayload = null;

  function formatGraphRagDiagnostics(data) {
    const stats = data && typeof data === 'object' ? data : {};
    const links = stats.linkHits && typeof stats.linkHits === 'object' ? stats.linkHits : {};
    const retrievals = Number(stats.retrievals || 0);
    const vectorSeedHits = Number(stats.vectorSeedHits || 0);
    const expandedHits = Number(stats.expandedHits || 0);
    const finalReturned = Number(stats.finalReturned || 0);
    const avgExpansionFactor = Number(stats.avgExpansionFactor || 0);
    const maxObservedHops = Number(stats.maxObservedHops || 0);
    const lastRetrievedAt = stats.lastRetrievedAt ? new Date(stats.lastRetrievedAt).toLocaleString() : 'never';

    return [
      `retrievals=${formatCount(retrievals)}`,
      `vectorSeedHits=${formatCount(vectorSeedHits)}`,
      `expandedHits=${formatCount(expandedHits)}`,
      `finalReturned=${formatCount(finalReturned)}`,
      `avgExpansionFactor=${avgExpansionFactor.toFixed(3)}`,
      `maxObservedHops=${formatCount(maxObservedHops)}`,
      `linkHits.sequential=${formatCount(Number(links.sequential || 0))}`,
      `linkHits.explicit=${formatCount(Number(links.explicit || 0))}`,
      `linkHits.turn=${formatCount(Number(links.turn || 0))}`,
      `linkHits.source=${formatCount(Number(links.source || 0))}`,
      `lastRetrievedAt=${lastRetrievedAt}`
    ].join('\n');
  }

  function renderDiagnostics(payload) {
    lastPayload = payload;
    const healthOk = Boolean(payload?.health?.ok);
    status.textContent = healthOk ? 'TurboVec bridge healthy.' : 'TurboVec bridge has issues.';

    const totals = payload?.totals || {};
    const lines = [
      `Python: ${payload?.pythonExecutable || 'unknown'}`,
      `Bridge: ${payload?.bridgeScriptPath || 'unknown'}`,
      `Memory Root: ${payload?.memoryRoot || 'unknown'}`,
      `Namespaces: ${totals.namespaces || 0}`,
      `Records: ${totals.records || 0}`,
      `Index Bytes: ${bytesToHuman(totals.indexBytes || 0)}`,
      `Metadata Bytes: ${bytesToHuman(totals.metadataBytes || 0)}`,
      `NumPy: ${payload?.health?.numpyVersion || 'n/a'}`,
      `TurboVec: ${payload?.health?.turbovecVersion || 'n/a'}`
    ];
    if (payload?.health?.error) {
      lines.push(`Health Error: ${payload.health.error}`);
    }
    summary.textContent = lines.join('\n');

    const aggregateGraphRag = payload?.graphrag || {};
    const ns = Array.isArray(payload?.namespaces) ? payload.namespaces : [];
    const namespaceSections = ns
      .filter(item => item?.graphrag)
      .map(item => {
        return [
          `[${item.namespace}]`,
          formatGraphRagDiagnostics(item.graphrag)
        ].join('\n');
      });

    if (graphRagEl) {
      graphRagEl.textContent = [
        '[aggregate]',
        formatGraphRagDiagnostics(aggregateGraphRag),
        namespaceSections.length ? '' : 'No GraphRAG retrieval events captured yet for this filter.',
        namespaceSections.join('\n\n')
      ].filter(Boolean).join('\n\n');
    }

    namespaceSelect.innerHTML = '';
    if (!ns.length) {
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = 'No namespaces available';
      namespaceSelect.appendChild(emptyOpt);
      namespaceSelect.disabled = true;
      clearNamespaceBtn.disabled = true;
    } else {
      const chooseOpt = document.createElement('option');
      chooseOpt.value = '';
      chooseOpt.textContent = 'Select namespace...';
      namespaceSelect.appendChild(chooseOpt);

      for (const item of ns) {
        const option = document.createElement('option');
        option.value = item.namespace;
        option.textContent = item.namespace;
        namespaceSelect.appendChild(option);
      }
      namespaceSelect.disabled = false;
      clearNamespaceBtn.disabled = false;
    }

    if (!ns.length) {
      namespaces.textContent = 'No memory namespaces found for current workspace filter yet.';
    } else {
      namespaces.textContent = ns.map(item => {
        const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'never';
        return [
          `${item.namespace}`,
          `  records=${item.records}`,
          `  index=${bytesToHuman(item.indexBytes)}`,
          `  metadata=${bytesToHuman(item.metadataBytes)}`,
          `  updated=${updated}`
        ].join('\n');
      }).join('\n\n');
    }

    rawEl.textContent = JSON.stringify(payload || {}, null, 2);
  }

  async function refreshDiagnostics() {
    status.textContent = 'Loading diagnostics...';
    try {
      // Show all workspace namespaces so orchestration and chat memory are both visible.
      const payload = await window.llmIde.getMemoryDiagnostics();
      renderDiagnostics(payload);
    } catch (error) {
      status.textContent = 'Failed to load diagnostics.';
      rawEl.textContent = String(error instanceof Error ? error.stack || error.message : error);
    }
  }

  refreshBtn.addEventListener('click', refreshDiagnostics);
  copyBtn.addEventListener('click', async () => {
    if (!lastPayload) {
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(lastPayload, null, 2));
    status.textContent = 'Diagnostics JSON copied to clipboard.';
  });

  clearNamespaceBtn.addEventListener('click', async () => {
    const namespace = namespaceSelect.value;
    if (!namespace) {
      status.textContent = 'Select a namespace to clear.';
      return;
    }

    const confirmed = window.confirm(`Clear namespace ${namespace}? This action cannot be undone.`);
    if (!confirmed) {
      return;
    }

    status.textContent = `Clearing namespace ${namespace}...`;
    try {
      const result = await window.llmIde.clearMemoryNamespace({ namespace });
      const cleared = Boolean(result?.cleared);
      status.textContent = cleared
        ? `Namespace ${namespace} cleared.`
        : `Namespace ${namespace} not found.`;
      await refreshDiagnostics();
    } catch (error) {
      status.textContent = `Failed to clear namespace: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  await refreshDiagnostics();
}

async function main() {
  loadSettings();
  renderContextUsageGraph();
  document.getElementById('chatTab').addEventListener('click', () => setActiveTab('chat'));
  document.getElementById('orchTab').addEventListener('click', () => setActiveTab('orchestration'));
  document.getElementById('diagTab').addEventListener('click', () => setActiveTab('diagnostics'));
  document.getElementById('openSample').addEventListener('click', () => {
    openScratchTab(
      "// Sample file\nexport async function run() {\n  return 'Edit code here with Monaco and ask the LLM to help.';\n}\n",
      { language: 'typescript', extension: 'ts' }
    );
  });

  document.getElementById('saveFile').addEventListener('click', async () => {
    if (!activeEditorKey) return;
    await saveTab(activeEditorKey);
  });

  document.getElementById('saveAllFiles').addEventListener('click', saveAllTabs);

  initSettingsMenu();
  initResizablePanels();
  initTerminalPanel();
  await setupMonaco();
  await initWorkspaceTree();
  await initChat();
  await initOrchestration();
  await initDiagnostics();
}

main().catch(error => {
  const body = document.body;
  body.innerHTML = `<pre style=\"color:#ff6e7c;padding:20px\">${error instanceof Error ? error.stack : String(error)}</pre>`;
});
