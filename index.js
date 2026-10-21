require("dotenv").config();

const express = require("express");

const http = require("http");

const { Server } = require("socket.io");

const cors = require("cors");

require("./config/db");

const socketAuthMiddleware = require("./middleware/socketAuthMiddleware");

const socketHandler = require("./sockets/socketHandler");

const userRoutes = require("./routes/userRoutes");

const chatRoutes = require("./routes/chatRoutes");

const messageRoutes = require("./routes/messageRoutes");

const aiRoutes = require("./routes/aiRoutes");

const errorMiddleware = require("./middleware/errorMiddleware");

const bubblesServer = express();

bubblesServer.use(cors());

bubblesServer.use(express.json());

bubblesServer.use("/api/users", userRoutes);

bubblesServer.use("/api/chats", chatRoutes);

bubblesServer.use("/api/messages", messageRoutes);

bubblesServer.use("/api/ai", aiRoutes);

bubblesServer.get("/", (req, res) => {
    res.status(200).send("Bubbles Chat Server started");
});

bubblesServer.use(errorMiddleware);

const PORT = process.env.PORT;

const server = http.createServer(bubblesServer);

const io = new Server(server, {
    cors: {
        origin: "http://localhost:5173",
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE"]
    }
});

bubblesServer.set("io", io);

io.use(socketAuthMiddleware);

socketHandler(io);

server.listen(PORT, () => {
    console.log(`Bubbles Chat Server is running on port ${PORT}`);
});