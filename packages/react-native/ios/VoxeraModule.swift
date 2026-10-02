import Foundation
import React
import VoxeraSDK
import WebRTC

@objc(VoxeraModule)
final class VoxeraModule: RCTEventEmitter, VoxeraClientDelegate {
    private var client: VoxeraClient?
    private var hasListeners = false

    @objc override static func requiresMainQueueSetup() -> Bool { true }

    override func supportedEvents() -> [String]! {
        ["VoxeraEvent"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    @objc(configure:resolver:rejecter:)
    func configure(
        _ rawConfig: [String: Any],
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        guard let appKey = rawConfig["appKey"] as? String, !appKey.isEmpty,
              let serverUrl = rawConfig["serverUrl"] as? String, !serverUrl.isEmpty else {
            reject("INVALID_CONFIG", "appKey and serverUrl are required", nil)
            return
        }

        client?.disconnect()

        var config = VoxeraConfig(
            appKey: appKey,
            serverUrl: serverUrl,
            agentId: rawConfig["agentId"] as? String,
            userId: rawConfig["userId"] as? String,
            sessionId: rawConfig["sessionId"] as? String,
            threadId: rawConfig["threadId"] as? String,
            chatProfile: rawConfig["chatProfile"] as? [String: Any],
            user: rawConfig["user"] as? [String: Any],
            ttsConfig: rawConfig["ttsConfig"] as? [String: Any],
            transcriptionConfig: rawConfig["transcriptionConfig"] as? [String: Any],
            initialMessages: rawConfig["initialMessages"] as? [[String: Any]],
            selectedModel: rawConfig["selectedModel"] as? String,
            selectedVoice: rawConfig["selectedVoice"] as? String,
            workspaceId: rawConfig["workspaceId"] as? String,
            username: rawConfig["username"] as? String,
            userInfo: rawConfig["userInfo"] as? [String: String],
            language: rawConfig["language"] as? String,
            videoConfig: Self.videoConfig(from: rawConfig["videoConfig"] as? [String: Any]),
            connectionOptions: Self.connectionOptions(
                from: rawConfig["connectionOptions"] as? [String: Any]
            )
        )
        config.metadata = rawConfig["metadata"] as? [String: String]

        let newClient = VoxeraClient(config: config)
        newClient.delegate = self
        client = newClient
        resolve(nil)
    }

    @objc(connect:rejecter:)
    func connect(
        _ resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        guard let client else {
            reject("NOT_CONFIGURED", "Call configure before connect", nil)
            return
        }
        client.connect()
        resolve(nil)
    }

    @objc(disconnect:rejecter:)
    func disconnect(
        _ resolve: RCTPromiseResolveBlock,
        rejecter _: RCTPromiseRejectBlock
    ) {
        client?.disconnect()
        resolve(nil)
    }

    @objc(startConversation:rejecter:)
    func startConversation(
        _ resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        guard let client else {
            reject("NOT_CONFIGURED", "Call configure before starting a conversation", nil)
            return
        }
        client.startConversation()
        resolve(nil)
    }

    @objc(endConversation:rejecter:)
    func endConversation(
        _ resolve: RCTPromiseResolveBlock,
        rejecter _: RCTPromiseRejectBlock
    ) {
        client?.endConversation()
        resolve(nil)
    }

    @objc(sendMessage:resolver:rejecter:)
    func sendMessage(
        _ message: String,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        guard let client else {
            reject("NOT_CONFIGURED", "Call configure before sending a message", nil)
            return
        }
        client.sendMessage(message)
        resolve(nil)
    }

    @objc(selectAction:result:resolver:rejecter:)
    func selectAction(
        _ actionId: String,
        result: String,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        guard let client else {
            reject("NOT_CONFIGURED", "Call configure before answering a tool call", nil)
            return
        }
        client.selectAction(message: result, actionId: actionId)
        resolve(nil)
    }

    @objc(setMuted:resolver:rejecter:)
    func setMuted(
        _ muted: Bool,
        resolver resolve: RCTPromiseResolveBlock,
        rejecter reject: RCTPromiseRejectBlock
    ) {
        guard let client else {
            reject("NOT_CONFIGURED", "Call configure before changing mute state", nil)
            return
        }
        client.setMuted(muted)
        emit("muteChanged", ["muted": muted])
        resolve(nil)
    }

    @objc(startCamera:resolver:rejecter:)
    func startCamera(
        _ front: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard let client else {
            reject("NOT_CONFIGURED", "Call configure before starting the camera", nil)
            return
        }
        Task {
            do {
                try await client.startCamera(position: front ? .front : .back)
                resolve(nil)
            } catch {
                reject("CAMERA_ERROR", error.localizedDescription, error)
            }
        }
    }

    @objc(stopCamera:rejecter:)
    func stopCamera(
        _ resolve: RCTPromiseResolveBlock,
        rejecter _: RCTPromiseRejectBlock
    ) {
        client?.stopCamera()
        emit("localVideoTrack", ["trackId": NSNull()])
        resolve(nil)
    }

    @objc(switchCamera:rejecter:)
    func switchCamera(
        _ resolve: RCTPromiseResolveBlock,
        rejecter _: RCTPromiseRejectBlock
    ) {
        client?.switchCamera()
        resolve(nil)
    }

    func client(_ client: VoxeraClient, didChangeConnectionStatus status: ConnectionStatus) {
        emit("connectionState", ["status": status.rawValue])
    }

    func client(_ client: VoxeraClient, didChangeConversationStatus status: ConversationStatus) {
        emit("conversationState", ["status": status.rawValue])
    }

    func client(_ client: VoxeraClient, didChangeSpeakingStatus status: SpeakingStatus) {
        emit("speakingState", ["status": status.rawValue])
    }

    func client(_ client: VoxeraClient, didReceiveMessage message: ConversationMessage) {
        var payload: [String: Any] = [
            "id": message.id,
            "messageId": message.messageId,
            "role": message.role.rawValue,
            "content": message.content,
            "timestamp": message.timestamp.timeIntervalSince1970 * 1_000,
            "isFinal": message.isFinal
        ]
        if let fullText = message.fullText { payload["fullText"] = fullText }
        if let metadata = message.metadata { payload["metadata"] = metadata }
        emit("message", payload)
    }

    func client(_ client: VoxeraClient, didFailWithError error: VoxeraError) {
        var payload: [String: Any] = [
            "code": error.code.rawValue,
            "message": error.message
        ]
        if let details = error.details { payload["details"] = details }
        emit("error", payload)
    }

    func client(
        _ client: VoxeraClient,
        didReceiveToolCalls tools: [ToolCall],
        messageId: String
    ) {
        for tool in tools {
            // ToolCallFunction.arguments is already [String: Any] — the SDK
            // decodes it off the socket — so it crosses the bridge as-is and
            // reaches JS as an object, matching the web SDK.
            emit("toolTriggered", [
                "actionId": tool.id,
                "name": tool.function.name,
                "arguments": tool.function.arguments,
                "messageId": messageId
            ])
        }
    }

    func client(_ client: VoxeraClient, didReceiveRemoteAudioTrack track: RTCMediaStreamTrack) {
        emit("remoteAudioTrack", ["trackId": track.trackId])
    }

    func client(_ client: VoxeraClient, didReceiveRemoteVideoTrack track: RTCMediaStreamTrack) {
        emit("remoteVideoTrack", ["trackId": track.trackId])
    }

    func client(_ client: VoxeraClient, didUpdateAudioLevel level: Float) {
        emit("audioLevel", ["level": level])
    }

    func client(_ client: VoxeraClient, didUpdateAIAudioLevel level: Float) {
        emit("aiAudioLevel", ["level": level])
    }

    func client(_ client: VoxeraClient, didUpdateTranscript transcript: String) {
        emit("transcript", ["text": transcript, "isFinal": false])
    }

    private func emit(_ type: String, _ data: [String: Any]) {
        guard hasListeners else { return }
        let body: [String: Any] = ["type": type, "data": data]
        if Thread.isMainThread {
            sendEvent(withName: "VoxeraEvent", body: body)
        } else {
            DispatchQueue.main.async { [weak self] in
                guard let self, self.hasListeners else { return }
                self.sendEvent(withName: "VoxeraEvent", body: body)
            }
        }
    }

    private static func videoConfig(from raw: [String: Any]?) -> VideoConfig? {
        guard let raw else { return nil }
        return VideoConfig(
            enabled: raw["enabled"] as? Bool ?? false,
            width: raw["width"] as? Int ?? 1280,
            height: raw["height"] as? Int ?? 720,
            frameRate: raw["frameRate"] as? Int ?? 30,
            enableVideoAI: raw["enableVideoAI"] as? Bool ?? false,
            useFrontCamera: raw["useFrontCamera"] as? Bool ?? true
        )
    }

    private static func connectionOptions(from raw: [String: Any]?) -> ConnectionOptions {
        guard let raw else { return ConnectionOptions() }
        return ConnectionOptions(
            autoReconnect: raw["autoReconnect"] as? Bool ?? true,
            reconnectAttempts: raw["reconnectAttempts"] as? Int ?? 3,
            reconnectDelay: TimeInterval(raw["reconnectDelayMs"] as? Double ?? 1_000) / 1_000,
            timeout: TimeInterval(raw["timeoutMs"] as? Double ?? 30_000) / 1_000
        )
    }
}
