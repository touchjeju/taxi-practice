/* ==========================================================================
   택시 호출 연습하기 — 동작 로직
   ─ 화면은 전부 DOM/SVG 로 그린다. 스크린샷을 붙이지 않는다.
   ─ 좌표계: "월드"는 미터 단위, 원점은 제주시청, x=동쪽 / y=남쪽.
   ========================================================================== */
(function () {
'use strict';

/* ───────────────────────── 0. 설정 / 유틸 ───────────────────────── */

// 요구사항 2-2: 핀을 잡고 끌면 지도가 드래그 방향의 "반대"로 밀린다
// (= 핀이 손가락을 따라 지도 위를 이동한다). 일반 지도앱처럼 지도가
// 손가락을 따라오게 하려면 이 값만 false 로 바꾸면 된다.
var PIN_FOLLOWS_DRAG = true;

var PPM = 1.15;          // S2 지도 배율 (화면 px / 실제 m)
var PAN_LIMIT = 400;     // 출발 핀을 현위치에서 최대 몇 m 까지 옮길 수 있나
var S2_CELL = 46;        // 도로 격자 한 칸 (m)
// tp-04 실제 화면에는 지도를 돌아다니는 택시가 없고, 출발 지점에 택시가
// 도로 방향으로 서 있다. 그래서 대수를 줄이고 주행은 끈다.
// (요구사항 2-3 의 "천천히 앞으로 움직인다"를 되살리려면 TAXI_DRIVES = true)
var TAXI_COUNT = 3;
var TAXI_DRIVES = false;

var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
var lerp = function (a, b, t) { return a + (b - a) * t; };
var esc = function (s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
};
var won = function (n) { return n.toLocaleString('ko-KR') + '원'; };

// 결정적 난수 — 같은 seed 면 항상 같은 지도가 나온다
function rngFrom(seed) {
  var a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var toastEl = $('#toast'), toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2200);
}

/* ───────────────────────── 1. 좌표 / 장소 데이터 ───────────────────────── */

var ORIGIN_LL = { lat: 33.4996, lng: 126.5312 };   // 제주시청
var M_PER_LAT = 111320;
var M_PER_LNG = 111320 * Math.cos(ORIGIN_LL.lat * Math.PI / 180);

function toWorld(lat, lng) {
  return { x: (lng - ORIGIN_LL.lng) * M_PER_LNG, y: -(lat - ORIGIN_LL.lat) * M_PER_LAT };
}
// 제주 북쪽 해안선 (월드 y 가 이보다 작으면 바다) — 위도 약 33.520
var COAST_Y = -(33.5200 - 33.4996) * 111320;

function distM(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

// 검색 가능한 장소 (실제 좌표 기준)
var PLACES = [
  ['제주국제공항',            '제주특별자치도 제주시 공항로 2',          33.5070, 126.4930],
  ['제주국제공항 Gate3(출발)','제주특별자치도 제주시 공항로 2',          33.5074, 126.4938],
  ['제주공항렌트카 본사',      '제주특별자치도 제주시 다호5길 17',        33.5030, 126.4880],
  ['에스케이제주공항충전소',   '제주특별자치도 제주시 용문로 28',         33.5065, 126.5040],
  ['제주공항주유소',          '제주특별자치도 제주시 서광로 58',         33.4990, 126.5030],
  ['제주은행 공항지점',        '제주특별자치도 제주시 공항로 2',          33.5068, 126.4935],
  ['제주시청',                '제주특별자치도 제주시 광양9길 10',        33.4996, 126.5312],
  ['제주특별자치도청',         '제주특별자치도 제주시 문연로 6',          33.4890, 126.4990],
  ['제주지방법원',            '제주특별자치도 제주시 남광북5길 3',        33.4960, 126.5320],
  ['제주시외버스터미널',       '제주특별자치도 제주시 서광로 174',        33.4993, 126.5150],
  ['제주항연안여객터미널',     '제주특별자치도 제주시 임항로 111',        33.5225, 126.5380],
  ['동문재래시장',            '제주특별자치도 제주시 관덕로14길 20',      33.5122, 126.5270],
  ['제주민속오일시장',         '제주특별자치도 제주시 오일장서길 26',      33.4885, 126.4800],
  ['제주종합경기장',          '제주특별자치도 제주시 서광로 2길 24',      33.5010, 126.5090],
  ['삼성혈',                  '제주특별자치도 제주시 삼성로 22',          33.5030, 126.5300],
  ['탑동광장',                '제주특별자치도 제주시 탑동로 0',          33.5178, 126.5215],
  ['용두암',                  '제주특별자치도 제주시 용담이동 483',       33.5155, 126.5120],
  ['이호테우해변',            '제주특별자치도 제주시 이호일동',           33.4970, 126.4520],
  ['한라수목원',              '제주특별자치도 제주시 수목원길 72',        33.4665, 126.4930],
  ['제주한라병원',            '제주특별자치도 제주시 도령로 65',          33.4855, 126.4870],
  ['제주대학교',              '제주특별자치도 제주시 제주대학로 102',     33.4560, 126.5620],
  ['신제주로터리',            '제주특별자치도 제주시 연동',               33.4880, 126.4920],
  ['노형오거리',              '제주특별자치도 제주시 노형동',             33.4830, 126.4790],
  ['제주국제컨벤션센터',       '제주특별자치도 서귀포시 중문관광로 224',   33.2470, 126.4230],
  ['중문관광단지',            '제주특별자치도 서귀포시 색달동',           33.2470, 126.4120],
  ['서귀포시청',              '제주특별자치도 서귀포시 중앙로 105',       33.2540, 126.5600],
  ['성산일출봉',              '제주특별자치도 서귀포시 성산읍 일출로 284',33.4580, 126.9420],
  ['함덕해수욕장',            '제주특별자치도 제주시 조천읍 조함해안로',  33.5430, 126.6690],
  ['김녕해수욕장',            '제주특별자치도 제주시 구좌읍 해맞이해안로',33.5590, 126.7570],
  ['협재해수욕장',            '제주특별자치도 제주시 한림읍 한림로 329',  33.3940, 126.2400],
  ['애월카페거리',            '제주특별자치도 제주시 애월읍 애월로',      33.4640, 126.3120],
  ['산굼부리',                '제주특별자치도 제주시 조천읍 비자림로 768',33.4340, 126.6890],
  ['사려니숲길',              '제주특별자치도 제주시 조천읍 교래리',      33.4180, 126.6360],
  ['제주민속촌',              '제주특별자치도 서귀포시 표선면 민속해안로',33.3130, 126.8420],
  ['우도',                    '제주특별자치도 제주시 우도면',             33.5060, 126.9530],
  ['제주공항 렌터카하우스',    '제주특별자치도 제주시 오광로 68',          33.5020, 126.4855],
  ['제주항',                  '제주특별자치도 제주시 임항로',             33.5210, 126.5410],
  ['제주동문시장 주차장',      '제주특별자치도 제주시 관덕로 32',          33.5115, 126.5262],
  ['제주중앙로지하상가',       '제주특별자치도 제주시 중앙로 60',          33.5080, 126.5240],
  ['한라산국립공원',          '제주특별자치도 제주시 1100로 2070-61',     33.3617, 126.5292]
].map(function (r) {
  var w = toWorld(r[2], r[3]);
  return { name: r[0], addr: r[1], lat: r[2], lng: r[3], x: w.x, y: w.y };
});

function placeByName(n) {
  for (var i = 0; i < PLACES.length; i++) if (PLACES[i].name === n) return PLACES[i];
  return null;
}

// 집 / 회사 (저장된 주소)
var FAVS = {
  home:    { name: '집',   label: '집',            addr: '제주특별자치도 제주시 이도이동 1234', lat: 33.4948, lng: 126.5340 },
  work:    { name: '회사', label: '회사',          addr: '제주특별자치도 제주시 노형동 3001',   lat: 33.4855, lng: 126.4795 },
  airport: null // 아래에서 제주국제공항으로 채운다
};
Object.keys(FAVS).forEach(function (k) {
  var f = FAVS[k];
  if (!f) return;
  var w = toWorld(f.lat, f.lng);
  f.x = w.x; f.y = w.y;
});
FAVS.airport = placeByName('제주국제공항');

// 역지오코딩 대체 테이블 — 제주시청 주변 랜드마크 (원점 기준 미터 오프셋)
var LANDMARKS = [
  ['제주시청', 0, 0],
  ['광양사거리', -150, -120],
  ['제주시청 서문', -95, 20],
  ['이도이동 주민센터', 120, 190],
  ['일도이동 주민센터', 420, -60],
  ['삼도이동 주민센터', -430, -20],
  ['제주중앙로', -260, -300],
  ['동광로', 210, -330],
  ['남광사거리', 60, 300],
  ['제주지방법원', 80, 400],
  ['제주동초등학교', 330, 240],
  ['광양초등학교', -290, -430],
  ['제주여자중학교', -520, 260],
  ['제주종합경기장', -600, 150],
  ['제주고등학교', 480, 430],
  ['산지천', 340, -520],
  ['제주우체국', -180, -560],
  ['제주시민회관', 520, -240],
  ['제주대학교병원 사거리', -640, -420],
  ['이도월드하이츠', 620, 120],
  ['제주교육대학교', -700, 480],
  ['화북사거리', 690, -540]
];

function reverseGeocode(x, y) {
  var best = null, bd = Infinity;
  for (var i = 0; i < LANDMARKS.length; i++) {
    var l = LANDMARKS[i];
    var d = Math.hypot(x - l[1], y - l[2]);
    if (d < bd) { bd = d; best = l; }
  }
  return bd < 85 ? best[0] : best[0] + ' 부근';
}

/* ───────────────────────── 2. 지도 생성기 ─────────────────────────
   격자형 도로망을 만들고, 도로 선분 목록(그래프)을 같이 돌려준다.
   택시 마커는 이 선분 위에 스냅해서 선분 각도로 회전한다. (요구사항 2-3)
   ------------------------------------------------------------------ */

var POI_FOOD = ['유일반점', '한라식당', '라스또르따스', '포쉬노쉬', '삼대국수회관', '김만복김밥', '제주순대국', '흑돼지거리'];
var POI_CAFE = ['스타벅스 제주시청점', '카페델문도', '봄날카페', '파리바게뜨'];
var POI_BLDG = ['NH농협은행', '제주우체국', '호텔더레드', '호텔샬롬제주', '제주은행', '365의원', '이도월드하이츠', '장원스카이팰리스', '뷰띠끄헤르츠호텔', '제주의료원', '펠라즈바버샵', '토마토요양병원'];
var ROAD_NAMES = ['중앙로', '동광로', '서광로', '광양로', '연북로', '일주동로', '관덕로', '남광로'];
var ROUTE_NOS = ['1132', '1131', '97', '12', '99'];

function makeMap(o) {
  // o = { cx, cy, half, cell, seed, buildings, fs, sea }
  var rnd = rngFrom(o.seed);
  var n = Math.max(4, Math.round(o.half * 2 / o.cell) + 1);
  var jit = o.cell * 0.055;

  // ── 격자 노드 (약간 흔들어 유기적인 도로 모양을 만든다)
  var nodes = [], idx = [];
  for (var i = 0; i < n; i++) {
    idx[i] = [];
    for (var j = 0; j < n; j++) {
      var x = o.cx - o.half + i * o.cell + (rnd() - 0.5) * 2 * jit;
      var y = o.cy - o.half + j * o.cell + (rnd() - 0.5) * 2 * jit;
      idx[i][j] = nodes.length;
      nodes.push({ x: x, y: y });
    }
  }
  // ── 인접 리스트 (택시 주행용 그래프)
  var adj = nodes.map(function () { return []; });
  function link(a, b) { adj[a].push(b); adj[b].push(a); }
  for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
    if (i + 1 < n) link(idx[i][j], idx[i + 1][j]);
    if (j + 1 < n) link(idx[i][j], idx[i][j + 1]);
  }

  var vClass = [], hClass = [];
  for (i = 0; i < n; i++) vClass[i] = (i % 8 === 2) ? 2 : (i % 4 === 2) ? 1 : 0;
  for (j = 0; j < n; j++) hClass[j] = (j % 8 === 5) ? 2 : (j % 4 === 1) ? 1 : 0;
  var W = [7, 14, 18];   // 도로 폭 (m)

  var out = [];
  var b0x = o.cx - o.half - o.cell, b0y = o.cy - o.half - o.cell;
  var bw = o.half * 2 + o.cell * 2;
  out.push('<rect x="' + b0x + '" y="' + b0y + '" width="' + bw + '" height="' + bw + '" fill="var(--map-base)"/>');

  // ── 블록(대지) + 건물
  var parkCells = {};
  for (var p = 0; p < 4; p++) parkCells[(1 + Math.floor(rnd() * (n - 2))) + ',' + (1 + Math.floor(rnd() * (n - 2)))] = 1;

  var blocks = [];
  for (i = 0; i + 1 < n; i++) for (j = 0; j + 1 < n; j++) {
    var A = nodes[idx[i][j]], B = nodes[idx[i + 1][j]], C = nodes[idx[i + 1][j + 1]], D = nodes[idx[i][j + 1]];
    var inset = (Math.max(W[vClass[i]], W[vClass[i + 1]], W[hClass[j]], W[hClass[j + 1]]) / 2) + 2.5;
    var cx = (A.x + B.x + C.x + D.x) / 4, cy = (A.y + B.y + C.y + D.y) / 4;
    var pts = [A, B, C, D].map(function (q) {
      var dx = cx - q.x, dy = cy - q.y, L = Math.hypot(dx, dy) || 1;
      return (q.x + dx / L * inset * 1.35).toFixed(1) + ',' + (q.y + dy / L * inset * 1.35).toFixed(1);
    }).join(' ');
    var isPark = parkCells[i + ',' + j];
    out.push('<polygon points="' + pts + '" fill="' + (isPark ? 'var(--map-park)' : 'var(--map-block)') + '"/>');
    blocks.push({ i: i, j: j, cx: cx, cy: cy, park: !!isPark });

    if (o.buildings && !isPark) {
      var bn = rnd() < 0.55 ? 2 : 1;
      for (var k = 0; k < bn; k++) {
        var bwid = o.cell * (0.18 + rnd() * 0.2), bhei = o.cell * (0.16 + rnd() * 0.22);
        var bx = cx - o.cell * 0.32 + rnd() * (o.cell * 0.5 - bwid);
        var by = cy - o.cell * 0.3 + rnd() * (o.cell * 0.48 - bhei);
        out.push('<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + bwid.toFixed(1) +
          '" height="' + bhei.toFixed(1) + '" rx="1.5" fill="var(--map-block-2)"/>');
      }
    }
  }

  // ── 하천
  var riverI = Math.floor(n * 0.68);
  if (riverI > 1 && riverI < n - 1) {
    var rv = [];
    for (j = 0; j < n; j++) { var q = nodes[idx[riverI][j]]; rv.push((q.x + o.cell * 0.42).toFixed(1) + ',' + q.y.toFixed(1)); }
    out.push('<polyline points="' + rv.join(' ') + '" fill="none" stroke="var(--map-water)" stroke-width="' +
      (o.cell * 0.16).toFixed(1) + '" stroke-linecap="round" stroke-linejoin="round"/>');
  }

  // ── 도로: 밑선(테두리) → 윗선(면) 순으로 두 번 그린다
  function roadPoints(dir, k) {
    var a = [];
    for (var t = 0; t < n; t++) { var q = nodes[dir === 'v' ? idx[k][t] : idx[t][k]]; a.push(q.x.toFixed(1) + ',' + q.y.toFixed(1)); }
    return a.join(' ');
  }
  var pass;
  for (pass = 0; pass < 2; pass++) {
    for (i = 0; i < n; i++) {
      var c = vClass[i], w = W[c];
      out.push('<polyline points="' + roadPoints('v', i) + '" fill="none" stroke="' +
        (pass === 0 ? (c ? 'var(--map-major-line)' : 'var(--map-road-line)') : (c ? 'var(--map-major)' : 'var(--map-road)')) +
        '" stroke-width="' + (pass === 0 ? w + 2.4 : w) + '" stroke-linecap="round" stroke-linejoin="round"/>');
    }
    for (j = 0; j < n; j++) {
      var c2 = hClass[j], w2 = W[c2];
      out.push('<polyline points="' + roadPoints('h', j) + '" fill="none" stroke="' +
        (pass === 0 ? (c2 ? 'var(--map-major-line)' : 'var(--map-road-line)') : (c2 ? 'var(--map-major)' : 'var(--map-road)')) +
        '" stroke-width="' + (pass === 0 ? w2 + 2.4 : w2) + '" stroke-linecap="round" stroke-linejoin="round"/>');
    }
  }

  // ── 바다 — 제주 북쪽 해안선 (월드 y = COAST_Y 위쪽이 바다)
  if (o.sea != null && o.sea > b0y) {
    var seaY = o.sea;
    var wav = ['M' + b0x + ',' + b0y, 'L' + (b0x + bw) + ',' + b0y, 'L' + (b0x + bw) + ',' + seaY.toFixed(0)];
    var steps = 14, amp = Math.min(o.half * 0.06, 320);
    for (var s = steps; s >= 0; s--) {
      var sx = b0x + bw * (s / steps);
      var sy = seaY + Math.sin(s * 1.7 + 0.6) * amp;
      wav.push('L' + sx.toFixed(0) + ',' + sy.toFixed(0));
    }
    out.push('<path d="' + wav.join(' ') + ' Z" fill="var(--map-water)"/>');
  }

  var fs = o.fs;

  // ── 노선 번호 뱃지
  var badge = 0;
  for (i = 0; i < n; i++) if (vClass[i] === 2) {
    var bj = 2 + Math.floor(rnd() * (n - 4)), bq = nodes[idx[i][bj]];
    out.push(badgeSvg(bq.x, bq.y, ROUTE_NOS[badge++ % ROUTE_NOS.length], fs));
  }
  for (j = 0; j < n; j++) if (hClass[j] === 2) {
    var bi = 2 + Math.floor(rnd() * (n - 4)), bq2 = nodes[idx[bi][j]];
    out.push(badgeSvg(bq2.x, bq2.y, ROUTE_NOS[badge++ % ROUTE_NOS.length], fs));
  }
  function badgeSvg(x, y, txt, f) {
    var w = f * 2.6, h = f * 1.45;
    return '<g><rect x="' + (x - w / 2).toFixed(1) + '" y="' + (y - h / 2).toFixed(1) + '" width="' + w.toFixed(1) +
      '" height="' + h.toFixed(1) + '" rx="' + (h * 0.28).toFixed(1) + '" fill="#FFF7DF" stroke="#D8B75E" stroke-width="' + (f * 0.09).toFixed(2) + '"/>' +
      '<text x="' + x.toFixed(1) + '" y="' + (y + f * 0.36).toFixed(1) + '" font-size="' + (f * 0.86).toFixed(1) +
      '" font-weight="700" fill="#8A6A17" text-anchor="middle">' + txt + '</text></g>';
  }

  // ── 도로 이름
  for (i = 0; i < n; i++) if (vClass[i] === 1) {
    var nj = 1 + Math.floor(rnd() * (n - 2)), q1 = nodes[idx[i][nj]], q2 = nodes[idx[i][Math.min(n - 1, nj + 1)]];
    var ang = Math.atan2(q2.y - q1.y, q2.x - q1.x) * 180 / Math.PI;
    out.push('<text x="' + q1.x.toFixed(1) + '" y="' + q1.y.toFixed(1) + '" font-size="' + (fs * 0.88).toFixed(1) +
      '" fill="#9A8E66" font-weight="600" text-anchor="middle" transform="rotate(' + ang.toFixed(1) + ' ' +
      q1.x.toFixed(1) + ' ' + q1.y.toFixed(1) + ')">' + ROAD_NAMES[i % ROAD_NAMES.length] + '</text>');
  }
  for (j = 0; j < n; j++) if (hClass[j] === 1) {
    var ni = 1 + Math.floor(rnd() * (n - 2)), r1 = nodes[idx[ni][j]];
    out.push('<text x="' + r1.x.toFixed(1) + '" y="' + (r1.y - fs * 0.1).toFixed(1) + '" font-size="' + (fs * 0.88).toFixed(1) +
      '" fill="#9A8E66" font-weight="600" text-anchor="middle">' + ROAD_NAMES[(j + 3) % ROAD_NAMES.length] + '</text>');
  }

  // ── POI
  var poiN = o.buildings ? Math.round(blocks.length / 2.2) : Math.round(blocks.length / 12);
  var used = {};
  for (var pi = 0; pi < poiN; pi++) {
    var b = blocks[Math.floor(rnd() * blocks.length)];
    if (!b || used[b.i + ',' + b.j]) continue;
    used[b.i + ',' + b.j] = 1;
    var kind = rnd();
    var name, col, ico;
    if (kind < 0.36) { name = POI_FOOD[Math.floor(rnd() * POI_FOOD.length)]; col = 'var(--map-poi)'; ico = '#F09A3E'; }
    else if (kind < 0.55) { name = POI_CAFE[Math.floor(rnd() * POI_CAFE.length)]; col = 'var(--map-poi)'; ico = '#3E9A6B'; }
    else { name = POI_BLDG[Math.floor(rnd() * POI_BLDG.length)]; col = 'var(--map-label)'; ico = '#8B84C9'; }
    out.push('<circle cx="' + b.cx.toFixed(1) + '" cy="' + (b.cy - fs * 0.95).toFixed(1) + '" r="' + (fs * 0.52).toFixed(1) + '" fill="' + ico + '"/>');
    out.push('<circle cx="' + b.cx.toFixed(1) + '" cy="' + (b.cy - fs * 0.95).toFixed(1) + '" r="' + (fs * 0.19).toFixed(1) + '" fill="#fff"/>');
    out.push('<text x="' + b.cx.toFixed(1) + '" y="' + (b.cy + fs * 0.55).toFixed(1) + '" font-size="' + fs.toFixed(1) +
      '" font-weight="700" fill="' + col + '" text-anchor="middle" stroke="#fff" stroke-width="' + (fs * 0.22).toFixed(2) +
      '" paint-order="stroke">' + esc(name) + '</text>');
  }

  return { html: out.join(''), nodes: nodes, adj: adj, idx: idx, n: n, cell: o.cell };
}

/* ───────────────────────── 3. 화면 스택 ───────────────────────── */

var screens = {};
$$('.screen').forEach(function (el) { screens[el.dataset.screen] = el; });
var stack = ['home'];

function renderStack(anim) {
  var top = stack.length - 1;
  Object.keys(screens).forEach(function (name) {
    var el = screens[name], pos = stack.lastIndexOf(name);
    if (!anim) { el.classList.add('no-anim'); }
    el.classList.remove('is-top', 'is-under');
    if (pos === top) { el.classList.add('is-top'); el.style.zIndex = 10 + pos; }
    else if (pos > -1) { el.classList.add('is-under'); el.style.zIndex = 10 + pos; }
    else { el.style.zIndex = 1; }
    if (!anim) { el.getBoundingClientRect(); el.classList.remove('no-anim'); }
  });
}
function push(name) {
  stack.push(name);
  history.pushState({ depth: stack.length }, '');
  renderStack(true);
  if (onEnter[name]) onEnter[name]();
}
function pop() { if (stack.length > 1) history.back(); }

// 뒤로가기는 state 에 적힌 깊이까지 되감는다 (새로고침 등으로 히스토리가
// 어긋나 있어도 화면 스택이 꼬이지 않게)
window.addEventListener('popstate', function (e) {
  var depth = (e.state && e.state.depth) || 1;
  if (depth >= stack.length) return;
  while (stack.length > depth) {
    var left = stack.pop();
    if (onLeave[left]) onLeave[left]();
  }
  renderStack(true);
});
history.replaceState({ depth: 1 }, '');

var onEnter = {}, onLeave = {};
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-back]');
  if (b) { e.preventDefault(); pop(); }
});

