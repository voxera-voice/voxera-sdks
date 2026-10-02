/** Stable protocol identity used during capability negotiation. */
export const VOXERA_PROTOCOL = "voxera" as const;
export const VOXERA_PROTOCOL_VERSION = "1.0" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const CLIENT_COMMANDS = {
  initSessionConnection: "init-session-connection",
  getRtpCapabilities: "getRtpCapabilities",
  getIceServers: "getIceServers",
  createTransport: "createTransport",
  connectTransport: "connectTransport",
  produce: "produce",
  consume: "consume",
  leave: "leave",
  conversationStart: "conversation:start",
  conversationEnd: "conversation:end",
  sendMessage: "send-message",
  selectActions: "select-actions",
  muteChanged: "mute-changed",
  speakingChanged: "speaking-changed",
  userSpeakingStatus: "user-speaking-status",
  aiSpeakingStatus: "ai-speaking-status",
  waitingForAiResponse: "waiting-for-ai-response",
  toggleListenMode: "toggle-listen-mode",
  videoFrame: "video-frame",
  stopVideoFrame: "stop-video-frame",
  muteParticipant: "mute-participant",
  muteAll: "mute-all",
  unmuteAll: "unmute-all",
  removeParticipant: "remove-participant",
  lockRoom: "lock-room",
  endMeeting: "end-meeting",
  transferHost: "transfer-host",
  toggleTranscription: "toggle-transcription",
  askAi: "ask-ai",
  cancelAskAi: "cancel-ask-ai",
  askAiText: "ask-ai-text",
  enableWaitingRoom: "enable-waiting-room",
  admitParticipant: "admit-participant",
  denyParticipant: "deny-participant",
  admitAll: "admit-all",
  generateSummary: "generate-summary",
  generateMinutes: "generate-minutes",
  addBookmark: "add-bookmark",
  removeBookmark: "remove-bookmark",
  getBookmarks: "get-bookmarks",
  getTranscript: "get-transcript",
  getSummaries: "get-summaries",
  getMinutes: "get-minutes",
  getModels: "getModels",
} as const;

export const SERVER_EVENTS = {
  serverError: "server-error",
  transportError: "transport-error",
  producerError: "producer-error",
  consumeError: "consume-error",
  newProducer: "new-producer",
  producerClosed: "producer-closed",
  message: "message",
  conversationStarted: "conversation-started",
  conversationEnded: "conversation-ended",
  speakingStatusChanged: "speaking-status-changed",
  volumeChanged: "volume-changed",
  transcriptUpdate: "transcript-update",
  participantJoined: "participant-joined",
  participantLeft: "participant-left",
  participantRemoved: "participant-removed",
  participantsUpdated: "participants-updated",
  youWereMuted: "you-were-muted",
  youWereRemoved: "you-were-removed",
  allMuted: "all-muted",
  allUnmuted: "all-unmuted",
  hostChanged: "host-changed",
  meetingEnded: "meeting-ended",
  roomLockedChanged: "room-locked-changed",
  transcriptionToggled: "transcription-toggled",
  liveTranscription: "live-transcription",
  askAiStarted: "ask-ai-started",
  askAiProcessing: "ask-ai-processing",
  askAiCancelled: "ask-ai-cancelled",
  askAiTextStarted: "ask-ai-text-started",
  askAiTextChunk: "ask-ai-text-chunk",
  askAiTextResponse: "ask-ai-text-response",
  askAiTextError: "ask-ai-text-error",
  waitingRoom: "waiting-room",
  admitted: "admitted",
  denied: "denied",
  waitingRoomUpdated: "waiting-room-updated",
  waitingRoomToggled: "waiting-room-toggled",
  summaryGenerating: "summary-generating",
  summaryGenerated: "summary-generated",
  minutesGenerating: "minutes-generating",
  minutesGenerated: "minutes-generated",
  bookmarkAdded: "bookmark-added",
  bookmarkRemoved: "bookmark-removed",
  /** The assistant called a tool. */
  toolTriggered: "tool-triggered",
  clearAction: "clear_action",
  searching: "searching",
} as const;

/**
 * Temporary aliases accepted during the ROCS-to-Voxera migration. New code
 * must emit and subscribe with the canonical values above.
 */
export const LEGACY_SERVER_EVENT_ALIASES = {
  newProducer: ["newProducer"],
  clearAction: ["clear-action"],
} as const;

export type ClientCommand =
  (typeof CLIENT_COMMANDS)[keyof typeof CLIENT_COMMANDS];
export type ServerEvent =
  (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];

export type ClientType =
  | "web"
  | "ios"
  | "android"
  | "react-native"
  | "flutter";

export interface InitialMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type AiServiceProvider = "openai" | "custom";

/**
 * Speech providers. Superset of `AiServiceProvider`: ElevenLabs is
 * speech-only.
 *
 * Unlike the others it never carries its credential in the config — it names a
 * stored provider connection, and the voice server resolves the key from the
 * control plane at session setup.
 */
export type TtsServiceProvider = AiServiceProvider | "elevenlabs";

export interface TranscriptionConfig {
  [key: string]: JsonValue | undefined;
  provider?: AiServiceProvider;
  /** Alias for provider, retained for clients that use service naming. */
  service?: AiServiceProvider;
  url?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  language?: string;
  model?: string;
  customParams?: Record<string, JsonValue>;
  responseTextPath?: string;
}

export interface ModelConfig {
  [key: string]: JsonValue | undefined;
  provider?: AiServiceProvider;
  service?: AiServiceProvider;
  url?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model?: string;
  stream?: boolean;
  customParams?: Record<string, JsonValue>;
  responseTextPath?: string;
  responseToolCallsPath?: string;
}

