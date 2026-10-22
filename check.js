// One-shot Twitch -> Discord check. Runs once and exits (for GitHub Actions cron).
// Remembers who was live last time in seen.json so it only posts new streams.
const fs = require("fs");

const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, TWITCH_GAME_ID, DISCORD_WEBHOOK_URL } = process.env;
const SEEN_FILE = "seen.json";

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

  const res = await fetch(`https://api.twitch.tv/helix/streams?game_id=${TWITCH_GAME_ID}&first=100`, {
    headers: { "Client-ID": TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
  });
  const streams = (await res.json()).data;

  const firstRun = !fs.existsSync(SEEN_FILE);
  const seen = firstRun ? [] : JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"));

  for (const s of streams) {
    if (firstRun || seen.includes(s.user_id)) continue;
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `🎮 **${s.user_name}** is live!`,
        embeds: [{
          title: s.title || "(no title)",
          url: `https://twitch.tv/${s.user_login}`,
          color: 0x9146ff,
          fields: [{ name: "Viewers", value: String(s.viewer_count), inline: true }],
          image: { url: s.thumbnail_url.replace("{width}", "640").replace("{height}", "360") + `?t=${Date.now()}` },
          timestamp: s.started_at,
        }],
      }),
    });
  }

  fs.writeFileSync(SEEN_FILE, JSON.stringify(streams.map(s => s.user_id).sort()));
  console.log(`${streams.length} live, first run: ${firstRun}`);
}

main().catch(e => { console.error(e); process.exit(1); });
