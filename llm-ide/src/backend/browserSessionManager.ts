import {
  BrowserCaptureRequest,
  BrowserCaptureResult,
  BrowserFeatureState,
  BrowserInteractionRequest,
  BrowserInteractionResult,
  BrowserNavigateRequest,
  BrowserNavigateResult,
  BrowserSessionState,
  BrowserSetBoundsRequest,
  BrowserSnapshot
} from '../shared/types';
import type { BrowserWindow } from 'electron';

interface BrowserSessionManagerOptions {
  enabled?: boolean;
  onStateChanged?: (state: BrowserSessionState) => void;
}

interface BrowserViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Minimal feature-gated browser session manager scaffold.
 *
 * Purpose: Provide a stable IPC contract and state model for browser features
 * without changing current runtime behavior while the feature is disabled.
 *
 * Notes:
 * - Disabled by default until enabled from app settings.
 * - Uses Electron WebContentsView to embed a real browser surface.
 */
export class BrowserSessionManager {
  private featureState: BrowserFeatureState;
  private state: BrowserSessionState;
  private bounds: BrowserViewportBounds | null;
  private hostWindow: BrowserWindow | null;
  private browserView: unknown | null;
  private onStateChanged?: (state: BrowserSessionState) => void;

  constructor(options: BrowserSessionManagerOptions = {}) {
    const enabled = typeof options.enabled === 'boolean' ? options.enabled : false;

    this.featureState = enabled
      ? { enabled: true, mode: 'embedded' }
      : {
          enabled: false,
          mode: 'disabled',
          reason: 'Browser integration is disabled in settings.'
        };

    this.state = {
      sessionActive: false,
      mode: this.featureState.mode,
      loading: false,
      updatedAt: nowIso()
    };

    this.bounds = null;
    this.hostWindow = null;
    this.browserView = null;
    this.onStateChanged = options.onStateChanged;
  }

  setHostWindow(window: BrowserWindow | null): void {
    this.hostWindow = window;
    if (!window) {
      this.teardownView();
      return;
    }
    if (this.featureState.enabled && this.state.sessionActive) {
      this.ensureView();
      this.applyCurrentBounds();
    }
  }

  setFeatureEnabled(enabled: boolean): BrowserFeatureState {
    if (enabled) {
      this.featureState = { enabled: true, mode: 'embedded' };
      this.state = {
        ...this.state,
        mode: 'embedded',
        lastError: undefined,
        updatedAt: nowIso()
      };
      this.emitState();
      return this.getFeatureState();
    }

    this.featureState = {
      enabled: false,
      mode: 'disabled',
      reason: 'Browser integration is disabled in settings.'
    };
    this.destroySession();
    this.state = {
      sessionActive: false,
      mode: 'disabled',
      loading: false,
      updatedAt: nowIso()
    };
    this.emitState();
    return this.getFeatureState();
  }

  getFeatureState(): BrowserFeatureState {
    return { ...this.featureState };
  }

  createSession(): BrowserNavigateResult {
    if (!this.featureState.enabled) {
      return this.disabledResult();
    }

    const viewReady = this.ensureView();
    if (!viewReady.ok) {
      return viewReady;
    }

    this.state = {
      ...this.state,
      sessionActive: true,
      loading: false,
      lastError: undefined,
      updatedAt: nowIso(),
      mode: 'embedded'
    };

    this.applyCurrentBounds();
    this.emitState();

    return {
      ok: true,
      state: this.getState()
    };
  }

  destroySession(): BrowserNavigateResult {
    if (!this.featureState.enabled) {
      return this.disabledResult();
    }

    this.teardownView();
    this.state = {
      sessionActive: false,
      mode: this.featureState.mode,
      loading: false,
      updatedAt: nowIso()
    };
    this.emitState();

    return {
      ok: true,
      state: this.getState()
    };
  }

  getState(): BrowserSessionState {
    return { ...this.state };
  }

