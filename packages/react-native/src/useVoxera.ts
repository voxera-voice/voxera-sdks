import { useCallback, useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";

import { VoxeraClient } from "./VoxeraClient";
import type {
  VoxeraConfig,
  VoxeraConnectionState,
  VoxeraConversationState,
  VoxeraMessage,
  VoxeraSpeakingState,
  VoxeraSubscription,
  VoxeraToolCall,
} from "./types";

export interface UseVoxeraOptions {
  /**
   * Start the conversation automatically once the connection is established.
   * Defaults to true; set false to call startConversation yourself.
   */
  autoStartConversation?: boolean;
  /**
   * Request the Android microphone permission before connecting. Defaults to
   * true. No-op on iOS, where the permission prompt is driven by Info.plist.
   */
  requestMicrophonePermission?: boolean;
  /**
   * Called when the model invokes a tool.
   *
   * The server holds the reply until the result comes back, so the handler
   * must answer every call with `selectAction` — a tool call left unanswered
   * leaves the caller listening to silence. Without this option a tool call
   * is surfaced as an error rather than being dropped quietly, because a
   * silent drop is indistinguishable from the agent having stalled.
   */
  onToolCall?: (call: VoxeraToolCall) => void;
}

export interface UseVoxera {
  /** The live client, or null when no call is in progress. Escape hatch for APIs this hook does not wrap. */
  client: VoxeraClient | null;
  /** True once a call has been started and not yet left. */
  isActive: boolean;
  connectionState: VoxeraConnectionState;
  conversationState: VoxeraConversationState;
  speakingState: VoxeraSpeakingState;
  /** Messages with streamed chunks already merged into one entry per reply. */
  messages: VoxeraMessage[];
  transcript: string;
  isMuted: boolean;
  isCameraOn: boolean;
  audioLevel: number;
  aiAudioLevel: number;
  /** True while a start/leave transition is in flight. */
  isBusy: boolean;
  error: string | null;
  clearError: () => void;
  start: (config: VoxeraConfig) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleCamera: (front?: boolean) => Promise<void>;
  sendMessage: (text: string) => void;
  /** Answer a `onToolCall` with what the tool produced. Call once per actionId. */
  selectAction: (actionId: string, result: string) => void;
}

function messageFromReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function requestAndroidPermission(
  permission: "microphone" | "camera",
): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const androidPermission =
    permission === "microphone"
      ? PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      : PermissionsAndroid.PERMISSIONS.CAMERA;
  const result = await PermissionsAndroid.request(androidPermission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Owns a single {@link VoxeraClient}: its lifecycle, its event subscriptions,
 * and the state they drive. Components get plain values and actions and never
 * have to manage the client, its subscriptions, or Android permissions.
 *
 * ```tsx
 * const call = useVoxera();
 * await call.start({ appKey, serverUrl, selectedVoice: "emma" });
 * ```
 */
export function useVoxera(options: UseVoxeraOptions = {}): UseVoxera {
  const {
    autoStartConversation = true,
    requestMicrophonePermission = true,
    onToolCall,
  } = options;

  const [client, setClient] = useState<VoxeraClient | null>(null);
  const [connectionState, setConnectionState] =
    useState<VoxeraConnectionState>("idle");
  const [conversationState, setConversationState] =
    useState<VoxeraConversationState>("idle");
  const [speakingState, setSpeakingState] = useState<VoxeraSpeakingState>("none");
  const [messages, setMessages] = useState<VoxeraMessage[]>([]);
  const [transcript, setTranscript] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [aiAudioLevel, setAiAudioLevel] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationRequested = useRef(false);

  // Read inside the subscription effect without making it a dependency.
  const autoStartRef = useRef(autoStartConversation);
  autoStartRef.current = autoStartConversation;
  const onToolCallRef = useRef(onToolCall);
  onToolCallRef.current = onToolCall;

  const clearError = useCallback(() => setError(null), []);

  // The client is connected here rather than in start() so the subscriptions
  // are attached before connect() can emit anything.
  useEffect(() => {
    if (!client) return undefined;

    const subscriptions: VoxeraSubscription[] = [
      client.on("connectionState", ({ status }) => {
        setConnectionState(status);
        if (
          status === "connected" &&
          autoStartRef.current &&
          !conversationRequested.current
        ) {
          conversationRequested.current = true;
          void client.startConversation().catch((reason: unknown) => {
            setError(messageFromReason(reason));
          });
        }
      }),
      client.on("conversationState", ({ status }) => setConversationState(status)),
      client.on("speakingState", ({ status }) => setSpeakingState(status)),
      client.on("toolTriggered", (call) => {
        const handler = onToolCallRef.current;
        if (!handler) {
          // Surfaced rather than swallowed: the reply is already paused
          // waiting for a result that no one is going to send, and the caller
          // is sitting in silence. An error at least says why.
          setError(
            `The agent called the tool "${call.name}", but no onToolCall handler is set.`,
          );
          return;
        }
        handler(call);
      }),
      client.on("message", (message) => {
        setMessages((current) => {
          // The server streams one logical reply as many chunk events that
          // share a messageId but carry no id, so the native layer mints a
          // fresh random id for each. Grouping on id would therefore append a
          // new message per chunk — group on messageId instead.
          const key = message.messageId || message.id;
          const index = current.findIndex(
            (item) => (item.messageId || item.id) === key,
          );

          // A chunk's content is only the newest delta; fullText is the reply
          // accumulated so far. Prefer fullText and fall back to appending.
          if (index === -1) {
            return [
              ...current,
              { ...message, content: message.fullText ?? message.content },
            ];
          }

          const previous = current[index]!;
          const next = [...current];
          next[index] = {
            ...message,
            // Keep the first-seen id so list keys stay stable while streaming.
            id: previous.id,
            content: message.fullText ?? previous.content + message.content,
          };
          return next;
        });
      }),
      client.on("transcript", ({ text }) => setTranscript(text)),
      client.on("error", (event) => setError(event.message)),
      client.on("audioLevel", ({ level }) => setAudioLevel(level)),
      client.on("aiAudioLevel", ({ level }) => setAiAudioLevel(level)),
      client.on("muteChanged", ({ muted }) => setIsMuted(muted)),
    ];

    void client.connect().catch((reason: unknown) => {
      setError(messageFromReason(reason));
    });

    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      void client.disconnect();
    };
  }, [client]);

  const start = useCallback(
    async (config: VoxeraConfig) => {
      setIsBusy(true);
      setError(null);
      try {
        if (requestMicrophonePermission) {
          const permitted = await requestAndroidPermission("microphone");
          if (!permitted) {
            throw new Error(
              "Microphone permission is required for a voice call.",
            );
          }
        }
        conversationRequested.current = false;
        setMessages([]);
        setTranscript("");
        setClient(new VoxeraClient(config));
      } catch (reason) {
        setError(messageFromReason(reason));
      } finally {
        setIsBusy(false);
      }
    },
    [requestMicrophonePermission],
  );

  const leave = useCallback(async () => {
    if (!client || isBusy) return;
    setIsBusy(true);
    try {
      if (conversationState === "active" || conversationState === "starting") {
        await client.endConversation();
      }
      await client.disconnect();
    } catch (reason) {
      setError(messageFromReason(reason));
    } finally {
      // Clearing the client tears down the subscriptions in the effect above.
      setClient(null);
      setConnectionState("idle");
      setConversationState("idle");
      setSpeakingState("none");
      setIsMuted(false);
      setIsCameraOn(false);
      setIsBusy(false);
    }
  }, [client, conversationState, isBusy]);

  const toggleMute = useCallback(async () => {
    if (!client) return;
    const nextMuted = !isMuted;
    try {
      await client.setMuted(nextMuted);
      setIsMuted(nextMuted);
    } catch (reason) {
      setError(messageFromReason(reason));
    }
  }, [client, isMuted]);

  const toggleCamera = useCallback(
    async (front = true) => {
      if (!client) return;
      try {
        if (isCameraOn) {
          await client.stopCamera();
          setIsCameraOn(false);
          return;
        }
        const permitted = await requestAndroidPermission("camera");
        if (!permitted) throw new Error("Camera permission was not granted.");
        await client.startCamera(front);
        setIsCameraOn(true);
      } catch (reason) {
        setError(messageFromReason(reason));
      }
    },
    [client, isCameraOn],
  );

  const sendMessage = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!client || !value) return;
      void client.sendMessage(value).catch((reason: unknown) => {
        setError(messageFromReason(reason));
      });
    },
    [client],
  );

  const selectAction = useCallback(
    (actionId: string, result: string) => {
      if (!client || !actionId) return;
      void client.selectAction(actionId, result).catch((reason: unknown) => {
        setError(messageFromReason(reason));
      });
    },
    [client],
  );

  return {
    client,
    isActive: client !== null,
    connectionState,
    conversationState,
    speakingState,
    messages,
    transcript,
    isMuted,
    isCameraOn,
    audioLevel,
    aiAudioLevel,
    isBusy,
    error,
    clearError,
    start,
    leave,
    toggleMute,
    toggleCamera,
    sendMessage,
    selectAction,
  };
}