/* ───────────────────────── 4. S2 · 택시 지도 ───────────────────────── */

var mapBox = $('#mapBox'), svgS2 = $('#svgS2'), panG = $('#s2Pan'),
    staticG = $('#s2Static'), meG = $('#s2Me'), taxiG = $('#s2Taxis'),
    pinEl = $('#pin'), originTextEl = $('#originText'), btnLocate = $('#btnLocate');

var HOME = { x: 0, y: 0 };          // 현위치 (월드 좌표)
var view = { dx: 0, dy: 0 };        // 현위치 대비 핀 오프셋
var s2Map = null;
var originName = '제주시청';

function pinWorld() { return { x: HOME.x + view.dx, y: HOME.y + view.dy }; }

function fitViewBox() {
  var r = mapBox.getBoundingClientRect();
  if (!r.width) return;
  var w = r.width / PPM, h = r.height / PPM;
  svgS2.setAttribute('viewBox', (HOME.x - w / 2) + ' ' + (HOME.y - h / 2) + ' ' + w + ' ' + h);
}
function applyPan() {
  panG.setAttribute('transform', 'translate(' + (-view.dx).toFixed(2) + ',' + (-view.dy).toFixed(2) + ')');
  var moved = Math.hypot(view.dx, view.dy) > 6;
  btnLocate.classList.toggle('is-moved', moved);
}

