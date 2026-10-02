import {
  CLIENT_COMMANDS,
  SERVER_EVENTS,
  VOXERA_PROTOCOL_VERSION,
  type ConnectionStatus,
  type ConversationMessage,
  type ConversationStatus,
  type InitSessionConnection,
  type JsonValue,
  type ProtocolCapabilities,
  type SpeakingStatus,
  type VoxeraProtocolError,
} from "@voxera/protocol";
import { Device, type types as MediasoupTypes } from "mediasoup-client";
import { io, type Socket } from "socket.io-client";

/**
 * The server reports loudness in dBFS (roughly -100 = silence, 0 = peak).
 * Meters expect a 0..1 level, so map the audible range above a -60 dB noise
 * floor onto [0, 1]. Without this, consumers multiplying the raw (negative)
 * value produce a meter that never leaves its minimum.
 */
const VOLUME_FLOOR_DB = -60;
function normalizeVolumeToLevel(volumeDb: number): number {
  if (!Number.isFinite(volumeDb)) return 0;
  const level = (volumeDb - VOLUME_FLOOR_DB) / -VOLUME_FLOOR_DB;
  return Math.min(1, Math.max(0, level));
}

export interface VoxeraWebConfig
  extends Omit<
    InitSessionConnection,
    "clientType" | "protocolVersion" | "sessionId"
  > {
  serverUrl: string;
  sessionId?: string;
  connectionTimeoutMs?: number;
  autoReconnect?: boolean;
  autoPlayRemoteAudio?: boolean;
  mediaConstraints?: MediaStreamConstraints;
  /**
   * ICE candidate policy. Defaults to "all": the client tries a direct path to
   * the media server and falls back to TURN, which is what a server with a
   * routable address wants -- forcing "relay" sends every packet through the
   * TURN server even when it sits on the same host as the media server,
   * doubling its bandwidth and CPU for no gain. Set "relay" deliberately when
   * the media server has no address clients can reach, as when it runs inside
   * a private cluster network behind a relay.
   */
  iceTransportPolicy?: RTCIceTransportPolicy;
}

export interface VoxeraClientState {
  connectionStatus: ConnectionStatus;
  conversationStatus: ConversationStatus;
  speakingStatus: SpeakingStatus;
  sessionId: string;
  participantId?: string;
  isMuted: boolean;
  /**
   * Silence (listen-only) mode. When true the assistant keeps transcribing the
   * caller but does not speak back, mirroring the server's "listen mode".
   */
  isSilenced: boolean;
  capabilities?: ProtocolCapabilities;
}

export interface VoxeraClientEventMap {
  stateChanged: VoxeraClientState;
  message: ConversationMessage;
  transcript: { text: string; isFinal: boolean };
  audioLevel: { level: number; isAi: boolean };
  /** Fired when the assistant triggers a tool/function call. */
  toolTriggered: {
    actionId: string;
    name: string;
    arguments: JsonValue;
  };
  localStream: MediaStream;
  remoteStream: MediaStream;
  remoteTrack: MediaStreamTrack;
  error: VoxeraProtocolError;
  autoplayBlocked: { stream: MediaStream };
  rawEvent: { event: string; data: JsonValue };
}

type Listener<T> = (payload: T) => void;
type Unsubscribe = () => void;

interface SessionAck {
  participantId: string;
  sessionId: string;
  protocol?: "voxera";
  protocolVersion?: "1.0";
  legacyEventAliases?: boolean;
}

interface TransportParameters {
  id: string;
  iceParameters: MediasoupTypes.IceParameters;
  iceCandidates: MediasoupTypes.IceCandidate[];
  dtlsParameters: MediasoupTypes.DtlsParameters;
  sctpParameters?: MediasoupTypes.SctpParameters;
}

interface ConsumeParameters {
  id: string;
  producerId: string;
  kind: MediasoupTypes.MediaKind;
  rtpParameters: MediasoupTypes.RtpParameters;
}

/**
 * A failure with a protocol error code attached, so it reaches `error`
 * listeners as that code rather than as the fallback for wherever it surfaced.
 */
