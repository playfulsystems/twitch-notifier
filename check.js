// One-shot Twitch -> Discord check. Runs once and exits (for GitHub Actions cron).
// Posts new live streams and new clips for one or more games. Remembers what it posted in seen.json.
// TWITCH_GAME_ID can be one ID or several separated by commas, e.g. 1875225424,123456
const fs = require("fs");

const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, TWITCH_GAME_ID, DISCORD_WEBHOOK_URL } = process.env;
const SEEN_FILE = "seen.json";
const GAME_IDS = TWITCH_GAME_ID.split(",").map(s => s.trim()).filter(Boolean);

let headers;

async function twitch(path) {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, { headers });
  const json = await res.json();
  if (!res.ok) throw new Error(`Twitch ${res.status}: ${JSON.stringify(json)}`);
  return json.data || [];
}

async function discord(body) {
  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
}

async function main() {
  const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  const token = (await tokenRes.json()).access_token;
  headers = { "Client-ID": TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` };

  console.log(`Watching game IDs: ${GAME_IDS.join(", ")}`);

  // Load memory. Older versions saved a plain array of stream IDs.
  let seen = { streams: null, clips: null };
  if (fs.existsSync(SEEN_FILE)) {
    const raw = JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"));
    seen = Array.isArray(raw) ? { streams: raw, clips: null } : raw;
  }
  const posted = { streams: [], clips: [] }; // only things Discord actually accepted

  // --- Live streams (one request covers all games) ---
  const gameParams = GAME_IDS.map(id => `game_id=${id}`).join("&");
  const streams = await twitch(`streams?${gameParams}&first=100`);
  for (const s of streams) {
    console.log(`Live: ${s.user_name} (${s.game_name})`);
    if (seen.streams && !seen.streams.includes(s.user_id)) {
      try {
        await discord({
          content: `🎮 **${s.user_name}** is live!`,
          embeds: [{
            title: s.title || "(no title)",
            url: `https://twitch.tv/${s.user_login}`,
            color: 0x9146ff,
            fields: [{ name: "Viewers", value: String(s.viewer_count), inline: true }],
            image: { url: s.thumbnail_url.replace("{width}", "640").replace("{height}", "360") + `?t=${Date.now()}` },
            timestamp: s.started_at,
          }],
        });
      } catch (e) { console.error(e.message); continue; } // not marked seen, so it retries next run
    }
    posted.streams.push(s.user_id);
  }

  // --- Clips made in the last 24 hours (clips API takes one game at a time) ---
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const clips = [];
  for (const id of GAME_IDS) clips.push(...await twitch(`clips?game_id=${id}&started_at=${since}&first=100`));
  for (const c of clips) {
    if (seen.clips && !seen.clips.includes(c.id)) {
      try {
        // Discord turns the clip link into a playable preview.
        await discord({ content: `🎬 **${c.title}**\nClipped by ${c.creator_name} from ${c.broadcaster_name}'s stream\n${c.url}` });
      } catch (e) { console.error(e.message); continue; }
    }
    posted.clips.push(c.id);
  }

  // First run of each section just records what exists, without posting.
  fs.writeFileSync(SEEN_FILE, JSON.stringify({ streams: posted.streams.sort(), clips: posted.clips.sort() }));
  console.log(`${streams.length} live, ${clips.length} clips in last 24h`);
}

main().catch(e => { console.error(e); process.exit(1); });
