/* ====================================================
   Kryp Ultimate AI Dev Bot v10.1 (Patched)
   - Fixed: Large file handling (>1MB)
   - Fixed: Fetch compatibility (Require Node 18+)
   - Fixed: Temp file cleanup
==================================================== */

const TelegramBot = require('node-telegram-bot-api');
const { Octokit } = require('octokit');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const https = require('https'); // Use https for download compatibility

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const OWNER_TELEGRAM_ID = Number(process.env.OWNER_TELEGRAM_ID || 0);
const ALLOW_USER_IDS = process.env.ALLOW_USER_IDS ? process.env.ALLOW_USER_IDS.split(',').map(x=>Number(x.trim())) : [OWNER_TELEGRAM_ID];

if (!TELEGRAM_TOKEN || !GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.error("Missing ENV Variables.");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const octokit = new Octokit({ auth: GITHUB_TOKEN });

console.log("🤖 Kryp Ultimate Bot v10.1 Ready (Node 18+ Required)");

// ---------- Utilities ----------
function isAllowed(userId) {
  return ALLOW_USER_IDS.includes(userId) || userId === OWNER_TELEGRAM_ID;
}

async function getFileSha(pathInRepo) {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo
    });
    return Array.isArray(data) ? null : data.sha; // If dir, return null
  } catch (e) { return null; }
}

async function readFileText(pathInRepo) {
  const { data } = await octokit.rest.repos.getContent({
    owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo
  });
  // Fix: Handle >1MB files (API returns no content)
  if (!data.content) throw new Error("File too large (>1MB) to read via API directly.");
  return Buffer.from(data.content, 'base64').toString('utf8');
}

async function sendLong(chatId, text) {
  const max = 3000;
  if (text.length <= max) return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  const parts = text.match(/[\s\S]{1,3000}/g) || [];
  for (const p of parts) await bot.sendMessage(chatId, p); // Removed Markdown to prevent broken formatting in split messages
}

// Helper to download file without 'fetch' dependency issues
const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => { file.close(resolve); });
    }).on('error', (err) => { fs.unlink(dest, () => reject(err)); });
  });
};

// ---------- Basic Commands ----------
bot.onText(/^\/help$/i, (msg) => {
  bot.sendMessage(msg.chat.id, `🤖 **Kryp Bot v10.1 Commands:**\n\n/list [path]\n/read <file>\n/raw <file>\n/delete <file>\n/move <old> <new>\n/copy <old> <new>\n/mkdir <path>\n/upload (Attach file)\n/checkall\n/find <keyword>\n/du (Disk Usage)\n/backup (Get Zip)\n/self-update`, {parse_mode:'Markdown'});
});

// LIST
bot.onText(/^\/list(?:\s+(.+))?$/i, async (msg, match) => {
  if (!isAllowed(msg.from.id)) return;
  const p = (match && match[1]) ? match[1].trim() : "";
  try {
    const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p });
    if (!Array.isArray(data)) return bot.sendMessage(msg.chat.id, `📄 This is a file.`);
    let out = `📦 **/${p}**\n`;
    data.forEach(i => out += `${i.type==='dir'?'📁':'📄'} ${i.name}\n`);
    await sendLong(msg.chat.id, out);
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ ${e.message}`); }
});

// READ
bot.onText(/^\/read\s+(.+)$/i, async (msg, match) => {
  if (!isAllowed(msg.from.id)) return;
  const p = match[1].trim();
  bot.sendMessage(msg.chat.id, `📖 Reading: ${p}`);
  try {
    const text = await readFileText(p);
    if (text.length > 4000) {
        const preview = text.slice(0, 3000);
        await bot.sendMessage(msg.chat.id, `\`\`\`\n${preview}\n...\`\`\`\n⚠️ (Showing first 3000 chars)`, { parse_mode: 'Markdown' });
    } else {
        await bot.sendMessage(msg.chat.id, `\`\`\`\n${text}\n\`\`\``, { parse_mode: 'Markdown' });
    }
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`); }
});

// RAW (Fixed cleanup)
bot.onText(/^\/raw\s+(.+)$/i, async (msg, match) => {
  if (!isAllowed(msg.from.id)) return;
  const p = match[1].trim();
  const tmpPath = `/tmp/${path.basename(p)}`; // Ensure /tmp exists
  try {
    const text = await readFileText(p);
    fs.writeFileSync(tmpPath, text);
    await bot.sendDocument(msg.chat.id, tmpPath);
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

// DELETE
bot.onText(/^\/delete\s+(.+)$/i, async (msg, match) => {
  if (!isAllowed(msg.from.id)) return;
  const p = match[1].trim();
  try {
    const sha = await getFileSha(p);
    if (!sha) return bot.sendMessage(msg.chat.id, "❌ File not found");
    await octokit.rest.repos.deleteFile({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p, sha, message: `Bot delete ${p}` });
    bot.sendMessage(msg.chat.id, `🗑️ Deleted: ${p}`);
  } catch (e) { bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`); }
});