class VoxeraCommandError extends Error {
  constructor(
    readonly code: VoxeraProtocolError["code"],
    message: string,
  ) {
    super(message);
    this.name = "VoxeraCommandError";
  }
}

/**
 * The failure a command ack carries, if it carries one.
 *
 * Refusals arrive as the protocol's CommandFailure (`{ ok: false, error }`),
 * or from older handlers as `{ error: "reason" }`. Successful acks are the
 * bare result, so anything else is success.
 */
function commandFailure(response: unknown): VoxeraCommandError | undefined {
  if (!response || typeof response !== "object") return undefined;
  const record = response as Record<string, unknown>;
  if (record.ok === false) {
    const error = (record.error ?? {}) as Record<string, unknown>;
    return new VoxeraCommandError(
      typeof error.code === "string"
        ? (error.code as VoxeraProtocolError["code"])
        : "SERVER_ERROR",
      String(error.message ?? "The server refused the command"),
    );
  }
  if (typeof record.error === "string") {
    return new VoxeraCommandError("SERVER_ERROR", record.error);
  }
  return undefined;
}

/** Maps a getUserMedia rejection to a protocol code by its DOMException name. */
function mediaErrorCode(error: unknown): VoxeraProtocolError["code"] | undefined {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "NotAllowedError" ||
    name === "SecurityError" ||
    name === "NotFoundError" ||
    name === "NotReadableError" ||
    name === "OverconstrainedError"
    ? "MEDIA_ACCESS_DENIED"
    : undefined;
}

const DEFAULT_MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: false,
};

export class VoxeraClient {
  readonly localStream = new MediaStream();
  readonly remoteStream = new MediaStream();

  private readonly listeners = new Map<
    keyof VoxeraClientEventMap,
    Set<Listener<never>>
  >();
  private readonly config: VoxeraWebConfig;
  private readonly remoteAudio?: HTMLAudioElement;
  private readonly consumedProducerIds = new Set<string>();

  private socket?: Socket;
  private device?: Device;
  private sendTransport?: MediasoupTypes.Transport;
  private receiveTransport?: MediasoupTypes.Transport;
  private producers: MediasoupTypes.Producer[] = [];
  private consumers: MediasoupTypes.Consumer[] = [];
  private disposed = false;
  /** Set once a session has been bootstrapped; later socket connects are reconnects. */
  private sessionEstablished = false;
  /** While a bootstrap runs, a server-error ends it instead of being reported. */
  private failBootstrap?: (error: Error) => void;

  private stateValue: VoxeraClientState;

  constructor(config: VoxeraWebConfig) {
    if (!config.appKey?.trim() && !config.sessionToken?.trim()) {
      throw new Error("Voxera appKey or sessionToken is required");
    }
    if (!config.serverUrl.trim()) {
      throw new Error("Voxera serverUrl is required");
    }

    this.config = config;
    this.stateValue = {
      connectionStatus: "idle",
      conversationStatus: "idle",
      speakingStatus: "none",
      sessionId: config.sessionId ?? this.createSessionId(),
      isMuted: false,
      isSilenced: false,
    };

    if (config.autoPlayRemoteAudio !== false) {
      this.remoteAudio = document.createElement("audio");
      this.remoteAudio.autoplay = true;
      this.remoteAudio.setAttribute("playsinline", "");
      this.remoteAudio.srcObject = this.remoteStream;
    }
  }

  get state(): Readonly<VoxeraClientState> {
    return this.stateValue;
  }

