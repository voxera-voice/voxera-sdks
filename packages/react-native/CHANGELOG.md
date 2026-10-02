# Changelog

## 2.2.3 — unreleased

- **MIT licensed.** The SDKs were under a commercial license that required a
  signed agreement; they are now MIT. The Voxera service itself is unchanged.
- Source and issues moved to the public
  [voxera-sdks](https://github.com/voxera-voice/voxera-sdks) repository, and the
  contact address is now voicevoxera@gmail.com.
- README documents Expo (development build and config plugin; Expo Go is
  not supported) and bare React Native setup.

## 2.2.2 — 2026-09-29

- **Builds outside the Voxera repository.** Earlier releases depended on
  `VoxeraSDK` 1.1.42 and `com.voxera:voxera-sdk-android:1.1.42`, neither of
  which was published anywhere, so `pod install` and the Gradle build failed
  for every app. The bridge now depends on `VoxeraSDK` 1.1.43 from CocoaPods
  trunk and `com.github.voxera-voice:voxera-android:1.1.43` from JitPack, and
  declares the JitPack repository itself.

## 2.2.1 — 2026-09-29

- **iOS can answer tool calls.** 2.2.0 added `selectAction` to the Swift module
  but not to `VoxeraModule.m`, and React Native only sees a Swift method through
  that file — so on iOS the call was undefined and an agent with tools stalled.
  Android was unaffected.
- `npm test` now checks that every method the JS side calls is exported by both
  native modules, with matching iOS selectors.

## 2.2.0 — 2026-09-28

- **Tool calls.** `toolTriggered` now reaches the app and `selectAction` answers
  it, across the TypeScript facade, the native module and both adapters. The
  server pauses a reply until a tool result arrives, so an agent with tools
  previously stalled here with no way for the app to notice; `useVoxera` takes
  an `onToolCall` handler and surfaces an unanswered call as an error rather
  than leaving the caller in silence.
- State and error types are re-exported from `@voxera/protocol` instead of
  being restated. The declarations matched, but nothing kept them matching.
- `VoxeraErrorEvent.code` is a `VoxeraErrorCode` rather than a bare string.
- Podspec version now matches the package; 2.1.0 shipped one claiming 2.0.0.

These changes were meant for 2.1.0 but landed after it was published; the
2.1.0 on npm has no tool-call support.

## 2.1.0 — 2026-09-23

- Adopt protocol 0.3.0 with ElevenLabs TTS configuration and provider/budget error types.

## 2.0.0 — unreleased

**Rewritten on native bindings.** This release replaces the JavaScript WebRTC
implementation with a typed bridge over the native Voxera iOS and Android
SDKs. It is not a drop-in upgrade from 1.x.

The version jumps from the repository's 0.1.0 straight to 2.0.0 because npm's
`latest` tag pointed at 1.0.1 — the previous generation. Publishing below that
would have left `npm install @voxera/sdk-react-native` resolving the old
architecture.

### Breaking

- `react-native-webrtc` is no longer a peer dependency, and must **not** be
  installed alongside this package. The native SDKs resolve their own WebRTC
  runtime; a second copy fails to link on iOS and conflicts at runtime on
  Android.
- `@voxera/sdk-core` is no longer a dependency. Shared types now come from
  `@voxera/protocol`.
- Requires React Native `>=0.76.0` and React `>=18.2.0`.
- Requires the native artifacts: `VoxeraSDK` 1.1.42 (CocoaPods) and
  `com.voxera:voxera-sdk-android:1.1.42` (Maven).

### Added

- `useVoxera` hook: owns the client lifecycle, merges streamed message chunks
  into one entry per reply, and requests the Android microphone permission.
- Camera commands and video track events.
- Expo config plugin at `@voxera/sdk-react-native/app.plugin`.

### Known limitations

- Publishable keys only — there is no `sessionToken` field, unlike the web SDK.
- One active client per React Native bridge.
- Video track events are exposed; the native renderer component is not shipped.