// UPLOAD (Fixed fetch issue)
bot.on('document', async (msg) => {
  if (!isAllowed(msg.from.id)) return;
  const doc = msg.document;
  const filename = doc.file_name;
  const tmpPath = `/tmp/${filename}`;
  
  bot.sendMessage(msg.chat.id, "⏳ Uploading...");
  try {
    const fileInfo = await bot.getFile(doc.file_id);
    const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    
    // Use Node https instead of fetch for compatibility
    await downloadFile(url, tmpPath);
    
    const content = fs.readFileSync(tmpPath, { encoding: 'base64' });
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path: `uploads/${filename}`,
      message: `Upload ${filename}`, content: content,
      sha: await getFileSha(`uploads/${filename}`) || undefined
    });
    bot.sendMessage(msg.chat.id, `✅ Uploaded to: uploads/${filename}`);
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Upload failed: ${e.message}`);
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

// BACKUP (Fixed crash on large file/API limit)
bot.onText(/^\/backup$/i, async (msg) => {
  if (msg.from.id !== OWNER_TELEGRAM_ID) return;
  bot.sendMessage(msg.chat.id, "💾 Creating Backup (Please wait)...");
  const tmpDir = '/tmp/kryp_backup_' + Date.now();
  const zipPath = `/tmp/backup_${Date.now()}.zip`;
  
  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    async function downloadRecursive(dirPath) {
      const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: dirPath });
      for (const item of data) {
        if (item.type === 'dir') {
            fs.mkdirSync(path.join(tmpDir, item.path), { recursive: true });
            await downloadRecursive(item.path);
        } else {
            // Safe check for content
            try {
                const f = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: item.path });
                if (f.data.content) {
                    fs.writeFileSync(path.join(tmpDir, item.path), Buffer.from(f.data.content, 'base64'));
                } else {
                    console.log(`Skipping large file: ${item.path}`); // Skip files > 1MB
                }
            } catch (err) { console.error(err); }
        }
      }
    }
    
    await downloadRecursive("");
    
    const zip = new AdmZip();
    zip.addLocalFolder(tmpDir);
    zip.writeZip(zipPath);
    await bot.sendDocument(msg.chat.id, zipPath);

  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Backup failed: ${e.message}`);
  } finally {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  }
});

// JSON COMMAND (Keep as is, works fine)
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/') || !msg.text.startsWith('{')) return;
  if (!isAllowed(msg.from.id)) return;
  try {
    const data = JSON.parse(msg.text);
    const { filename, content, message } = data;
    if (!filename || content === undefined) return;
    
    bot.sendMessage(msg.chat.id, `🚀 Saving ${filename}...`);
    const sha = await getFileSha(filename);
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filename,
      message: message || 'Bot update', content: Buffer.from(content).toString('base64'), sha: sha || undefined
    });
    bot.sendMessage(msg.chat.id, `✅ Saved!`);
  } catch (e) { /* Ignore invalid JSON */ }
});
