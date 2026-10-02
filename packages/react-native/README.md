# @voxera/sdk-react-native

Add a talking AI agent to a React Native app. The caller speaks, the agent
answers out loud, and either can interrupt the other.

Voxera runs the whole voice pipeline — WebRTC transport, streaming
speech-to-text, your language model, and text-to-speech — as one service. This
package is a typed bridge over the native iOS and Android SDKs, so media and
signalling run natively; it deliberately does **not** ship a second JavaScript
WebRTC stack.

```bash
npm install @voxera/sdk-react-native
```

Requires React `>=18.2.0` and React Native `>=0.76.0`.

## A voice screen

`useVoxera` owns the client, its subscriptions and the Android microphone
permission, and merges streamed chunks into one entry per reply.

```tsx
import { useVoxera } from "@voxera/sdk-react-native";

export function VoiceScreen() {
  const { start, leave, isActive, messages, speakingState } = useVoxera();

  return (
    <View>
      <Text>{speakingState === "ai" ? "Agent speaking" : "Listening"}</Text>
      <Button
        title={isActive ? "End call" : "Start call"}
        onPress={() =>
          isActive
            ? leave()
            : start({
                appKey: "vx_pk_live_...",
                serverUrl: "https://rtc.voxera-voice.com",
                agentId: "your-agent-id",
              })
        }
      />
      {messages.map((m) => (
        <Text key={m.id}>{m.content}</Text>
      ))}
    </View>
  );
}
```

The agent's prompt, voice and tools live on the published agent version, so
changing how it behaves does not mean shipping a new build.

## What the hook gives you

| | |
| --- | --- |
| `start` / `leave` | begin or end a call |
| `isActive`, `isBusy` | in a call; a transition is in flight |
| `connectionState`, `conversationState`, `speakingState` | live status |
| `messages`, `transcript` | replies with chunks merged; live speech-to-text |
| `audioLevel`, `aiAudioLevel` | loudness, for a meter |
| `isMuted`, `toggleMute` | microphone control |
| `sendMessage` | send text into a voice conversation |
| `error`, `clearError` | last failure, and a way to dismiss it |
| `client` | the underlying client, for anything the hook does not wrap |

## Language

The agent answers in whatever language the caller speaks, and follows them if
they switch mid-call. Nothing to configure.

Pass `language` when you already know it — on mobile the device locale usually
is that answer:

```tsx
import { NativeModules, Platform } from "react-native";

const deviceLocale =
  Platform.OS === "ios"
    ? NativeModules.SettingsManager.settings.AppleLocale
    : NativeModules.I18nManager.localeIdentifier;

start({
  appKey: "vx_pk_live_...",
  serverUrl: "https://rtc.voxera-voice.com",
  agentId: "your-agent-id",
  language: deviceLocale.replace("_", "-"),   // "ar-EG", "fr-CA", … or "auto"
});
```

A tag makes speech-to-text more accurate and slightly faster, because it no
longer has to work the language out from the first moment of audio. `"auto"`
asks for detection explicitly, which is also how you override an agent that was
pinned to the wrong language.

## Keys

Two credentials, and the difference matters:

- **Publishable** (`vx_pk_*`) — safe to ship in a bundle, restricted to an
  allowlist you set when creating the key.
- **Secret** (`vx_sk_*`) — server only. Exchanges for a short-lived session
  token the app uses instead. Never put one in a bundle.

## Platform setup

The package contains native code, so it needs a native build. Requires iOS
15.0+ and Android `minSdk` 24+. The native SDKs are fetched for you:

- **iOS** — `VoxeraSDK` from CocoaPods trunk, via the package's podspec.
- **Android** — `com.github.voxera-voice:voxera-android` from JitPack. The
  package declares the JitPack repository itself; you do not add it.

### Expo

**Expo Go is not supported** — it cannot load native modules that are not
bundled into it. Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/).

Add the config plugin to `app.json`. It writes the microphone permission to
`Info.plist` and the Android manifest:

```json
{
  "expo": {
    "plugins": [
      [
        "@voxera/sdk-react-native/app.plugin",
        { "microphonePermission": "Talk to the assistant by voice." }
      ]
    ]
  }
}
```

Note the `/app.plugin` suffix — the bare package name does not resolve as a
plugin. Then build:

```bash
npx expo prebuild
npx expo run:ios        # or: npx expo run:android
```

### Bare React Native

Autolinking picks the module up. On iOS, install the pods:

```bash
cd ios && pod install
```

Then declare microphone permission yourself:

- **iOS** — `NSMicrophoneUsageDescription` in `Info.plist`
- **Android** — `RECORD_AUDIO` in `AndroidManifest.xml`

On Android the hook requests the permission at runtime unless you pass
`requestMicrophonePermission: false`.

## Links

- [Live demo](https://demo.voxera-voice.com) — talk to an agent in your browser
- [voxera-voice.com](https://voxera-voice.com) — pricing, SDKs, how it works
- [Dashboard](https://app.voxera-voice.com) — create an agent and a key

Also available for [Web](https://www.npmjs.com/package/@voxera/sdk-web),
[React](https://www.npmjs.com/package/@voxera/sdk-react), iOS and Android, with
Flutter coming. All share one wire protocol, so an agent configured once
behaves the same everywhere.

## Licence

MIT — see [LICENSE](LICENSE).
