/* ====================================================
   Kryp Ultimate AI Dev Bot v10 (Thai + English)
   Features: list, tree, read, raw, upload, delete, move, copy,
             mkdir, checkall, find, find-sol, du, stats,
             split/merge, backup, export, self-update, security
   Notes: No external AI required. Uses Octokit and node-telegram-bot-api.
==================================================== */

const TelegramBot = require('node-telegram-bot-api');
const { Octokit } = require('octokit');
const AdmZip = require('adm-zip'); // npm i adm-zip
const fs = require('fs');
const path = require('path');
const stream = require('stream');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const OWNER_TELEGRAM_ID = Number(process.env.OWNER_TELEGRAM_ID || 0);
const ALLOW_USER_IDS = process.env.ALLOW_USER_IDS ? process.env.ALLOW_USER_IDS.split(',').map(x=>Number(x.trim())) : [OWNER_TELEGRAM_ID];

if (!TELEGRAM_TOKEN || !GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.error("Missing ENV. Please set TELEGRAM_TOKEN, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const octokit = new Octokit({ auth: GITHUB_TOKEN });

console.log("🤖 Kryp Ultimate Bot v10 ready");

// ---------- Utilities ----------
function isAllowed(userId) {
  return ALLOW_USER_IDS.includes(userId) || userId === OWNER_TELEGRAM_ID;
}

function safeText(s) { return String(s || ""); }

async function getRepoContent(pathInRepo="") {
  return await octokit.rest.repos.getContent({
    owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo
  });
}

async function getFileSha(pathInRepo) {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo
    });
    return data.sha;
  } catch (e) { return null; }
}

async function readFileText(pathInRepo) {
  const { data } = await octokit.rest.repos.getContent({
    owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo
  });
  if (data.content) return Buffer.from(data.content, 'base64').toString('utf8');
  return "";
}

// chunk-safe send (split large messages)
async function sendLong(chatId, text) {
  const max = 3500;
  if (text.length <= max) return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  const parts = text.match(/[\s\S]{1,3000}/g);
  for (const p of parts) await bot.sendMessage(chatId, p, { parse_mode: 'Markdown' });
}

// ---------- Basic commands ----------
bot.onText(/^\/help$/i, (msg) => {
  const chatId = msg.chat.id;
  const help = `Kryp Bot — คำสั่งหลัก / Main commands (TH+EN)
/list [path]   — แสดงไฟล์/โฟลเดอร์\n/read <file>  — อ่านไฟล์\n/raw <file>   — ส่ง raw file (may be long)\n/delete <file> — ลบไฟล์\n/move <old> <new> — ย้าย/rename\n/copy <old> <new> — คัดลอกไฟล์\n/mkdir <path> — สร้างโฟลเดอร์\n/upload (attach file) — อัปโหลดไฟล์จาก Telegram\n/checkall — ตรวจ repo ทั้งหมด\n/find <keyword> — ค้นหา keyword ทั้ง repo\n/find-sol <keyword> — ค้นใน .sol\n/du — ขนาดไฟล์/โฟลเดอร์\n/stats — สถิติโปรเจกต์\n/backup — สร้าง zip สำรอง repo\n/self-update — (Owner only) update bot index.js from repo\n/help — แสดงผลนี้`;
  bot.sendMessage(chatId, help);
});

