# Changelog

## 0.4.1 — unreleased

- **MIT licensed.** The SDKs were under a commercial license that required a
  signed agreement; they are now MIT. The Voxera service itself is unchanged.
- Source and issues moved to the public
  [voxera-sdks](https://github.com/voxera-voice/voxera-sdks) repository, and the
  contact address is now voicevoxera@gmail.com.
- README lists the SDKs that are actually available.

## 0.4.0 — 2026-09-29

- **Auto-reconnect works.** The rebuild ran on the manager's `reconnect`, which
  fires before the socket itself is connected, so every reconnect failed with
  "socket is not connected". It now runs on the socket's `connect`. Closing the
  old producers no longer stops the microphone (`stopTracks: false`), an ended
  track is re-acquired, and mute and silence are restored on the new
  participant.
- **A refused session fails at once, with its reason.** A bad key, disallowed
  origin or unsupported protocol version used to wait out the full ack timeout
  (30 s) and surface as `CONNECTION_FAILED: operation has timed out`. `connect()`
  now rejects as soon as the server refuses — through the command's failure ack,
  or its `server-error` on servers that do not ack failures — and reports the
  server's code (`AUTHENTICATION_FAILED`, `CAPACITY_LIMIT`, …) once.
- Behaviour changes to error codes: ack timeouts are `TIMEOUT` (was
  `CONNECTION_FAILED`), and microphone denial is `MEDIA_ACCESS_DENIED` (was the
  DOMException's numeric `code`, usually `0`). Only string codes are reported.
- A failed `connect()` ends in `error`; it no longer flips to `reconnecting`.
- `conversationStatus` now reaches `active` and `ended`: the voice server sends
  `conversation-started` / `conversation-ended` from this release's deploy.

## 0.3.0 — 2026-09-23

- Adopt protocol 0.3.0 types and ship validated voice client behavior with 31 behavioral tests.

## 0.2.0 — unreleased

- Subscribe to the canonical `toolTriggered` server event, via the alias list
  added in `@voxera/protocol` 0.2.0. The dependency range moves to `^0.2.0`:
  0.1.x does not export the constant the client reads.
- `language` on the client config, so a caller's known locale can be passed
  instead of detected.

## 0.1.0

First public release.

- `VoxeraClient` over socket.io signalling and mediasoup/WebRTC transport.
- Session-token and publishable-key authorization.
- Events for state, messages, transcripts, audio levels, tool calls, and
  local/remote media.
- Mute and silence (listen-only) modes.
- Managed remote-audio playback with `autoplayBlocked` / `resumeRemoteAudio()`
  recovery for browsers that refuse autoplay.
