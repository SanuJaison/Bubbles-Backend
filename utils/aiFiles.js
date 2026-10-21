const path = require("path");
const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");

const { transcribeWithProvider } = require("./aiProvider");

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_PER_FILE = 7000;
const MAX_TOTAL_TEXT = 16000;

const TEXT_EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".tsv",
    ".json",
    ".xml",
    ".html",
    ".htm",
    ".css",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".cs",
    ".php",
    ".rb",
    ".go",
    ".rs",
    ".sql",
    ".yml",
    ".yaml",
    ".log",
    ".env",
]);

const isImageFile = (file) => file.mimetype?.startsWith("image/");
const isAudioFile = (file) => file.mimetype?.startsWith("audio/");
const isVideoFile = (file) => file.mimetype?.startsWith("video/");

const getExtension = (file) =>
    path.extname(file.originalname || "").toLowerCase();

const extractDocumentText = async (file) => {
    const extension = getExtension(file);

    if (file.mimetype === "application/pdf" || extension === ".pdf") {
        const parser = new PDFParse({ data: file.buffer });

        try {
            const result = await parser.getText();
            return result.text || "";
        } finally {
            await parser.destroy().catch(() => {});
        }
    }

    if (
        file.mimetype ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        extension === ".docx"
    ) {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        return result.value || "";
    }

    if (
        file.mimetype?.startsWith("text/") ||
        TEXT_EXTENSIONS.has(extension)
    ) {
        return file.buffer.toString("utf8");
    }

    return "";
};

const trimText = (value, limit = MAX_TEXT_PER_FILE) => {
    const text = String(value || "")
        .replace(/\u0000/g, "")
        .replace(/\r\n/g, "\n")
        .trim();

    if (text.length <= limit) {
        return text;
    }

    return `${text.slice(0, limit)}\n[Text truncated]`;
};

const buildAttachmentContext = async (files, provider) => {
    if (!Array.isArray(files) || files.length === 0) {
        return {
            imageDataUrls: [],
            textContext: "",
            hasImages: false,
        };
    }

    const usableImages = [];
    let skippedImages = 0;
    const textParts = [];
    const notes = [];

    (files || []).forEach((file) => {
        if (!isImageFile(file)) {
            return;
        }

        if (usableImages.length >= MAX_IMAGES) {
            skippedImages += 1;
            return;
        }

        if (file.size > MAX_IMAGE_BYTES) {
            notes.push(
                `[Image "${file.originalname}" was skipped because it is larger than 20 MB.]`
            );
            return;
        }

        usableImages.push(file);
    });

    const imageDataUrls = usableImages.map((file) => {
        const mime = file.mimetype || "image/jpeg";
        return `data:${mime};base64,${file.buffer.toString("base64")}`;
    });

    const entries = await Promise.all(
        files.map(async (file) => {
            if (isImageFile(file)) {
                return {
                    image: true,
                    text: usableImages.includes(file)
                        ? `[Attached image: ${file.originalname}]`
                        : "",
                };
            }

            if (isAudioFile(file) || isVideoFile(file)) {
                const kind = isVideoFile(file) ? "Video" : "Voice note";

                if (file.size > MAX_AUDIO_BYTES) {
                    return {
                        text: "",
                        note: `[${kind} "${file.originalname}" was attached, but its audio was not transcribed because it is larger than 25 MB.]`,
                    };
                }

                try {
                    const transcript = await transcribeWithProvider(
                        file,
                        provider
                    );

                    return {
                        text: `[${kind}: ${file.originalname}]\nTranscript: ${trimText(transcript, 5000)}`,
                    };
                } catch (error) {
                    return {
                        text: "",
                        note: `[${kind} "${file.originalname}" could not be transcribed: ${error.message}]`,
                    };
                }
            }

            try {
                const text = await extractDocumentText(file);

                if (!text.trim()) {
                    return {
                        text: "",
                        note: `[Attached file "${file.originalname}" could not be read. It may be scanned, empty, or an unsupported format.]`,
                    };
                }

                return {
                    text: `[Attached file: ${file.originalname}]\n${trimText(text)}`,
                };
            } catch (error) {
                return {
                    text: "",
                    note: `[Attached file "${file.originalname}" could not be read: ${error.message}]`,
                };
            }
        })
    );

    entries.forEach((entry) => {
        if (entry.text) {
            textParts.push(entry.text);
        }

        if (entry.note) {
            notes.push(entry.note);
        }
    });

    if (skippedImages > 0) {
        notes.push(
            `[${skippedImages} additional image${skippedImages === 1 ? "" : "s"} not analyzed. A maximum of ${MAX_IMAGES} images can be read at once.]`
        );
    }

    let textContext = [...textParts, ...notes].join("\n\n");

    if (textContext.length > MAX_TOTAL_TEXT) {
        textContext = `${textContext.slice(0, MAX_TOTAL_TEXT)}\n[Attachment text truncated]`;
    }

    return {
        imageDataUrls,
        textContext,
        hasImages: imageDataUrls.length > 0,
    };
};

module.exports = {
    buildAttachmentContext,
    MAX_IMAGES,
    MAX_IMAGE_BYTES,
    MAX_AUDIO_BYTES,
};