// LIST
bot.onText(/^\/list(?:\s+(.+))?$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ คุณไม่ได้รับอนุญาต / Not allowed");
  const p = (match && match[1]) ? match[1].trim() : "";
  try {
    const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p });
    if (!Array.isArray(data)) {
      return bot.sendMessage(chatId, `📄 This is a file. Use /read ${p}`);
    }
    let out = `📦 Contents of /${p || ''}:\n`;
    for (const item of data) out += `${item.type === 'dir' ? '📁' : '📄'} ${item.name}\n`;
    await sendLong(chatId, out);
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error: ${e.message}`);
  }
});

// READ
bot.onText(/^\/read\s+(.+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  const p = match[1].trim();
  bot.sendMessage(chatId, `📖 Reading: ${p}`);
  try {
    const text = await readFileText(p);
    if (text.length > 4000) {
      bot.sendMessage(chatId, "⚠️ File too long, showing first 4000 chars");
      await bot.sendMessage(chatId, `\`\`\`\n${text.slice(0,4000)}\n\`\`\``, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, `\`\`\`\n${text}\n\`\`\``, { parse_mode: 'Markdown' });
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Read error: ${e.message}`);
  }
});

// RAW (download file content as message or send as file via Telegram)
bot.onText(/^\/raw\s+(.+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  const p = match[1].trim();
  try {
    const text = await readFileText(p);
    // if large, send as .txt file
    if (text.length > 3500) {
      const tmp = `/tmp/${path.basename(p)}.txt`;
      fs.writeFileSync(tmp, text, 'utf8');
      await bot.sendDocument(chatId, tmp);
      fs.unlinkSync(tmp);
    } else {
      await bot.sendMessage(chatId, `\`\`\`\n${text}\n\`\`\``, { parse_mode: 'Markdown' });
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Raw error: ${e.message}`);
  }
});

// DELETE
bot.onText(/^\/delete\s+(.+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from.id;
  if (user !== OWNER_TELEGRAM_ID) return bot.sendMessage(chatId, "⛔ Only owner can delete");
  const p = match[1].trim();
  try {
    const sha = await getFileSha(p);
    if (!sha) return bot.sendMessage(chatId, "❌ File not found");
    await octokit.rest.repos.deleteFile({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p, sha, message: `Deleted ${p} via bot` });
    bot.sendMessage(chatId, `🗑️ Deleted: ${p}`);
  } catch (e) {
    bot.sendMessage(chatId, `❌ Delete error: ${e.message}`);
  }
});

// MOVE
bot.onText(/^\/move\s+(\S+)\s+(\S+)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  const oldP = match[1], newP = match[2];
  bot.sendMessage(chatId, `🚚 Moving ${oldP} -> ${newP}`);
  try {
    const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: oldP });
    const sha = data.sha, content = data.content;
    await octokit.rest.repos.createOrUpdateFileContents({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: newP, message: `Move from ${oldP}`, content });
    await octokit.rest.repos.deleteFile({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: oldP, sha, message: `Delete old after move` });
    bot.sendMessage(chatId, `✅ Moved`);
  } catch (e) { bot.sendMessage(chatId, `❌ Move error: ${e.message}`); }
});

// COPY
bot.onText(/^\/copy\s+(\S+)\s+(\S+)$/i, async (msg, match) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  const oldP = match[1], newP = match[2];
  try {
    const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: oldP });
    const content = data.content;
    await octokit.rest.repos.createOrUpdateFileContents({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: newP, message: `Copy ${oldP} to ${newP}`, content });
    bot.sendMessage(chatId, `✅ Copied`);
  } catch (e) { bot.sendMessage(chatId, `❌ Copy error: ${e.message}`); }
});

// MKDIR (just create placeholder .gitkeep)
bot.onText(/^\/mkdir\s+(.+)$/i, async (msg, match) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  const folder = match[1].trim().replace(/\/+$/,'');
  const placeholder = `${folder}/.gitkeep`;
  try {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path: placeholder,
      message: `Create folder ${folder}`, content: Buffer.from('').toString('base64')
    });
    bot.sendMessage(chatId, `📁 Created folder ${folder}`);
  } catch (e) { bot.sendMessage(chatId, `❌ Mkdir error: ${e.message}`); }
});

// UPLOAD: receive file from Telegram and push to repo
bot.on('document', async (msg) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  const doc = msg.document;
  const filename = doc.file_name;
  try {
    const fileInfo = await bot.getFile(doc.file_id);
    const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileInfo.file_path}`;
    // download
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    const base64 = Buffer.from(buf).toString('base64');
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path: `uploads/${filename}`,
      message: `Upload ${filename} via Telegram`, content: base64
    });
    bot.sendMessage(chatId, `📤 Uploaded ${filename} to uploads/${filename}`);
  } catch (e) { bot.sendMessage(chatId, `❌ Upload error: ${e.message}`); }
});

