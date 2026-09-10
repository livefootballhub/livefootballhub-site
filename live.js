const API_KEY = "cfa369145084fa2cfae4735aefab3c65";
const API_HOST = "https://v3.football.api-sports.io";
const SEASON = 2025;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";

// Curated leagues, in the order they should appear on the page
const LEAGUES = [
  { id: 39, name: "Premier League" },
  { id: 140, name: "La Liga" },
  { id: 135, name: "Serie A" },
  { id: 78, name: "Bundesliga" },
  { id: 61, name: "Ligue 1" },
  { id: 2, name: "Champions League" }
];
const LEAGUE_IDS = LEAGUES.map(l => l.id);
const LEAGUE_ORDER = Object.fromEntries(LEAGUES.map((l, i) => [l.id, i]));

const LIVE_STATUSES = ["1H", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"];
const HT_STATUSES = ["HT"];
const FINISHED_STATUSES = ["FT", "AET", "PEN", "AWD", "WO"];

const CACHE_TTL_MIN = 10;
let liveRefreshTimer = null;

async function cachedFetch(cacheKey, url, ttlMin = CACHE_TTL_MIN) {
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      const ageMin = (Date.now() - parsed.time) / 60000;
      if (ageMin < ttlMin) return parsed.data;
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

async function liveFetch(url) {
  const res = await fetch(url, { headers: { "x-apisports-key": API_KEY } });
  if (!res.ok) throw new Error("API request failed: " + res.status);
  return res.json();
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function dateOffsetISO(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function statusInfo(fixture) {
  const short = fixture.fixture.status.short;
  const elapsed = fixture.fixture.status.elapsed;
  if (LIVE_STATUSES.includes(short)) return { kind: "live", label: elapsed ? `${elapsed}'` : "LIVE" };
  if (HT_STATUSES.includes(short)) return { kind: "live", label: "HT" };
  if (FINISHED_STATUSES.includes(short)) return { kind: "finished", label: "FT" };
  if (short === "PST") return { kind: "other", label: "Postponed" };
  if (short === "CANC") return { kind: "other", label: "Cancelled" };
  if (short === "ABD") return { kind: "other", label: "Abandoned" };
  return { kind: "scheduled", label: fmtTime(fixture.fixture.date) };
}

function matchRowHTML(f) {
  const home = f.teams.home, away = f.teams.away;
  const gh = f.goals.home, ga = f.goals.away;
  const info = statusInfo(f);
  const hasScore = gh !== null && gh !== undefined;

  let statusHTML;
  if (info.kind === "live") {
    statusHTML = `<span class="live-tag"><span class="live-dot"></span>${info.label}</span>`;
  } else if (info.kind === "finished") {
    statusHTML = `<span class="final-tag">FT</span>`;
  } else if (info.kind === "scheduled") {
    statusHTML = `<span class="kick-time">${info.label}</span>`;
  } else {
    statusHTML = `<span class="final-tag">${info.label}</span>`;
  }

  const scoreHTML = hasScore
    ? `<div class="score">${gh} – ${ga}</div>`
    : `<div class="score score-pending">vs</div>`;

  const venue = f.fixture.venue && f.fixture.venue.name ? f.fixture.venue.name : null;
  const referee = f.fixture.referee || null;
  const detailBits = [venue, referee ? `Referee: ${referee}` : null].filter(Boolean);
  const detailHTML = detailBits.length
    ? `<div class="match-detail">${detailBits.join(" · ")}</div>`
    : `<div class="match-detail">No further details available.</div>`;

  return `<div class="match" data-fixture-id="${f.fixture.id}">
    <div class="match-row">
      <div class="side home">
        <span class="crest"><img src="${home.logo}" alt="" loading="lazy"></span>
        <span class="team-name">${home.name}</span>
      </div>
      <div class="mid">
        ${scoreHTML}
        <div class="status-line">${statusHTML}</div>
      </div>
      <div class="side away">
        <span class="team-name">${away.name}</span>
        <span class="crest"><img src="${away.logo}" alt="" loading="lazy"></span>
      </div>
    </div>
    ${detailHTML}
  </div>`;
}

function groupMatches(matches) {
  const groups = {};
  matches.forEach(f => {
    const lid = f.league.id;
    if (!LEAGUE_IDS.includes(lid)) return;
    if (!groups[lid]) groups[lid] = { league: f.league, matches: [] };
    groups[lid].matches.push(f);
  });
  return Object.values(groups).sort((a, b) => LEAGUE_ORDER[a.league.id] - LEAGUE_ORDER[b.league.id]);
}

function renderGroups(groups, container) {
  if (!groups.length) {
    container.innerHTML = `<div class="subtitle">No matches found for this view.</div>`;
    return;
  }
  let html = "";
  groups.forEach(g => {
    g.matches.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
    html += `<div class="league-group">
      <div class="league-header">
        <img src="${g.league.logo}" alt="" loading="lazy">
        <span>${g.league.name}</span>
        <span class="league-country">${g.league.country || ""}</span>
      </div>
      ${g.matches.map(matchRowHTML).join("")}
    </div>`;
  });
  container.innerHTML = html;
  bindMatchClicks(container);
}

function bindMatchClicks(container) {
  container.querySelectorAll(".match").forEach(row => {
    row.addEventListener("click", () => row.classList.toggle("expanded"));
  });
}

function stopLiveRefresh() {
  if (liveRefreshTimer) {
    clearInterval(liveRefreshTimer);
    liveRefreshTimer = null;
  }
}

function applyLiveUpdate(f, container) {
  const row = container.querySelector(`.match[data-fixture-id="${f.fixture.id}"]`);
  if (!row) return;
  const info = statusInfo(f);
  const scoreEl = row.querySelector(".score");
  const statusEl = row.querySelector(".status-line");
  if (scoreEl && f.goals.home !== null) {
    scoreEl.textContent = `${f.goals.home} – ${f.goals.away}`;
    scoreEl.classList.remove("score-pending");
  }
  if (statusEl) {
    if (info.kind === "live") {
      statusEl.innerHTML = `<span class="live-tag"><span class="live-dot"></span>${info.label}</span>`;
    } else if (info.kind === "finished") {
      statusEl.innerHTML = `<span class="final-tag">FT</span>`;
    }
  }
}

// Poll only the specific live fixtures embedded in a date view (Today etc.)
function startIdPolling(liveIds, container) {
  stopLiveRefresh();
  if (!liveIds.length) return;
  liveRefreshTimer = setInterval(async () => {
    try {
      const idsParam = liveIds.slice(0, 20).join("-");
      const data = await liveFetch(`${API_HOST}/fixtures?ids=${idsParam}`);
      (data.response || []).forEach(f => applyLiveUpdate(f, container));
      const stillLive = (data.response || []).filter(f => statusInfo(f).kind === "live").map(f => f.fixture.id);
      liveIds = stillLive;
      if (!stillLive.length) stopLiveRefresh();
    } catch (e) {}
  }, 60000);
}

// Poll the whole live board (used by the "Live" filter) so new/ended matches appear correctly
function startLiveBoardPolling(container) {
  stopLiveRefresh();
  liveRefreshTimer = setInterval(async () => {
    try {
      const data = await liveFetch(`${API_HOST}/fixtures?live=all`);
      const groups = groupMatches(data.response || []);
      renderGroups(groups, container);
    } catch (e) {}
  }, 60000);
}

async function loadBoard(dayOffset, liveOnly, container) {
  stopLiveRefresh();
  container.innerHTML = '<div class="subtitle">Loading matches…</div>';
  try {
    if (liveOnly) {
      const data = await cachedFetch("live_all", `${API_HOST}/fixtures?live=all`, 0.5);
      const groups = groupMatches(data.response || []);
      renderGroups(groups, container);
      startLiveBoardPolling(container);
      return;
    }

    const date = dateOffsetISO(dayOffset);
    const data = await cachedFetch(
      `fxdate_all_${date}`,
      `${API_HOST}/fixtures?date=${date}&timezone=${encodeURIComponent(TZ)}`,
      dayOffset === 0 ? 2 : CACHE_TTL_MIN
    );
    const matches = data.response || [];
    const groups = groupMatches(matches);
    renderGroups(groups, container);

    const liveIds = matches.filter(f => LEAGUE_IDS.includes(f.league.id) && statusInfo(f).kind === "live").map(f => f.fixture.id);
    if (liveIds.length) startIdPolling(liveIds, container);
  } catch (e) {
    container.innerHTML = `<div class="subtitle">Couldn't load live data right now (${e.message}).</div>`;
  }
}

async function loadStandings(leagueId, container) {
  container.innerHTML = '<div class="subtitle">Loading table…</div>';
  try {
    let season = SEASON;
    let data = await cachedFetch(`st_${leagueId}_${season}`, `${API_HOST}/standings?league=${leagueId}&season=${season}`);

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
      html += `<tr><td class="rank">${row.rank}</td><td class="club-cell"><img class="crest-sm" src="${row.team.logo}" alt="" loading="lazy">${row.team.name}</td><td>${row.all.win}</td><td>${row.all.draw}</td><td>${row.all.lose}</td><td class="pts">${row.points}</td></tr>`;
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

function initBoardControls(onChange) {
  const bar = document.querySelector(".datebar .wrap");
  if (!bar) return;
  const tabs = [
    { key: "live", label: "🔴 Live" },
    { key: "-1", label: "Yesterday" },
    { key: "0", label: "Today" },
    { key: "1", label: "Tomorrow" }
  ];
  bar.innerHTML = tabs.map(t => `<a href="#" data-key="${t.key}" class="${t.key === "0" ? "active" : ""}">${t.label}</a>`).join("");
  bar.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      bar.querySelectorAll("a").forEach(x => x.classList.remove("active"));
      a.classList.add("active");
      if (a.dataset.key === "live") {
        onChange(0, true);
      } else {
        onChange(parseInt(a.dataset.key, 10), false);
      }
    });
  });
}
