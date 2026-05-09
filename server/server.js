import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = 5000;
const SYSTEM_PROMPT =
  "You are a helpful AI support assistant for a tech startup. Be concise and friendly.";
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const MAX_HISTORY_MESSAGES = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitStore = new Map();

app.use(cors());
app.use(express.json({ limit: "32kb" }));

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: GROQ_BASE_URL,
});

function formatHistory(history = []) {
  // Groq uses the OpenAI-compatible role/content message format.
  return history
    .filter((message) => message?.text && ["user", "ai"].includes(message.sender))
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.sender === "user" ? "user" : "assistant",
      content: message.text,
    }));
}

function rateLimit(req, res, next) {
  const clientId = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const clientRecord = rateLimitStore.get(clientId) || {
    count: 0,
    resetAt: now + RATE_LIMIT_WINDOW_MS,
  };

  if (now > clientRecord.resetAt) {
    clientRecord.count = 0;
    clientRecord.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  clientRecord.count += 1;
  rateLimitStore.set(clientId, clientRecord);

  if (clientRecord.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      error: "Too many messages. Please wait a minute before trying again.",
    });
  }

  return next();
}

function getGroqErrorResponse(error) {
  const message = error.message || "";

  if (error.status === 401) {
    return {
      status: 401,
      message: "Groq rejected the API key. Check GROQ_API_KEY in server/.env.",
    };
  }

  if (error.status === 429 || message.toLowerCase().includes("rate limit")) {
    return {
      status: 429,
      message:
        "Groq rate limit or quota was reached. Check your Groq usage, billing, or project limits.",
    };
  }

  if (error.status === 404) {
    return {
      status: 502,
      message: `The Groq model "${GROQ_MODEL}" is not available for this API key.`,
    };
  }

  if (message.includes("fetch failed")) {
    return {
      status: 502,
      message:
        "The server could not connect to Groq. Check your internet connection, firewall, VPN, or proxy settings.",
    };
  }

  return {
    status: 500,
    message: "Something went wrong while generating a reply.",
  };
}

app.post("/chat", rateLimit, async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: "Missing GROQ_API_KEY. Add it to server/.env and restart the server.",
      });
    }

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "A non-empty message string is required." });
    }

    if (message.length > 2000) {
      return res.status(400).json({
        error: "Message is too long. Please keep it under 2,000 characters.",
      });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({ error: "History must be an array." });
    }

    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...formatHistory(history),
        { role: "user", content: message },
      ],
      temperature: 0.4,
    });

    const reply = completion.choices[0]?.message?.content?.trim();

    if (!reply) {
      return res.status(502).json({
        error: "Groq returned an empty reply. Please try again.",
      });
    }

    return res.json({ reply });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    const groqError = getGroqErrorResponse(error);

    return res.status(groqError.status).json({
      error: groqError.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
