/*
 * The wire vocabulary is re-exported from @voxera/protocol rather than
 * restated here. These were duplicated declarations that happened to match;
 * nothing made them keep matching, so a protocol change would have drifted
 * silently past the type checker and only shown up at runtime.
 *
 * The Voxera* names stay as aliases: they are this package's public API.
 */
export type {
  JsonPrimitive,
  JsonValue,
  VoxeraErrorCode,
} from "@voxera/protocol";

import type {
  ConnectionStatus,
  ConversationStatus,
  JsonValue,
  SpeakingStatus,
  VoxeraErrorCode,
} from "@voxera/protocol";

export interface VoxeraVideoConfig {
  enabled?: boolean;
  width?: number;
  height?: number;
  frameRate?: number;
  enableVideoAI?: boolean;
  useFrontCamera?: boolean;
}

export interface VoxeraConnectionOptions {
  autoReconnect?: boolean;
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
  timeoutMs?: number;
}

export interface VoxeraConfig {
  appKey: string;
  serverUrl: string;
  agentId?: string;
  userId?: string;
  sessionId?: string;
  threadId?: string;
  chatProfile?: Record<string, JsonValue>;
  user?: Record<string, JsonValue>;
  metadata?: Record<string, string>;
  ttsConfig?: Record<string, JsonValue>;
  transcriptionConfig?: Record<string, JsonValue>;
  initialMessages?: Array<Record<string, JsonValue>>;
  selectedModel?: string;
  selectedVoice?: string;
  workspaceId?: string;
  username?: string;
  userInfo?: Record<string, string>;
  /**
   * Conversation language: a BCP-47 tag such as "ar", "ar-EG" or "fr-CA", or
   * "auto" to detect it from the caller's speech and reply in the same
   * language.
   *
   * For an app that follows the device, react-native-localize's
   * `getLocales()[0].languageCode` (or `NativeModules` locale) is the value to
   * pass. Leaving it unset keeps whatever the published agent was configured
   * with.
   */
  language?: string;
  videoConfig?: VoxeraVideoConfig;
  connectionOptions?: VoxeraConnectionOptions;
}

export type {
  ConnectionStatus as VoxeraConnectionState,
  ConversationStatus as VoxeraConversationState,
  SpeakingStatus as VoxeraSpeakingState,
} from "@voxera/protocol";

export interface VoxeraMessage {
  id: string;
  messageId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  fullText?: string;
  isFinal: boolean;
  metadata?: Record<string, JsonValue>;
}

export interface VoxeraErrorEvent {
  /*
   * A VoxeraErrorCode, not a bare string: PROVIDER_UNAVAILABLE and
   * SPEECH_BUDGET_EXHAUSTED are the agent's provider failing rather than the
   * caller's credential, and an app that cannot tell them apart shows the
   * wrong recovery to the user. Widened to string so an older client still
   * compiles against a server that has learned a new code.
   */
  code: VoxeraErrorCode | (string & {});
  message: string;
  details?: Record<string, JsonValue>;
}

/**
 * A tool the model asked the app to run.
 *
 * The server stops the reply on this event and does not resume it until a
 * result arrives, because the conversation context needs an
 * assistant(tool_calls) -> tool pairing to stay well formed. An app that
 * ignores a tool call leaves the caller in silence, so answer every one with
 * `selectAction(actionId, result)`.
 */
export interface VoxeraToolCall {
  /** Pass back to `selectAction` to pair the result with this call. */
  actionId: string;
  name: string;
  /** The model's arguments, already decoded from the wire's JSON string. */
  arguments: JsonValue;
  messageId: string;
}

export interface VoxeraEventMap {
  connectionState: { status: ConnectionStatus };
  conversationState: { status: ConversationStatus };
  speakingState: { status: SpeakingStatus };
  toolTriggered: VoxeraToolCall;
  message: VoxeraMessage;
  transcript: { text: string; isFinal: boolean };
  error: VoxeraErrorEvent;
  audioLevel: { level: number };
  aiAudioLevel: { level: number };
  muteChanged: { muted: boolean };
  localVideoTrack: { trackId: string | null };
  remoteAudioTrack: { trackId: string | null };
  remoteVideoTrack: { trackId: string | null };
}

export type VoxeraEventName = keyof VoxeraEventMap;

export interface VoxeraSubscription {
  remove(): void;
}
