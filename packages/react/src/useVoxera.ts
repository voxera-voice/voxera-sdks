"use client";

import {
  VoxeraClient,
  type ConversationMessage,
  type ConnectionStatus,
  type ConversationStatus,
  type JsonValue,
  type SpeakingStatus,
  type VoxeraWebConfig,
} from "@voxera/sdk-web";
import { useCallback, useEffect, useRef, useState } from "react";

/** A tool call the agent made, as handed to {@link UseVoxeraOptions.onToolCall}. */
export interface VoxeraToolCall {
  actionId: string;
  name: string;
  arguments: JsonValue;
}

export interface UseVoxeraOptions {
  /**
   * Start the conversation as soon as the connection is up. Defaults to true;
   * set false to call `startConversation()` yourself — on a button press, say,
   * once the caller has read a consent notice.
   */
  autoStartConversation?: boolean;
  /**
   * Called when the agent triggers a tool. The server *waits* for a result
   * before finishing its reply, so every call must be answered exactly once:
   * either return the result as a string from this handler and the hook sends
   * it, or return nothing and call `selectAction(actionId, result)` yourself
   * when the work is done.
   */
  onToolCall?: (call: VoxeraToolCall) => string | void | Promise<string | void>;
}

export interface UseVoxera {
  /** The live client, or null between calls. Escape hatch for anything this hook does not wrap. */
  client: VoxeraClient | null;
  /** True once `start()` has been called and `leave()` has not. */
  isActive: boolean;
  connectionStatus: ConnectionStatus;
  conversationStatus: ConversationStatus;
  speakingStatus: SpeakingStatus;
  /** Messages with streamed chunks already merged into one entry per reply. */
  messages: ConversationMessage[];
  /** Live speech-to-text for the caller's current turn. */
  transcript: string;
  isMuted: boolean;
  /** Listen-only mode: the agent keeps transcribing but does not speak back. */
  isSilenced: boolean;
  /** Caller loudness, 0..1. */
  audioLevel: number;
  /** Agent loudness, 0..1. */
  aiAudioLevel: number;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /**
   * True when the browser refused to play the agent unprompted. Call
   * `resumeAudio()` from a click or tap to recover.
   */
  autoplayBlocked: boolean;
  /** True while a start or leave transition is in flight. */
  isBusy: boolean;
  error: string | null;
  clearError: () => void;
  start: (config: VoxeraWebConfig) => Promise<void>;
  leave: () => Promise<void>;
  startConversation: () => void;
  endConversation: () => void;
  sendMessage: (text: string) => void;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
  setSilenced: (silenced: boolean) => void;
  toggleSilence: () => void;
  /** Answer a tool call the agent is waiting on. */
  selectAction: (actionId: string, result: string) => void;
  resumeAudio: () => Promise<void>;
}

function messageFromReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Merge one streamed event into the message list.
 *
 * The server streams a single logical reply as many events sharing a
 * `messageId`, where `content` is only the newest delta and `fullText` is the
 * reply so far. Grouping on `id` would append a new bubble per chunk.
 */
function mergeMessage(
  current: ConversationMessage[],
  message: ConversationMessage,
): ConversationMessage[] {
  const key = message.messageId || message.id;
  const index = current.findIndex((item) => (item.messageId || item.id) === key);

  if (index === -1) {
    return [...current, { ...message, content: message.fullText ?? message.content }];
  }

  const previous = current[index]!;
  const next = [...current];
  next[index] = {
    ...message,
    // Keep the first-seen id so React list keys stay stable while streaming.
    id: previous.id,
    content: message.fullText ?? previous.content + message.content,
  };
  return next;
}

/**
 * Owns a single {@link VoxeraClient}: its lifecycle, its event subscriptions,
 * and the state they drive. Components get plain values and actions, and never
 * have to manage the client or unsubscribe from it.
 *
 * ```tsx
 * const call = useVoxera();
 *
 * await call.start({
 *   appKey: "vx_pk_live_...",
 *   serverUrl: "https://rtc.voxera-voice.com",
 *   agentId: "your-agent-id",
 * });
 * ```
 */
