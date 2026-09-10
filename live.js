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
    html += `<h1 class="pagetitle" style="margin-top:40px;">Upcoming Fixtures</h1><div class="subtitle">Kickoff times shown in your local time</div>`;
    (data.response || []).forEach(f => {
      const home = f.teams.home.name, away = f.teams.away.name;
      html += `<div class="match"><div class="teams">${home} <span style="font-weight:400;color:#8a8f95;">vs</span> ${away}</div><div class="time">${fmtTime(f.fixture.date)}</div></div>`;
    });

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="subtitle">Couldn't load live data right now (${e.message}).</div>`;
  }
}

async function loadStandings(leagueId, container) {
  container.innerHTML = '<div class="subtitle">Loading table…</div>';
  try {
    let season = SEASON;
    let data = await cachedFetch(`st_${leagueId}_${season}`, `${API_HOST}/standings?league=${leagueId}&season=${season}`);

    // The current season sometimes has no standings data yet on this plan.
    // Fall back to the previous season so the page still shows something useful.
    if (!data.response || data.response.length === 0) {
      season = SEASON - 1;
      data = await cachedFetch(`st_${leagueId}_${season}`, `${API_HOST}/standings?league=${leagueId}&season=${season}`);
    }

    if (!data.response || data.response.length === 0) {
      container.innerHTML = `<div class="subtitle">No table data is available for this league right now.</div>`;
      return;
    }

    const table = data.response[0].league.standings[0];
    const noteHtml = season !== SEASON
      ? `<div class="subtitle">Showing ${season}/${season + 1} standings — the current season's table isn't available yet.</div>`
      : "";

    let html = noteHtml;
    html += `<table class="standings"><thead><tr><th class="rank">#</th><th>Club</th><th>W</th><th>D</th><th>L</th><th class="pts">Pts</th></tr></thead><tbody>`;
    table.forEach(row => {
      html += `<tr><td class="rank">${row.rank}</td><td>${row.team.name}</td><td>${row.all.win}</td><td>${row.all.draw}</td><td>${row.all.lose}</td><td class="pts">${row.points}</td></tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="subtitle">Couldn't load the table right now (${e.message}).</div>`;
  }
}

function initLeagueBar(onSelect) {
  const bar = document.querySelector(".leaguebar .wrap");
  if (!bar) return;
  bar.innerHTML = LEAGUES.map((l, i) => `<a href="#" data-league="${l.id}" class="${i === 0 ? "active" : ""}">${l.name}</a>`).join("");
  bar.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      bar.querySelectorAll("a").forEach(x => x.classList.remove("active"));
      a.classList.add("active");
      onSelect(a.dataset.league);
    });
  });
  return LEAGUES[0].id;
}