// ---------- Repo Intelligence ----------
async function scanRecursive(pathInRepo="") {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo });
    let issues = [];
    for (const item of data) {
      if (item.type === 'dir') {
        const child = await scanRecursive(item.path);
        issues = issues.concat(child);
        if (child.length === 0) issues.push({ type:'empty_folder', path: item.path, issue: 'Empty folder' });
      } else {
        try {
          const f = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: item.path });
          const txt = Buffer.from(f.data.content, 'base64').toString('utf8');
          if (!txt.trim()) issues.push({ type:'empty_file', path: item.path, issue: 'Empty file' });
          if (txt.length > 30000) issues.push({ type:'large_file', path: item.path, issue: 'Large file >30KB' });
        } catch (e) {
          issues.push({ type:'read_error', path: item.path, issue: e.message });
        }
      }
    }
    return issues;
  } catch (e) {
    return [{ type: 'read_error', path: pathInRepo, issue: e.message }];
  }
}

// CHECKALL
bot.onText(/^\/checkall$/i, async (msg) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  bot.sendMessage(chatId, "🔍 Scanning repository (recursive)...");
  const issues = await scanRecursive("");
  if (!issues.length) return bot.sendMessage(chatId, "✅ Repo looks healthy");
  let out = "⚠️ Issues found:\n\n";
  issues.forEach((it, idx) => out += `${idx+1}. [${it.type}] ${it.path}\n→ ${it.issue}\n\n`);
  await sendLong(chatId, out);
});

// FIND (generic)
bot.onText(/^\/find\s+(.+)$/i, async (msg, match) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  const kw = match[1].trim();
  bot.sendMessage(chatId, `🔎 Searching for "${kw}"...`);
  // naive walk and search
  async function walkSearch(pathInRepo="") {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo });
      let results = [];
      for (const item of data) {
        if (item.type === 'dir') results = results.concat(await walkSearch(item.path));
        else {
          try {
            const f = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: item.path });
            const txt = Buffer.from(f.data.content, 'base64').toString('utf8');
            if (txt.includes(kw)) results.push(item.path);
          } catch (e) {}
        }
      }
      return results;
    } catch (e) { return []; }
  }
  const res = await walkSearch("");
  if (!res.length) return bot.sendMessage(chatId, "🔍 Not found");
  await sendLong(chatId, `🔎 Found in files:\n` + res.join("\n"));
});

// FIND-SOL
bot.onText(/^\/find-sol\s+(.+)$/i, async (msg, match) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  const kw = match[1].trim();
  bot.sendMessage(chatId, `🔎 Searching in .sol for "${kw}"...`);
  async function walk(pathInRepo="") {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo });
      let res = [];
      for (const item of data) {
        if (item.type === 'dir') res = res.concat(await walk(item.path));
        else if (item.name.endsWith('.sol')) {
          try {
            const f = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: item.path });
            const txt = Buffer.from(f.data.content, 'base64').toString('utf8');
            if (txt.includes(kw)) res.push(item.path);
          } catch (e) {}
        }
      }
      return res;
    } catch (e) { return []; }
  }
  const out = await walk("");
  if (!out.length) return bot.sendMessage(chatId, "🔎 Not found in .sol");
  await sendLong(chatId, `🔎 Found in .sol files:\n` + out.join("\n"));
});