function buildS2Map() {
  s2Map = makeMap({
    cx: HOME.x, cy: HOME.y, half: PAN_LIMIT + 270, cell: S2_CELL,
    seed: 20260827, buildings: true, fs: 11.5 / PPM, sea: COAST_Y
  });
  staticG.innerHTML = s2Map.html;

  // 현위치 마커 — 파란 점 + 퍼지는 반투명 원 (2.6초 루프)
  var pulse = REDUCED ? '' :
    '<circle cx="0" cy="0" r="8" fill="#2F6BFF" opacity=".28">' +
      '<animate attributeName="r" values="8;46;46" dur="2.6s" repeatCount="indefinite"/>' +
      '<animate attributeName="opacity" values=".3;0;0" dur="2.6s" repeatCount="indefinite"/>' +
    '</circle>';
  meG.innerHTML = '<g transform="translate(' + HOME.x + ',' + HOME.y + ')">' + pulse +
    '<circle cx="0" cy="0" r="13" fill="#2F6BFF" opacity=".18"/>' +
    '<circle cx="0" cy="0" r="7.5" fill="#2F6BFF" stroke="#fff" stroke-width="2.4"/></g>';
}

/* ── 4-1. 도로에 맞춰 회전하는 주변 택시 (요구사항 2-3) ── */

