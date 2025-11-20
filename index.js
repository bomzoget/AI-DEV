/*
  Kryp AI Agent — Self-Update Master Version
  (Thai + English Version)

  This file is the MASTER version for self-update.
  Place this file inside your update repository.
*/

const TelegramBot = require("node-telegram-bot-api");
const { Octokit } = require("octokit");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

const SELF_UPDATE_REPO_OWNER = process.env.SELF_UPDATE_REPO_OWNER;
const SELF_UPDATE_REPO_NAME = process.env.SELF_UPDATE_REPO_NAME;
const SELF_UPDATE_PATH = process.env.SELF_UPDATE_PATH || "index.js";

const ALLOW_USER_IDS = (process.env.ALLOW_USER_IDS || "")
  .split(",")
  .map((x) => x.trim())
  .filter((x) => x.length > 0);

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const octokit = new Octokit({ auth: GITHUB_TOKEN });

function isAllowed(id) {
  return ALLOW_USER_IDS.includes(String(id));
}

bot.onText(/^\/myid$/, (msg) => {
  bot.sendMessage(msg.chat.id, `🆔 Your Telegram ID: ${msg.from.id}`);
});

// ===================
// MAIN COMMAND SYSTEM
// ===================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (!isAllowed(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⛔ Access denied — You are not allowed to use this bot."
    );
  }

  // /read filename
  if (text.startsWith("/read")) {
    const path = text.split(" ")[1];
    if (!path) return bot.sendMessage(chatId, "❗ Usage: /read filename");

    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path,
      });

      const content = Buffer.from(data.content, "base64").toString("utf8");
      return bot.sendMessage(chatId, `📄 File: ${path}\n\n${content}`);
    } catch (err) {
      return bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  }

  // =======================
  // SELF UPDATE FUNCTION
  // =======================
  if (text === "/self-update") {
    bot.sendMessage(chatId, "🔄 Fetching latest bot version…");

    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: SELF_UPDATE_REPO_OWNER,
        repo: SELF_UPDATE_REPO_NAME,
        path: SELF_UPDATE_PATH,
      });

      const newCode = data.content;
      const shaBot = await getSha("index.js");

      await octokit.rest.repos.createOrUpdateFileContents({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: "index.js",
        message: "Bot updated via /self-update",
        content: newCode,
        sha: shaBot,
      });

      return bot.sendMessage(
        chatId,
        "✅ Self-update completed!\nPlease restart the bot on Railway."
      );
    } catch (err) {
      return bot.sendMessage(chatId, `❌ Update failed: ${err.message}`);
    }
  }
});

// Helper — Get SHA
async function getSha(path) {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path,
    });
    return data.sha;
  } catch (e) {
    return undefined;
  }
}

console.log("🔥 Kryp AI Agent — Self-Update Ready");