// DU (sizes)
bot.onText(/^\/du$/i, async (msg) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  bot.sendMessage(chatId, "📊 Calculating sizes (may take time)...");
  async function calc(pathInRepo="") {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo });
      let total = 0; let entries = [];
      for (const item of data) {
        if (item.type === 'dir') {
          const r = await calc(item.path);
          total += r.total;
          entries = entries.concat(r.entries);
        } else {
          try {
            const f = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: item.path });
            const size = Buffer.from(f.data.content, 'base64').length;
            total += size;
            entries.push({ path: item.path, size });
          } catch (e) {}
        }
      }
      return { total, entries };
    } catch (e) { return { total:0, entries:[] }; }
  }
  const r = await calc("");
  const top = r.entries.sort((a,b)=>b.size-a.size).slice(0,20);
  let out = `📊 Total bytes: ${r.total}\nTop files:\n` + top.map(t=>`${t.path} - ${t.size}`).join("\n");
  await sendLong(chatId, out);
});

// STATS
bot.onText(/^\/stats$/i, async (msg) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  bot.sendMessage(chatId, "📈 Gathering stats...");
  async function walkCount(pathInRepo="") {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo });
      let files=0, dirs=0;
      for (const item of data) {
        if (item.type==='dir') { dirs++; const r = await walkCount(item.path); files+=r.files; dirs+=r.dirs; }
        else files++;
      }
      return { files, dirs };
    } catch (e) { return { files:0, dirs:0 }; }
  }
  const r = await walkCount("");
  bot.sendMessage(chatId, `📈 Repo stats:\nFiles: ${r.files}\nFolders: ${r.dirs}`);
});

// SPLIT: split large file into parts (size in chars)
bot.onText(/^\/split\s+(\S+)\s+(\d+)$/i, async (msg, match) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  const file = match[1], size = Number(match[2]);
  try {
    const txt = await readFileText(file);
    if (!txt) return bot.sendMessage(chatId, "❌ Empty or not found");
    const parts = [];
    for (let i=0;i<txt.length;i+=size) parts.push(txt.slice(i,i+size));
    for (let i=0;i<parts.length;i++) {
      const partPath = `${file}.part${i+1}`;
      await octokit.rest.repos.createOrUpdateFileContents({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: partPath, message: `Split ${file} part ${i+1}`, content: Buffer.from(parts[i]).toString('base64') });
    }
    bot.sendMessage(chatId, `✅ Split into ${parts.length} parts`);
  } catch (e) { bot.sendMessage(chatId, `❌ Split error: ${e.message}`); }
});

// MERGE (merge parts named file.part1, file.part2 ... into outFile)
bot.onText(/^\/merge\s+(\S+)\s+(\S+)$/i, async (msg, match) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed");
  const base = match[1], outFile = match[2];
  try {
    // naive: find parts via list search
    const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: path.dirname(base) || '' });
    const parts = data.filter(d => d.name.startsWith(path.basename(base) + ".part")).sort((a,b)=>a.name.localeCompare(b.name));
    let combined = "";
    for (const p of parts) {
      const f = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: (path.dirname(base)?path.dirname(base)+"/":"") + p.name });
      combined += Buffer.from(f.data.content, 'base64').toString('utf8');
    }
    await octokit.rest.repos.createOrUpdateFileContents({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: outFile, message: `Merge parts into ${outFile}`, content: Buffer.from(combined).toString('base64') });
    bot.sendMessage(chatId, `✅ Merged into ${outFile}`);
  } catch(e){ bot.sendMessage(chatId, `❌ Merge error: ${e.message}`); }
});