var taxis = [];
// 위에서 내려다본 카카오T 블루 택시 (tp-04 의 출발 지점 마커와 같은 모양).
// 기본 방향은 +x (코가 오른쪽) — rotate(선분 각도) 를 그대로 걸면 도로와 나란해진다.
var TAXI_SVG =
  // 바닥 그림자
  '<rect x="-17" y="-7.4" width="36" height="17" rx="7" fill="rgba(0,0,0,.16)"/>' +
  // 흰 테두리 → 검은 외곽선 → 파란 차체
  '<rect x="-18" y="-8.6" width="36" height="17.2" rx="6.6" fill="#fff"/>' +
  '<rect x="-16.6" y="-7.4" width="33.2" height="14.8" rx="5.6" fill="#3F5AC6" stroke="#1D1F24" stroke-width="1.5"/>' +
  // 앞유리 / 뒷유리 (진한 유리색)
  '<path d="M4.6 -5.6 Q10 -5.2 12.4 0 Q10 5.2 4.6 5.6 Z" fill="#2A3350"/>' +
  '<path d="M-9.4 -5.6 Q-12.6 -4.6 -13.4 0 Q-12.6 4.6 -9.4 5.6 Z" fill="#2A3350"/>' +
  // 지붕 패널 — 위아래로 파란 차체가 남도록 안쪽에만
  '<rect x="-8" y="-4.4" width="12.6" height="8.8" rx="2.2" fill="#EEF1F6"/>' +
  // 노란 갓등 (지붕을 가로지른다)
  '<rect x="-3.2" y="-3.4" width="4.4" height="6.8" rx="1.6" fill="#FFCE00"/>';

