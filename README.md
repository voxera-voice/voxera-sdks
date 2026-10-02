# Voxera SDKs

Client SDKs for [Voxera](https://voxera-voice.com), realtime voice AI for
developers. Add a voice agent the caller can talk to and interrupt: WebRTC
transport, streaming speech-to-text, your language model and text-to-speech
run as one service, and these packages connect your app to it.

| Package | npm | Source |
| --- | --- | --- |
| Web (browser) | [`@voxera/sdk-web`](https://www.npmjs.com/package/@voxera/sdk-web) | [`packages/web`](packages/web) |
| React | [`@voxera/sdk-react`](https://www.npmjs.com/package/@voxera/sdk-react) | [`packages/react`](packages/react) |
| React Native (iOS + Android, Expo) | [`@voxera/sdk-react-native`](https://www.npmjs.com/package/@voxera/sdk-react-native) | [`packages/react-native`](packages/react-native) |
| Wire protocol types | [`@voxera/protocol`](https://www.npmjs.com/package/@voxera/protocol) | [`packages/protocol`](packages/protocol) |

Native SDKs live in their own repositories:
[iOS](https://github.com/voxera-voice/voxera-ios) (CocoaPods / SwiftPM) and
[Android](https://github.com/voxera-voice/voxera-android) (JitPack).

## Get started

1. Create an agent and a publishable key at [app.voxera-voice.com](https://app.voxera-voice.com/signup) — free, no card.
2. Install the SDK for your platform and follow its README.
3. Or try it first in the browser: [demo.voxera-voice.com](https://demo.voxera-voice.com).

## Issues and questions

Bug reports and feature requests: [open an issue](https://github.com/voxera-voice/voxera-sdks/issues).
Anything else: voicevoxera@gmail.com.

## About this repository

This is a read-only mirror, synced from Voxera's main repository on every
release. Each published version is tagged `<package>@<version>`, for example
`sdk-web@0.4.1`. Pull requests are welcome as proposals; accepted changes land
upstream and come back here with the next sync.

## License

MIT — see [LICENSE](LICENSE).
