package com.voxera.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.voxera.sdk.ConnectionOptions
import com.voxera.sdk.ConnectionStatus
import com.voxera.sdk.ConversationMessage
import com.voxera.sdk.ConversationStatus
import com.voxera.sdk.SpeakingStatus
import com.voxera.sdk.ToolCall
import com.voxera.sdk.VideoConfig
import com.voxera.sdk.VoxeraClient
import com.voxera.sdk.VoxeraConfig
import com.voxera.sdk.VoxeraException
import com.voxera.sdk.VoxeraListener
import org.json.JSONArray
import org.json.JSONObject

class VoxeraModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context), VoxeraListener {
    private var client: VoxeraClient? = null
    private var listenerCount = 0

    override fun getName(): String = NAME

    @ReactMethod
    fun configure(config: ReadableMap, promise: Promise) {
        try {
            val appKey = config.string("appKey")
                ?: throw IllegalArgumentException("appKey is required")
            val serverUrl = config.string("serverUrl")
                ?: throw IllegalArgumentException("serverUrl is required")

            client?.disconnect()
            client = VoxeraClient(
                context = context.applicationContext,
                config = VoxeraConfig(
                    appKey = appKey,
                    serverUrl = serverUrl,
                    agentId = config.string("agentId"),
                    userId = config.string("userId"),
                    metadata = config.stringMap("metadata"),
                    videoConfig = config.videoConfig(),
                    connectionOptions = config.connectionOptions(),
                    listener = this,
                    sessionId = config.string("sessionId"),
                    threadId = config.string("threadId"),
                    chatProfile = config.string("chatProfile")
                        ?: config.anyMap("chatProfile")?.let { JSONObject(it).toString() },
                    user = config.anyMap("user"),
                    ttsConfig = config.anyMap("ttsConfig"),
                    transcriptionConfig = config.anyMap("transcriptionConfig"),
                    initialMessages = config.mapList("initialMessages"),
                    selectedModel = config.string("selectedModel"),
                    selectedVoice = config.string("selectedVoice"),
                    workspaceId = config.string("workspaceId"),
                    username = config.string("username"),
                    userInfo = config.stringMap("userInfo"),
                    language = config.string("language"),
                ),
            ).also { it.listener = this }
            promise.resolve(null)
        } catch (error: Throwable) {
            promise.reject("INVALID_CONFIG", error.message, error)
        }
    }

    @ReactMethod
    fun connect(promise: Promise) = withClient(promise) { it.connect() }

    @ReactMethod
    fun disconnect(promise: Promise) {
        client?.disconnect()
        promise.resolve(null)
    }

    @ReactMethod
    fun startConversation(promise: Promise) = withClient(promise) { it.startConversation() }

    @ReactMethod
    fun endConversation(promise: Promise) {
        client?.endConversation()
        promise.resolve(null)
    }

    @ReactMethod
    fun sendMessage(message: String, promise: Promise) = withClient(promise) {
        it.sendMessage(message)
    }

    @ReactMethod
    fun selectAction(actionId: String, result: String, promise: Promise) = withClient(promise) {
        it.selectAction(message = result, actionId = actionId)
    }

    @ReactMethod
    fun setMuted(muted: Boolean, promise: Promise) = withClient(promise) {
        it.setMuted(muted)
    }

    @ReactMethod
    fun startCamera(front: Boolean, promise: Promise) = withClient(promise) {
        it.startCamera(front)
    }

    @ReactMethod
    fun stopCamera(promise: Promise) {
        client?.stopCamera()
        promise.resolve(null)
    }

    @ReactMethod
    fun switchCamera(promise: Promise) = withClient(promise) { it.switchCamera() }

    @ReactMethod
    fun addListener(eventName: String) {
        if (eventName == NATIVE_EVENT) listenerCount += 1
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
    }

    override fun invalidate() {
        client?.disconnect()
        client = null
        super.invalidate()
    }

    override fun onConnectionStatusChanged(status: ConnectionStatus) {
        emit("connectionState", Arguments.createMap().apply {
            putString("status", status.name.lowercase())
        })
    }

    override fun onConversationStatusChanged(status: ConversationStatus) {
        emit("conversationState", Arguments.createMap().apply {
            putString("status", status.name.lowercase())
        })
    }

    override fun onSpeakingStatusChanged(status: SpeakingStatus) {
        emit("speakingState", Arguments.createMap().apply {
            putString("status", status.name.lowercase())
        })
    }

    override fun onMessage(message: ConversationMessage) {
        emit("message", Arguments.createMap().apply {
            putString("id", message.id)
            putString("messageId", message.messageId)
            putString("role", message.role.name.lowercase())
            putString("content", message.content)
            putDouble("timestamp", message.timestamp.toDouble())
            putBoolean("isFinal", message.isFinal)
            message.fullText?.let { putString("fullText", it) }
            message.metadata?.let { putMap("metadata", Arguments.makeNativeMap(it)) }
        })
    }

    override fun onTranscript(text: String, isFinal: Boolean) {
        emit("transcript", Arguments.createMap().apply {
            putString("text", text)
            putBoolean("isFinal", isFinal)
        })
    }

    override fun onError(error: VoxeraException) {
        emit("error", Arguments.createMap().apply {
            putString("code", error.code.code)
            putString("message", error.message ?: "Unknown Voxera error")
            error.details?.let { putMap("details", Arguments.makeNativeMap(it)) }
        })
    }

