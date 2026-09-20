import axios from 'axios';

/**
 * Outbound notifications (ntfy only).
 *
 * Lives in the main process on purpose: the renderer CSP (`connect-src`) blocks
 * arbitrary outbound HTTPS, and `contextIsolation` removes Node networking from
 * the renderer. The main process already ships `axios`, so this adds no deps.
 *
 * Design rules:
 * - `dispatchNotification` is fire-and-forget and NEVER throws. A dead or slow
 *   ntfy server must not add latency to, or fail, a chat completion.
 * - The ntfy topic is effectively a bearer secret (anyone who knows it can read
 *   your notifications), so it is redacted from every log/event string.
 * - Content policy is opt-in: response text only leaves the machine when
 *   `notifyIncludeExcerpt` is explicitly enabled.
 */

export type NotifyEventKind =
  | 'chat.completed'
  | 'chat.input_needed'
  | 'chat.error'
  | 'orchestration.completed';

export interface NotifyConfig {
  notifyEnabled?: boolean;
  /** Topic name (e.g. `my-phone`), or a full `http(s)://host/topic` URL. */
  notifyNtfyTopic?: string;
  /** Base server used when `notifyNtfyTopic` is a bare topic name. */
  notifyNtfyServer?: string;
  /** Event kinds to send. Empty/omitted means all events. */
  notifyEvents?: string[];
  /** When false (default), only titles/metadata are sent, never response text. */
  notifyIncludeExcerpt?: boolean;
  /** ntfy priority 1-5. Default 3; `input_needed` and `error` bump to 4. */
  notifyPriority?: number;
  /** Suppress duplicate sends of the same event kind within this window. */
  notifyRateLimitSeconds?: number;
  /** Per-request timeout for the ntfy publish itself. Default 5000 ms. */
  notifyTimeoutMs?: number;
}

export interface NotifyEventPayload {
  kind: NotifyEventKind;
  title: string;
  /** Response/step text. Only sent when `notifyIncludeExcerpt` is enabled. */
  excerpt?: string;
  model?: string;
  workspaceDir?: string;
  durationMs?: number;
  totalTokens?: number;
  /** Extra one-line context, e.g. the query_user question. Always sent. */
  detail?: string;
}

export interface NotifySendResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  status?: number;
}

export const NOTIFY_EVENT_KINDS: NotifyEventKind[] = [
  'chat.completed',
  'chat.input_needed',
  'chat.error',
  'orchestration.completed'
];

export const DEFAULT_NTFY_SERVER = 'https://ntfy.sh';

const MAX_BODY_CHARS = 3500;
const MAX_TITLE_CHARS = 120;
const MAX_DETAIL_CHARS = 400;
const FALLBACK_TIMEOUT_MS = 5000;

const EVENT_META: Record<NotifyEventKind, { label: string; tag: string; priority: number }> = {
  'chat.completed': { label: 'Chat complete', tag: 'white_check_mark', priority: 3 },
  'chat.input_needed': { label: 'Input needed', tag: 'speech_balloon', priority: 4 },
  'chat.error': { label: 'Chat failed', tag: 'warning', priority: 4 },
  'orchestration.completed': { label: 'Orchestration complete', tag: 'robot', priority: 3 }
};

const recentSends = new Map<string, number>();