  navigate(request: BrowserNavigateRequest): BrowserNavigateResult {
    if (!this.featureState.enabled) {
      return this.disabledResult();
    }

    if (!this.state.sessionActive) {
      return this.errorResult('no_active_session', 'No active browser session.');
    }

    const view = this.ensureView();
    if (!view.ok) {
      return view;
    }

    const type = request.type ?? 'url';
    if (type === 'url') {
      const rawUrl = String(request.url ?? '').trim();
      if (!rawUrl) {
        return this.errorResult('url_required', 'url is required when navigation type is "url".');
      }

      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        return this.errorResult('invalid_url', 'url must be a valid absolute URL.');
      }

      if (!/^https?:$/.test(url.protocol)) {
        return this.errorResult('unsupported_protocol', 'Only http and https URLs are supported.');
      }

      const targetUrl = url.toString();
      this.state = {
        ...this.state,
        currentUrl: targetUrl,
        title: url.hostname,
        loading: true,
        lastError: undefined,
        updatedAt: nowIso()
      };

      this.emitState();
      this.loadUrl(targetUrl).catch(error => {
        this.state = {
          ...this.state,
          loading: false,
          lastError: `navigate_failed: ${error instanceof Error ? error.message : String(error)}`,
          updatedAt: nowIso()
        };
        this.emitState();
      });

      return {
        ok: true,
        state: this.getState()
      };
    }

    const webContents = this.getWebContents();
    if (!webContents) {
      return this.errorResult('view_unavailable', 'Browser surface is unavailable.');
    }

    if (type === 'back') {
      if (typeof webContents.canGoBack === 'function' && webContents.canGoBack()) {
        webContents.goBack();
      }
    } else if (type === 'forward') {
      if (typeof webContents.canGoForward === 'function' && webContents.canGoForward()) {
        webContents.goForward();
      }
    } else if (type === 'reload') {
      if (typeof webContents.reload === 'function') {
        webContents.reload();
      }
    } else if (type === 'stop') {
      if (typeof webContents.stop === 'function') {
        webContents.stop();
      }
    }

    this.state = {
      ...this.state,
      loading: type !== 'stop',
      lastError: undefined,
      updatedAt: nowIso()
    };
    this.emitState();

