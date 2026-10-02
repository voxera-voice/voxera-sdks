# @voxera/sdk-react

Add a talking AI agent to a React app. The caller speaks, the agent answers out
loud, and either can interrupt the other.

Voxera runs the whole voice pipeline — WebRTC transport, streaming
speech-to-text, your language model, and text-to-speech — as one service. This
package wraps the browser client in a hook, so a component gets plain values and
actions and never has to manage a client, its subscriptions, or its teardown.

```bash
npm install @voxera/sdk-react
```

`@voxera/sdk-web` comes with it and is re-exported, so there is nothing else to
install and nothing else to import.

## Talking in ten lines

```tsx
import { useVoxera } from "@voxera/sdk-react";

export function CallButton() {
  const call = useVoxera();

  if (!call.isActive) {
    return (
      <button
        onClick={() =>
          call.start({
            appKey: "vx_pk_live_...",              // publishable key, safe in a bundle
            serverUrl: "https://rtc.voxera-voice.com",
            agentId: "your-agent-id",              // the agent you published
          })
        }
      >
        Talk to the agent
      </button>
    );
  }

  return <button onClick={call.leave}>End call</button>;
}
```

That is the whole integration. The agent's prompt, voice and tools live on the
published agent version, so changing how it behaves does not mean shipping a new
build.

The hook attaches and plays the agent's audio itself. If a browser blocks
autoplay it sets `autoplayBlocked` rather than failing silently, so you can offer
a tap to resume.

## Following the conversation

`messages` already has streamed chunks merged into one entry per reply, with
stable ids — render it directly as a list.

```tsx
const call = useVoxera();

return (
  <>
    <ul>
      {call.messages.map((m) => (
        <li key={m.id}>
          <b>{m.role}</b> {m.content}
        </li>
      ))}
    </ul>
    {call.transcript && <p aria-live="polite">{call.transcript}</p>}
    <Meter caller={call.audioLevel} agent={call.aiAudioLevel} />
    {call.speakingStatus === "ai" && <p>Agent is speaking…</p>}
  </>
);
```

| Value | What it holds |
| --- | --- |
| `messages` | the conversation, chunks already merged, newest last |
| `transcript` | live speech-to-text for the caller's current turn |
| `connectionStatus` | `idle` → `connecting` → `connected` → `disconnected` |
| `conversationStatus` | `idle` → `starting` → `active` → `ended` |
| `speakingStatus` | `user`, `ai`, `searching` or `none` |
| `audioLevel` / `aiAudioLevel` | loudness 0..1, for a meter |
| `isMuted` / `isSilenced` | microphone off / agent listening but not replying |
| `localStream` / `remoteStream` | the raw tracks, if you want to draw them |
| `autoplayBlocked` | the browser refused to play audio unprompted |
| `isBusy` | a start or leave transition is in flight |
| `error` | the last failure as a string, with `clearError()` to dismiss |

Actions: `start(config)`, `leave()`, `sendMessage(text)`, `toggleMute()`,
`setMuted(muted)`, `toggleSilence()`, `setSilenced(silenced)`,
`startConversation()`, `endConversation()`, `selectAction(actionId, result)` and
`resumeAudio()`. `client` is the underlying `VoxeraClient` for anything the hook
does not wrap.

## Tools

Give the agent tools and it can look something up or take an action
mid-sentence. When it calls one, the server **waits for the result** before
finishing its reply — so every call must be answered exactly once.

Return the result from `onToolCall` and the hook sends it for you:

```tsx
const call = useVoxera({
  onToolCall: async ({ name, arguments: args }) => {
    const result = await runYourTool(name, args);
    return result;                          // sent as the answer
  },
});
```

Return nothing when the answer is not ready yet — a tool whose real result is a
piece of UI, say — and call `call.selectAction(actionId, result)` once it is.
Answering twice desyncs the conversation, so pick one or the other.

The result is free text and reaches the model verbatim, so describe what
happened in terms it can act on — `"booked for Friday 10:00"` rather than
`"200 OK"`.

## Autoplay

Browsers refuse to play audio a user did not ask for. Starting the call from a
click is normally enough; when it is not, the hook tells you:

```tsx
{call.autoplayBlocked && (
  <button onClick={call.resumeAudio}>Tap to hear the agent</button>
)}
```

## Language

The agent answers in whatever language the caller speaks, and follows them if
they switch mid-call. Nothing to configure.

Pass `language` when the caller's language is something you already know — a
device locale, an account preference, a per-market build:

```tsx
call.start({
  appKey: "vx_pk_live_...",
  serverUrl: "https://rtc.voxera-voice.com",
  agentId: "your-agent-id",
  language: navigator.language,   // "ar-EG", "fr-CA", … or "auto"
});
```

A tag makes speech-to-text more accurate and slightly faster, because it no
longer has to work the language out from the first moment of audio.

## Keys

Two credentials, and the difference matters:

- **Publishable** (`vx_pk_*`) — safe to ship in a bundle. Restricted to an
  origin allowlist you set when creating the key. **Set that allowlist**, or the
  key works from any site on the internet.
- **Secret** (`vx_sk_*`) — server only. Exchanges for a short-lived session
  token your client uses instead. Never put one in a bundle.

```tsx
// Your backend
const { token } = await fetch("https://api.voxera-voice.com/api/v1/sessions/token", {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.VOXERA_SECRET_KEY}` },
  body: JSON.stringify({ userId: user.id }),
}).then((r) => r.json());

// Your component
call.start({ sessionToken: token, serverUrl: "..." });
```

## Next.js

The hook needs the browser: microphone, WebRTC and an `<audio>` element. Both
entry points carry `"use client"`, so importing it from a server component is
safe, but the component that calls `useVoxera` must be a client component.

```tsx
"use client";
import { useVoxera } from "@voxera/sdk-react";
```

## Requirements

React 18 or 19. A browser with WebRTC and `getUserMedia`, served over HTTPS or
`localhost` — microphone access is refused outside a secure context. Node 18+ to
build.

## Links

- [Live demo](https://demo.voxera-voice.com) — talk to an agent in your browser
- [voxera-voice.com](https://voxera-voice.com) — pricing, SDKs, how it works
- [Dashboard](https://app.voxera-voice.com) — create an agent and a key

Also available for [Web](https://www.npmjs.com/package/@voxera/sdk-web) without
React, [React Native](https://www.npmjs.com/package/@voxera/sdk-react-native),
iOS and Android, with Flutter coming. All share one wire protocol, so an agent configured
once behaves the same everywhere.

## Licence

MIT — see [LICENSE](LICENSE).