function angDiff(a, b) { var d = (a - b + 540) % 360 - 180; return d; }

function pickNext(node, avoid) {
  var opts = s2Map.adj[node];
  var pool = opts.filter(function (v) { return v !== avoid; });
  if (!pool.length) pool = opts;
  return pool[Math.floor(Math.random() * pool.length)];
}

function placeTaxis() {
  var pw = pinWorld();
  var nodes = s2Map.nodes;
  // 출발 지점 가까이(35~150m)에 있는 도로 위 지점만 후보로 모은다
  var cand = [];
  for (var i = 0; i < nodes.length; i++) {
    var d = distM(nodes[i], pw);
    if (d > 35 && d < 150 && s2Map.adj[i].length) cand.push(i);
  }
  if (!cand.length) cand = nodes.map(function (_, i) { return i; });

  taxiG.innerHTML = '';
  taxis = [];

  // 첫 대는 tp-04 처럼 출발 지점에 붙인다 — 핀에서 가장 가까운 도로 선분 위,
  // 핀에 제일 가까운 점에 스냅한다.
  var near = nearestEdge(pw);

  for (var t = 0; t < TAXI_COUNT; t++) {
    var a, b, at;
    if (t === 0 && near) {
      a = near.from; b = near.to;
      // 말풍선 대 바로 밑이 아니라 도로를 따라 20m 정도 옆에 세운다 (tp-04)
      var segLen = distM(nodes[near.from], nodes[near.to]) || 1;
      at = clamp(near.t - 20 / segLen, 0.08, 0.92);
    } else {
      a = cand[Math.floor(Math.random() * cand.length)];
      b = pickNext(a, -1);
      at = 0.25 + Math.random() * 0.5;
    }
    // 요구사항 2-3(5): 선분의 양방향 중 하나를 랜덤으로 (반대 차선 표현)
    if (Math.random() < 0.5) { var tmp = a; a = b; b = tmp; at = 1 - at; }
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.innerHTML = TAXI_SVG;
    taxiG.appendChild(g);
    var A = nodes[a], B = nodes[b];
    taxis.push({
      el: g, from: a, to: b, t: at,
      speed: 7 + Math.random() * 5,                 // m/s
      angle: Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI,
      target: 0
    });
    taxis[t].target = taxis[t].angle;
    drawTaxi(taxis[t]);
  }
}

// 한 점에서 가장 가까운 도로 선분과, 그 선분 위의 최근접 위치(0~1)
function nearestEdge(p) {
  var nodes = s2Map.nodes, adj = s2Map.adj, best = null, bd = Infinity;
  for (var i = 0; i < nodes.length; i++) {
    var A = nodes[i];
    if (Math.abs(A.x - p.x) > 220 || Math.abs(A.y - p.y) > 220) continue;
    for (var k = 0; k < adj[i].length; k++) {
      var j = adj[i][k];
      if (j < i) continue;                    // 선분마다 한 번만
      var B = nodes[j];
      var vx = B.x - A.x, vy = B.y - A.y;
      var L2 = vx * vx + vy * vy;
      if (!L2) continue;
      var t = clamp(((p.x - A.x) * vx + (p.y - A.y) * vy) / L2, 0.12, 0.88);
      var dx = A.x + vx * t - p.x, dy = A.y + vy * t - p.y;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = { from: i, to: j, t: t }; }
    }
  }
  return best;
}

function drawTaxi(tx) {
  var A = s2Map.nodes[tx.from], B = s2Map.nodes[tx.to];
  var x = lerp(A.x, B.x, tx.t), y = lerp(A.y, B.y, tx.t);
  tx.el.setAttribute('transform', 'translate(' + x.toFixed(2) + ',' + y.toFixed(2) + ') rotate(' + tx.angle.toFixed(1) + ') scale(1.18)');
}

var lastT = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (!s2Map || !taxis.length) return;
  var dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0;
  lastT = now;
  if (!dt) return;

  var pw = pinWorld();
  var moving = TAXI_DRIVES && !REDUCED && stack[stack.length - 1] === 'taxi';
  if (!moving) return;   // 서 있을 때는 배치할 때 그린 그대로 둔다

  for (var i = 0; i < taxis.length; i++) {
    var tx = taxis[i];
    if (moving) {
      var A = s2Map.nodes[tx.from], B = s2Map.nodes[tx.to];
      var len = distM(A, B) || 1;
      tx.t += tx.speed * dt / len;
      var guard = 0;
      while (tx.t >= 1 && guard++ < 4) {
        var prev = tx.from;
        tx.from = tx.to;
        tx.to = pickNext(tx.from, prev);
        A = s2Map.nodes[tx.from]; B = s2Map.nodes[tx.to];
        len = distM(A, B) || 1;
        tx.t -= 1;
        // 새 선분의 방향각 — 여기로 부드럽게 회전한다
        tx.target = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
      }
      // 0.4초 정도에 걸쳐 새 각도로 전환 (옆으로 미끄러지지 않게 코 방향만 회전)
      var k = 1 - Math.exp(-dt / 0.13);
      tx.angle += angDiff(tx.target, tx.angle) * k;

      // 핀에서 너무 멀어지면 핀 주변으로 다시 배치
      var cur = { x: lerp(A.x, B.x, tx.t), y: lerp(A.y, B.y, tx.t) };
      if (distM(cur, pw) > 330) { respawn(tx, pw); }
    }
    drawTaxi(tx);
  }
}

function respawn(tx, pw) {
  var nodes = s2Map.nodes, best = -1, bd = Infinity;
  for (var i = 0; i < nodes.length; i++) {
    var d = distM(nodes[i], pw);
    var score = Math.abs(d - 190) + Math.random() * 90;
    if (d > 60 && d < 270 && score < bd) { bd = score; best = i; }
  }
  if (best < 0) return;
  tx.from = best; tx.to = pickNext(best, -1); tx.t = 0;
  var A = nodes[tx.from], B = nodes[tx.to];
  tx.angle = tx.target = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
}

/* ── 4-2. 팬 / 핀 드래그 ── */