// BACKUP (zip repository contents and send)
bot.onText(/^\/backup$/i, async (msg) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (user !== OWNER_TELEGRAM_ID) return bot.sendMessage(chatId, "⛔ Only owner");
  bot.sendMessage(chatId, "💾 Creating repo backup (this may take a while)...");
  const tmpdir = '/tmp/kryp_backup';
  try {
    if (fs.existsSync(tmpdir)) fs.rmSync(tmpdir, { recursive: true });
    fs.mkdirSync(tmpdir, { recursive: true });
    // naive walk and download each file
    async function download(pathInRepo="") {
      const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: pathInRepo });
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.type === 'dir') { fs.mkdirSync(path.join(tmpdir, item.path), { recursive: true }); await download(item.path); }
          else {
            const f = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: item.path });
            const txt = Buffer.from(f.data.content, 'base64');
            const outPath = path.join(tmpdir, item.path);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, txt);
          }
        }
      }
    }
    await download("");
    // zip
    const zip = new AdmZip();
    zip.addLocalFolder(tmpdir);
    const zipPath = '/tmp/kryp_repo_backup.zip';
    zip.writeZip(zipPath);
    await bot.sendDocument(chatId, zipPath);
    fs.rmSync(tmpdir, { recursive: true });
    fs.unlinkSync(zipPath);
  } catch (e) {
    bot.sendMessage(chatId, `❌ Backup error: ${e.message}`);
  }
});

// SELF-UPDATE (owner only) — pulls new index.js from a repo (SELF_UPDATE_REPO_OWNER/NAME)
bot.onText(/^\/self-update$/i, async (msg) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  if (user !== OWNER_TELEGRAM_ID) return bot.sendMessage(chatId, "⛔ Only owner");
  const sOwner = process.env.SELF_UPDATE_REPO_OWNER, sRepo = process.env.SELF_UPDATE_REPO_NAME, sPath = process.env.SELF_UPDATE_PATH || 'index.js';
  if (!sOwner || !sRepo) return bot.sendMessage(chatId, "❗ SELF_UPDATE_REPO_OWNER or SELF_UPDATE_REPO_NAME not set");
  bot.sendMessage(chatId, "🔁 Starting self-update...");
  try {
    const { data } = await new Octokit({ auth: GITHUB_TOKEN }).rest.repos.getContent({ owner: sOwner, repo: sRepo, path: sPath });
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    // commit into current repo index.js
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path: 'index.js',
      message: 'Self-update index.js via /self-update', content: Buffer.from(content).toString('base64'),
      sha: await getFileSha('index.js') || undefined
    });
    bot.sendMessage(chatId, "✅ Self-update committed. Please restart service to load new code.");
  } catch (e) {
    bot.sendMessage(chatId, `❌ Self-update failed: ${e.message}`);
  }
});

// JSON commit mode: send pure JSON object { filename, content, message }
bot.on('message', async (msg) => {
  const chatId = msg.chat.id; const user = msg.from.id;
  // ignore document messages here (handled above)
  if (!msg.text) return;
  const text = msg.text.trim();
  // ignore /commands
  if (text.startsWith('/')) return;

  // JSON mode
  if (!text.startsWith('{')) return;
  if (!isAllowed(user)) return bot.sendMessage(chatId, "⛔ Not allowed to commit");

  try {
    const data = JSON.parse(text);
    const { filename, content, message } = data;
    if (!filename || typeof content === 'undefined') return bot.sendMessage(chatId, "❌ JSON must include filename and content");
    bot.sendMessage(chatId, `🚀 Commit: ${filename}`);
    const sha = await getFileSha(filename);
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filename,
      message: message || `Update ${filename} via bot`, content: Buffer.from(content).toString('base64'), sha: sha || undefined
    });
    bot.sendMessage(chatId, `✅ Saved ${filename}`);
  } catch (e) {
    bot.sendMessage(chatId, `❌ JSON Error: ${e.message}`);
  }
});

// Fallback for unknown commands
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  // do not override JSON handler above; only react to plain small messages
  if (!msg.text) return;
  if (msg.text.startsWith('/')) {
    // unrecognized command
    const known = ['/help','/list','/read','/raw','/delete','/move','/copy','/mkdir','/upload','/checkall','/find','/find-sol','/du','/stats','/split','/merge','/backup','/self-update'];
    const cmd = msg.text.split(' ')[0];
    if (!known.includes(cmd)) bot.sendMessage(chatId, `❓ Unknown command. Use /help to see commands.`);
  }
});

process.on('unhandledRejection', (e) => console.error('UnhandledRejection', e));
process.on('uncaughtException', (e) => console.error('uncaughtException', e));