# @voxera/sdk-web

Add a talking AI agent to a web app. The caller speaks, the agent answers out
loud, and either can interrupt the other.

Voxera runs the whole voice pipeline — WebRTC transport, streaming
speech-to-text, your language model, and text-to-speech — as one service. This
package is the browser client for it: it captures the microphone, plays the
reply, and gives you typed events for everything in between.

```bash
npm install @voxera/sdk-web
```

## Talking in ten lines

```ts
import { VoxeraClient } from "@voxera/sdk-web";

const client = new VoxeraClient({
  appKey: "vx_pk_live_...",                 // publishable key, safe in a bundle
  serverUrl: "https://rtc.voxera-voice.com",
  agentId: "your-agent-id",                 // the agent you published
});

await client.connect();
client.startConversation();
```

That is the whole integration. The agent's prompt, voice and tools live on the
published agent version, so changing how it behaves does not mean shipping a
new build.

The SDK attaches and plays the agent's audio itself. If a browser blocks
autoplay it emits `autoplayBlocked` rather than failing silently, so you can
retry on the next user gesture.

## Following the conversation

Every event is typed. `fullText` is the reply so far; `content` is only the
newest delta, so prefer `fullText` when rendering.

```ts
client.on("message", (m) => render(m.role, m.fullText ?? m.content));
client.on("transcript", ({ text, isFinal }) => showCaption(text, isFinal));
client.on("stateChanged", (s) => setStatus(s.speakingStatus));
client.on("audioLevel", ({ level, isAi }) => meter(level, isAi));
client.on("error", (e) => console.error(e.code, e.message));
```

| Event | Fires when |
| --- | --- |
| `stateChanged` | connection, conversation or speaking status moves |
| `message` | a reply streams in, or the caller's turn is transcribed |
| `transcript` | live speech-to-text, before the turn is final |
| `audioLevel` | loudness update, `isAi` says whose |
| `toolTriggered` | the agent called one of your tools |
| `remoteStream` / `remoteTrack` | the agent's audio is ready to attach |
| `autoplayBlocked` | the browser refused to play audio unprompted |
| `error` | a protocol-level failure, with a `code` you can branch on |

## Language

The agent answers in whatever language the caller speaks, and follows them if
they switch mid-call. Nothing to configure.

Pass `language` when the caller's language is something you already know — a
device locale, an account preference, a per-market build:

```ts
new VoxeraClient({
  appKey: "vx_pk_live_...",
  serverUrl: "https://rtc.voxera-voice.com",
  agentId: "your-agent-id",
  language: navigator.language,   // "ar-EG", "fr-CA", … or "auto"
});
```

A tag makes speech-to-text more accurate and slightly faster, because it no
longer has to work the language out from the first moment of audio. `"auto"`
asks for detection explicitly, which is also how you override an agent that was
pinned to the wrong language.

## Tools

Give the agent tools and it can look something up or take an action
mid-sentence. When it calls one, the server **waits for the result** before
finishing its reply — so every `toolTriggered` must be answered exactly once.

```ts
client.on("toolTriggered", async ({ actionId, name, arguments: args }) => {
  const result = await runYourTool(name, args);
  client.selectAction(actionId, result);   // required, or the reply stalls
});
```

The result is free text and reaches the model verbatim, so describe what
happened in terms it can act on — `"booked for Friday 10:00"` rather than
`"200 OK"`.

## Keys

Two credentials, and the difference matters:

- **Publishable** (`vx_pk_*`) — safe to ship in a bundle. Restricted to an
  origin allowlist you set when creating the key. **Set that allowlist**, or
  the key works from any site on the internet.
- **Secret** (`vx_sk_*`) — server only. Exchanges for a short-lived session
  token your client uses instead. Never put one in a bundle.

```ts
// Your backend
const { token } = await fetch("https://api.voxera-voice.com/api/v1/sessions/token", {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.VOXERA_SECRET_KEY}` },
  body: JSON.stringify({ userId: user.id }),
}).then((r) => r.json());

// Your client
new VoxeraClient({ sessionToken: token, serverUrl: "..." });
```

## Requirements

A browser with WebRTC and `getUserMedia`, served over HTTPS or `localhost` —
microphone access is refused outside a secure context. Node 18+ to build.

## Links

- [Live demo](https://demo.voxera-voice.com) — talk to an agent in your browser
- [voxera-voice.com](https://voxera-voice.com) — pricing, SDKs, how it works
- [Dashboard](https://app.voxera-voice.com) — create an agent and a key

Also available for [React](https://www.npmjs.com/package/@voxera/sdk-react),
[React Native](https://www.npmjs.com/package/@voxera/sdk-react-native), iOS and
Android, with Flutter coming. All share one wire protocol, so an agent
configured once behaves the same everywhere.

## Licence

MIT — see [LICENSE](LICENSE).