var drag = null;
mapBox.addEventListener('pointerdown', function (e) {
  if (e.target.closest('button')) return;
  drag = { id: e.pointerId, lx: e.clientX, ly: e.clientY, moved: false };
  mapBox.setPointerCapture(e.pointerId);
});
mapBox.addEventListener('pointermove', function (e) {
  if (!drag || e.pointerId !== drag.id) return;
  var mx = e.clientX - drag.lx, my = e.clientY - drag.ly;
  drag.lx = e.clientX; drag.ly = e.clientY;
  if (!drag.moved && Math.hypot(mx, my) < 2) return;
  if (!drag.moved) {
    drag.moved = true;
    pinEl.classList.remove('is-drop');
    pinEl.classList.add('is-drag');
    originTextEl.textContent = '위치 확인 중...';
  }
  var sign = PIN_FOLLOWS_DRAG ? 1 : -1;
  view.dx = clamp(view.dx + sign * mx / PPM, -PAN_LIMIT, PAN_LIMIT);
  view.dy = clamp(view.dy + sign * my / PPM, -PAN_LIMIT, PAN_LIMIT);
  applyPan();
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  var wasMoved = drag.moved;
  drag = null;
  if (!wasMoved) return;
  pinEl.classList.remove('is-drag');
  pinEl.classList.add('is-drop');
  setTimeout(function () { pinEl.classList.remove('is-drop'); }, 300);
  settlePin();
}
mapBox.addEventListener('pointerup', endDrag);
mapBox.addEventListener('pointercancel', endDrag);

function settlePin() {
  var pw = pinWorld();
  originName = reverseGeocode(pw.x, pw.y);
  originTextEl.textContent = originName;
  $('#srchOrigin').textContent = originName;
  placeTaxis();           // 새 위치 주변 도로에 다시 스냅
}

// 현위치 버튼 — 0.5초 이징으로 부드럽게 복귀
var flying = null;
btnLocate.addEventListener('click', function () {
  if (Math.hypot(view.dx, view.dy) < 1) { toast('이미 현위치에 있어요.'); return; }
  var t0 = performance.now(), sx = view.dx, sy = view.dy;
  originTextEl.textContent = '위치 확인 중...';
  if (flying) cancelAnimationFrame(flying);
  (function step(now) {
    var p = clamp((now - t0) / 500, 0, 1);
    var e = 1 - Math.pow(1 - p, 3);
    view.dx = sx * (1 - e); view.dy = sy * (1 - e);
    applyPan();
    if (p < 1) flying = requestAnimationFrame(step);
    else { flying = null; settlePin(); }
  })(performance.now());
});

$('#btnReserve').addEventListener('click', function () { toast('예약 호출은 연습에 포함되어 있지 않아요.'); });

$('#rowDest').addEventListener('click', function () {
  openSearch();
});
$('#rowOrigin').addEventListener('click', function () {
  toast('출발지는 지도를 움직여서 정할 수 있어요.');
});
$$('.chip[data-fav]').forEach(function (b) {
  b.addEventListener('click', function () { chooseDest(FAVS[b.dataset.fav]); });
});

/* ───────────────────────── 5. S3 · 도착지 검색 ───────────────────────── */

var srchInput = $('#srchInput'), srchBody = $('#srchBody'), srchForm = $('#srchForm'),
    srchClear = $('#srchClear'), srchMic = $('#srchMic'), srchTools = $('#srchTools');
var recents = [];

function openSearch() {
  srchInput.value = '';
  renderSearch();
  push('search');
  // 실제 키패드를 띄우려면 사용자 제스처와 같은 틱에서 focus 해야 한다
  screens.search.getBoundingClientRect();
  try { srchInput.focus({ preventScroll: true }); } catch (err) { srchInput.focus(); }
}
onLeave.search = function () { srchInput.blur(); };

function highlight(text, q) {
  if (!q) return esc(text);
  var i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<b>' + esc(text.slice(i, i + q.length)) + '</b>' + esc(text.slice(i + q.length));
}

function suggestionsFor(q) {
  var list = [], seen = {};
  function add(s) { if (s && !seen[s] && s.indexOf(q) > -1) { seen[s] = 1; list.push(s); } }
  add(q);
  PLACES.forEach(function (p) { add(p.name); });
  [' 맛집', ' 주차장', ' 근처', ' 가는 길'].forEach(function (suf) { add(q + suf); });
  return list.slice(0, 8);
}

// "제주공항" 으로 "제주국제공항" 도 찾히도록 — 글자가 순서대로 들어 있으면 후보
function isSubseq(q, s) {
  var i = 0;
  for (var k = 0; k < s.length && i < q.length; k++) if (s[k] === q[i]) i++;
  return i === q.length;
}
function matchScore(q, p) {
  if (p.name.indexOf(q) === 0) return 0;
  if (p.name.indexOf(q) > 0) return 1;
  if (isSubseq(q, p.name)) return 2;
  if (p.addr.indexOf(q) > -1) return 3;
  return -1;
}

function resultsFor(q) {
  var pw = pinWorld();
  return PLACES
    .map(function (p) {
      // 검색어에 가장 "딱 맞는" 이름(군더더기가 적은 쪽)을 위로 올린다.
      // 예) "제주공항" → 제주국제공항이 제주공항주유소보다 먼저.
      return { p: p, s: matchScore(q, p), fit: p.name.length - q.length, d: distM(p, pw) / 1000 };
    })
    .filter(function (r) { return r.s >= 0; })
    .sort(function (a, b) {
      if (a.fit !== b.fit) return a.fit - b.fit;
      if (a.s !== b.s) return a.s - b.s;
      return a.d - b.d;
    })
    .slice(0, 12);
}

var mode = 'idle';   // idle | suggest | result

function renderSearch() {
  var q = srchInput.value.trim();
  srchClear.hidden = !q;
  srchMic.hidden = !!q;
  srchTools.style.display = q ? 'none' : '';

  if (!q) {
    mode = 'idle';
    if (!recents.length) {
      srchBody.innerHTML = '<div class="srch-empty">최근 설정 기록이 없습니다.</div>';
    } else {
      srchBody.innerHTML = '<div class="res-head">최근 검색</div>' + recents.map(function (p, i) {
        return '<button class="res" data-recent="' + i + '">' +
          '<span class="opt__ico" style="width:24px;height:24px"><svg class="i22" style="color:#B2B7C0"><use href="#ic-clock"/></svg></span>' +
          '<span class="res__txt"><span class="res__name">' + esc(p.name) + '</span>' +
          '<span class="res__addr">' + esc(p.addr) + '</span></span></button>';
      }).join('');
    }
    return;
  }
  if (mode !== 'result') {
    var sug = suggestionsFor(q);
    mode = 'suggest';
    srchBody.innerHTML = sug.length
      ? sug.map(function (s) { return '<button class="sug" data-sug="' + esc(s) + '">' + highlight(s, q) + '</button>'; }).join('')
      : '<div class="srch-empty">검색 결과가 없어요</div>';
  }
}

function renderResults(q) {
  mode = 'result';
  var rs = resultsFor(q);
  if (!rs.length) { srchBody.innerHTML = '<div class="srch-empty">검색 결과가 없어요</div>'; return; }
  srchBody.innerHTML = '<div class="res-head">장소결과</div>' + rs.map(function (r, i) {
    return '<div class="res">' +
      '<svg class="i22" style="color:#C3C7CD;flex:none"><use href="#ic-crosshair"/></svg>' +
      '<div class="res__txt">' +
        '<div class="res__name">' + highlight(r.p.name, q) + '</div>' +
        '<div class="res__addr">' + esc(r.p.addr) + ' · ' + r.d.toFixed(2) + 'km</div>' +
      '</div>' +
      '<button class="res__btn" data-pick="' + esc(r.p.name) + '">도착</button>' +
    '</div>';
  }).join('');
}

srchInput.addEventListener('input', function () { mode = 'suggest'; renderSearch(); });
srchForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var q = srchInput.value.trim();
  if (!q) return;
  srchInput.blur();                 // 검색 실행 시 키보드는 내려간다
  renderResults(q);
});
srchClear.addEventListener('click', function () {
  srchInput.value = ''; mode = 'idle'; renderSearch(); srchInput.focus();
});
srchMic.addEventListener('click', function () { toast('음성 검색은 연습에 포함되어 있지 않아요.'); });