  on<K extends keyof VoxeraClientEventMap>(
    event: K,
    listener: Listener<VoxeraClientEventMap[K]>,
  ): Unsubscribe {
    const listeners = this.listeners.get(event) ?? new Set<Listener<never>>();
    listeners.add(listener as Listener<never>);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener as Listener<never>);
  }

  async connect(): Promise<void> {
    this.assertNotDisposed();
    if (
      this.stateValue.connectionStatus === "connected" ||
      this.stateValue.connectionStatus === "connecting"
    ) {
      return;
    }

    this.patchState({ connectionStatus: "connecting" });

    try {
      this.socket = this.createSocket();
      this.registerSocketEvents(this.socket);
      await this.openSocket(this.socket);
      await this.bootstrapSession();
      this.patchState({ connectionStatus: "connected" });
    } catch (error) {
      // Listeners go first: disconnecting fires "disconnect", whose handler
      // would otherwise overwrite this failure with "reconnecting".
      this.socket?.removeAllListeners();
      this.socket?.io.removeAllListeners();
      this.socket?.disconnect();
      this.socket = undefined;
      await this.closeMedia();
      this.patchState({ connectionStatus: "error" });
      this.reportError(error, "CONNECTION_FAILED");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.stateValue.connectionStatus === "disconnected") {
      return;
    }

    if (this.socket?.connected) {
      this.socket.emit(CLIENT_COMMANDS.leave, {
        sessionId: this.stateValue.sessionId,
      });
    }

    await this.closeMedia();
    this.socket?.removeAllListeners();
    this.socket?.io.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
    this.sessionEstablished = false;
    this.patchState({
      connectionStatus: "disconnected",
      conversationStatus: "ended",
      speakingStatus: "none",
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.disconnect();
    this.disposed = true;
    this.listeners.clear();
    this.remoteAudio?.remove();
  }

  startConversation(): void {
    this.assertConnected();
    this.socket?.emit(CLIENT_COMMANDS.conversationStart, {
      sessionId: this.stateValue.sessionId,
    });
    this.patchState({ conversationStatus: "starting" });
  }

  endConversation(): void {
    this.assertConnected();
    this.socket?.emit(CLIENT_COMMANDS.conversationEnd, {
      sessionId: this.stateValue.sessionId,
    });
    this.patchState({ conversationStatus: "ending" });
  }

  sendMessage(message: string): void {
    this.assertConnected();
    const value = message.trim();
    if (!value) return;
    this.socket?.emit(CLIENT_COMMANDS.sendMessage, {
      sessionId: this.stateValue.sessionId,
      message: value,
    });
  }

  /**
   * Returns the result of a tool call to the assistant.
   *
   * When the model calls a tool, the server emits `toolTriggered` and then
   * waits: the reply is not resumed until a result arrives, because the
   * conversation context needs an assistant(tool_calls) -> tool pairing to stay
   * well formed. Call this once per `actionId` with whatever the tool produced.
   *
   * `result` is free text and reaches the model verbatim, so it should say what
   * happened in terms the model can act on ("calendar shown, awaiting a slot")
   * rather than a status code. For a tool whose real result is a piece of UI,
   * describing the UI is the honest answer.
   */
  selectAction(actionId: string, result: string): void {
    this.assertConnected();
    if (!actionId) return;
    this.socket?.emit(CLIENT_COMMANDS.selectActions, {
      sessionId: this.stateValue.sessionId,
      action_id: actionId,
      message: result,
    });
  }

  setMuted(muted: boolean): void {
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !muted;
    }
    this.patchState({ isMuted: muted });
    this.socket?.emit(CLIENT_COMMANDS.muteChanged, {
      id: this.stateValue.participantId,
      isMuted: muted,
    });
  }

  toggleMute(): boolean {
    const muted = !this.stateValue.isMuted;
    this.setMuted(muted);
    return muted;
  }

  /**
   * Toggle silence (listen-only) mode. In silence mode the server keeps
   * listening/transcribing but the assistant does not speak back.
   */
  setSilenceMode(silenced: boolean): void {
    this.patchState({ isSilenced: silenced });
    this.socket?.emit(CLIENT_COMMANDS.toggleListenMode, {
      id: this.stateValue.participantId,
      listenMode: silenced,
    });
  }

  toggleSilenceMode(): boolean {
    const silenced = !this.stateValue.isSilenced;
    this.setSilenceMode(silenced);
    return silenced;
  }

  async resumeRemoteAudio(): Promise<void> {
    if (!this.remoteAudio) return;
    await this.remoteAudio.play();
  }

  private createSocket(): Socket {
    return io(this.config.serverUrl, {
      autoConnect: false,
      reconnection: this.config.autoReconnect !== false,
      transports: ["websocket"],
    });
  }

  private registerSocketEvents(socket: Socket): void {
    socket.onAny((event: string, data: unknown) => {
      this.emit("rawEvent", {
        event,
        data: data === undefined ? null : (data as JsonValue),
      });
    });

    socket.on("disconnect", () => {
      if (!this.disposed) {
        this.patchState({ connectionStatus: "reconnecting" });
      }
    });

    /*
     * Rebuild on the socket's own "connect", not the manager's "reconnect".
     * The manager fires when the transport is back, before this namespace has
     * reconnected, so every command sent from there failed with "socket is not
     * connected" and auto-reconnect never once worked. The first connect is
     * connect()'s to handle; only later ones are reconnects.
     */
    socket.on("connect", () => {
      if (this.sessionEstablished && !this.disposed) {
        void this.rebuildAfterReconnect();
      }
    });

    socket.on(SERVER_EVENTS.newProducer, (data: { producerId?: string }) => {
      if (data.producerId) void this.consumeProducer(data.producerId);
    });

    // A closed producer leaves a dead track at the head of remoteStream, and a
    // media element renders only the first audio track it finds - so dropping
    // it is what lets a replacement producer actually be heard.
    socket.on(SERVER_EVENTS.producerClosed, (data: { producerId?: string }) => {
      if (data.producerId) this.removeConsumerByProducerId(data.producerId);
    });

    socket.on(SERVER_EVENTS.message, (data: Record<string, unknown>) => {
      const message = this.normalizeMessage(data);
      this.emit("message", message);
    });

    socket.on(
      SERVER_EVENTS.speakingStatusChanged,
      (data: { status?: string }) => {
        const status = this.normalizeSpeakingStatus(data.status);
        this.patchState({ speakingStatus: status });
      },
    );

    socket.on(SERVER_EVENTS.volumeChanged, (data: Record<string, unknown>) => {
      this.emit("audioLevel", {
        level: normalizeVolumeToLevel(Number(data.volume ?? -100)),
        isAi: Boolean(data.isAi),
      });
    });

    socket.on(SERVER_EVENTS.transcriptUpdate, (data: Record<string, unknown>) => {
      this.emit("transcript", {
        text: String(data.text ?? ""),
        isFinal: Boolean(data.isFinal),
      });
    });

    socket.on(SERVER_EVENTS.toolTriggered, (data: Record<string, unknown>) => {
      const content = (data?.content ?? {}) as Record<string, unknown>;
      const name = content.name;
      if (typeof name !== "string" || !name) return;
      this.emit("toolTriggered", {
        actionId: String(content.action_id ?? ""),
        name,
        arguments: (content.arguments ?? null) as JsonValue,
      });
    });

    socket.on(SERVER_EVENTS.conversationStarted, () => {
      this.patchState({ conversationStatus: "active" });
    });
    socket.on(SERVER_EVENTS.conversationEnded, () => {
      this.patchState({ conversationStatus: "ended", speakingStatus: "none" });
    });

    socket.on(SERVER_EVENTS.serverError, (data: Record<string, unknown>) => {
      // During setup this is the reason setup failed: end it now with this
      // code, and let connect() report it once. A server that predates
      // failure acks sends only this, and the client used to wait out the
      // whole ack timeout before reporting a generic timeout.
      if (this.failBootstrap) {
        this.failBootstrap(
          new VoxeraCommandError(
            typeof data?.code === "string"
              ? (data.code as VoxeraProtocolError["code"])
              : "SERVER_ERROR",
            String(data?.message ?? "The server refused the session"),
          ),
        );
        return;
      }
      this.reportError(data, "SERVER_ERROR");
    });
    socket.on(SERVER_EVENTS.transportError, (data: Record<string, unknown>) => {
      this.reportError(data, "WEBRTC_ERROR");
    });
    socket.on(SERVER_EVENTS.producerError, (data: Record<string, unknown>) => {
      this.reportError(data, "WEBRTC_ERROR");
    });
  }

  private async openSocket(socket: Socket): Promise<void> {
    const timeoutMs = this.config.connectionTimeoutMs ?? 30_000;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new VoxeraCommandError("TIMEOUT", "Timed out connecting to Voxera"));
      }, timeoutMs);

      const cleanup = () => {
        window.clearTimeout(timeout);
        socket.off("connect", onConnect);
        socket.off("connect_error", onError);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      socket.once("connect", onConnect);
      socket.once("connect_error", onError);
      socket.connect();
    });
  }

  private async bootstrapSession(): Promise<void> {
    const failed = new Promise<never>((_, reject) => {
      this.failBootstrap = reject;
    });
    const run = this.runBootstrap();
    // Whichever loses the race still settles later; neither may go unhandled.
    failed.catch(() => undefined);
    run.catch(() => undefined);
    try {
      await Promise.race([run, failed]);
      this.sessionEstablished = true;
    } finally {
      this.failBootstrap = undefined;
    }
  }

  private async runBootstrap(): Promise<void> {
    const socket = this.requireSocket();
    const init: InitSessionConnection = {
      sessionId: this.stateValue.sessionId,
      appKey: this.config.appKey,
      sessionToken: this.config.sessionToken,
      agentId: this.config.agentId,
      clientType: "web",
      protocolVersion: VOXERA_PROTOCOL_VERSION,
      threadId: this.config.threadId,
      chatProfile: this.config.chatProfile,
      userId: this.config.userId,
      username: this.config.username,
      user: this.config.user,
      userInfo: this.config.userInfo,
      metadata: this.config.metadata,
      language: this.config.language,
      ttsConfig: this.config.ttsConfig,
      transcriptionConfig: this.config.transcriptionConfig,
      modelConfig: this.config.modelConfig,
      tools: this.config.tools,
      additionalSystemPrompts: this.config.additionalSystemPrompts,
      initialMessages: this.config.initialMessages,
      selectedModel: this.config.selectedModel,
      selectedVoice: this.config.selectedVoice,
      workspaceId: this.config.workspaceId,
      clientDateTime: new Date().toISOString(),
    };

    const session = await this.emitWithAck<SessionAck>(
      CLIENT_COMMANDS.initSessionConnection,
      init,
    );
    this.patchState({
      participantId: session.participantId,
      capabilities: session.protocol
        ? {
            protocol: session.protocol,
            version: session.protocolVersion ?? VOXERA_PROTOCOL_VERSION,
            features: [],
            legacyEventAliases: session.legacyEventAliases,
          }
        : undefined,
    });

    const routerRtpCapabilities =
      await this.emitWithAck<MediasoupTypes.RtpCapabilities>(
        CLIENT_COMMANDS.getRtpCapabilities,
        {},
      );
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities });

    const iceServers = await this.emitWithAck<RTCIceServer[]>(
      CLIENT_COMMANDS.getIceServers,
      {},
    );
    await this.createTransports(iceServers);
    await this.produceLocalMedia();

    // Tell consumers about the stream object even before its first track arrives.
    this.emit("remoteStream", this.remoteStream);
    void socket;
  }

  private async createTransports(iceServers: RTCIceServer[]): Promise<void> {
    const device = this.requireDevice();
    const sendParameters = await this.emitWithAck<TransportParameters>(
      CLIENT_COMMANDS.createTransport,
      { consuming: false },
    );
    const iceTransportPolicy = this.config.iceTransportPolicy ?? "all";
    this.sendTransport = device.createSendTransport({
      ...sendParameters,
      iceServers,
      iceTransportPolicy,
    });
    this.bindTransport(this.sendTransport);

    const receiveParameters = await this.emitWithAck<TransportParameters>(
      CLIENT_COMMANDS.createTransport,
      { consuming: true },
    );
    this.receiveTransport = device.createRecvTransport({
      ...receiveParameters,
      iceServers,
      iceTransportPolicy,
    });
    this.bindTransport(this.receiveTransport);
  }

  private bindTransport(transport: MediasoupTypes.Transport): void {
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      this.emitWithAck(CLIENT_COMMANDS.connectTransport, {
        transportId: transport.id,
        dtlsParameters,
      }).then(() => callback(), errback);
    });

    if (transport.direction === "send") {
      transport.on(
        "produce",
        ({ kind, rtpParameters }, callback, errback) => {
          this.emitWithAck<{ id: string }>(CLIENT_COMMANDS.produce, {
            transportId: transport.id,
            kind,
            rtpParameters,
          }).then(({ id }) => callback({ id }), errback);
        },
      );
    }

    transport.on("connectionstatechange", (state) => {
      if (state === "failed" || state === "disconnected") {
        this.reportError(
          new Error(`WebRTC transport ${transport.id} is ${state}`),
          "WEBRTC_ERROR",
        );
      }
    });
  }

  private async produceLocalMedia(): Promise<void> {
    // A track the browser ended (device unplugged, permission revoked) cannot
    // be produced again; drop it so the microphone is asked for afresh.
    for (const track of this.localStream.getTracks()) {
      if (track.readyState === "ended") this.localStream.removeTrack(track);
    }

    if (this.localStream.getTracks().length === 0) {
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia(
          this.config.mediaConstraints ?? DEFAULT_MEDIA_CONSTRAINTS,
        );
      } catch (error) {
        const code = mediaErrorCode(error);
        if (!code) throw error;
        throw new VoxeraCommandError(
          code,
          error instanceof Error ? error.message : "Microphone access denied",
        );
      }
      for (const track of media.getTracks()) {
        track.enabled = !this.stateValue.isMuted;
        this.localStream.addTrack(track);
      }
      this.emit("localStream", this.localStream);
    }

    const transport = this.sendTransport;
    if (!transport) throw new Error("Send transport is not ready");
    for (const track of this.localStream.getTracks()) {
      // stopTracks: false — mediasoup otherwise stops the track when the
      // producer closes, and a reconnect closes every producer. The track is
      // the user's microphone; closeMedia() stops it when the call ends.
      const producer = await transport.produce({ track, stopTracks: false });
      this.producers.push(producer);
    }
  }

  private async consumeProducer(producerId: string): Promise<void> {
    if (this.consumedProducerIds.has(producerId)) return;
    const device = this.requireDevice();
    const transport = this.receiveTransport;
    if (!transport) return;

    this.consumedProducerIds.add(producerId);
    try {
      const parameters = await this.emitWithAck<ConsumeParameters>(
        CLIENT_COMMANDS.consume,
        {
          producerId,
          rtpCapabilities: device.rtpCapabilities,
          transportId: transport.id,
        },
      );
      const consumer = await transport.consume(parameters);
      this.consumers.push(consumer);
      this.remoteStream.addTrack(consumer.track);
      this.emit("remoteTrack", consumer.track);
      this.emit("remoteStream", this.remoteStream);

      if (consumer.kind === "audio" && this.remoteAudio) {
        try {
          await this.remoteAudio.play();
        } catch {
          this.emit("autoplayBlocked", { stream: this.remoteStream });
        }
      }

      consumer.on("transportclose", () => this.removeConsumer(consumer));
      consumer.on("trackended", () => this.removeConsumer(consumer));
    } catch (error) {
      this.consumedProducerIds.delete(producerId);
      this.reportError(error, "WEBRTC_ERROR");
    }
  }

  private removeConsumerByProducerId(producerId: string): void {
    const consumer = this.consumers.find(
      (entry) => entry.producerId === producerId,
    );
    if (consumer) this.removeConsumer(consumer);
  }

  private removeConsumer(consumer: MediasoupTypes.Consumer): void {
    consumer.close();
    this.remoteStream.removeTrack(consumer.track);
    this.consumers = this.consumers.filter((entry) => entry !== consumer);
    this.consumedProducerIds.delete(consumer.producerId);
  }

  private async rebuildAfterReconnect(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.closeTransportsOnly();
      await this.bootstrapSession();
      this.patchState({ connectionStatus: "connected" });
      // The server sees a new participant after a reconnect and knows nothing
      // of the old one's state; tell it again rather than let them drift.
      if (this.stateValue.isMuted) this.setMuted(true);
      if (this.stateValue.isSilenced) this.setSilenceMode(true);
    } catch (error) {
      this.patchState({ connectionStatus: "error" });
      this.reportError(error, "CONNECTION_FAILED");
    }
  }

  private async closeTransportsOnly(): Promise<void> {
    for (const producer of this.producers) producer.close();
    for (const consumer of this.consumers) consumer.close();
    this.producers = [];
    this.consumers = [];
    this.sendTransport?.close();
    this.receiveTransport?.close();
    this.sendTransport = undefined;
    this.receiveTransport = undefined;
    this.device = undefined;
    this.consumedProducerIds.clear();
    for (const track of this.remoteStream.getTracks()) {
      this.remoteStream.removeTrack(track);
    }
  }

  private async closeMedia(): Promise<void> {
    await this.closeTransportsOnly();
    for (const track of this.localStream.getTracks()) {
      track.stop();
      this.localStream.removeTrack(track);
    }
  }

  private emitWithAck<T = unknown>(event: string, data: unknown): Promise<T> {
    const socket = this.requireSocket();
    const timeout = this.config.connectionTimeoutMs ?? 30_000;
    return new Promise<T>((resolve, reject) => {
      socket.timeout(timeout).emit(
        event,
        data,
        (error: Error | null, response: T) => {
          if (error) {
            // socket.io's only ack error is its timeout.
            reject(new VoxeraCommandError("TIMEOUT", `${event}: ${error.message}`));
            return;
          }
          const failure = commandFailure(response);
          if (failure) reject(failure);
          else resolve(response);
        },
      );
    });
  }

  private normalizeMessage(data: Record<string, unknown>): ConversationMessage {
    const timestamp = Number(data.timestamp ?? Date.now());
    const roleValue = String(data.role ?? "assistant");
    const role =
      roleValue === "user" || roleValue === "system"
        ? roleValue
        : "assistant";
    return {
      id: String(data.id ?? data.messageId ?? crypto.randomUUID()),
      messageId: data.messageId ? String(data.messageId) : undefined,
      role,
      content: String(data.content ?? data.text ?? ""),
      timestamp,
      fullText: data.fullText ? String(data.fullText) : undefined,
      isFinal: Boolean(data.isFinal),
    };
  }

  private normalizeSpeakingStatus(status?: string): SpeakingStatus {
    switch (status) {
      case "user":
      case "user-speaking":
        return "user";
      case "ai":
      case "ai-speaking":
        return "ai";
      case "searching":
        return "searching";
      default:
        return "none";
    }
  }

  private patchState(patch: Partial<VoxeraClientState>): void {
    this.stateValue = { ...this.stateValue, ...patch };
    this.emit("stateChanged", this.stateValue);
  }

  private emit<K extends keyof VoxeraClientEventMap>(
    event: K,
    payload: VoxeraClientEventMap[K],
  ): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as Listener<VoxeraClientEventMap[K]>)(payload);
    }
  }

  private reportError(error: unknown, fallbackCode: VoxeraProtocolError["code"]): void {
    const record =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : undefined;
    const normalized: VoxeraProtocolError = {
      // String codes only: a DOMException carries a legacy numeric `code`
      // (0 for most), which is not a protocol code and used to leak through.
      code:
        typeof record?.code === "string"
          ? (record.code as VoxeraProtocolError["code"])
          : fallbackCode,
      message:
        error instanceof Error
          ? error.message
          : String(record?.message ?? record?.error ?? error),
    };
    this.emit("error", normalized);
  }

  private requireSocket(): Socket {
    if (!this.socket?.connected) throw new Error("Voxera socket is not connected");
    return this.socket;
  }

  private requireDevice(): Device {
    if (!this.device?.loaded) throw new Error("Voxera WebRTC device is not loaded");
    return this.device;
  }

  private assertConnected(): void {
    if (this.stateValue.connectionStatus !== "connected") {
      throw new Error("Voxera client is not connected");
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error("Voxera client has been disposed");
  }

  private createSessionId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }
}
