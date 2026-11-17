# External Notifications via ntfy

LocalCode can publish outbound notifications to [ntfy](https://ntfy.sh) when a chat
completion finishes, when the model is blocked waiting for your answer, when a run
errors out, or when an orchestration completes.

This is useful when you kick off a long prompt and walk away: instead of a toast in a
window you are no longer looking at, your phone buzzes.

---

## What ntfy is

ntfy is a tiny pub-sub notification service. A **topic** is a name you invent; publishing
to it is a single HTTP `POST`, and any subscriber (the phone app, the web app, `curl`)
receives it. There is no account and no API key.

```bash
curl -d "Backup finished" ntfy.sh/my-topic
```

Because there is no sign-up, **the topic name is the password**. Anyone who knows it can
read your notifications, so pick something unguessable (see
[the topic name generator](https://ntfy.sh/topicgen) in the ntfy docs).

---

## Setup

### 1. Subscribe on the device that should receive notifications

**Phone (recommended)**

1. Install the ntfy app — [Android (Play Store / F-Droid)](https://ntfy.sh/client) or iOS.
2. Tap **Subscribe**, enter the topic name you plan to use, and leave the server as
   `https://ntfy.sh`.
3. Confirm notifications are allowed for the app in your OS settings.

**Desktop browser**

Open <https://ntfy.sh>, click **Subscribe**, and enter the same topic. Browser
notifications require the tab to stay open.

**Terminal (quick sanity check)**

```bash
ntfy subscribe my-topic
```

### 2. Enable notifications in LocalCode

Open **Settings** (gear icon) and find **External Notifications (ntfy)**:

| Field | Value |
| --- | --- |
| **Send notifications to my ntfy topic** | Check to enable |
| **Topic (or full URL)** | `my-localcode-alerts`, or `https://ntfy.sh/my-localcode-alerts` |
| **Server** | `https://ntfy.sh` (default). Change only for a self-hosted server. |
| **Events** | Which events to send. Leave all unchecked to send every event. |
| **Include a response excerpt** | Off by default. See [privacy](#privacy). |
| **Repeat suppression (s)** | Suppress identical events within this window. Default `15`. |

Then click **Send Test Notification**. A successful send reports `Sent.`; a failure
reports the specific reason (bad topic, `404`, network error).

### 3. Done

Notifications now fire automatically. Settings are stored in the app's local storage and
sent along with each request, so no restart is required.

---

## Which events send what

| Event | Trigger | Default priority |
| --- | --- | --- |
| `chat.completed` | A chat prompt finished successfully | `3` (default) |
| `chat.input_needed` | The model called `query_user` and is waiting for you | `4` (high) |
| `chat.error` | A chat or orchestration run failed | `4` (high) |
| `orchestration.completed` | A simple or advanced orchestration run finished | `3` (default) |

`chat.input_needed` is usually the most valuable one: it is exactly the moment you are
not at the keyboard.

A typical message looks like this:

```
Title:  Chat complete · llama3
Body:   workspace: LocalCode | duration: 42.5s | tokens: 18930
Tags:   ✅
```

User-initiated stops (**Stop Chat**) are treated as intentional and do **not** notify.

---

## Privacy

By default **no model output leaves your machine**. Notifications carry only a title, the
model name, the workspace folder name, elapsed time, token counts, and — for
`input_needed` — the question the model asked.

The **Include a response excerpt** option additionally sends up to ~3,500 characters of
the assistant's reply. Enable it only if that is acceptable for your workload.

Additional guardrails:

- The topic is treated as a secret and is redacted from any log or event output.
- Notifications are configured only by you in Settings. They are **not** exposed as a
  model-callable tool, so a prompt-injected model cannot redirect them to an
  attacker-controlled endpoint or read arbitrary content into them.
- Plain `http://` is accepted only for loopback and private LAN addresses
  (`localhost`, `127.x`, `192.168.x`, `172.16–31.x`); everything else must be `https://`.

---

## Self-hosted ntfy

Point **Server** at your own instance, or put the full URL in **Topic**:

```
Server: https://ntfy.office.example
Topic:  dev-alerts
```

or

```
Topic:  https://ntfy.office.example/dev-alerts
```

Authentication (access tokens / basic auth) is not currently supported by the Settings
UI; run the server without auth on a trusted network, or front it with a reverse proxy.

---

## How it works technically

| Concern | Detail |
| --- | --- |
| Implementation | [`llm-ide/src/backend/notify.ts`](llm-ide/src/backend/notify.ts) |
| Transport | `POST <server>/<topic>` with `Title`, `Priority`, `Tags` headers and a `text/plain` body |
| Process | Electron **main** process, not the renderer |
| Dependencies | None added — reuses the existing `axios` dependency |
| Failure mode | Fire-and-forget with a 5 s timeout; delivery errors never fail or delay a chat |

The main process is used deliberately. The renderer's Content-Security-Policy restricts
`connect-src` to `'self'`, the jsDelivr CDN, and localhost, so a renderer-side `fetch()`
to `ntfy.sh` would be silently blocked. The main process has no such restriction, and it
is also where the completion result and usage stats are available.

Because delivery is fire-and-forget, a dead or slow ntfy server cannot affect prompt
throughput — use **Send Test Notification** to diagnose delivery separately.

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Test reports `404` | The topic name is wrong, or the server expects a path prefix. |
| Test reports a network error | No internet, a firewall blocking `443`, or a wrong server URL. |
| Test says `Sent.` but no phone notification | The phone is subscribed to a **different** topic. Topic names are case-sensitive. |
| Notifications arrive but silently stop | You are sending many identical events inside the **Repeat suppression** window. Lower it or set it to `0` to disable. |
| Nothing arrives even though the test worked | Notifications are enabled per request; confirm the checkbox is still on and the topic is non-empty after saving. |
| Phone notifications are delayed | ntfy free tier can throttle; battery-optimization settings on Android are the usual culprit. |

---

## Related

- [README](README.md) — project overview
- [Toast Notifications](llm-ide/README.md#toast-notifications) — the in-app equivalent