srchBody.addEventListener('click', function (e) {
  var s = e.target.closest('[data-sug]');
  if (s) { srchInput.value = s.dataset.sug; srchInput.blur(); renderResults(s.dataset.sug); return; }
  var p = e.target.closest('[data-pick]');
  if (p) { chooseDest(placeByName(p.dataset.pick)); return; }
  var r = e.target.closest('[data-recent]');
  if (r) { chooseDest(recents[+r.dataset.recent]); return; }
});
$$('.srch-tool[data-fav]').forEach(function (b) {
  b.addEventListener('click', function () { chooseDest(FAVS[b.dataset.fav]); });
});

/* ───────────────────────── 6. S4 · 경로 + 호출 옵션 ───────────────────────── */

var OPTIONS = [
  { key: 'normal', name: '일반 호출', desc: '가까운 택시 자동 배차',    mul: 1.0,  ico: 'ic-taxi' },
  { key: 'blue',   name: '블루',      desc: '예약 확정 · 승차 거부 없음', mul: 1.18, ico: 'ic-taxi-blue' },
  { key: 'venti',  name: '벤티',      desc: '최대 6인 · 짐 많을 때',    mul: 1.65, ico: 'ic-venti' },
  { key: 'black',  name: '블랙',      desc: '고급 세단 · 프리미엄',      mul: 2.6,  ico: 'ic-black' },
  { key: 'mobum',  name: '모범',      desc: '모범택시 기사 배차',        mul: 1.95, ico: 'ic-mobum' },
  { key: 'resv',   name: '예약',      desc: '날짜·시간 지정 호출',       mul: null, ico: 'ic-taxical' }
];

// 요금 = (4,800 + max(0, 거리km − 2) × 1,320) × 배수, 100원 단위 반올림
function fareFor(km, mul) {
  var base = 4800 + Math.max(0, km - 2) * 1320;
  return Math.round(base * mul / 100) * 100;
}

var trip = null;      // { from:{name,x,y}, to:place, km, eta }
var selected = 'normal';

function chooseDest(place) {
  if (!place) return;
  var pw = pinWorld();
  var km = distM(place, pw) / 1000;
  trip = {
    fromName: originName,
    from: { x: pw.x, y: pw.y },
    to: place,
    km: km,
    eta: Math.max(4, Math.round(km * 3.2) + 2)
  };
  // 최근 검색어 기록
  recents = [place].concat(recents.filter(function (r) { return r.name !== place.name; })).slice(0, 6);
  selected = 'normal';

  buildRoute();
  push('route');   // 검색 화면은 스택에 남긴다 — 뒤로가기가 항상 직전 화면으로 가도록
}

var svgS4 = $('#svgS4'), routeBox = $('#routeMapBox');

function buildRoute() {
  $('#routeFrom').textContent = trip.fromName;
  $('#routeTo').textContent = trip.to.name;
  $('#routeAddrFrom').textContent = trip.fromName;
  $('#routeAddrTo').textContent = trip.to.name;
  renderOptions();
  // 지도는 레이아웃이 잡힌 뒤에 그린다 (탭이 백그라운드여도 반드시 그려지도록 타이머 사용)
  setTimeout(drawRouteMap, 0);
}

function drawRouteMap() {
  var r = routeBox.getBoundingClientRect();
  if (!r.width) { setTimeout(drawRouteMap, 40); return; }

  var o = trip.from, d = trip.to;
  var midx = (o.x + d.x) / 2, midy = (o.y + d.y) / 2;
  // 4-1: 출발/도착이 한 화면에 모두 보이도록 축척·중심을 맞춘다
  var spanX = Math.abs(d.x - o.x), spanY = Math.abs(d.y - o.y);
  var aspect = r.height / r.width;
  var vbW = Math.max(spanX / (1 - 130 / r.width), 900);
  var vbH = vbW * aspect;
  if (spanY / vbH > 0.52) { vbH = spanY / 0.52; vbW = vbH / aspect; }

  var ppm4 = r.width / vbW;
  var cell = Math.max(160, vbW / 15);
  var map4 = makeMap({
    cx: midx, cy: midy, half: Math.max(vbW, vbH) * 0.75, cell: cell,
    seed: 771102, buildings: false, fs: 11.5 / ppm4, sea: COAST_Y
  });

  var vbX = midx - vbW / 2, vbY = midy - vbH / 2 - vbH * 0.04;
  svgS4.setAttribute('viewBox', vbX + ' ' + vbY + ' ' + vbW + ' ' + vbH);

  // 경로선 — 몇 번 꺾이는 실제 도로 같은 모양
  var dx = d.x - o.x, dy = d.y - o.y;
  var pts = [
    [o.x, o.y],
    [o.x + dx * 0.06, o.y + dy * 0.30],
    [o.x + dx * 0.40, o.y + dy * 0.36],
    [o.x + dx * 0.52, o.y + dy * 0.74],
    [o.x + dx * 0.86, o.y + dy * 0.80],
    [d.x, d.y]
  ].map(function (p) { return p[0].toFixed(0) + ',' + p[1].toFixed(0); }).join(' ');

  var lw = vbW * 0.014;
  svgS4.innerHTML = map4.html +
    '<polyline points="' + pts + '" fill="none" stroke="#fff" stroke-width="' + (lw * 1.55) + '" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>' +
    '<polyline id="routeLine" points="' + pts + '" fill="none" stroke="var(--route)" stroke-width="' + lw + '" stroke-linecap="round" stroke-linejoin="round"/>';

  // 경로선이 출발 → 도착 방향으로 그려지는 애니메이션 (0.9초)
  var line = $('#routeLine', svgS4);
  if (!REDUCED && line.getTotalLength) {
    var L = line.getTotalLength();
    line.style.strokeDasharray = L; line.style.strokeDashoffset = L;
    line.getBoundingClientRect();
    line.style.transition = 'stroke-dashoffset .9s ease-out';
    line.style.strokeDashoffset = 0;
  }

  // 마커 / 말풍선은 HTML 오버레이로 (지도 축척과 무관하게 크기 유지)
  function px(wx, wy) { return { x: (wx - vbX) / vbW * r.width, y: (wy - vbY) / vbH * r.height }; }
  var po = px(o.x, o.y), pd = px(d.x, d.y);
  $$('.rm', routeBox).forEach(function (n) { n.remove(); });

  // 말풍선은 지점 위에 뜨지만, 화면 밖으로 잘리지 않게 가로 위치만 안쪽으로 당긴다
  function addMarker(cls, inner, p, bubbleW) {
    var el = document.createElement('div');
    el.className = 'rm ' + cls;
    el.innerHTML = inner;
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    var shift = clamp(p.x, bubbleW / 2 + 8, r.width - bubbleW / 2 - 8) - p.x;
    if (shift) el.style.setProperty('--shift', shift.toFixed(1) + 'px');
    routeBox.appendChild(el);
    return el;
  }

  addMarker('rm--from',
    '<div class="rm__bubble">출발 <svg class="i14"><use href="#ic-chev"/></svg></div><div class="rm__ring"></div>',
    po, 86);
  addMarker('rm--to',
    '<div class="rm__eta"><b>도착</b><span>' + trip.eta + '분 예상 <svg class="i14"><use href="#ic-chev"/></svg></span></div><div class="rm__pin"></div>',
    pd, 150);
}

