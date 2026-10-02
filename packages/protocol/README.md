# @voxera/protocol

The wire contract shared by the Voxera voice server and every client SDK — web,
React Native, Flutter, iOS, and Android. Event names, command names, payload
types, and JSON Schemas live here and nowhere else.

This package exists so that a rename in one codebase cannot silently break
another. Anything sent over the socket has a name defined in this file, and
that name is a wire identifier: it does not change because the product,
directory, or class was renamed.

- **Protocol version:** `1.0` (`VOXERA_PROTOCOL_VERSION`)
- **Transport:** socket.io for signalling, mediasoup/WebRTC for media
- **No runtime dependencies**

## Installing

```bash
npm install @voxera/protocol
```

Most people never install this directly — it arrives as a dependency of
[`@voxera/sdk-web`](https://www.npmjs.com/package/@voxera/sdk-web) or
[`@voxera/sdk-react-native`](https://www.npmjs.com/package/@voxera/sdk-react-native),
and those re-export what a client needs. Install it on its own when you are
writing a client of your own, or a server that talks to one, and want the event
names and payload types rather than string literals.

```ts
import {
  CLIENT_COMMANDS,
  SERVER_EVENTS,
  type ConversationMessage,
  type InitSessionConnection,
} from "@voxera/protocol";

socket.on(SERVER_EVENTS.toolTriggered, handleToolCall);
socket.emit(CLIENT_COMMANDS.conversationStart, { sessionId });
```

Inside this repository the same package is linked from source, so a change to a
wire type reaches every consumer without a publish. The iOS, Android and Flutter
SDKs do not consume the TypeScript package — they mirror the same constants in
their own languages, which is why a change here is a change to five codebases.

### Rebuild after editing wire types

`dist/` is gitignored and produced by the build. A `file:` dependency resolves
to the directory as it is on disk, so consumers keep compiling against the
previous `dist/` until it is rebuilt:

```bash
npm run build      # emits ESM + CJS + .d.ts
npm test           # == npm run validate
```

Editing `src/index.ts` and rebuilding only the consumer is the most common way
to get a confusing type error that disappears on a second, unrelated build.

## What it exports

```ts
import {
  VOXERA_PROTOCOL_VERSION,
  CLIENT_COMMANDS,
  SERVER_EVENTS,
  LEGACY_SERVER_EVENT_ALIASES,
  type InitSessionConnection,
  type ConversationMessage,
  type JsonValue,
} from "@voxera/protocol";

socket.emit(CLIENT_COMMANDS.conversationStart);
socket.on(SERVER_EVENTS.transcriptUpdate, handleTranscript);
```

Import the constants rather than writing the strings. A typo in a string
literal is a silent no-op — the server simply never receives the command, and
nothing errors.

| Export | Purpose |
| --- | --- |
| `CLIENT_COMMANDS` | Every command a client may emit. `server/src/mediasoup/mediasoup.gateway.ts` subscribes to exactly these. |
| `SERVER_EVENTS` | Every event the server emits. |
| `LEGACY_SERVER_EVENT_ALIASES` | Old names still emitted alongside the current ones, for clients that have not migrated. New clients must not listen for these. |
| `InitSessionConnection` | The session handshake payload — see below. |
| `TranscriptionConfig`, `ModelConfig`, `TtsConfig` | Provider stage configuration. |
| `FunctionToolDefinition` | Tool/function-calling schema. |
| `ConversationMessage`, `InitialMessage` | Conversation history shapes. |
| `ProtocolCapabilities` | What the connected server supports. |

### JSON Schemas

For consumers that validate at runtime, or that are not written in TypeScript:

```ts
import initSchema from "@voxera/protocol/schemas/v1/init-session-connection.schema.json";
```

`schemas/v1/` holds `init-session-connection.schema.json`,
`command-result.schema.json`, and a `manifest.json` listing them. `npm run
validate` checks the schemas against the TypeScript types, and runs as part of
`prepack`.

### Legacy aliases

```ts
LEGACY_SERVER_EVENT_ALIASES = {
  newProducer: ["newProducer"],   // current: "new-producer"
  clearAction: ["clear-action"],
}
```

The server emits both spellings. These exist to keep already-shipped mobile
builds working and will be removed once those versions are out of support.

## Session authorization

`init-session-connection` is the first command of every session and decides
what the session is allowed to do. It accepts **one of two** credentials:

```ts
// Preferred. Your backend exchanges its secret key for a short-lived token.
{ sessionToken: "...", sessionId: "..." }

// Direct-client. A publishable key, optionally pinned to one agent.
{ appKey: "vx_pk_...", agentId: "..." }
```

A **secret key (`vx_sk_*`) must never appear here.** The control plane refuses
one that arrives through a client — once a secret key has passed through a
browser or an app binary it is no longer secret. Secret keys are for
`POST /api/v1/sessions/token` from your own backend, nothing else.

### The server decides the pipeline, not the client

`InitSessionConnection` carries `transcriptionConfig`, `modelConfig`,
`ttsConfig`, `tools`, `additionalSystemPrompts`, `selectedModel`, and
`selectedVoice`. **On a managed session these are overwritten by the published
agent version before they are read.** Setting them changes nothing.

The exceptions are `tools` and `additionalSystemPrompts`, which are merged with
the agent's own only when that agent version's `runtimePolicy` sets
`allowRuntimeTools` / `allowRuntimePrompts`. Everything else is taken from the
immutable agent snapshot returned by the control plane.

These fields remain in the type because the legacy direct-configuration path —
where a client supplies its own provider config against a server-side
`APP_KEY` — still exists for migration. New integrations should configure the
agent in the manager application and send none of them.

### Untrusted by construction

`userInfo`, `user`, `metadata`, and `chatProfile` are caller-supplied and reach
the assistant as conversation context. They are **data, not instructions**:
anything a user can influence can attempt prompt injection through these
fields. Do not put authorization decisions behind values that arrive here.

## Related

- `server/README.md` — how the server consumes the handshake
- `persistence-service/README.md` — how tokens and app keys are minted
- `pkg/web/README.md` — the reference TypeScript client