export interface TtsConfig {
  [key: string]: JsonValue | undefined;
  provider?: TtsServiceProvider;
  service?: TtsServiceProvider;
  url?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model?: string;
  voiceId?: string;
  language?: string;
  responseFormat?: "mp3" | "wav" | "pcm";
  sampleRate?: number;
  customParams?: Record<string, JsonValue>;
  audioFieldPath?: string;
  /**
   * Stored provider connection holding the credential for this voice. An id,
   * never a key: the config is readable by anyone who can read the agent, so a
   * credential must not live in it.
   */
  connectionId?: string;
  /**
   * Provider-native output format, e.g. ElevenLabs `pcm_24000`. Distinct from
   * `responseFormat`, which is the OpenAI-shaped vocabulary.
   */
  outputFormat?: string;
  /** Provider-native delivery controls (stability, similarity, speed, ...). */
  voiceSettings?: Record<string, JsonValue>;
}

export interface FunctionToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, JsonValue>;
    strict?: boolean;
  };
}

export interface InitSessionConnection {
  sessionId: string;
  /** Legacy/direct-client authorization. Prefer sessionToken in production. */
  appKey?: string;
  /** Short-lived token minted by the Voxera persistence service. */
  sessionToken?: string;
  /** Published voice-agent identifier configured in the manager application. */
  agentId?: string;
  clientType: ClientType;
  protocolVersion: typeof VOXERA_PROTOCOL_VERSION;
  threadId?: string;
  chatProfile?: JsonValue;
  userId?: string;
  username?: string;
  user?: Record<string, JsonValue>;
  userInfo?: Record<string, JsonValue>;
  /**
   * Arbitrary caller-supplied key/values describing the session or user. Like
   * userInfo, these are surfaced to the assistant as conversation context, so
   * treat them as untrusted input rather than instructions.
   */
  metadata?: Record<string, JsonValue>;
  /**
   * Conversation language: a BCP-47 tag such as "ar", "ar-EG" or "fr-CA", or
   * the literal "auto".
   *
   * "auto" — or leaving this unset — means the language is detected from what
   * the caller says and mirrored back. Pinning a tag is worth doing when the
   * caller already knows the language (a device locale, a user preference, a
   * per-market app): speech-to-text is more accurate and slightly faster when
   * it is told the language up front rather than inferring it from the first
   * few hundred milliseconds of audio.
   *
   * This is a session-level setting and overrides any language pinned in the
   * agent's transcription config, because the client knows which human is on
   * this particular call and the agent configuration does not.
   *
   * The server validates this against a strict tag grammar. Anything else is
   * ignored rather than refused — the session keeps the agent's configured
   * language — so a bad value neither fails the call nor reaches the
   * assistant's instructions.
   */
  language?: string;
  ttsConfig?: TtsConfig;
  transcriptionConfig?: TranscriptionConfig;
  modelConfig?: ModelConfig;
  tools?: FunctionToolDefinition[];
  additionalSystemPrompts?: string[];
  initialMessages?: InitialMessage[];
  selectedModel?: string;
  selectedVoice?: string;
  workspaceId?: string;
  clientDateTime?: string;
}

export interface ProtocolCapabilities {
  protocol: typeof VOXERA_PROTOCOL;
  version: typeof VOXERA_PROTOCOL_VERSION;
  features: string[];
  legacyEventAliases?: boolean;
}

export interface CommandSuccess<T = JsonValue> {
  ok: true;
  data: T;
}

export interface CommandFailure {
  ok: false;
  error: VoxeraProtocolError;
}

export type CommandResult<T = JsonValue> =
  | CommandSuccess<T>
  | CommandFailure;

export type VoxeraErrorCode =
  | "CONNECTION_FAILED"
  | "AUTHENTICATION_FAILED"
  /**
   * The tenant is already running as many concurrent calls as its plan allows.
   * Distinct from AUTHENTICATION_FAILED: the credential is fine and retrying
   * shortly is the right response, which a caller cannot tell from the message
   * alone.
   */
  | "CAPACITY_LIMIT"
  | "WEBRTC_ERROR"
  | "MEDIA_ACCESS_DENIED"
  | "TIMEOUT"
  | "SERVER_ERROR"
  | "INVALID_CONFIG"
  /**
   * The agent's speech or model provider connection could not be used — the
   * stored key was rejected, revoked, or the connection is gone. Distinct from
   * AUTHENTICATION_FAILED, which is about the caller's own credential: here the
   * caller did nothing wrong and retrying will not help until the tenant fixes
   * the connection.
   */
  | "PROVIDER_UNAVAILABLE"
  /**
   * The workspace has used the speech budget its plan allows, so the agent
   * cannot generate more audio this period. Distinct from PROVIDER_UNAVAILABLE:
   * nothing is broken and retrying will not help until the workspace raises its
   * limit. The session stays open — transcripts still flow.
   */
  | "SPEECH_BUDGET_EXHAUSTED"
  | "NETWORK_ERROR"
  | "UNSUPPORTED_PROTOCOL"
  | "UNSUPPORTED_FEATURE"
  | "UNKNOWN_ERROR";

export interface VoxeraProtocolError {
  code: VoxeraErrorCode;
  message: string;
  details?: Record<string, JsonValue>;
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type ConversationStatus =
  | "idle"
  | "starting"
  | "active"
  | "ending"
  | "ended";

export type SpeakingStatus = "user" | "ai" | "searching" | "none";

export interface ConversationMessage {
  id: string;
  messageId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  fullText?: string;
  isFinal: boolean;
  metadata?: Record<string, JsonValue>;
}

export interface MediaTrackDescriptor {
  id: string;
  kind: "audio" | "video";
  source: "microphone" | "camera" | "screen" | "ai" | "participant";
  participantId?: string;
  muted: boolean;
}
