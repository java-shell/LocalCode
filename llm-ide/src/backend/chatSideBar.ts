import type { ChatMessage, ChatSideBarResult, ChatSideBarState } from '../shared/types';

/**
 * One run's cooperative pause gate. Only a completed tool batch may enter it.
 * A single reply runs at a time; resume is refused while it is in flight.
 * No polling, tools, provider credentials, or disk I/O live here. The caller
 * persists exchanges and owns the AbortSignal used by provider requests.
 */
export class ChatSideBar {
  private mode: ChatSideBarState['mode'] = 'running';
  private busy = false;
  private release?: () => void;
  private reply?: (content: string) => Promise<string>;
  readonly transcript: ChatMessage[] = [];

  /** Bind this gate to its run and forward metadata-only state changes. */
  constructor(
    private readonly sessionId: string,
    private readonly onState: (state: ChatSideBarState) => void
  ) {}

  /** Return a detached metadata snapshot for validation and UI events. */
  get state(): ChatSideBarState {
    return { sessionId: this.sessionId, mode: this.mode, busy: this.busy };
  }

  /** Publish O(1) UI state; conversation content is deliberately excluded. */
  private emit(): void {
    this.onState(this.state);
  }

  /** Request a pause without interrupting an in-flight model request or tool. */
  start(): ChatSideBarResult {
    if (this.mode === 'closed') return { accepted: false, reason: 'run_closed' };
    if (this.mode === 'running') {
      this.mode = 'pending';
      this.emit();
    }
    return { accepted: true };
  }

  /**
   * Await explicit resume at a coherent history boundary. Abort releases the
   * waiter and removes its listener; the LLM loop checks cancellation next.
   * The reply callback retains the live history, not a stale renderer snapshot.
   */
  async atBoundary(reply: (content: string) => Promise<string>, signal?: AbortSignal): Promise<void> {
    if (this.mode !== 'pending' || signal?.aborted) return;
    this.reply = reply;
    let onAbort: () => void = () => {};
    await new Promise<void>(resolve => {
      this.release = resolve;
      onAbort = () => resolve();
      signal?.addEventListener('abort', onAbort, { once: true });
      this.mode = 'paused';
      this.emit();
    });
    // close() also releases the gate; removing a missing listener is safe.
    signal?.removeEventListener('abort', onAbort);
    this.release = undefined;
    this.reply = undefined;
  }

  /** Resume/cancel a pending pause only when no Side-Bar response is running. */
  resume(): ChatSideBarResult {
    if (this.busy) return { accepted: false, reason: 'reply_in_progress' };
    if (this.mode === 'closed') return { accepted: false, reason: 'run_closed' };
    this.mode = 'running';
    this.emit();
    this.release?.();
    return { accepted: true };
  }

  /**
   * Generate exactly one text reply. Reject invalid/parallel sends, propagate
   * provider errors to the requester, and leave the work run paused for retry.
   * Successful pairs are retained for internal-server retry continuity.
   */
  async message(content: string): Promise<ChatSideBarResult> {
    if (this.mode !== 'paused' || !this.reply) return { accepted: false, reason: 'not_paused' };
    if (this.busy) return { accepted: false, reason: 'reply_in_progress' };
    const text = String(content ?? '').trim();
    if (!text || text.length > 100000) return { accepted: false, reason: 'invalid_content' };
    this.busy = true;
    this.emit();
    try {
      const answer = await this.reply(text);
      if (this.state.mode === 'closed') throw new Error('Chat request canceled');
      this.transcript.push(
        { role: 'user', content: text, sideBar: true },
        { role: 'assistant', content: answer, sideBar: true }
      );
      return { accepted: true, text: answer };
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Release any waiter on stop/failure/completion; repeated cleanup is safe. */
  close(): void {
    this.mode = 'closed';
    this.emit();
    this.release?.();
  }
}