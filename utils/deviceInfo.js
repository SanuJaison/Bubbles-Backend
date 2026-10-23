const crypto = require("crypto");
const User = require("../models/userModel");
const { asTrimmedString } = require("./validation");

const MAX_DEVICES = 8;
const DEVICE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;

const cleanHeader = (value) =>
    asTrimmedString(Array.isArray(value) ? value[0] : value)
        .replace(/^"|"$/g, "")
        .slice(0, 500);

const normalizeDeviceId = (value) => {
    const id = asTrimmedString(value);

    return DEVICE_ID_PATTERN.test(id) ? id : "";
};

const parseDevice = (userAgent, hints = {}) => {
    const ua = cleanHeader(userAgent);
    const lower = ua.toLowerCase();
    const platform = cleanHeader(hints.platform).toLowerCase();
    const mobileHint = cleanHeader(hints.mobile).toLowerCase();

    let type = "unknown";
    const androidTablet =
        /android/i.test(lower) && !/mobile/i.test(lower);

    if (
        /ipad|tablet|playbook|silk/i.test(lower) ||
        platform === "ipados" ||
        androidTablet
    ) {
        type = "tablet";
    } else if (
        /mobi|iphone|ipod|android|blackberry|iemobile|opera mini|windows phone/i.test(
            lower
        ) ||
        mobileHint === "?1"
    ) {
        type = "mobile";
    } else if (ua) {
        type = "desktop";
    }

    let os = "Unknown";

    if (/windows phone/i.test(lower)) {
        os = "Windows Phone";
    } else if (/windows nt|windows/i.test(lower)) {
        os = "Windows";
    } else if (/android/i.test(lower)) {
        os = "Android";
    } else if (/iphone|ipad|ipod/i.test(lower) || platform === "ios") {
        os = "iOS";
    } else if (/cros/i.test(lower) || platform === "chrome os") {
        os = "ChromeOS";
    } else if (/mac os x|macintosh/i.test(lower) || platform === "macos") {
        os = "macOS";
    } else if (/linux/i.test(lower) || platform === "linux") {
        os = "Linux";
    }

    let browser = "Unknown";

    if (/edg\//i.test(lower)) {
        browser = "Edge";
    } else if (/opr\/|opera/i.test(lower)) {
        browser = "Opera";
    } else if (/samsungbrowser/i.test(lower)) {
        browser = "Samsung Internet";
    } else if (/firefox|fxios/i.test(lower)) {
        browser = "Firefox";
    } else if (/chrome|crios/i.test(lower)) {
        browser = "Chrome";
    } else if (/safari/i.test(lower)) {
        browser = "Safari";
    } else if (/msie|trident/i.test(lower)) {
        browser = "Internet Explorer";
    }

    return {
        type,
        os,
        browser,
        userAgent: ua,
    };
};

const getIpAddress = (headers = {}) => {
    const forwarded = cleanHeader(headers["x-forwarded-for"])
        .split(",")[0]
        .trim();
    const candidate = forwarded || cleanHeader(headers["x-real-ip"]);

    if (!candidate) {
        return "";
    }

    const cleaned = candidate.replace(/[^a-fA-F0-9:.]/g, "").slice(0, 64);

    return cleaned.length >= 3 ? cleaned : "";
};

const buildDeviceDetails = ({ headers = {}, deviceId = "" } = {}) => {
    const parsed = parseDevice(headers["user-agent"], {
        platform: headers["sec-ch-ua-platform"],
        mobile: headers["sec-ch-ua-mobile"],
    });
    const ip = getIpAddress(headers);
    const cleanDeviceId =
        normalizeDeviceId(deviceId) ||
        crypto
            .createHash("sha256")
            .update(`${parsed.userAgent}|${ip}`)
            .digest("hex")
            .slice(0, 32);

    return {
        ...parsed,
        deviceId: cleanDeviceId,
        ip,
    };
};

const getRequestDeviceDetails = (req) =>
    buildDeviceDetails({
        headers: req?.headers || {},
        deviceId: req?.body?.deviceId,
    });

const recordUserDevice = async (userOrId, details) => {
    const userId = userOrId?._id || userOrId;
    const user =
        userOrId?._id && Array.isArray(userOrId.devices)
            ? userOrId
            : await User.findById(userId);

    if (!user) {
        return null;
    }

    const safeDetails = buildDeviceDetails({
        headers: {},
        deviceId: details?.deviceId,
    });

    // Preserve the parsed values supplied by the caller. The fallback above is
    // only here so a malformed device payload can never crash sign-in.
    const nextDetails = {
        deviceId: normalizeDeviceId(details?.deviceId) || safeDetails.deviceId,
        type: ["desktop", "mobile", "tablet", "unknown"].includes(details?.type)
            ? details.type
            : safeDetails.type,
        os: asTrimmedString(details?.os).slice(0, 60) || safeDetails.os,
        browser:
            asTrimmedString(details?.browser).slice(0, 60) ||
            safeDetails.browser,
        userAgent:
            asTrimmedString(details?.userAgent).slice(0, 500) ||
            safeDetails.userAgent,
        ip: asTrimmedString(details?.ip).slice(0, 64) || safeDetails.ip,
    };

    const now = new Date();
    const devices = Array.isArray(user.devices)
        ? Array.from(user.devices)
        : [];
    const existing = devices.find(
        (device) => device.deviceId === nextDetails.deviceId
    );

    if (existing) {
        existing.type = nextDetails.type;
        existing.os = nextDetails.os;
        existing.browser = nextDetails.browser;
        existing.userAgent = nextDetails.userAgent;
        existing.ip = nextDetails.ip;
        existing.lastActiveAt = now;
    } else {
        devices.push({
            ...nextDetails,
            firstSeenAt: now,
            lastActiveAt: now,
        });
    }

    user.devices = devices
        .sort(
            (left, right) =>
                new Date(right.lastActiveAt).getTime() -
                new Date(left.lastActiveAt).getTime()
        )
        .slice(0, MAX_DEVICES);
    user.markModified("devices");

    await user.save();

    return user.devices;
};

module.exports = {
    MAX_DEVICES,
    buildDeviceDetails,
    getRequestDeviceDetails,
    normalizeDeviceId,
    parseDevice,
    recordUserDevice,
};
