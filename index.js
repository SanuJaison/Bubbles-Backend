require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");

const { assertSecureConfig } = require("./utils/authTokens");

try {
    assertSecureConfig();
} catch (error) {
    console.error(`Refusing to start insecurely: ${error.message}`);
    process.exit(1);
}

require("./config/db");

const socketAuthMiddleware = require("./middleware/socketAuthMiddleware");
const socketHandler = require("./sockets/socketHandler");
const userRoutes = require("./routes/userRoutes");
const chatRoutes = require("./routes/chatRoutes");
const messageRoutes = require("./routes/messageRoutes");
const aiRoutes = require("./routes/aiRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const adminRoutes = require("./routes/adminRoutes");
const errorMiddleware = require("./middleware/errorMiddleware");
const { apiLimiter } = require("./middleware/rateLimiters");
const {
    noStore,
    sanitizeRequest,
} = require("./middleware/securityMiddleware");

const bubblesServer = express();

const defaultOrigins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
];

const allowedOrigins = (
    process.env.CLIENT_URLS ||
    process.env.CLIENT_URL ||
    defaultOrigins.join(",")
)
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

const isAllowedOrigin = (origin) => {
    if (!origin) {
        return true;
    }

    return allowedOrigins.includes(origin.replace(/\/+$/, ""));
};

const corsOptions = {
    origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["RateLimit", "RateLimit-Policy"],
    credentials: false,
    maxAge: 86400,
    optionsSuccessStatus: 204,
};

bubblesServer.disable("x-powered-by");
bubblesServer.use(
    helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" },
        referrerPolicy: { policy: "no-referrer" },
    })
);
bubblesServer.use(cors(corsOptions));
bubblesServer.use(express.json({ limit: "1mb", strict: true }));
bubblesServer.use(
    express.urlencoded({ extended: false, limit: "100kb", parameterLimit: 100 })
);
bubblesServer.use(sanitizeRequest);
bubblesServer.use("/api", noStore, apiLimiter);

bubblesServer.use("/api/users", userRoutes);
bubblesServer.use("/api/chats", chatRoutes);
bubblesServer.use("/api/messages", messageRoutes);
bubblesServer.use("/api/ai", aiRoutes);
bubblesServer.use("/api/feedback", feedbackRoutes);
bubblesServer.use("/api/admin", adminRoutes);

bubblesServer.get("/", (req, res) => {
    res.status(200).json({
        status: "ok",
        service: "Bubbles Chat Server",
    });
});

bubblesServer.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found",
    });
});

bubblesServer.use(errorMiddleware);

const PORT = Number(process.env.PORT) || 5000;

const server = http.createServer(bubblesServer);

server.headersTimeout = 65000;
server.requestTimeout = 120000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 100;

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            callback(null, isAllowedOrigin(origin));
        },
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    },
    maxHttpBufferSize: 256 * 1024,
    allowEIO3: false,
    pingTimeout: 30000,
    pingInterval: 25000,
});

bubblesServer.set("io", io);

io.use(socketAuthMiddleware);

socketHandler(io);

server.listen(PORT, () => {
    console.log(`Bubbles Chat Server is running on port ${PORT}`);
});