    return {
      ok: true,
      state: this.getState()
    };
  }

  async snapshot(): Promise<{ ok: boolean; reason?: string; snapshot?: BrowserSnapshot; state: BrowserSessionState }> {
    if (!this.featureState.enabled) {
      return {
        ...this.disabledResult(),
        snapshot: undefined
      };
    }

    if (!this.state.sessionActive) {
      return {
        ...this.errorResult('no_active_session', 'No active browser session.'),
        snapshot: undefined
      };
    }

    const webContents = this.getWebContents();
    if (!webContents) {
      return {
        ...this.errorResult('view_unavailable', 'Browser surface is unavailable.'),
        snapshot: undefined
      };
    }

    let content = '';
    try {
      content = await webContents.executeJavaScript(
        `(() => {
          const title = document.title || '';
          const text = (document.body && document.body.innerText ? document.body.innerText : '')
            .replace(/\\s+/g, ' ')
            .trim();
          const links = Array.from(document.querySelectorAll('a[href]'))
            .slice(0, 40)
            .map(el => el.href)
            .join('\\n');
          return [title ? 'Title: ' + title : '', text ? 'Text: ' + text.slice(0, 12000) : '', links ? 'Links:\\n' + links : '']
            .filter(Boolean)
            .join('\\n\\n');
        })();`,
        true
      );
    } catch {
      content = 'Unable to read page DOM content from embedded browser.';
    }

    const result = {
      ok: true,
      snapshot: {
        url: this.state.currentUrl,
        title: this.state.title,
        content,
        capturedAt: nowIso()
      },
      state: this.getState()
    };

    this.state = {
      ...this.state,
      updatedAt: nowIso()
    };
    this.emitState();
    return result;
  }

  async capture(_request: BrowserCaptureRequest): Promise<BrowserCaptureResult> {
    if (!this.featureState.enabled) {
      return {
        ...this.disabledResult(),
        mimeType: undefined,
        dataBase64: undefined
      };
    }

    const webContents = this.getWebContents();
    if (!webContents) {
      return {
        ok: false,
        reason: 'view_unavailable',
        state: this.getState()
      };
    }

    try {
      const image = await webContents.capturePage();
      const png = image.toPNG();
      return {
        ok: true,
        mimeType: 'image/png',
        dataBase64: png.toString('base64'),
        state: this.getState()
      };
    } catch {
      return {
        ok: false,
        reason: 'capture_failed',
        state: this.getState()
      };
    }
  }

  setBounds(request: BrowserSetBoundsRequest): BrowserNavigateResult {
    if (!this.featureState.enabled) {
      return this.disabledResult();
    }

    this.bounds = {
      x: Math.max(0, Math.floor(request.x)),
      y: Math.max(0, Math.floor(request.y)),
      width: Math.max(0, Math.floor(request.width)),
      height: Math.max(0, Math.floor(request.height)),
      visible: request.visible !== false
    };

    this.state = {
      ...this.state,
      updatedAt: nowIso()
    };
    this.applyCurrentBounds();
    this.emitState();

    return {
      ok: true,
      state: this.getState()
    };
  }

  async interact(request: BrowserInteractionRequest): Promise<BrowserInteractionResult> {
    if (!this.featureState.enabled) {
      return {
        ...this.disabledResult()
      };
    }

    const webContents = this.getWebContents();
    if (!webContents) {
      return {
        ok: false,
        reason: 'view_unavailable',
        state: this.getState()
      };
    }

    const action = String(request.action ?? '').trim();

    if (action === 'click') {
      const selector = String(request.selector ?? '').trim();
      if (!selector) {
        return { ok: false, reason: 'selector_required', state: this.getState() };
      }
      const clicked = await webContents.executeJavaScript(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) { return false; }
          (el).scrollIntoView({ block: 'center', inline: 'center' });
          (el).click();
          return true;
        })();`,
        true
      );
      return { ok: Boolean(clicked), reason: clicked ? undefined : 'selector_not_found', state: this.getState() };
    }

    if (action === 'type') {
      const selector = String(request.selector ?? '').trim();
      const text = String(request.text ?? '');
      if (!selector) {
        return { ok: false, reason: 'selector_required', state: this.getState() };
      }
      const typed = await webContents.executeJavaScript(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) { return false; }
          (el).focus();
          const value = ${JSON.stringify(text)};
          if ('value' in el) {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        })();`,
        true
      );
      return { ok: Boolean(typed), reason: typed ? undefined : 'selector_not_found', state: this.getState() };
    }

    if (action === 'keypress') {
      const key = String(request.key ?? '').trim();
      if (!key) {
        return { ok: false, reason: 'key_required', state: this.getState() };
      }
      const keyCode = key.length === 1 ? key.toUpperCase() : key;
      if (typeof webContents.sendInputEvent === 'function') {
        webContents.sendInputEvent({ type: 'keyDown', keyCode });
        webContents.sendInputEvent({ type: 'char', keyCode: key });
        webContents.sendInputEvent({ type: 'keyUp', keyCode });
      }
      return { ok: true, state: this.getState() };
    }

    return {
      ok: false,
      reason: 'unsupported_action',
      state: this.getState()
    };
  }

  getBounds(): BrowserViewportBounds | null {
    return this.bounds ? { ...this.bounds } : null;
  }

  private disabledResult(): BrowserNavigateResult {
    return {
      ok: false,
      reason: 'feature_disabled',
      state: this.getState()
    };
  }

  private errorResult(code: string, message: string): BrowserNavigateResult {
    this.state = {
      ...this.state,
      lastError: `${code}: ${message}`,
      updatedAt: nowIso()
    };
    return {
      ok: false,
      reason: code,
      state: this.getState()
    };
  }

  private emitState(): void {
    this.onStateChanged?.(this.getState());
  }

  private ensureView(): BrowserNavigateResult {
    if (!this.hostWindow) {
      return this.errorResult('host_window_unavailable', 'Host window is unavailable.');
    }

    if (this.browserView) {
      return {
        ok: true,
        state: this.getState()
      };
    }

    // Lazy require keeps non-Electron test environments working.
    const electronMod = require('electron') as {
      WebContentsView?: new (options?: Record<string, unknown>) => {
        webContents: any;
        setBounds?: (bounds: { x: number; y: number; width: number; height: number }) => void;
      };
    };

    if (!electronMod.WebContentsView) {
      return this.errorResult('webcontentsview_unavailable', 'WebContentsView is not available in this Electron runtime.');
    }

    const view = new electronMod.WebContentsView({
      webPreferences: {
        javascript: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    });

    this.browserView = view;
    this.hostWindow.contentView.addChildView(view as any);
    this.bindWebContentsEvents();
    this.applyCurrentBounds();
    return {
      ok: true,
      state: this.getState()
    };
  }

  private teardownView(): void {
    const view = this.browserView as any;
    if (!view) {
      return;
    }

    try {
      if (this.hostWindow) {
        this.hostWindow.contentView.removeChildView(view);
      }
    } catch {
      // Ignore detach failures during teardown.
    }

    try {
      if (view.webContents && !view.webContents.isDestroyed()) {
        view.webContents.removeAllListeners?.();
        view.webContents.close?.();
      }
    } catch {
      // Ignore close failures during teardown.
    }

    this.browserView = null;
  }

  private getWebContents(): any | null {
    const view = this.browserView as any;
    if (!view || !view.webContents || view.webContents.isDestroyed?.()) {
      return null;
    }
    return view.webContents;
  }

  private applyCurrentBounds(): void {
    const view = this.browserView as any;
    if (!view || typeof view.setBounds !== 'function') {
      return;
    }

    const hiddenBounds = { x: 0, y: 0, width: 1, height: 1 };
    if (!this.bounds || !this.bounds.visible || this.bounds.width < 2 || this.bounds.height < 2) {
      view.setBounds(hiddenBounds);
      return;
    }

    view.setBounds({
      x: this.bounds.x,
      y: this.bounds.y,
      width: this.bounds.width,
      height: this.bounds.height
    });
  }

  private bindWebContentsEvents(): void {
    const webContents = this.getWebContents();
    if (!webContents) {
      return;
    }

    webContents.on('did-start-loading', () => {
      this.state = {
        ...this.state,
        loading: true,
        updatedAt: nowIso()
      };
      this.emitState();
    });

    webContents.on('did-stop-loading', () => {
      this.state = {
        ...this.state,
        loading: false,
        updatedAt: nowIso()
      };
      this.emitState();
    });

    webContents.on('page-title-updated', (_event: unknown, title: string) => {
      this.state = {
        ...this.state,
        title,
        updatedAt: nowIso()
      };
      this.emitState();
    });

    const onNavigate = (_event: unknown, url: string) => {
      this.state = {
        ...this.state,
        currentUrl: url,
        updatedAt: nowIso()
      };
      this.emitState();
    };

    webContents.on('did-navigate', onNavigate);
    webContents.on('did-navigate-in-page', onNavigate);

    webContents.on('did-fail-load', (_event: unknown, code: number, description: string) => {
      this.state = {
        ...this.state,
        loading: false,
        lastError: `load_failed(${code}): ${description}`,
        updatedAt: nowIso()
      };
      this.emitState();
    });
  }

  private async loadUrl(url: string): Promise<void> {
    const webContents = this.getWebContents();
    if (!webContents) {
      throw new Error('Browser view is not available.');
    }
    await webContents.loadURL(url);
  }
}
