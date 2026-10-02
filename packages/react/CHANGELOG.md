# Changelog

## 2.2.0 — unreleased

- **Use web SDK 0.4.0.** 2.1.0 depended on `@voxera/sdk-web` `^0.3.0`, and a
  caret range on 0.x never reaches 0.4.0, so React apps were held on 0.3.0 and
  missed its fixes: auto-reconnect that works, and a refused session failing at
  once with the server's code instead of after a 30 s timeout. Error codes
  follow 0.4.0 — ack timeouts are `TIMEOUT` and microphone denial is
  `MEDIA_ACCESS_DENIED`.
- **MIT licensed.** The SDKs were under a commercial license that required a
  signed agreement; they are now MIT. The Voxera service itself is unchanged.
- Source and issues moved to the public
  [voxera-sdks](https://github.com/voxera-voice/voxera-sdks) repository, and the
  contact address is now voicevoxera@gmail.com.

## 2.1.0 — 2026-09-23

- Use web SDK 0.3.0 and expose the updated provider configuration and error types.

## 2.0.0 — unreleased

Rewritten from scratch against `@voxera/sdk-web`. Nothing is carried over from
1.x, which wrapped the retired `@voxera/sdk-core` and no longer talks to the
platform; there is no upgrade path from it, only a reinstall.

- `useVoxera` owns one `VoxeraClient`: lifecycle, subscriptions and teardown.
- Streamed reply chunks merged into one message per reply, with stable ids.
- Connection, conversation and speaking status, caller and agent audio levels,
  live transcript, mute and silence (listen-only) mode.
- `onToolCall` answers a tool call by returning a string, or defers to
  `selectAction` when the result is not ready yet.
- `autoplayBlocked` / `resumeAudio()` recovery for browsers that refuse
  autoplay.
- `"use client"` on both entry points, for the Next.js App Router.
- Re-exports all of `@voxera/sdk-web`, so `VoxeraClient` and the protocol types
  need no second install.
