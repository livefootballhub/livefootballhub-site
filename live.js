const API_KEY = "cfa369145084fa2cfae4735aefab3c65";
const API_HOST = "https://v3.football.api-sports.io";
const SEASON = 2025;

const LEAGUES = [
  { id: 39, name: "Premier League" },
  { id: 140, name: "La Liga" },
  { id: 135, name: "Serie A" },
  { id: 78, name: "Bundesliga" },
  { id: 61, name: "Ligue 1" },
  { id: 2, name: "Champions League" }
];

const CACHE_TTL_MIN = 10;

async function cachedFetch(cacheKey, url) {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      const ageMin = (Date.now() - parsed.time) / 60000;
      if (ageMin < CACHE_TTL_MIN) return parsed.data;
    }
  } catch (e) {}

  const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });
  if (!res.ok) throw new Error("API request failed: " + res.status);
  const data = await res.json();

  try {
    localStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), data }));
  } catch (e) {}

  return data;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function loadFixtures(leagueId, container) {
  container.innerHTML = '<div class="subtitle">Loading matches…</div>';
  try {
    const data = await cachedFetch(`fx_${leagueId}`, `${API_HOST}/fixtures?league=${leagueId}&season=${SEASON}&next=8`);
    const past = await cachedFetch(`fxpast_${leagueId}`, `${API_HOST}/fixtures?league=${leagueId}&season=${SEASON}&last=6`);

    let html = "";
    html += `<h1 class="pagetitle">Latest Results</h1><div class="subtitle">Most recent matches</div>`;
    (past.response || []).forEach(f => {
      const home = f.teams.home.name, away = f.teams.away.name;
      const gh = f.goals.home, ga = f.goals.away;
      html += `<div class="match"><div class="teams">${home} <span style="font-weight:400;color:#8a8f95;">vs</span> ${away}</div><div class="score">${gh} – ${ga}</div><div class="time"><span class="final-tag">Full Time</span></div></div>`;
    });

    html += `<div class="ad-slot">Ad slot — paste your AdSense code here</div>`;