function renderOptions() {
  var html = OPTIONS.map(function (op) {
    // tp-09: 이름과 요금이 같은 줄에 있고, 설명은 그 아래로 폭 전체를 쓴다
    var right = op.mul === null
      ? '<span class="opt__fare" style="color:#8A8F99">날짜 지정</span>'
      : '<span class="opt__fare"><small>예상</small>' + won(fareFor(trip.km, op.mul)) + '</span>';
    var chip = op.key === 'resv'
      ? '<span class="opt__chip"><svg><use href="#ic-clock"/></svg>10분~2주 뒤 출발</span>' : '';
    return '<button class="opt' + (op.key === selected ? ' is-on' : '') + '" data-opt="' + op.key + '">' +
      '<span class="opt__ico"><svg viewBox="0 0 48 32"><use href="#' + op.ico + '"/></svg></span>' +
      '<span class="opt__body">' +
        '<span class="opt__top"><span class="opt__name">' + op.name + '</span>' + right + '</span>' +
        (chip || '<span class="opt__desc">' + op.desc + '</span>') +
      '</span></button>';
  }).join('');
  $('#opts').innerHTML = html;
  updateCta();
}

function updateCta() {
  var op = OPTIONS.filter(function (o) { return o.key === selected; })[0];
  $('#ctaCall').textContent = op.key === 'resv' ? '예약하기' : op.name + '하기';
}

$('#opts').addEventListener('click', function (e) {
  var b = e.target.closest('[data-opt]');
  if (!b) return;
  selected = b.dataset.opt;
  $$('.opt', $('#opts')).forEach(function (n) { n.classList.toggle('is-on', n === b); });
  updateCta();
});
$('#ctaCall').addEventListener('click', function () {
  var op = OPTIONS.filter(function (o) { return o.key === selected; })[0];
  if (op.key === 'resv') { toast('예약 화면은 연습에 포함되어 있지 않아요.'); return; }
  toast(trip.to.name + '까지 ' + op.name + ' — ' + won(fareFor(trip.km, op.mul)) + ' 예상');
});
$('#btnRecommend').addEventListener('click', function () { toast('지금 경로가 가장 빠른 추천경로예요.'); });

/* ───────────────────────── 7. S1 · 광고 팝업 ───────────────────────── */

var adPopup = $('#adPopup'), adShown = false;
function showAd() {
  if (adShown) return;
  adShown = true;
  adPopup.hidden = false;
}
function closeAd() { adPopup.hidden = true; }
$('#adClose').addEventListener('click', closeAd);
$('#adDim').addEventListener('click', closeAd);
$('#adShare').addEventListener('click', function () { closeAd(); toast('친구에게 공유했어요.'); });
$('#adMore').addEventListener('click', function () { closeAd(); toast('광고 자세히 보기는 연습에 포함되어 있지 않아요.'); });

/* ───────────────────────── 8. 홈 → 택시 ───────────────────────── */

function openTaxi() {
  push('taxi');
  fitViewBox();
  setTimeout(showAd, 260);
  askLocation();
}
$('#svcTaxi').addEventListener('click', openTaxi);
$('#homeSearch').addEventListener('click', openTaxi);
$$('.svc').forEach(function (b) {
  if (b.id === 'svcTaxi') return;
  b.addEventListener('click', function () { toast('이 연습에서는 [택시]만 사용해요.'); });
});
$('.home-more').addEventListener('click', function () { toast('이 연습에서는 [택시]만 사용해요.'); });
$$('.home-nav button').forEach(function (b) {
  b.addEventListener('click', function () { if (!b.classList.contains('is-on')) toast('이 연습에서는 [택시]만 사용해요.'); });
});
$$('.home-tab').forEach(function (b) {
  b.addEventListener('click', function () {
    $$('.home-tab').forEach(function (n) { n.classList.remove('is-on'); });
    b.classList.add('is-on');
  });
});
$$('.seg__btn').forEach(function (b) {
  b.addEventListener('click', function () {
    $$('.seg__btn').forEach(function (n) { n.classList.remove('is-on'); });
    b.classList.add('is-on');
  });
});

/* ───────────────────────── 9. 시작 ───────────────────────── */

function start() {
  buildS2Map();
  fitViewBox();
  applyPan();
  settlePin();
  requestAnimationFrame(tick);
  renderStack(false);
  renderSearch();
}

window.addEventListener('resize', function () {
  fitViewBox();
  if (trip && stack.indexOf('route') > -1) drawRouteMap();
});

// 2-1: 택시 화면 진입 즉시 현위치를 표시한다. 권한이 없거나 제주 밖이면
// 기본 좌표(제주시청)로 대체하고 토스트로 알린다.
var askedLocation = false;
function askLocation() {
  if (askedLocation) return;
  askedLocation = true;
  if (!navigator.geolocation) { toast('위치를 확인할 수 없어 제주시청을 기준으로 안내해요.'); return; }
  navigator.geolocation.getCurrentPosition(function (pos) {
    var w = toWorld(pos.coords.latitude, pos.coords.longitude);
    if (Math.hypot(w.x, w.y) > 12000) toast('현위치가 제주 밖이라 제주시청을 기준으로 안내해요.');
  }, function () {
    toast('위치를 확인할 수 없어 제주시청을 기준으로 안내해요.');
  }, { timeout: 6000, maximumAge: 300000 });
}

start();

})();
