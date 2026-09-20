import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import {
  buildNtfyMessage,
  dispatchNotification,
  redactNtfyEndpoint,
  resolveNtfyEndpoint,
  sendTestNotification,
  type NotifyConfig,
  type NotifyEventPayload
} from '../backend/notify';

interface MockPostResponse {
  status: number;
  data: string;
}

interface AxiosPostCapture {
  url: string;
  body: string;
  options: { headers?: Record<string, string> };
}

/**
 * Replace axios.post for a single test and restore afterward.
 * Side effects: mutates axios.post during callback execution only.
 */
async function withMockedAxiosPost(
  impl: (...args: unknown[]) => Promise<MockPostResponse>,
  callback: () => Promise<void>
): Promise<void> {
  const axiosRef = axios as unknown as { post: (...args: unknown[]) => Promise<MockPostResponse> };
  const originalPost = axiosRef.post;
  axiosRef.post = impl;
  try {
    await callback();
  } finally {
    axiosRef.post = originalPost;
  }
}

/**
 * dispatchNotification is fire-and-forget; resolve once the mocked post lands.
 */
function waitForPost(capture: { called: boolean; value?: AxiosPostCapture }): Promise<AxiosPostCapture> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (capture.value) {
        resolve(capture.value);
        return;
      }
      if (Date.now() - started > 2000) {
        reject(new Error('timed out waiting for ntfy publish'));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

function completionPayload(overrides?: Partial<NotifyEventPayload>): NotifyEventPayload {
  return {
    kind: 'chat.completed',
    title: 'Chat complete',
    excerpt: 'All done. The build passes with zero errors.',
    model: 'llama3',
    workspaceDir: '/home/dan/git/LocalCode',
    durationMs: 4200,
    totalTokens: 1234,
    ...overrides
  };
}

test('resolveNtfyEndpoint builds a publish URL from a bare topic', () => {
  assert.equal(
    resolveNtfyEndpoint({ notifyNtfyTopic: 'my-localcode-alerts' }),
    'https://ntfy.sh/my-localcode-alerts'
  );
});

test('resolveNtfyEndpoint honors a custom self-hosted server', () => {
  assert.equal(
    resolveNtfyEndpoint({ notifyNtfyTopic: 'alerts', notifyNtfyServer: 'https://ntfy.home.arpa' }),
    'https://ntfy.home.arpa/alerts'
  );
  assert.equal(
    resolveNtfyEndpoint({ notifyNtfyTopic: 'alerts', notifyNtfyServer: 'ntfy.home.arpa' }),
    'https://ntfy.home.arpa/alerts'
  );
});

test('resolveNtfyEndpoint accepts a full URL and strips trailing slashes', () => {
  assert.equal(
    resolveNtfyEndpoint({ notifyNtfyTopic: 'https://ntfy.sh/dan-phone/' }),
    'https://ntfy.sh/dan-phone'
  );
});

test('resolveNtfyEndpoint returns null for empty or non-http topics', () => {
  assert.equal(resolveNtfyEndpoint({}), null);
  assert.equal(resolveNtfyEndpoint({ notifyNtfyTopic: '   ' }), null);
  assert.equal(resolveNtfyEndpoint(null), null);
  assert.equal(resolveNtfyEndpoint({ notifyNtfyTopic: 'file:///etc/passwd' }), null);
  assert.equal(resolveNtfyEndpoint({ notifyNtfyTopic: 'javascript:alert(1)' }), null);
});

test('resolveNtfyEndpoint only allows plain http for loopback or LAN hosts', () => {
  assert.equal(
    resolveNtfyEndpoint({ notifyNtfyTopic: 'http://127.0.0.1:8080/alerts' }),
    'http://127.0.0.1:8080/alerts'
  );
  assert.equal(
    resolveNtfyEndpoint({ notifyNtfyTopic: 'http://192.168.1.50:8080/alerts' }),
    'http://192.168.1.50:8080/alerts'
  );
  assert.equal(resolveNtfyEndpoint({ notifyNtfyTopic: 'http://evil.example.com/alerts' }), null);
});

test('redactNtfyEndpoint masks the topic so it can be logged safely', () => {
  assert.equal(redactNtfyEndpoint('https://ntfy.sh/supersecrettopic'), 'https://ntfy.sh/***');
  assert.equal(redactNtfyEndpoint(null), '(not configured)');
});

test('buildNtfyMessage omits response text unless excerpt mode is enabled', () => {
  const config: NotifyConfig = { notifyEnabled: true, notifyNtfyTopic: 'alerts' };

  const secure = buildNtfyMessage(completionPayload(), config);
  assert.ok(!secure.body.includes('All done'), 'body must not contain response text by default');
  assert.match(secure.body, /workspace: LocalCode/);
  assert.match(secure.body, /duration: 4\.2s/);
  assert.match(secure.body, /tokens: 1234/);
  assert.equal(secure.title, 'Chat complete · llama3');
  assert.equal(secure.priority, 3);

  const verbose = buildNtfyMessage(completionPayload(), { ...config, notifyIncludeExcerpt: true });
  assert.match(verbose.body, /All done\. The build passes/);
});

test('buildNtfyMessage raises priority for input-needed and error events', () => {
  const config: NotifyConfig = { notifyEnabled: true, notifyNtfyTopic: 'alerts' };

  const inputNeeded = buildNtfyMessage(
    completionPayload({ kind: 'chat.input_needed', detail: 'Which provider should I use?' }),
    config
  );
  assert.equal(inputNeeded.priority, 4);
  assert.match(inputNeeded.body, /Which provider should I use\?/);

  const failure = buildNtfyMessage(
    completionPayload({ kind: 'chat.error', detail: 'ECONNREFUSED' }),
    config
  );
  assert.equal(failure.priority, 4);
  assert.equal(failure.tag, 'warning');

  const explicit = buildNtfyMessage(completionPayload(), { ...config, notifyPriority: 5 });
  assert.equal(explicit.priority, 5);
});

test('buildNtfyMessage collapses whitespace and truncates oversized excerpts', () => {
  const config: NotifyConfig = { notifyEnabled: true, notifyNtfyTopic: 'alerts', notifyIncludeExcerpt: true };
  const huge = `${'x'.repeat(9000)}\n\nwith newline`;
  const message = buildNtfyMessage(completionPayload({ excerpt: huge }), config);

  assert.ok(message.body.length <= 3500);
  assert.ok(!message.body.includes('\n\nwith newline'), 'raw newlines from the excerpt are contained');
});

test('dispatchNotification is a no-op when notifications are disabled or unconfigured', async () => {
  let posted = false;
  await withMockedAxiosPost(async () => {
    posted = true;
    return { status: 200, data: '' };
  }, async () => {
    assert.equal(dispatchNotification({}, completionPayload()), null);
    assert.equal(
      dispatchNotification({ notifyEnabled: true }, completionPayload()),
      null,
      'missing topic must not attempt a send'
    );
    assert.equal(
      dispatchNotification(
        { notifyEnabled: true, notifyNtfyTopic: 'alerts', notifyEvents: ['chat.error'] },
        completionPayload()
      ),
      null,
      'unselected event must not send'
    );
  });
  assert.equal(posted, false);
});

test('dispatchNotification publishes title, priority, and tags to ntfy', async () => {
  const captured: { called: boolean; value?: AxiosPostCapture } = { called: false };

  await withMockedAxiosPost(async (...args) => {
    captured.value = {
      url: String(args[0]),
      body: String(args[1]),
      options: (args[2] ?? {}) as { headers?: Record<string, string> }
    };
    return { status: 200, data: '' };
  }, async () => {
    const result = dispatchNotification(
      { notifyEnabled: true, notifyNtfyTopic: 'unique-topic-dispatch-test' },
      completionPayload({ title: 'Dispatch unique', detail: 'unique-detail-body' })
    );
    assert.equal(result?.ok, true);

    const request = await waitForPost(captured);
    assert.equal(request.url, 'https://ntfy.sh/unique-topic-dispatch-test');
    assert.equal(request.options.headers?.Title, 'Dispatch unique · llama3');
    assert.equal(request.options.headers?.Priority, '3');
    assert.equal(request.options.headers?.Tags, 'white_check_mark');
    assert.ok(!request.body.includes('All done'), 'response text stays local by default');
  });
});

test('dispatchNotification rate-limits repeated identical events', async () => {
  let postCount = 0;
  const captured: { called: boolean; value?: AxiosPostCapture } = { called: false };

  await withMockedAxiosPost(async (...args) => {
    postCount += 1;
    captured.value = {
      url: String(args[0]),
      body: String(args[1]),
      options: (args[2] ?? {}) as { headers?: Record<string, string> }
    };
    return { status: 200, data: '' };
  }, async () => {
    const config: NotifyConfig = {
      notifyEnabled: true,
      notifyNtfyTopic: 'unique-topic-ratelimit',
      notifyRateLimitSeconds: 60
    };
    const payload = completionPayload({ title: 'Rate limit probe', detail: 'same-detail' });

    assert.equal(dispatchNotification(config, payload)?.ok, true);
    const second = dispatchNotification(config, payload);
    assert.equal(second?.skipped, true);
    assert.equal(second?.reason, 'rate limited');

    // A different event kind is a distinct key and still sends.
    const other = dispatchNotification(config, completionPayload({ kind: 'chat.error', detail: 'boom' }));
    assert.equal(other?.ok, true);
  });

  assert.equal(postCount, 2);
});

test('dispatchNotification never throws when the transport fails', async () => {
  const captured: { called: boolean; value?: AxiosPostCapture } = { called: false };

  await withMockedAxiosPost(async (...args) => {
    captured.value = { url: String(args[0]), body: '', options: {} };
    throw new Error('ECONNREFUSED ntfy.sh:443');
  }, async () => {
    const result = dispatchNotification(
      { notifyEnabled: true, notifyNtfyTopic: 'unique-topic-failing' },
      completionPayload({ title: 'Transport failure', detail: 'will-fail' })
    );
    // Reported as dispatched: delivery errors are swallowed so a chat never fails.
    assert.equal(result?.ok, true);
    await waitForPost(captured);
  });
});

test('sendTestNotification reports the real failure reason to the UI', async () => {
  const missingTopic = await sendTestNotification({ notifyEnabled: true });
  assert.equal(missingTopic.ok, false);
  assert.match(missingTopic.reason ?? '', /valid ntfy topic/);

  await withMockedAxiosPost(async () => {
    const error = new Error('Request failed') as Error & { response?: { status: number } };
    error.response = { status: 404 };
    throw error;
  }, async () => {
    const result = await sendTestNotification({ notifyEnabled: true, notifyNtfyTopic: 'nope' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.match(result.reason ?? '', /404/);
  });

  await withMockedAxiosPost(async () => ({ status: 200, data: '' }), async () => {
    const result = await sendTestNotification({ notifyEnabled: true, notifyNtfyTopic: 'works' });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  });
});
