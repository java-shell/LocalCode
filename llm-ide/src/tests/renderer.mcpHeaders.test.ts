import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

/** Minimal deterministic DOM for running the shipped editor without Electron or a real user profile. */
class ElementStub {
  children: ElementStub[] = [];
  listeners: Record<string, () => void> = {};
  attributes: Record<string, string> = {};
  tag: string;
  value = '';
  textContent = '';
  id = '';
  htmlFor = '';
  disabled = false;
  private html = '';
  /** Record element type for semantic assertions. */
  constructor(tag: string) { this.tag = tag; }
  /** Emulate clearing the editor on a rerender. */
  set innerHTML(value: string) { this.html = value; this.children = []; }
  /** Return markup assigned to selects. */
  get innerHTML() { return this.html; }
  /** Preserve child order for field lookup. */
  appendChild(child: ElementStub) { this.children.push(child); return child; }
  /** Capture attribute values, including accessibility associations. */
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  /** Capture single event listeners for explicit deterministic dispatch. */
  addEventListener(event: string, listener: () => void) { this.listeners[event] = listener; }
}

/** Extract and execute actual MCP helpers/editor only; bridge returns saved configs to exercise both normalizers. */
function harness(servers: unknown[]) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../renderer/app.js'), 'utf8');
  const editor = new ElementStub('div');
  let sent: any;
  const context = vm.createContext({
    modalMcpServers: servers, mcpServersEditor: editor,
    mcpServerState: { servers: [], runtimeById: {}, loaded: false },
    document: {
      createElement: (tag: string) => new ElementStub(tag),
      createTextNode: (text: string) => Object.assign(new ElementStub('#text'), { textContent: text })
    },
    window: { llmIde: { saveMcpServers: async (payload: unknown) => {
      sent = payload;
      return payload;
    } } }
  });
  vm.runInContext(source.slice(source.indexOf('function createDefaultMcpServer('),
    source.indexOf('async function refreshMcpRuntimeFromMain(')), context);
  vm.runInContext(source.slice(source.indexOf('  function renderMcpServersEditor()'),
    source.indexOf('  function renderNotifyEventCheckboxes()')), context);
  return { context, editor, sent: () => sent };
}

/** Assert label/help associations, transport enabling, and invalid draft retention across runtime refreshes. */
test('MCP header editor is accessible, HTTP-only, and retains drafts on rerender', () => {
  const server = {
    id: 'remote', label: 'Remote', transport: 'http', endpoint: 'https://example.invalid/mcp',
    enabledForChat: true, enabledForOrchestration: true, headers: { Authorization: 'Bearer test-token' }
  };
  const { context, editor } = harness([server]);
  vm.runInContext('renderMcpServersEditor()', context);
  let fields = editor.children[0].children;
  const textarea = fields.find(item => item.tag === 'textarea')!;
  assert.equal(textarea.disabled, false);
  assert.match(textarea.value, /Bearer test-token/);
  assert.ok(fields.some(item => item.tag === 'label' && item.htmlFor === textarea.id));
  assert.ok(fields.some(item => item.id === textarea.attributes['aria-describedby']));
  const transport = fields.find(item => item.tag === 'select')!;
  for (const value of ['stdio', 'sse', 'http']) {
    transport.value = value;
    transport.listeners.change();
    assert.equal(textarea.disabled, value !== 'http');
  }
  textarea.value = '{invalid draft';
  textarea.listeners.input();
  vm.runInContext('renderMcpServersEditor()', context);
  fields = editor.children[0].children;
  assert.equal(fields.find(item => item.tag === 'textarea')!.value, '{invalid draft');
});

/** Execute real parser/save helpers: edits survive IPC round-trip, blank clears, errors retain drafts and do not send. */
test('MCP settings save round-trips headers, clears blanks, and rejects malformed drafts without secrets', async () => {
  const { context, sent } = harness([{
    id: 'remote', label: 'Remote', transport: 'http', endpoint: 'https://example.invalid/mcp',
    enabledForChat: true, enabledForOrchestration: true,
    headers: { Authorization: 'old' }, headersJson: '{"Authorization":"Bearer edited","X-Tenant":"tenant"}'
  }]);
  await vm.runInContext('saveMcpServersToMain(modalMcpServers)', context);
  // vm objects have a different prototype; compare the serialized IPC payload, not its realm.
  assert.deepEqual(JSON.parse(JSON.stringify(sent().servers[0].headers)), { Authorization: 'Bearer edited', 'X-Tenant': 'tenant' });
  assert.equal(sent().servers[0].headersJson, undefined);
  assert.equal(vm.runInContext('mcpServerState.servers[0].headers.Authorization', context), 'Bearer edited');
  vm.runInContext('modalMcpServers[0].headersJson = "  "', context);
  await vm.runInContext('saveMcpServersToMain(modalMcpServers)', context);
  assert.deepEqual(Object.keys(sent().servers[0].headers), []);
  const lastSent = sent();
  for (const draft of ['test-secret', '[]', 'null', '{"Authorization":42}', '{"Authorization":"test-secret",}']) {
    context.draft = draft;
    vm.runInContext('modalMcpServers[0].headersJson = draft', context);
    await assert.rejects(vm.runInContext('saveMcpServersToMain(modalMcpServers)', context), (error: any) => {
      assert.match(error.message, /HTTP headers/);
      assert.doesNotMatch(error.message, /test-secret/);
      return true;
    });
    assert.equal(sent(), lastSent);
    assert.equal(vm.runInContext('modalMcpServers[0].headersJson', context), draft);
  }
  // Inactive transport drafts cannot block saves or unexpectedly clear preserved configuration.
  vm.runInContext('modalMcpServers[0].transport = "sse"', context);
  await vm.runInContext('saveMcpServersToMain(modalMcpServers)', context);
  assert.equal(sent().servers[0].headers.Authorization, 'old');
});

/** Keep the existing IPC route and announce errors accessibly in the existing settings section. */
test('MCP headers retain the existing typed settings bridge and live status', () => {
  const root = path.resolve(__dirname, '../..');
  const preload = fs.readFileSync(path.join(root, 'src/preload.ts'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
  assert.match(preload, /saveMcpServers:[\s\S]*?ipcRenderer.invoke\('mcp:save-servers', payload\)/);
  assert.match(main, /ipcMain.handle\('mcp:save-servers'[\s\S]*?saveMcpServers\([\s\S]*?configure\(servers\)[\s\S]*?refreshAll\(\)/);
  assert.match(html, /id="settingMcpStatus"[^>]*role="status"[^>]*aria-live="polite"/);
});