    override fun onToolCalls(tools: List<ToolCall>, messageId: String) {
        for (tool in tools) {
            emit("toolTriggered", Arguments.createMap().apply {
                putString("actionId", tool.id)
                putString("name", tool.function.name)
                // ToolCallFunction.arguments is already a JSONObject — the SDK
                // decodes it off the socket — so this only re-shapes it into
                // the bridge's map type. JS receives an object, as on web.
                putMap("arguments", tool.function.arguments.toWritableMap())
                putString("messageId", messageId)
            })
        }
    }

    private fun JSONObject.toWritableMap(): WritableMap {
        val map = Arguments.createMap()
        for (key in keys()) {
            when (val value = get(key)) {
                is JSONObject -> map.putMap(key, value.toWritableMap())
                is JSONArray -> map.putArray(key, value.toWritableArray())
                is Boolean -> map.putBoolean(key, value)
                is Int -> map.putInt(key, value)
                is Long -> map.putDouble(key, value.toDouble())
                is Double -> map.putDouble(key, value)
                JSONObject.NULL -> map.putNull(key)
                else -> map.putString(key, value.toString())
            }
        }
        return map
    }

    private fun JSONArray.toWritableArray(): WritableArray {
        val array = Arguments.createArray()
        for (index in 0 until length()) {
            when (val value = get(index)) {
                is JSONObject -> array.pushMap(value.toWritableMap())
                is JSONArray -> array.pushArray(value.toWritableArray())
                is Boolean -> array.pushBoolean(value)
                is Int -> array.pushInt(value)
                is Long -> array.pushDouble(value.toDouble())
                is Double -> array.pushDouble(value)
                JSONObject.NULL -> array.pushNull()
                else -> array.pushString(value.toString())
            }
        }
        return array
    }

    override fun onAudioLevel(level: Float) {
        emit("audioLevel", Arguments.createMap().apply { putDouble("level", level.toDouble()) })
    }

    override fun onAIAudioLevel(level: Float) {
        emit("aiAudioLevel", Arguments.createMap().apply { putDouble("level", level.toDouble()) })
    }

    override fun onMuteChanged(muted: Boolean) {
        emit("muteChanged", Arguments.createMap().apply { putBoolean("muted", muted) })
    }

    private inline fun withClient(promise: Promise, action: (VoxeraClient) -> Unit) {
        val current = client
        if (current == null) {
            promise.reject("NOT_CONFIGURED", "Call configure before using Voxera")
            return
        }
        try {
            action(current)
            promise.resolve(null)
        } catch (error: Throwable) {
            promise.reject("VOXERA_ERROR", error.message, error)
        }
    }

    private fun emit(type: String, data: com.facebook.react.bridge.WritableMap) {
        if (listenerCount <= 0 || !context.hasActiveReactInstance()) return
        val body = Arguments.createMap().apply {
            putString("type", type)
            putMap("data", data)
        }
        context
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(NATIVE_EVENT, body)
    }

    private fun ReadableMap.string(key: String): String? =
        if (hasKey(key) && !isNull(key) && getType(key) == ReadableType.String) getString(key) else null

    private fun ReadableMap.bool(key: String, fallback: Boolean): Boolean =
        if (hasKey(key) && !isNull(key) && getType(key) == ReadableType.Boolean) getBoolean(key) else fallback

    private fun ReadableMap.number(key: String, fallback: Double): Double =
        if (hasKey(key) && !isNull(key) && getType(key) == ReadableType.Number) getDouble(key) else fallback

    private fun ReadableMap.childMap(key: String): ReadableMap? =
        if (hasKey(key) && !isNull(key) && getType(key) == ReadableType.Map) getMap(key) else null

    private fun ReadableMap.stringMap(key: String): Map<String, String>? =
        childMap(key)?.toHashMap()?.mapNotNull { (mapKey, value) ->
            (value as? String)?.let { mapKey to it }
        }?.toMap()

    @Suppress("UNCHECKED_CAST")
    private fun ReadableMap.anyMap(key: String): Map<String, Any>? =
        childMap(key)?.toHashMap()?.filterValues { it != null } as? Map<String, Any>

    @Suppress("UNCHECKED_CAST")
    private fun ReadableMap.mapList(key: String): List<Map<String, Any>>? {
        if (!hasKey(key) || isNull(key) || getType(key) != ReadableType.Array) return null
        return getArray(key)?.toArrayList()?.mapNotNull { item ->
            (item as? Map<String, Any?>)?.filterValues { it != null } as? Map<String, Any>
        }
    }

    private fun ReadableMap.videoConfig(): VideoConfig? = childMap("videoConfig")?.let { video ->
        VideoConfig(
            enabled = video.bool("enabled", false),
            width = video.number("width", 1280.0).toInt(),
            height = video.number("height", 720.0).toInt(),
            frameRate = video.number("frameRate", 30.0).toInt(),
            enableVideoAI = video.bool("enableVideoAI", false),
            useFrontCamera = video.bool("useFrontCamera", true),
        )
    }

    private fun ReadableMap.connectionOptions(): ConnectionOptions =
        childMap("connectionOptions")?.let { options ->
            ConnectionOptions(
                autoReconnect = options.bool("autoReconnect", true),
                reconnectAttempts = options.number("reconnectAttempts", 3.0).toInt(),
                reconnectDelayMs = options.number("reconnectDelayMs", 1_000.0).toLong(),
                timeoutMs = options.number("timeoutMs", 30_000.0).toLong(),
            )
        } ?: ConnectionOptions()

    companion object {
        private const val NAME = "VoxeraModule"
        private const val NATIVE_EVENT = "VoxeraEvent"
    }
}
