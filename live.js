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

function getFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem("favMatches") || "[]"));
  } catch (e) {
    return new Set();
  }
}

function toggleFavorite(fixtureId) {
  const favs = getFavorites();
  const key = String(fixtureId);
  if (favs.has(key)) favs.delete(key); else favs.add(key);
  localStorage.setItem("favMatches", JSON.stringify([...favs]));
  return favs.has(key);
}

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

  let timeColHTML;
  if (info.kind === "live") {
    timeColHTML = `<span class="live-tag"><span class="live-dot"></span>${info.label}</span>`;
  } else if (info.kind === "finished") {
    timeColHTML = `<span class="final-tag">FT</span>`;
  } else if (info.kind === "scheduled") {
    timeColHTML = `<span class="kick-time">${info.label}</span>`;
  } else {
    timeColHTML = `<span class="final-tag">${info.label}</span>`;
  }

  const homeScore = hasScore ? gh : "";
  const awayScore = hasScore ? ga : "";
  const scoreColClass = hasScore ? "score-col" : "score-col score-col-hidden";

  const venue = f.fixture.venue && f.fixture.venue.name ? f.fixture.venue.name : null;
  const referee = f.fixture.referee || null;
  const detailBits = [venue, referee ? `Referee: ${referee}` : null].filter(Boolean);
  const metaHTML = detailBits.length ? detailBits.join(" · ") : "No further details available.";

  const isFav = getFavorites().has(String(f.fixture.id));

  return `<div class="match" data-fixture-id="${f.fixture.id}">
    <div class="match-row">
      <div class="time-col">${timeColHTML}</div>
      <div class="teams-col">
        <div class="team-row"><img class="crest" src="${home.logo}" alt="" loading="lazy"><span class="team-name">${home.name}</span></div>
        <div class="team-row"><img class="crest" src="${away.logo}" alt="" loading="lazy"><span class="team-name">${away.name}</span></div>
      </div>
      <div class="${scoreColClass}">
        <span class="score-num">${homeScore}</span>
        <span class="score-num">${awayScore}</span>
      </div>
      <div class="fav-star ${isFav ? "active" : ""}" data-fav="1">★</div>
    </div>
    <div class="match-detail">
      <div class="detail-meta">${metaHTML}</div>
      <div class="detail-events" data-loaded="false"><span class="detail-hint">Tap to load goals, cards &amp; corners</span></div>
    </div>
  </div>`;
}

function eventIcon(ev) {
  if (ev.type === "Goal") {
    if (ev.detail === "Missed Penalty") return "❌";
    if (ev.detail === "Own Goal") return "⚽ (OG)";
    return "⚽";
  }
  if (ev.type === "Card") return ev.detail === "Red Card" ? "🟥" : "🟨";
  return "•";
}

function eventLineHTML(ev) {
  const min = ev.time.elapsed + (ev.time.extra ? "+" + ev.time.extra : "");
  const player = ev.player && ev.player.name ? ev.player.name : "Unknown";
  return `<div class="event-line"><span class="event-min">${min}'</span><span class="event-icon">${eventIcon(ev)}</span><span class="event-player">${player}</span><span class="event-team">${ev.team.name}</span></div>`;
}

async function loadMatchDetail(fixtureId, panel) {
  panel.innerHTML = `<span class="detail-hint">Loading…</span>`;
  try {
    const [evData, statData] = await Promise.all([
      cachedFetch(`evt_${fixtureId}`, `${API_HOST}/fixtures/events?fixture=${fixtureId}`, 5),
      cachedFetch(`stat_${fixtureId}`, `${API_HOST}/fixtures/statistics?fixture=${fixtureId}`, 5)
    ]);

    const events = (evData.response || [])
      .filter(e => e.type === "Goal" || e.type === "Card")
      .sort((a, b) => a.time.elapsed - b.time.elapsed);

    let html = events.length
      ? `<div class="event-list">${events.map(eventLineHTML).join("")}</div>`
      : `<div class="detail-hint">No goals or cards yet.</div>`;

    const stats = statData.response || [];
    if (stats.length === 2) {
      const corners = stats.map(t => {
        const s = (t.statistics || []).find(x => x.type === "Corner Kicks");
        return s && s.value !== null ? s.value : 0;
      });
      html += `<div class="stat-line">Corners: ${corners[0]} – ${corners[1]}</div>`;
    }

    panel.innerHTML = html;
  } catch (e) {
    panel.innerHTML = `<span class="detail-hint">Couldn't load match details.</span>`;
  }
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
        <div class="league-titles">
          <span class="league-name">${g.league.name}</span>
          <span class="league-country">${g.league.country || ""}</span>
        </div>
        <span class="league-chevron">›</span>
      </div>
      <div class="league-matches">${g.matches.map(matchRowHTML).join("")}</div>
    </div>`;
  });
  container.innerHTML = html;
  bindMatchClicks(container);
}

function bindMatchClicks(container) {
  container.querySelectorAll(".match").forEach(row => {
    const fixtureId = row.dataset.fixtureId;
    const star = row.querySelector(".fav-star");

    if (star) {
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        const nowFav = toggleFavorite(fixtureId);
        star.classList.toggle("active", nowFav);
      });
    }

    row.addEventListener("click", () => {
      const wasExpanded = row.classList.contains("expanded");
      row.classList.toggle("expanded");
      if (!wasExpanded) {
        const panel = row.querySelector(".detail-events");
        if (panel && panel.dataset.loaded !== "true") {
          panel.dataset.loaded = "true";
          loadMatchDetail(fixtureId, panel);
        }
      }
    });
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
  const scoreNums = row.querySelectorAll(".score-num");
  const scoreCol = row.querySelector(".score-col");
  const timeCol = row.querySelector(".time-col");
  if (scoreNums.length === 2 && f.goals.home !== null) {
    scoreNums[0].textContent = f.goals.home;
    scoreNums[1].textContent = f.goals.away;
    if (scoreCol) scoreCol.classList.remove("score-col-hidden");
  }
  if (timeCol) {
    if (info.kind === "live") {
      timeCol.innerHTML = `<span class="live-tag"><span class="live-dot"></span>${info.label}</span>`;
    } else if (info.kind === "finished") {
      timeCol.innerHTML = `<span class="final-tag">FT</span>`;
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

function dayLabel(offset) {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function initBoardControls(onChange) {
  const bar = document.querySelector(".datebar .wrap");
  if (!bar) return;

  let offset = 0;
  let liveOnly = false;

  bar.innerHTML = `
    <button type="button" class="live-pill" aria-pressed="false">LIVE</button>
    <button type="button" class="day-arrow" data-dir="-1" aria-label="Previous day">‹</button>
    <span class="day-label">Today</span>
    <button type="button" class="day-arrow" data-dir="1" aria-label="Next day">›</button>
  `;

  const livePill = bar.querySelector(".live-pill");
  const label = bar.querySelector(".day-label");
  const arrows = bar.querySelectorAll(".day-arrow");

  function render() {
    label.textContent = liveOnly ? "Live matches" : dayLabel(offset);
    livePill.classList.toggle("active", liveOnly);
    arrows.forEach(a => a.disabled = liveOnly);
  }

  livePill.addEventListener("click", () => {
    liveOnly = !liveOnly;
    render();
    onChange(offset, liveOnly);
  });

  arrows.forEach(a => {
    a.addEventListener("click", () => {
      if (liveOnly) return;
      offset += parseInt(a.dataset.dir, 10);
      render();
      onChange(offset, liveOnly);
    });
  });

  render();
}
