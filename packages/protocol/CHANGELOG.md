# Changelog

## 0.3.2 — unreleased

- **MIT licensed.** The SDKs were under a commercial license that required a
  signed agreement; they are now MIT. The Voxera service itself is unchanged.
- Source and issues moved to the public
  [voxera-sdks](https://github.com/voxera-voice/voxera-sdks) repository, and the
  contact address is now voicevoxera@gmail.com.

## 0.3.1 — 2026-09-29

- **Schemas accept what the types allow.** `init-session-connection` refused
  `language` and `metadata` (it forbids unknown properties) and demanded a UUID
  `agentId`; `command-result` lacked `CAPACITY_LIMIT`, `PROVIDER_UNAVAILABLE`
  and `SPEECH_BUDGET_EXHAUSTED`. `npm run validate` now checks the schemas
  against `src/index.ts`, so they cannot drift apart again unnoticed.
- `language` is documented as it behaves: an invalid tag is ignored and the
  agent's configured language kept, not refused.

## 0.3.0 — 2026-09-23

- Add ElevenLabs TTS configuration types and provider/budget error codes.

## 0.2.0 — unreleased

Additive; nothing is removed, so 0.1.0 consumers keep resolving and working.

- `SERVER_EVENTS.toolTriggered`, the canonical name for the tool-call event,
  plus the legacy alias list naming `justin_action`. Without these an external
  developer cannot subscribe to the event at all.
- `language` on `InitSessionConnection`: a BCP-47 tag, or `"auto"` to detect and
  mirror the caller. Absent leaves whatever the agent was configured with.

## 0.1.0

First public release. Protocol version `1.0`.

- `CLIENT_COMMANDS` / `SERVER_EVENTS` as the single source of truth for every
  wire identifier shared by the server and the SDKs.
- `LEGACY_SERVER_EVENT_ALIASES` for the two events still emitted under both
  their old and current names.
- `InitSessionConnection` handshake type, covering both the session-token and
  publishable-key authorization paths.
- JSON Schemas under `schemas/v1/`, exported as `@voxera/protocol/schemas/*`.
- Dual ESM + CJS build with type declarations.

Note that the package version and `VOXERA_PROTOCOL_VERSION` are separate: the
first tracks releases of this npm package, the second tracks the wire format.