function normalizeWhitespace(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clamp(value: string, maxChars: number): string {
  const text = normalizeWhitespace(value);
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function basename(dirPath: string): string {
  const normalized = String(dirPath ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

/**
 * Resolve the configured topic (bare name or full URL) into a publish endpoint.
 * Returns null when the config is unusable. Only http/https are accepted.
 */
export function resolveNtfyEndpoint(config: NotifyConfig | null | undefined): string | null {
  const rawTopic = String(config?.notifyNtfyTopic ?? '').trim();
  if (!rawTopic) {
    return null;
  }

  const rawServer = String(config?.notifyNtfyServer ?? '').trim();
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawTopic);

  let candidate: URL;
  try {
    if (looksLikeUrl) {
      candidate = new URL(rawTopic);
    } else {
      // Bare topic name: ntfy topics are `[a-zA-Z0-9._-]{1,64}`. Rejecting
      // anything else here prevents odd input from becoming a path traversal
      // or an unexpected host/path on the publish URL.
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(rawTopic)) {
        return null;
      }
      const base = rawServer || DEFAULT_NTFY_SERVER;
      const baseWithScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(base) ? base : `https://${base}`;
      candidate = new URL(`${baseWithScheme.replace(/\/+$/, '')}/${encodeURIComponent(rawTopic)}`);
    }
  } catch {
    return null;
  }

  if (candidate.protocol !== 'https:' && candidate.protocol !== 'http:') {
    return null;
  }

  // http is only acceptable for loopback / LAN self-hosted servers.
  if (candidate.protocol === 'http:') {
    const host = candidate.hostname.toLowerCase();
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host === '::1' ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (!isLocal) {
      return null;
    }
  }

  if (!candidate.pathname || candidate.pathname === '/') {
    return null;
  }

  return candidate.toString().replace(/\/+$/, '');
}

/** Mask the topic segment so endpoints can be logged without leaking the secret. */
export function redactNtfyEndpoint(endpoint: string | null): string {
  if (!endpoint) {
    return '(not configured)';
  }
  try {
    const url = new URL(endpoint);
    const segments = url.pathname.split('/').filter(Boolean);
    const masked = segments.map(() => '***').join('/');
    return `${url.protocol}//${url.host}/${masked}`;
  } catch {
    return '(redacted)';
  }
}

export function buildNtfyMessage(
  payload: NotifyEventPayload,
  config: NotifyConfig
): { title: string; body: string; priority: number; tag: string } {
  const meta = EVENT_META[payload.kind] ?? { label: 'Notification', tag: 'bell', priority: 3 };

  const titleParts = [payload.title || meta.label];
  const model = normalizeWhitespace(payload.model ?? '');
  if (model) {
    titleParts.push(model);
  }

  const lines: string[] = [clamp(payload.detail ?? '', MAX_DETAIL_CHARS)].filter(Boolean);

  if (config.notifyIncludeExcerpt) {
    const excerpt = normalizeWhitespace(payload.excerpt ?? '');
    if (excerpt) {
      lines.push(`---\n${excerpt.slice(0, MAX_BODY_CHARS)}`);
    }
  }

  const facts: string[] = [];
  const workspace = basename(payload.workspaceDir ?? '');
  if (workspace) {
    facts.push(`workspace: ${workspace}`);
  }
  if (typeof payload.durationMs === 'number' && payload.durationMs > 0) {
    facts.push(`duration: ${(payload.durationMs / 1000).toFixed(1)}s`);
  }
  if (typeof payload.totalTokens === 'number' && payload.totalTokens > 0) {
    facts.push(`tokens: ${payload.totalTokens}`);
  }
  if (facts.length > 0) {
    lines.push(facts.join(' | '));
  }

  const configuredPriority = Number(config.notifyPriority ?? 0);
  const priority =
    configuredPriority >= 1 && configuredPriority <= 5 ? configuredPriority : meta.priority;

  return {
    title: clamp(titleParts.join(' · '), MAX_TITLE_CHARS),
    body: lines.join('\n\n').slice(0, MAX_BODY_CHARS) || meta.label,
    priority,
    tag: meta.tag
  };
}

function eventSelected(payload: NotifyEventPayload, config: NotifyConfig): boolean {
  const events = Array.isArray(config.notifyEvents)
    ? config.notifyEvents.map(entry => String(entry ?? '').trim()).filter(Boolean)
    : [];
  if (events.length === 0) {
    return true;
  }
  return events.includes(payload.kind);
}

function rateLimitKey(payload: NotifyEventPayload): string {
  const fingerprint = normalizeWhitespace(`${payload.title}|${payload.detail ?? ''}`).slice(0, 160);
  return `${payload.kind}::${fingerprint}`;
}

/**
 * Publish to ntfy. Never throws: failures are reported through the returned
 * result (or the thrown error only for the explicit `await`ed test path).
 */
export async function publishNtfy(
  config: NotifyConfig,
  payload: NotifyEventPayload
): Promise<NotifySendResult> {
  const endpoint = resolveNtfyEndpoint(config);
  if (!endpoint) {
    return { ok: false, skipped: true, reason: 'ntfy topic not configured' };
  }

  const message = buildNtfyMessage(payload, config);
  const timeoutMs = Math.max(
    1000,
    Math.min(30000, Number(config.notifyTimeoutMs ?? 0) || FALLBACK_TIMEOUT_MS)
  );

  const response = await axios.post(endpoint, message.body, {
    timeout: timeoutMs,
    maxRedirects: 0,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      Title: message.title,
      Priority: String(message.priority),
      Tags: message.tag
    },
    validateStatus: status => status >= 200 && status < 300
  });

  return { ok: true, status: response.status };
}

/**
 * Fire-and-forget dispatch used by the chat/orchestration handlers.
 * Returns null when nothing was sent (disabled / not selected / rate limited).
 */
export function dispatchNotification(
  config: NotifyConfig | null | undefined,
  payload: NotifyEventPayload
): NotifySendResult | null {
  try {
    if (!config?.notifyEnabled) {
      return null;
    }
    if (!eventSelected(payload, config)) {
      return null;
    }
    // Validate the endpoint up front so a missing/invalid topic reports "nothing
    // sent" instead of optimistically claiming success before the async publish.
    if (!resolveNtfyEndpoint(config)) {
      return null;
    }

    const windowSeconds = Math.max(0, Number(config.notifyRateLimitSeconds ?? 0) || 0);
    if (windowSeconds > 0) {
      const key = rateLimitKey(payload);
      const lastSent = recentSends.get(key) ?? 0;
      if (Date.now() - lastSent < windowSeconds * 1000) {
        return { ok: false, skipped: true, reason: 'rate limited' };
      }
      recentSends.set(key, Date.now());
      if (recentSends.size > 200) {
        const cutoff = Date.now() - 3600000;
        for (const [entry, ts] of recentSends) {
          if (ts < cutoff) {
            recentSends.delete(entry);
          }
        }
      }
    }

    void publishNtfy(config, payload).catch(() => {
      // Intentionally silent: notification delivery must never surface as a
      // chat error. Use the Settings "Send Test" button to diagnose issues.
    });

    return { ok: true };
  } catch {
    return null;
  }
}

/**
 * Explicit, awaited send for the Settings "Send Test" button. Unlike
 * `dispatchNotification`, this reports the real failure reason to the caller.
 */
export async function sendTestNotification(config: NotifyConfig): Promise<NotifySendResult> {
  const endpoint = resolveNtfyEndpoint(config);
  if (!endpoint) {
    return { ok: false, reason: 'Enter a valid ntfy topic (or full https:// URL).' };
  }

  try {
    return await publishNtfy(config, {
      kind: 'chat.completed',
      title: 'Test notification',
      detail: 'LocalCode sent this notification successfully.'
    });
  } catch (error) {
    // Report a status code whenever the thrown error carries one, regardless of
    // whether it is a canonical AxiosError instance.
    const statusCandidate = error as { response?: { status?: number }; code?: string };
    const status = Number(statusCandidate?.response?.status ?? 0);
    if (status >= 100) {
      return { ok: false, status, reason: `ntfy server responded ${status}.` };
    }
    if (axios.isAxiosError(error)) {
      return { ok: false, reason: `Network error: ${error.code || error.message}` };
    }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
