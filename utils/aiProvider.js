const getDefaultProvider = (isGroqKey, isOpenRouterKey, isGeminiKey) => {
    if (isGroqKey) {
        return {
            baseUrl: "https://api.groq.com/openai/v1",
            model: "openai/gpt-oss-20b",
            visionModel: "qwen/qwen3.8-27b",
            whisperModel: "whisper-large-v3-turbo",
        };
    }

    if (isOpenRouterKey) {
        return {
            baseUrl: "https://openrouter.ai/api/v1",
            model: "openrouter/free",
            visionModel: "openrouter/free",
            whisperModel: "",
        };
    }

    if (isGeminiKey) {
        return {
            baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            model: "gemini-2.5-flash",
            visionModel: "gemini-2.5-flash",
            whisperModel: "",
        };
    }

    return {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        visionModel: "gpt-4o-mini",
        whisperModel: "whisper-1",
    };
};

const getAIProvider = () => {
    const apiKey =
        process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";

    const isGroqKey = apiKey.startsWith("gsk_");
    const isOpenRouterKey = apiKey.startsWith("sk-or-v1-");
    const isGeminiKey = apiKey.startsWith("AIza");

    const defaults = getDefaultProvider(
        isGroqKey,
        isOpenRouterKey,
        isGeminiKey
    );

    const baseUrl = (
        process.env.AI_BASE_URL ||
        process.env.OPENAI_BASE_URL ||
        defaults.baseUrl
    ).replace(/\/+$/, "");

    const model =
        process.env.AI_MODEL || process.env.OPENAI_MODEL || defaults.model;

    const visionModel =
        process.env.AI_VISION_MODEL || defaults.visionModel || model;

    const whisperModel =
        process.env.AI_WHISPER_MODEL || defaults.whisperModel || "";

    return {
        apiKey,
        baseUrl,
        model,
        visionModel,
        whisperModel,
        isGroqKey,
        supportsBrowserSearch:
            isGroqKey && /^openai\/gpt-oss/i.test(model),
        supportsTranscription: Boolean(whisperModel),
        chatEndpoint: `${baseUrl}/chat/completions`,
        transcriptionEndpoint: `${baseUrl}/audio/transcriptions`,
    };
};

const getTranscriptionError = (status, payload) => {
    if (status === 401) {
        return "Voice transcription couldn't authenticate. Check the AI API key.";
    }

    if (status === 429) {
        return "Voice transcription is busy right now. Try again in a moment.";
    }

    if (status === 413) {
        return "That voice message is too large to transcribe.";
    }

    return (
        payload?.error?.message ||
        "Voice transcription failed. Please try again."
    );
};

const transcribeWithProvider = async (file, provider) => {
    if (!provider.apiKey) {
        throw new Error("Bubbles AI isn't configured yet.");
    }

    if (!provider.supportsTranscription) {
        throw new Error(
            "Voice transcription isn't available for the current AI provider."
        );
    }

    if (!file?.buffer || !file.buffer.length) {
        throw new Error("The audio file is empty.");
    }

    if (file.size > 25 * 1024 * 1024) {
        throw new Error("Voice files must be 25 MB or smaller.");
    }

    const formData = new FormData();
    const filename = file.originalname || "voice-message.webm";

    formData.append(
        "file",
        new Blob([file.buffer], {
            type: file.mimetype || "audio/webm",
        }),
        filename
    );
    formData.append("model", provider.whisperModel);
    formData.append("response_format", "json");
    formData.append("temperature", "0");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
        const response = await fetch(provider.transcriptionEndpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${provider.apiKey}`,
            },
            body: formData,
            signal: controller.signal,
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
            const message = getTranscriptionError(response.status, payload);

            console.error(
                `Bubbles AI transcription error (${response.status}):`,
                payload?.error?.message || message
            );

            throw new Error(message);
        }

        const text =
            typeof payload?.text === "string" ? payload.text.trim() : "";

        if (!text) {
            throw new Error("No speech was detected in that audio.");
        }

        return text;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("Voice transcription took too long. Please try again.");
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

module.exports = {
    getAIProvider,
    transcribeWithProvider,
};