export function useVoxera(options: UseVoxeraOptions = {}): UseVoxera {
  const { autoStartConversation = true } = options;

  const [client, setClient] = useState<VoxeraClient | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [conversationStatus, setConversationStatus] =
    useState<ConversationStatus>("idle");
  const [speakingStatus, setSpeakingStatus] = useState<SpeakingStatus>("none");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [transcript, setTranscript] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [isSilenced, setIsSilenced] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [aiAudioLevel, setAiAudioLevel] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationRequested = useRef(false);

  // Read the latest options inside the subscription effect without making the
  // effect depend on them — a new inline callback each render would otherwise
  // tear the connection down and rebuild it.
  const autoStartRef = useRef(autoStartConversation);
  autoStartRef.current = autoStartConversation;
  const onToolCallRef = useRef(options.onToolCall);
  onToolCallRef.current = options.onToolCall;

  const clearError = useCallback(() => setError(null), []);

  // The client connects here rather than in start() so every subscription is
  // attached before connect() can emit anything.
  useEffect(() => {
    if (!client) return undefined;

    const unsubscribes = [
      client.on("stateChanged", (state) => {
        setConnectionStatus(state.connectionStatus);
        setConversationStatus(state.conversationStatus);
        setSpeakingStatus(state.speakingStatus);
        setIsMuted(state.isMuted);
        setIsSilenced(state.isSilenced);

        if (
          state.connectionStatus === "connected" &&
          autoStartRef.current &&
          !conversationRequested.current
        ) {
          conversationRequested.current = true;
          try {
            client.startConversation();
          } catch (reason) {
            setError(messageFromReason(reason));
          }
        }
      }),
      client.on("message", (message) => {
        setMessages((current) => mergeMessage(current, message));
      }),
      client.on("transcript", ({ text }) => setTranscript(text)),
      client.on("audioLevel", ({ level, isAi }) => {
        if (isAi) setAiAudioLevel(level);
        else setAudioLevel(level);
      }),
      client.on("localStream", (stream) => setLocalStream(stream)),
      client.on("remoteStream", (stream) => {
        setRemoteStream(stream);
        setAutoplayBlocked(false);
      }),
      client.on("autoplayBlocked", () => setAutoplayBlocked(true)),
      client.on("error", (event) => setError(event.message)),
      client.on("toolTriggered", (call) => {
        const handler = onToolCallRef.current;
        if (!handler) return;
        void (async () => {
          try {
            const result = await handler(call);
            // A handler that resolves the call itself returns nothing; only a
            // returned string is an answer, and answering twice desyncs the
            // conversation context.
            if (typeof result === "string") {
              client.selectAction(call.actionId, result);
            }
          } catch (reason) {
            setError(messageFromReason(reason));
          }
        })();
      }),
    ];

    void client.connect().catch((reason: unknown) => {
      setError(messageFromReason(reason));
    });

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      // disconnect(), not dispose(): React re-runs this effect on every
      // StrictMode mount and the same client has to be able to connect again.
      void client.disconnect();
    };
  }, [client]);

  const start = useCallback(async (config: VoxeraWebConfig) => {
    setIsBusy(true);
    setError(null);
    try {
      conversationRequested.current = false;
      setMessages([]);
      setTranscript("");
      setAutoplayBlocked(false);
      setAudioLevel(0);
      setAiAudioLevel(0);
      // Constructing the client is what triggers the effect above, which
      // subscribes and then connects.
      setClient(new VoxeraClient(config));
    } catch (reason) {
      setError(messageFromReason(reason));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const leave = useCallback(async () => {
    if (!client || isBusy) return;
    setIsBusy(true);
    try {
      if (conversationStatus === "active" || conversationStatus === "starting") {
        client.endConversation();
      }
      await client.dispose();
    } catch (reason) {
      setError(messageFromReason(reason));
    } finally {
      // Clearing the client tears down the subscriptions in the effect above.
      setClient(null);
      setConnectionStatus("idle");
      setConversationStatus("idle");
      setSpeakingStatus("none");
      setIsMuted(false);
      setIsSilenced(false);
      setLocalStream(null);
      setRemoteStream(null);
      setAutoplayBlocked(false);
      setIsBusy(false);
    }
  }, [client, conversationStatus, isBusy]);

  const guard = useCallback((action: () => void) => {
    try {
      action();
    } catch (reason) {
      setError(messageFromReason(reason));
    }
  }, []);

  const startConversation = useCallback(() => {
    if (!client) return;
    conversationRequested.current = true;
    guard(() => client.startConversation());
  }, [client, guard]);

  const endConversation = useCallback(() => {
    if (!client) return;
    guard(() => client.endConversation());
  }, [client, guard]);

  const sendMessage = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!client || !value) return;
      guard(() => client.sendMessage(value));
    },
    [client, guard],
  );

  const setMuted = useCallback(
    (muted: boolean) => {
      if (!client) return;
      guard(() => client.setMuted(muted));
    },
    [client, guard],
  );

  const toggleMute = useCallback(() => {
    if (!client) return;
    guard(() => void client.toggleMute());
  }, [client, guard]);

  const setSilenced = useCallback(
    (silenced: boolean) => {
      if (!client) return;
      guard(() => client.setSilenceMode(silenced));
    },
    [client, guard],
  );

  const toggleSilence = useCallback(() => {
    if (!client) return;
    guard(() => void client.toggleSilenceMode());
  }, [client, guard]);

  const selectAction = useCallback(
    (actionId: string, result: string) => {
      if (!client) return;
      guard(() => client.selectAction(actionId, result));
    },
    [client, guard],
  );

  const resumeAudio = useCallback(async () => {
    if (!client) return;
    try {
      await client.resumeRemoteAudio();
      setAutoplayBlocked(false);
    } catch (reason) {
      setError(messageFromReason(reason));
    }
  }, [client]);

  return {
    client,
    isActive: client !== null,
    connectionStatus,
    conversationStatus,
    speakingStatus,
    messages,
    transcript,
    isMuted,
    isSilenced,
    audioLevel,
    aiAudioLevel,
    localStream,
    remoteStream,
    autoplayBlocked,
    isBusy,
    error,
    clearError,
    start,
    leave,
    startConversation,
    endConversation,
    sendMessage,
    setMuted,
    toggleMute,
    setSilenced,
    toggleSilence,
    selectAction,
    resumeAudio,
  };
}
