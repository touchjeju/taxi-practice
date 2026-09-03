/* ==========================================================================
   택시 호출 연습하기 — 카카오 T 흐름 그대로 (홈 → 광고 → 지도 → 검색 → 경로 →
   호출 상세 → 결제수단).  지도·장소검색·길찾기는 모두 실제 카카오 API.
   화면 디자인은 image/tp-01 ~ tp-14 캡처를 기준으로 맞췄다.
   ========================================================================== */
(function () {
'use strict';

/* ───────────────────────── 0. 설정 / 유틸 ───────────────────────── */

// 길찾기(카카오모빌리티)만 REST 키를 쓴다. 지도·장소검색은 index.html 의
// JavaScript 키로 동작한다. 키가 막히거나 응답이 없으면 직선 경로로 대체한다.
var KAKAO_REST_KEY = 'cbbbcdf18e5a96b22500e4399e62bbd5';

var CITYHALL = { lat: 33.4996, lng: 126.5312, name: '제주시청' };

var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var esc = function (s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
};
var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
var round100 = function (n) { return Math.round(n / 100) * 100; };

var toastEl = $('#toast'), toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2400);
}

function haversine(a, b) {
  var R = 6371000, t = Math.PI / 180;
  var dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

var K = null;                 // kakao.maps (로드 성공 시)
function LL(p) { return new K.LatLng(p.lat, p.lng); }

/* 집 / 회사 — 저장된 주소 (연습용) */
var FAVS = {
  home:    { name: '우리집',        addr: '제주특별자치도 제주시 이도이동',       lat: 33.4936, lng: 126.5296 },
  work:    { name: '회사',          addr: '제주특별자치도 제주시 연동',          lat: 33.4890, lng: 126.4983 },
  airport: { name: '제주국제공항',   addr: '제주특별자치도 제주시 공항로 2',      lat: 33.5070, lng: 126.4930 }
};

/* ───────────────────────── 1. 화면 스택 ───────────────────────── */

var screens = {};
$$('.screen').forEach(function (el) { screens[el.dataset.screen] = el; });
var stack = ['home'];
var onEnter = {}, onLeave = {};

function renderStack(anim) {
  Object.keys(screens).forEach(function (name) {
    var el = screens[name], pos = stack.lastIndexOf(name);
    if (!anim) el.classList.add('no-anim');
    el.classList.toggle('is-in', pos > -1);
    el.style.zIndex = pos > -1 ? 10 + pos : 1;
    if (!anim) { el.getBoundingClientRect(); el.classList.remove('no-anim'); }
  });
  TRACK.at(stack[stack.length - 1]);          // 연습 기록 — 반 링크로 들어왔을 때만 남는다
}
function push(name) {
  if (stack[stack.length - 1] === name) return;
  stack.push(name);
  history.pushState({ depth: stack.length }, '');
  renderStack(true);
  if (onEnter[name]) onEnter[name]();
}
function pop() { if (stack.length > 1) history.back(); }

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

document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-back]');
  if (b) { e.preventDefault(); pop(); }
});

/* ───────────────────────── 2. S2 · 카카오 지도 + 출발지 ───────────────────────── */

var mapS2 = null, mapS4 = null, geocoder = null, places = null;
var origin = { lat: CITYHALL.lat, lng: CITYHALL.lng, name: '제주시청' };
var myPos = { lat: CITYHALL.lat, lng: CITYHALL.lng };

var mapBox = $('#mapBox'), pinEl = $('#pin');
var originTextEl = $('#originText'), btnLocate = $('#btnLocate');

function initS2Map() {
  mapS2 = new K.Map($('#mapCanvas'), { center: LL(origin), level: 3 });
  mapS2.setMaxLevel(7);
  geocoder = new K.services.Geocoder();
  places = new K.services.Places();

  // 현위치 파란 점
  var me = document.createElement('div');
  me.innerHTML =
    '<div style="position:relative">' +
      '<div style="position:absolute;left:-19px;top:-19px;width:38px;height:38px;border-radius:50%;background:rgba(47,107,255,.18)"></div>' +
      '<div style="position:absolute;left:-8px;top:-8px;width:16px;height:16px;border-radius:50%;background:#2F6BFF;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>' +
    '</div>';
  meOverlay = new K.CustomOverlay({ map: mapS2, position: LL(myPos), content: me, zIndex: 2 });

  K.event.addListener(mapS2, 'dragstart', function () {
    pinEl.classList.add('is-drag');
    originTextEl.textContent = '위치 확인 중...';
  });
  K.event.addListener(mapS2, 'idle', function () {
    pinEl.classList.remove('is-drag');
    var c = mapS2.getCenter();
    origin.lat = c.getLat(); origin.lng = c.getLng();
    btnLocate.classList.toggle('is-moved', haversine(origin, myPos) > 25);
    resolveOriginName();
    updateTaxiHeading();
  });
}
var meOverlay = null;

/* ── 택시 아이콘 방향 ──────────────────────────────────────────────
   출발점 앞 도로에서 택시가 "어느 쪽에서 오는지"를 보여준다.  근처 한 점에서
   출발점까지 실제 길찾기를 돌린 뒤, 도착 직전 구간의 방위각을 진행 방향으로
   쓴다.  경로를 못 구하면 기본값(동쪽)을 그대로 둔다. */
var taxiEl = document.querySelector(".pin__taxi");
var TAXI_BACK = 44;          // 핀 뒤로 물러나 있는 거리(px)
var headTimer = null, headFrom = null, headSeq = 0;

function bearing(a, b) {
  var t = Math.PI / 180;
  var y = Math.sin((b.lng - a.lng) * t) * Math.cos(b.lat * t);
  var x = Math.cos(a.lat * t) * Math.sin(b.lat * t) -
          Math.sin(a.lat * t) * Math.cos(b.lat * t) * Math.cos((b.lng - a.lng) * t);
  return (Math.atan2(y, x) / t + 360) % 360;
}

/* 방위각 deg(북=0, 시계방향)로 진행하는 모습으로 택시를 놓는다.
   화면에서 진행 방향 = (sin, -cos) 이므로 뒤쪽은 그 반대. */
function placeTaxi(deg) {
  if (!taxiEl) return;
  var r = deg * Math.PI / 180;
  var dx = -TAXI_BACK * Math.sin(r), dy = TAXI_BACK * Math.cos(r);
  taxiEl.style.transform =
    "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px) rotate(" + (deg - 90).toFixed(1) + "deg)";
}

/* 출발점으로 접근하는 길을 만들기 위한 기준점 — 현위치가 쓸 만하면 그걸,
   아니면 북쪽으로 700m 떨어진 가상의 점을 쓴다. */
function approachFrom(o) {
  var d = haversine(o, myPos);
  if (d > 250 && d < 20000) return { lat: myPos.lat, lng: myPos.lng };
  return { lat: o.lat + 0.0063, lng: o.lng };
}

function updateTaxiHeading() {
  clearTimeout(headTimer);
  headTimer = setTimeout(function () {
    var o = { lat: origin.lat, lng: origin.lng };
    if (headFrom && haversine(headFrom, o) < 30) return;   // 거의 안 움직였으면 그대로
    headFrom = o;
    var seq = ++headSeq;
    fetchDirections(approachFrom(o), o).then(function (r) {
      if (seq !== headSeq) return;                          // 그 사이 또 움직였다
      var c = r.coords, end = c[c.length - 1];
      if (!end) return;
      for (var i = c.length - 2; i >= 0; i--) {             // 15m 이상 떨어진 점까지 되짚어
        var pt = { lat: c[i][0], lng: c[i][1] };
        if (haversine(pt, { lat: end[0], lng: end[1] }) >= 15) {
          placeTaxi(bearing(pt, { lat: end[0], lng: end[1] }));
          return;
        }
      }
    }).catch(function () { /* 기본 방향 유지 */ });
  }, 420);
}

var nameTimer = null, pinnedName = null;
function resolveOriginName() {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(function () {
    if (pinnedName) { setOrigin(pinnedName); pinnedName = null; return; }
    if (haversine(origin, CITYHALL) < 70) { setOrigin('제주시청'); return; }
    if (!geocoder) { setOrigin('선택한 위치'); return; }
    geocoder.coord2Address(origin.lng, origin.lat, function (res, status) {
      if (status !== K.services.Status.OK || !res[0]) { setOrigin('선택한 위치'); return; }
      var r = res[0], nm = '';
      if (r.road_address) nm = r.road_address.building_name || shortAddr(r.road_address.address_name);
      if (!nm && r.address) nm = shortAddr(r.address.address_name);
      setOrigin(nm || '선택한 위치');
    });
  }, 220);
}
function shortAddr(a) {
  return String(a || '').replace(/^제주특별자치도\s*/, '').replace(/^제주시\s*/, '').replace(/^서귀포시\s*/, '');
}
function setOrigin(name) {
  origin.name = name;
  originTextEl.textContent = name;
  $('#srchOrigin').textContent = name;
}

btnLocate.addEventListener('click', function () {
  if (!mapS2) return;
  if (haversine(origin, myPos) < 8) { toast('이미 현위치에 있어요.'); return; }
  originTextEl.textContent = '위치 확인 중...';
  mapS2.panTo(LL(myPos));
});
$('#btnReserve').addEventListener('click', function () {
  toast('예약 호출은 이 연습에 포함되어 있지 않아요.');
});
$('#rowOrigin').addEventListener('click', function () { openSearch('origin'); });
$('#srchOriginRow').addEventListener('click', function () { openSearch('origin'); });
$('#rowDest').addEventListener('click', function () { openSearch('dest'); });
$$('.chip[data-fav]').forEach(function (b) {
  b.addEventListener('click', function () { chooseDest(FAVS[b.dataset.fav]); });
});

/* ───────────────────────── 3. S3 · 도착지 검색 (카카오 장소검색) ───────────────────────── */

var srchInput = $('#srchInput'), srchBody = $('#srchBody'), srchForm = $('#srchForm'),
    srchClear = $('#srchClear'), srchMic = $('#srchMic'), srchTools = $('#srchTools');
var recents = [], lastResults = [], sugTimer = null;

/* 검색 범위 — 제주도 전체.
   예전에는 제주시청 기준 20km 반경이었는데, 서귀포시청(26km)·성산일출봉(30km)처럼
   섬의 남쪽·동쪽이 통째로 빠져서 아예 검색되지 않았다. 카카오 API 의 radius 최대값이
   20km 라 반경을 늘릴 수 없어, 제주도를 통째로 감싸는 사각형으로 바꿨다. */
var JEJU_SW = { lat: 33.10, lng: 126.14 }, JEJU_NE = { lat: 33.60, lng: 126.98 };
function jejuArea() { return { bounds: new K.LatLngBounds(LL(JEJU_SW), LL(JEJU_NE)) }; }

var srchMode = 'dest';                 // 'dest' | 'origin'
function openSearch(mode) {
  srchMode = mode === 'origin' ? 'origin' : 'dest';
  var isO = srchMode === 'origin';
  screens.search.classList.toggle('is-origin', isO);
  srchInput.placeholder = isO ? '출발지 검색' : '도착지 검색';
  $('#srchDot').className = 'dot ' + (isO ? 'dot--origin' : 'dot--dest');
  srchInput.value = '';
  renderIdle();
  push('search');
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

function renderIdle() {
  srchClear.hidden = true; srchMic.hidden = false; srchTools.style.display = '';
  if (!recents.length) {
    srchBody.innerHTML = '<div class="srch-empty">최근 설정 기록이 없습니다.</div>';
    return;
  }
  srchBody.innerHTML = '<div class="res-head">최근 검색</div>' + recents.map(function (p, i) {
    return '<div class="res res--recent" data-recent="' + i + '">' +
      '<svg class="i22" style="color:#B6BAC1;flex:none"><use href="#ic-clock"/></svg>' +
      '<div class="res__txt"><div class="res__name">' + esc(p.name) + '</div>' +
      '<div class="res__addr">' + esc(p.addr || '') + '</div></div></div>';
  }).join('');
}

function typing() {
  var q = srchInput.value.trim();
  srchClear.hidden = !q; srchMic.hidden = !!q;
  srchTools.style.display = q ? 'none' : '';
  if (!q) { renderIdle(); return; }
  clearTimeout(sugTimer);
  sugTimer = setTimeout(function () { suggest(q); }, 220);
}

function suggest(q) {
  if (!places) { srchBody.innerHTML = '<div class="srch-empty">검색을 사용할 수 없어요.</div>'; return; }
  places.keywordSearch(q, function (data, status) {
    if (srchInput.value.trim() !== q) return;
    if (status !== K.services.Status.OK || !data.length) {
      srchBody.innerHTML = '<button class="sug" data-sug="' + esc(q) + '">' + highlight(q, q) + '</button>';
      return;
    }
    var seen = {}, rows = [];
    data.forEach(function (d) {
      if (seen[d.place_name] || rows.length >= 7) return;
      seen[d.place_name] = 1;
      rows.push('<button class="sug" data-sug="' + esc(d.place_name) + '">' + highlight(d.place_name, q) + '</button>');
    });
    srchBody.innerHTML = rows.join('');
  }, Object.assign(jejuArea(), { size: 10 }));
}

function search(q) {
  srchInput.value = q;
  srchClear.hidden = false; srchMic.hidden = true; srchTools.style.display = 'none';
  srchInput.blur();
  if (!places) { srchBody.innerHTML = '<div class="srch-empty">검색을 사용할 수 없어요.</div>'; return; }
  srchBody.innerHTML = '<div class="srch-empty">찾는 중…</div>';
  places.keywordSearch(q, function (data, status) {
    if (status !== K.services.Status.OK || !data.length) {
      srchBody.innerHTML = '<div class="srch-empty">검색 결과가 없어요.</div>';
      return;
    }
    lastResults = data.map(function (d) {
      return {
        name: d.place_name,
        addr: d.road_address_name || d.address_name,
        lat: +d.y, lng: +d.x,
        km: d.distance ? (+d.distance / 1000) : haversine(origin, { lat: +d.y, lng: +d.x }) / 1000
      };
    });
    srchBody.innerHTML = '<div class="res-head">장소결과</div>' + lastResults.map(function (p, i) {
      return '<div class="res">' +
        '<div class="res__txt">' +
          '<div class="res__name">' + highlight(p.name, q) + '</div>' +
          '<div class="res__addr">' + esc(p.addr) + '<em>' + p.km.toFixed(2) + 'km</em></div>' +
        '</div>' +
        '<button class="res__btn" data-pick="' + i + '">' + (srchMode === 'origin' ? '출발' : '도착') + '</button>' +
      '</div>';
    }).join('');
  }, Object.assign(jejuArea(), { size: 15 }));
}

srchInput.addEventListener('input', typing);
srchForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var q = srchInput.value.trim();
  if (q) search(q);
});
srchClear.addEventListener('click', function () {
  srchInput.value = ''; renderIdle(); srchInput.focus();
});
srchMic.addEventListener('click', function () { toast('음성 검색은 이 연습에 포함되어 있지 않아요.'); });
$('#srchHere').addEventListener('click', function () {
  if (srchMode !== 'origin') { toast('출발지 줄을 누르면 출발지를 바꿀 수 있어요.'); return; }
  chooseOrigin({ name: '위치 확인 중...', lat: myPos.lat, lng: myPos.lng });
  pinnedName = null;
});
$('#srchMap').addEventListener('click', function () { toast('지도에서 찾기는 이 연습에 포함되어 있지 않아요.'); });
srchBody.addEventListener('click', function (e) {
  var s = e.target.closest('[data-sug]');
  if (s) { search(s.dataset.sug); return; }
  var pick = srchMode === 'origin' ? chooseOrigin : chooseDest;
  var p = e.target.closest('[data-pick]');
  if (p) { pick(lastResults[+p.dataset.pick]); return; }
  var r = e.target.closest('[data-recent]');
  if (r) { pick(recents[+r.dataset.recent]); return; }
});

/* 검색으로 고른 출발지 — 지도를 그리로 옮기고 택시 화면으로 돌아간다 */
function chooseOrigin(place) {
  if (!place) return;
  origin.lat = place.lat; origin.lng = place.lng;
  pinnedName = place.name;
  setOrigin(place.name);
  pop();
  setTimeout(function () {
    if (mapS2) { mapS2.setCenter(LL(origin)); mapS2.relayout(); }
    updateTaxiHeading();
  }, 60);
}
$$('.srch-tool[data-fav]').forEach(function (b) {
  b.addEventListener('click', function () {
    (srchMode === 'origin' ? chooseOrigin : chooseDest)(FAVS[b.dataset.fav]);
  });
});

/* ───────────────────────── 4. S4 · 경로 + 호출 목록 ───────────────────────── */

var OPTS = [
  { key: 'bluepartner', name: '블루파트너스', desc: '배차될 때까지 찾아주는 제휴 택시', img: 'opt-blue',    add: 500 },
  { key: 'normal',      name: '일반호출',     desc: '주변 택시 호출',                 img: 'opt-normal',  add: 0 },
  { key: 'ventiresv',   name: '벤티 예약',    chip: '30분~2주 뒤 출발',  note: '대형 차량',      img: 'opt-venti',   resv: true },
  { key: 'bluersv',     name: '블루파트너스 예약', beta: true, chip: '10분~1시간 뒤 출발', note: '차종 선택 가능', img: 'opt-bluersv', resv: true },
  { key: 'blue',        name: '블루',         desc: '예약 확정 · 승차 거부 없음',      img: 'opt-blue',    add: 1000 },
  { key: 'venti',       name: '벤티',         desc: '최대 6인 · 짐이 많을 때',        img: 'opt-venti',   mul: 1.9 }
];
function fareOf(op) {
  if (!trip) return 0;
  var base = trip.fare;
  return round100(base * (op.mul || 1) + (op.add || 0));
}

var trip = null;      // { from, to, km, eta, fare, path }
var picked = OPTS[1];

function chooseDest(place) {
  if (!place) return;
  trip = {
    from: { lat: origin.lat, lng: origin.lng, name: origin.name },
    to: place,
    km: haversine(origin, place) / 1000,
    eta: 0, fare: 0, path: null
  };
  trip.eta = Math.max(4, Math.round(trip.km * 3.2) + 2);
  trip.fare = round100(4800 + Math.max(0, trip.km - 2) * 1320);

  recents = [place].concat(recents.filter(function (r) { return r.name !== place.name; })).slice(0, 6);

  $('#routeFrom').textContent = trip.from.name;
  $('#routeTo').textContent = trip.to.name;
  renderOptions();
  push('route');
  setTimeout(drawRoute, 30);
}

/* 실제 도로 경로 — 카카오모빌리티 길찾기 */
function fetchDirections(o, d) {
  var url = 'https://apis-navi.kakaomobility.com/v1/directions' +
            '?origin=' + o.lng + ',' + o.lat +
            '&destination=' + d.lng + ',' + d.lat +
            '&priority=RECOMMEND&car_fuel=GASOLINE&car_hipass=false&alternatives=false&road_details=false';
  return fetch(url, { headers: { Authorization: 'KakaoAK ' + KAKAO_REST_KEY } })
    .then(function (r) { return r.json(); })
    .then(function (js) {
      var rt = js && js.routes && js.routes[0];
      if (!rt || rt.result_code !== 0) throw new Error(rt ? rt.result_msg : '경로 없음');
      var coords = [];   // [[lat,lng], …] — 지도 SDK 없이도 쓸 수 있게 원시 좌표로
      (rt.sections || []).forEach(function (sec) {
        (sec.roads || []).forEach(function (rd) {
          for (var i = 0; i + 1 < rd.vertexes.length; i += 2) {
            coords.push([rd.vertexes[i + 1], rd.vertexes[i]]);
          }
        });
      });
      return {
        coords: coords,
        km: rt.summary.distance / 1000,
        min: Math.max(1, Math.round(rt.summary.duration / 60)),
        fare: (rt.summary.fare && rt.summary.fare.taxi) || 0
      };
    });
}

var routeLines = [], routeMarks = [];
function clearRoute() {
  routeLines.forEach(function (l) { l.setMap(null); });
  routeMarks.forEach(function (m) { m.setMap(null); });
  routeLines = []; routeMarks = [];
}

function markerEl(html, cls) {
  var d = document.createElement('div');
  d.className = 'mk ' + cls;
  d.innerHTML = html;
  return d;
}

function drawRoute() {
  if (!trip) return;
  var box = $('#routeMapBox');
  if (!box.offsetWidth) { setTimeout(drawRoute, 60); return; }

  if (K) {
    if (!mapS4) mapS4 = new K.Map($('#routeCanvas'), { center: LL(trip.from), level: 6 });
    mapS4.relayout();
    clearRoute();
    paint([LL(trip.from), LL(trip.to)]);   // 응답 전에도 화면이 비지 않도록 임시 직선
  }

  // 지도 SDK 가 없어도 거리·소요시간·택시요금은 실제 길찾기 값을 쓴다
  fetchDirections(trip.from, trip.to).then(function (r) {
    if (!r.coords.length) throw new Error('빈 경로');
    trip.km = r.km;
    trip.eta = r.min;
    if (r.fare) trip.fare = r.fare;
    renderOptions();
    updateDetail();
    if (!K) return;
    clearRoute();
    paint(r.coords.map(function (c) { return new K.LatLng(c[0], c[1]); }));
  }).catch(function (err) {
    // 길찾기를 못 쓰면 직선 거리 + 자체 예상요금으로 계속 진행한다
    if (window.console) console.warn('길찾기 실패:', err && err.message);
  });

  function paint(path) {
    routeLines.push(new K.Polyline({
      map: mapS4, path: path, strokeWeight: 11, strokeColor: '#ffffff', strokeOpacity: .95, strokeStyle: 'solid'
    }));
    routeLines.push(new K.Polyline({
      map: mapS4, path: path, strokeWeight: 7, strokeColor: '#2F80ED', strokeOpacity: 1, strokeStyle: 'solid'
    }));

    routeMarks.push(new K.CustomOverlay({
      map: mapS4, position: LL(trip.from), zIndex: 4, yAnchor: 1.55,
      content: markerEl('<div class="mk__bubble">출발 <svg class="i14" style="fill:none"><use href="#ic-chev"/></svg></div>' +
                        '<div class="mk__stem"></div><div class="mk__ring"></div>', 'mk--from')
    }));
    routeMarks.push(new K.CustomOverlay({
      map: mapS4, position: LL(trip.to), zIndex: 4, yAnchor: 1.6,
      content: markerEl('<div class="mk__eta"><b>도착</b><span>' + trip.eta + '분 예상 ' +
                        '<svg class="i14" style="fill:none"><use href="#ic-chev"/></svg></span></div>' +
                        '<div class="mk__stem"></div><div class="mk__pin"></div>', 'mk--to')
    }));

    var b = new K.LatLngBounds();
    path.forEach(function (p) { b.extend(p); });
    fitRoute(b);
    lastBounds = b;
  }
}
var lastBounds = null;
function fitRoute(b) {
  var sheet = stack.indexOf('detail') > -1 ? $('.sheet--detail') : $('.sheet--route');
  var h = sheet ? sheet.offsetHeight : 420;
  document.documentElement.style.setProperty('--sheetH', h + 'px');
  if (!mapS4 || !b) return;
  mapS4.setBounds(b, 96, 46, h + 20, 46);
}

function renderOptions() {
  $('#opts').innerHTML = OPTS.map(function (op) {
    var right = op.resv ? '' : '<span class="opt__fare"><small>예상</small>' + won(fareOf(op)) + '</span>';
    var second = op.resv
      ? '<span class="opt__chip"><svg style="fill:none"><use href="#ic-clock"/></svg>' + op.chip + '</span>' +
        '<span class="opt__note">' + op.note + '</span>'
      : '<span class="opt__desc">' + op.desc + '</span>';
    return '<button class="opt" data-opt="' + op.key + '">' +
        '<img src="img/' + op.img + '.png" alt="">' +
        '<span class="opt__body">' +
          '<span class="opt__top"><span class="opt__name">' + op.name +
            (op.beta ? '<i class="opt__beta">Beta</i>' : '') + '</span>' + right + '</span>' +
          second +
        '</span>' +
      '</button>';
  }).join('');
}

$('#opts').addEventListener('click', function (e) {
  var b = e.target.closest('[data-opt]');
  if (!b) return;
  var op = OPTS.filter(function (o) { return o.key === b.dataset.opt; })[0];
  if (!op) return;
  if (op.resv) { toast('예약 호출은 이 연습에 포함되어 있지 않아요.'); return; }
  picked = op;
  updateDetail();
  push('detail');
});
$('#btnRecommend').addEventListener('click', function () {
  toast('지금 보이는 길이 가장 빠른 추천경로예요.');
});
$$('.seg__btn').forEach(function (b) {
  b.addEventListener('click', function () {
    $$('.seg__btn').forEach(function (n) { n.classList.remove('is-on'); });
    b.classList.add('is-on');
    if (b.textContent.indexOf('원하는') > -1) toast('원하는 시간으로 호출은 이 연습에 포함되어 있지 않아요.');
  });
});

/* ───────────────────────── 5. S5 · 호출 상세 ───────────────────────── */

var payMethod = null;     // null | 'point' | 'card' | 'kakaopay' | 'other'
var PAY_LABEL = { point: '카카오 T 포인트', card: '신용/체크카드', kakaopay: '카카오페이', other: '직접결제' };

function updateDetail() {
  if (!trip) return;
  $('#dtIco').src = 'img/' + picked.img + '.png';
  $('#dtName').textContent = picked.name;
  $('#dtFare').textContent = won(fareOf(picked));
  $('#payTotal').textContent = won(fareOf(picked));
}
onEnter.route = function () { setTimeout(function () { fitRoute(lastBounds); }, 30); };
onEnter.detail = function () {
  screens.route.classList.add('has-detail');
  updateDetail();
  setTimeout(function () { fitRoute(lastBounds); }, 30);
  showCallSpot();
};
onLeave.detail = function () {
  screens.route.classList.remove('has-detail');
  setTimeout(function () { fitRoute(lastBounds); }, 30);
  hideCallSpot();
};

/* ── 호출하기 직전 안내 ──
   결제수단까지 정해져서 [호출하기]만 남았을 때, 둘레를 어둡게 덮고 그 버튼만 남긴다.
   진짜 택시가 오는 줄 알고 못 누르는 분들이 있어서 눌러도 된다고 알려 주는 자리다. */
var spotEl = $('#callSpot'), spotHole = $('#callSpotHole'), spotSay = $('#callSpotSay');

var spotTimer = null;
function showCallSpot(delay) {
  clearTimeout(spotTimer);
  if (!payMethod) { hideCallSpot(); return; }   // 결제수단이 먼저다
  spotTimer = setTimeout(function () {
    if (stack[stack.length - 1] !== 'detail') return;   // 그새 다른 화면으로 갔으면 그만둔다
    spotEl.hidden = false;
    placeCallSpot();
  }, delay || 0);
}
function hideCallSpot() { clearTimeout(spotTimer); spotEl.hidden = true; }

function placeCallSpot() {
  if (spotEl.hidden) return;
  var p = $('#phone').getBoundingClientRect();
  var r = $('#ctaCall').getBoundingClientRect();
  var pad = 6;
  spotHole.style.left   = (r.left - p.left - pad) + 'px';
  spotHole.style.top    = (r.top  - p.top  - pad) + 'px';
  spotHole.style.width  = (r.width  + pad * 2) + 'px';
  spotHole.style.height = (r.height + pad * 2) + 'px';
  /* 말풍선은 버튼 위에 둔다 — 자리가 모자라면 아래로 내린다 */
  var above = r.top - p.top - pad - 14;
  spotSay.style.top = above > spotSay.offsetHeight
    ? (above - spotSay.offsetHeight) + 'px'
    : (r.bottom - p.top + pad + 14) + 'px';
}

$('#dtDown').addEventListener('click', function () { pop(); });
$('#dtHelp').addEventListener('click', function () { toast(picked.name + ' — ' + (picked.desc || '') + '\n예상 금액은 실제와 다를 수 있어요.'); });
$$('.dt-size__b').forEach(function (b) {
  b.addEventListener('click', function () {
    $$('.dt-size__b').forEach(function (n) { n.classList.remove('is-on'); });
    b.classList.add('is-on');
  });
});
$('#btnRider').addEventListener('click', function () { toast('탑승자 변경은 이 연습에 포함되어 있지 않아요.'); });
$('#btnCoupon').addEventListener('click', function () { push('pay'); });
$('#btnPay').addEventListener('click', function () { push('pay'); });
$('#ctaCall').addEventListener('click', function () {
  /* 진짜 카카오 T 도 결제수단이 없으면 호출이 되지 않는다(캡처 tp-10 의 다음 단계가
     [결제수단 등록] 이다). 막기만 하지 않고 결제수단 화면을 바로 띄워 준다. */
  if (!payMethod) {
    toast('결제수단을 먼저 등록해 주세요.');
    push('pay');
    return;
  }
  hideCallSpot();
  startRide();
});

/* ───────────────────────── 6. 결제수단 시트 ───────────────────────── */

var paySel = null;

/* 진짜 카카오 T 와 같게 — 카카오페이에 카드나 계좌가 등록돼 있지 않으면
   골라도 [적용]이 활성화되지 않는다. 다른 결제수단을 골라야 넘어간다. */
var PAY_BLOCKED = { kakaopay: true };

onEnter.pay = function () {
  paySel = payMethod || 'kakaopay';   // 처음 열 때도 카카오페이가 골라져 있다
  syncPay();
};

function syncPay() {
  $$('.pm').forEach(function (el) { el.classList.toggle('is-on', el.dataset.pm === paySel); });
  $('#deckKakaopay').hidden = paySel !== 'kakaopay';
  $('#deckOther').hidden = paySel !== 'other';
  $('#payNote').hidden = !paySel;
  $('#payApply').disabled = !paySel || !!PAY_BLOCKED[paySel];
  $('#payWarn').hidden = !PAY_BLOCKED[paySel];

  var off = paySel === 'other';
  $$('.pay__row').forEach(function (r) { r.classList.toggle('is-off', off); });
  $('#valCoupon').textContent = off ? '사용불가' : '쿠폰 없음';
  $('#valPoint').innerHTML = off ? '사용불가' : '-0P<small>보유 0P</small>';
  $('#miniCoupon').hidden = off;
  $('#miniPoint').hidden = off;
}

$('#payCard').addEventListener('click', function (e) {
  var b = e.target.closest('[data-pm]');
  if (!b) return;
  paySel = b.dataset.pm;
  syncPay();
});
$('#miniCoupon').addEventListener('click', function () { toast('사용할 수 있는 쿠폰이 없어요.'); });
$('#miniPoint').addEventListener('click', function () { toast('보유 포인트가 0P 예요.'); });
/* 결제수단을 정하고 상세 화면의 [결제수단 등록] 자리를 바꿔 준다 */
function setPayMethod(key) {
  payMethod = key;
  var btn = $('#btnPay');
  $('#payLabel').textContent = PAY_LABEL[key];
  btn.classList.add('is-set');
  var ico = btn.querySelector('svg,img');
  if (key === 'other') {
    var img = document.createElement('img');
    img.src = 'img/pay-direct.png'; img.alt = '';
    if (ico) btn.replaceChild(img, ico);
  } else if (ico && ico.tagName === 'IMG') {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'i22');
    svg.innerHTML = '<use href="#ic-plus"/>';
    btn.replaceChild(svg, ico);
  }
}

$('#payApply').addEventListener('click', function () {
  setPayMethod(paySel);
  pop();
  toast(PAY_LABEL[payMethod] + '(으)로 결제수단을 설정했어요.');
  showCallSpot(2800);      // 안내 말풍선은 위 알림이 사라진 뒤에 띄운다
});

/* ───────────────────────── 7. 광고 팝업 ───────────────────────── */

var adShown = false;
$('#adShare').addEventListener('click', function () { pop(); toast('친구에게 공유했어요.'); });
$('#adMore').addEventListener('click', function () { pop(); toast('광고 자세히 보기는 이 연습에 포함되어 있지 않아요.'); });

/* ── S0 · 시작 광고 (앱을 열면 한 번, tp-01 캡처) ──
   [다시 보지 않기] 도 이 연습 안에서만 유효하다 — 다시 시작하면 또 보인다.  */
$('#ad0Never').addEventListener('click', function () { pop(); toast('이번 연습에서는 다시 보이지 않아요.'); });
$('#ad0Close').addEventListener('click', function () { pop(); });

/* ───────────────────────── 8. 홈 → 택시 ───────────────────────── */

function openTaxi() {
  push('taxi');
  if (mapS2) setTimeout(function () { mapS2.relayout(); mapS2.setCenter(LL(origin)); }, 30);
  if (!adShown) { adShown = true; setTimeout(function () { push('ad'); }, 320); }
  askLocation();
}
/* ── 홈 화면 서비스 격자 — 탭 4개(image/기타 기능 캡처 그대로) ──
   아이콘과 배너 그림은 캡처에서 잘라낸 실제 그림이다.                       */
var HOME_TABS = {
  move: { promo: { sub: '블루파트너스 이…', title: '무료로 이용하…', art: 'promo.jpg', tone: 'move' },
    svcs: [['taxi', '택시', 'svc-taxi'], ['taxical', '택시예약', 'svc-taxical'], ['rentcar', '렌터카', 'svc-rentcar'],
           ['bike', '바이크', 'svc-bike'], ['bike30', '바이크30분', 'svc-bike30'], ['trainbus', '기차/버스', 'svc-trainbus']] },
  drive: { promo: { sub: '급히 출장세차가 …', title: '오늘 세차됩니다', art: 'promo-drive.png', tone: 'drive' },
    svcs: [['daeri', '대리', 'svc-daeri'], ['parking', '주차', 'svc-parking'], ['inspect', '자동차검사', 'svc-inspect'],
           ['carwash', '출장세차', 'svc-carwash'], ['navi', '내비', 'svc-navi'], ['evcharge', '전기차충전', 'svc-evcharge']] },
  send: { two: true, promo: { sub: '고민없이 접수하는', title: '퀵 AI 사진 접수', art: 'promo-send.png', tone: 'send' },
    svcs: [['quick', '퀵', 'svc-quick'], ['bigcargo', '큰짐배송', 'svc-bigcargo'],
           ['pickup', '방문택배', 'svc-pickup'], ['cvspost', '편의점택배', 'svc-cvspost']] },
  abroad: { promo: { sub: '터치제주 광고', title: '스마트폰 교재', art: 'promo-touch.png', tone: 'touch' },
    svcs: [['abroadcall', '해외차량호출', 'svc-abroadcall'], ['abroadcar', '해외렌터카', 'svc-abroadcar'], ['guamtaxi', '괌택시', 'svc-guamtaxi'],
           ['air', '항공', 'svc-air'], ['jpair', '일본공항픽업', 'svc-jpair'], ['guamleisure', '괌레저', 'svc-guamleisure']] }
};

var homeGrid = $('#homeGrid');
function renderHomeGrid(key) {
  var t = HOME_TABS[key] || HOME_TABS.move;
  homeGrid.classList.toggle('home-grid--two', !!t.two);
  homeGrid.innerHTML =
    '<div class="promo promo--' + t.promo.tone + '">' +
      '<div class="promo__sub">' + esc(t.promo.sub) + '</div>' +
      '<div class="promo__title">' + esc(t.promo.title) + '</div>' +
      '<img class="promo__art" src="img/' + t.promo.art + '" alt="" aria-hidden="true">' +
    '</div>' +
    t.svcs.map(function (v) {
      return '<button class="svc" data-svc="' + v[0] + '"' + (v[0] === 'taxi' ? ' id="svcTaxi"' : '') + '>' +
        '<img src="img/' + v[2] + '.png" alt=""><span>' + esc(v[1]) + '</span></button>';
    }).join('');
}

$('#homeTabs').addEventListener('click', function (e) {
  var b = e.target.closest('.home-tab');
  if (!b) return;
  $$('.home-tab').forEach(function (n) { n.classList.toggle('is-on', n === b); });
  renderHomeGrid(b.dataset.tab);
  /* 고른 탭이 화면 밖으로 잘려 있으면 보이게 밀어 준다 */
  var bar = $('#homeTabs'), r = b.getBoundingClientRect(), br = bar.getBoundingClientRect();
  if (r.right > br.right - 6) bar.scrollLeft += r.right - br.right + 14;
  else if (r.left < br.left + 6) bar.scrollLeft -= br.left - r.left + 14;
});

homeGrid.addEventListener('click', function (e) {
  var b = e.target.closest('[data-svc]');
  if (!b) return;
  if (b.dataset.svc === 'taxi') openTaxi();
  else if (b.dataset.svc === 'air') push('air');
  else toast('이 연습에서는 [택시]만 사용해요.');
});

$('#homeSearch').addEventListener('click', openTaxi);
$('.home-more').addEventListener('click', function () { toast('이 연습에서는 [택시]만 사용해요.'); });
/* ── 하단 메뉴 (전체 서비스 · 알림) ──
   홈 화면의 메뉴 막대를 그대로 복사해 다른 화면에도 붙인다.            */
var homeNav = document.querySelector('.screen--home .home-nav');
$$('.needs-nav').forEach(function (slot) { slot.appendChild(homeNav.cloneNode(true)); });

function syncNav() {
  var top = stack[stack.length - 1];
  var key = (top === 'all' || top === 'noti') ? top : 'home';
  $$('.home-nav button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.nav === key); });
}
var origRenderStack = renderStack;
renderStack = function (anim) { origRenderStack(anim); syncNav(); };

document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('.home-nav button');
  if (!b) return;
  var k = b.dataset.nav, top = stack[stack.length - 1];
  if (k === 'home') { if (top !== 'home') goHome(); return; }
  if (k === 'all' || k === 'noti') { if (top !== k) push(k); return; }
  toast('이 연습에서는 [택시]만 사용해요.');
});

/* ── 전체 서비스 보기 ── */
/* 전체 서비스 화면의 목록 — 홈 탭보다 훨씬 많다(캡처 _05~_08 순서 그대로) */
var ALL_SVCS = {
  move: [['taxi','택시','svc-taxi'],['taxical','택시예약','svc-taxical'],['rentcar','렌터카','svc-rentcar'],
         ['bike','바이크','svc-bike'],['kickboard','킥보드','svc-kickboard'],['bike30','바이크30분','svc-bike30'],
         ['train','기차','svc-train'],['intercity','시외버스','svc-intercity'],['arex','공항철도','svc-arex'],
         ['booking','예약하기','svc-booking'],['mobility','교통약자','svc-mobility'],['shuttle','셔틀','svc-shuttle'],
         ['buscharter','버스대절','svc-buscharter'],['autodrive','서울자율','svc-autodrive'],['drt','DRT','svc-drt']],
  drive: [['daeri','대리','svc-daeri'],['parking','주차','svc-parking'],['navi','내비','svc-navi'],
          ['carwash','출장세차','svc-carwash'],['inspect','자동차검사','svc-inspect'],['evcharge','전기차충전','svc-evcharge'],
          ['carsell','내차팔기','svc-carsell'],['carbuy','내차사기','svc-carbuy'],['escooter','E스쿠터','svc-escooter'],
          ['monthrent','한달렌트','svc-monthrent'],['subsidy','보조금조회','svc-subsidy'],['carins','내차보험','svc-carins']],
  send: [['quickship','퀵·배송','svc-quickship'],['quick','퀵','svc-quick'],['bigcargo','큰짐배송','svc-bigcargo'],
         ['pickup','방문택배','svc-pickup'],['cvspost','편의점택배','svc-cvspost']],
  abroad: [['abroadcall','해외차량호출','svc-abroadcall'],['abroadcar','해외렌터카','svc-abroadcar'],['air','항공','svc-air'],
           ['guamtaxi','괌택시','svc-guamtaxi'],['guamleisure','괌레저','svc-guamleisure'],['leisure','레저/티켓','svc-leisure'],
           ['icnair','인천공항','svc-icnair'],['jpair','일본공항픽업','svc-jpair'],['usim','유심/이심','svc-usim'],
           ['travelins','여행자보험','svc-travelins']]
};
var ALL_CAT = { move: '이동할 때', drive: '운전할 때', send: '물건보낼 때', abroad: '해외갈 때' };
function renderAllGrid(key) {
  var list = ALL_SVCS[key] || ALL_SVCS.move;
  $('#allCatName').textContent = ALL_CAT[key] || ALL_CAT.move;
  $('#allGrid').innerHTML = list.map(function (v) {
    return '<button class="svc" data-svc="' + v[0] + '">' +
      '<img src="img/' + v[2] + '.png" alt=""><span>' + esc(v[1]) + '</span></button>';
  }).join('');
}
$('#allRail').addEventListener('click', function (e) {
  var b = e.target.closest('.all-cat');
  if (!b) return;
  $$('.all-cat').forEach(function (n) { n.classList.toggle('is-on', n === b); });
  renderAllGrid(b.dataset.tab);
});
$('#allGrid').addEventListener('click', function (e) {
  var b = e.target.closest('[data-svc]');
  if (!b) return;
  if (b.dataset.svc === 'taxi') goHome(function () { openTaxi(); });
  else toast('이 연습에서는 [택시]만 사용해요.');
});
onEnter.all = function () { renderAllGrid(($('.all-cat.is-on') || {}).dataset.tab || 'move'); };

/* ── 알림 → 이용기록 ── */
$('#btnUseLog').addEventListener('click', function () { push('uselog'); });
$$('.nchip').forEach(function (b) {
  b.addEventListener('click', function () {
    $$('.nchip').forEach(function (n) { n.classList.toggle('is-on', n === b); });
  });
});
$$('.ul-tab').forEach(function (b) {
  b.addEventListener('click', function () {
    $$('.ul-tab').forEach(function (n) { n.classList.toggle('is-on', n === b); });
  });
});
$$('.perk').forEach(function (b) {
  b.addEventListener('click', function () { toast('이 연습에서는 [택시]만 사용해요.'); });
});




var askedLocation = false;
function askLocation() {
  if (askedLocation || !navigator.geolocation) {
    if (!askedLocation) toast('위치를 확인할 수 없어 제주시청을 기준으로 안내해요.');
    askedLocation = true;
    return;
  }
  askedLocation = true;

  // 첫 좌표는 출발지까지 옮기고, 이후 갱신은 파란 점만 따라가게 한다.
  var first = true;
  function apply(pos) {
    var q = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    myPos = q;
    if (meOverlay) meOverlay.setPosition(LL(q));
    if (!first) {
      if (mapS2) btnLocate.classList.toggle('is-moved', haversine(origin, myPos) > 25);
      return;
    }
    first = false;
    origin.lat = q.lat; origin.lng = q.lng;
    if (mapS2) { mapS2.setCenter(LL(q)); }
    resolveOriginName();
    updateTaxiHeading();
  }
  function fail(err) {
    toast(err && err.code === 1
      ? '위치 권한이 꺼져 있어 제주시청을 기준으로 안내해요.'
      : '위치를 확인할 수 없어 제주시청을 기준으로 안내해요.');
  }

  var opts = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
  navigator.geolocation.getCurrentPosition(apply, fail, opts);
  // 걸어 다녀도 파란 점이 따라오도록 계속 지켜본다
  try { navigator.geolocation.watchPosition(apply, function () {}, opts); } catch (err) {}
}

/* ───────────────────── 8.5. S6 · 호출 요청 → 배차 완료 → 취소 ─────────────────────
   연습 종류는 주소의 flow 값으로 정한다.
     call   … 호출하기까지 (배차가 잡히면 끝)
     cancel … 호출하기 버튼에서 시작해 호출을 취소하기까지
     all    … 홈에서 취소까지 한번에                                          */

var FLOW = (location.search.match(/[?&]flow=(\w+)/) || [])[1] || 'all';

var rideScreen = screens.ride;
var mapS6 = null, rideMarks = [], taxiOv = null, taxiTimer = null;
var waitTimer = null, matchedAt = null, reason = null;

function hhmm(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function sheetH() { var s = $('#rideSheet'); return s ? s.offsetHeight : 404; }

/* 홈 화면까지 한 번에 되돌아간다 (뒤로가기 기록도 같이 정리된다) */
function goHome(then) {
  var back = stack.length - 1;
  if (back <= 0) { if (then) then(); return; }
  var once = function () {
    window.removeEventListener('popstate', once);
    setTimeout(then || function () {}, 80);
  };
  window.addEventListener('popstate', once);
  history.go(-back);
}

function clearRideMarks() {
  rideMarks.forEach(function (m) { m.setMap(null); });
  rideMarks = [];
}
function stopTaxi() {
  clearInterval(taxiTimer); taxiTimer = null;
  if (taxiOv) { taxiOv.setMap(null); taxiOv = null; }
}
/* 지도 위 택시 — 출발 핀 옆에 쓰는 SVG 를 그대로 복사해 쓴다 */
function taxiSvgHTML() {
  var n = document.querySelector('.pin__taxi').cloneNode(true);
  n.setAttribute('class', 'mk__car');
  n.removeAttribute('style');
  return n.outerHTML;
}

function drawRideMap() {
  if (!K) return;
  if (!$('#rideMapBox').offsetWidth) { setTimeout(drawRideMap, 60); return; }
  if (!mapS6) mapS6 = new K.Map($('#rideCanvas'), { center: LL(origin), level: 4 });
  mapS6.relayout();
  clearRideMarks();

  var waiting = rideScreen.classList.contains('is-wait');
  mapS6.setLevel(waiting ? 5 : 3);
  mapS6.setCenter(LL(origin));
  if (waiting) {
    rideMarks.push(new K.CustomOverlay({
      map: mapS6, position: LL(origin), zIndex: 5, yAnchor: 1.55,
      content: markerEl('<div class="mk__bubble">출발</div><div class="mk__stem"></div><div class="mk__ring"></div>', 'mk--from')
    }));
  } else {
    rideMarks.push(new K.CustomOverlay({
      map: mapS6, position: LL(origin), zIndex: 5, yAnchor: .85,
      content: markerEl('<div class="mk__tag">탑승 위치</div><div class="mk__dot"></div>', 'mk--pick')
    }));
  }
}

/* 배차된 택시가 실제 도로를 따라 탑승 위치로 다가온다 */
function runTaxi() {
  stopTaxi();
  if (!K || !mapS6) return;
  var o = { lat: origin.lat, lng: origin.lng };
  fetchDirections(approachFrom(o), o).then(function (r) {
    var c = r.coords;
    if (!c || c.length < 4) return;
    var i = Math.floor(c.length * 0.55);          // 몇 백 미터 앞에서 오는 모습부터
    var el = markerEl('<div class="mk__tag">곧 도착</div>' + taxiSvgHTML(), 'mk--soon');
    taxiOv = new K.CustomOverlay({
      map: mapS6, position: new K.LatLng(c[i][0], c[i][1]), zIndex: 6, yAnchor: .74, content: el
    });

    var b = new K.LatLngBounds();
    b.extend(new K.LatLng(c[i][0], c[i][1]));
    b.extend(LL(origin));
    mapS6.setBounds(b, 96, 60, sheetH() + 30, 60);

    taxiTimer = setInterval(function () {
      if (++i >= c.length) { stopTaxi(); return; }
      var p = { lat: c[i][0], lng: c[i][1] }, q = { lat: c[i - 1][0], lng: c[i - 1][1] };
      taxiOv.setPosition(new K.LatLng(p.lat, p.lng));
      var car = el.querySelector('.mk__car');
      if (car) car.style.transform = 'rotate(' + (bearing(q, p) - 90).toFixed(1) + 'deg)';
    }, 900);
  }).catch(function () { /* 길을 못 구하면 택시는 그리지 않는다 */ });
}

/* ── 호출하기 → 요청 중 ── */
function startRide() {
  matchedAt = null;
  rideScreen.classList.add('is-wait');
  rideScreen.classList.remove('is-up');
  $('#waitFrom').textContent = trip ? trip.from.name : origin.name;
  $('#waitTo').textContent = trip ? trip.to.name : '';
  push('ride');
  /* 호출 연습은 [호출하기] 를 누른 순간 다 한 것이다 — 그 뒤는 기다리기만 하면 된다.
     대기 화면을 잠깐 보여 주고 마침 안내를 띄우되, 기록은 누른 즉시 "마침"으로 남긴다. */
  if (FLOW === 'call') {
    TRACK.finish(true);
    setTimeout(function () {
      clearTimeout(waitTimer);      // 마침 화면 뒤에서 배차 알림이 뜨지 않게

      finish('택시를 불렀어요.\n택시 호출 연습을 마쳤어요.\n이제 택시가 올 때까지 기다리면 돼요.');
    }, 2400);
  }
}

/* ── 기사 배차 완료 ── */
function matchDriver() {
  if (!rideScreen.classList.contains('is-wait')) return;
  clearTimeout(waitTimer);
  rideScreen.classList.remove('is-wait');
  matchedAt = new Date();
  updateRideInfo();
  drawRideMap();
  runTaxi();
  toast('배차가 완료됐어요.\n택시가 탑승 위치로 오고 있어요.');
  // 잠시 뒤 기사가 출발하면 안내 문구가 바뀐다 (취소하기 3 캡처)
  setTimeout(function () { $('#rideH1').textContent = '지금 탑승 위치로 출발'; }, 12000);
}

function updateRideInfo() {
  $('#rideFrom').textContent = trip ? trip.from.name : origin.name;
  $('#rideTo').textContent = trip ? trip.to.name : '';
  $('#ridePayName').textContent = PAY_LABEL[payMethod] || '직접결제';
  $('#ridePayFare').textContent = won(fareOf(picked));
}

onEnter.ride = function () {
  drawRideMap();
  clearTimeout(waitTimer);
  waitTimer = setTimeout(matchDriver, 6500);      // 기다리면 저절로 배차된다
};
onLeave.ride = function () { clearTimeout(waitTimer); stopTaxi(); };

/* 요청 중에는 화면 아무 곳이나 누르면 바로 배차된다 */
rideScreen.addEventListener('click', function (e) {
  if (!rideScreen.classList.contains('is-wait')) return;
  if (e.target.closest('button')) return;
  matchDriver();
});

/* 시트 올리기 / 내리기 */
function toggleUp(force) {
  var up = force === undefined ? !rideScreen.classList.contains('is-up') : force;
  rideScreen.classList.toggle('is-up', up);
  if (up) $('#rideBody').scrollTop = 0;
}
$('#rideGrab').addEventListener('click', function () { toggleUp(); });
(function () {
  var sheet = $('#rideSheet'), y0 = null;
  sheet.addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchmove', function (e) {
    if (y0 === null) return;
    var dy = e.touches[0].clientY - y0, up = rideScreen.classList.contains('is-up');
    if (dy < -40 && !up) { toggleUp(true); y0 = null; }
    else if (dy > 40 && up && $('#rideBody').scrollTop <= 0) { toggleUp(false); y0 = null; }
  }, { passive: true });
  sheet.addEventListener('touchend', function () { y0 = null; });
})();

$('#rideHome').addEventListener('click', function () {
  toast('지금은 호출이 진행 중이에요.\n그만두려면 [호출취소]를 누르세요.');
});
$('#rideLocate').addEventListener('click', function () {
  if (mapS6) mapS6.panTo(LL(origin));
});
$('#btnDrvMsg').addEventListener('click', function () { toast('기사님께 보내는 메시지는 이 연습에 포함되어 있지 않아요.'); });
$('#btnDrvCall').addEventListener('click', function () { toast('연습이라 실제로 전화가 걸리지는 않아요.'); });
$('#btnRideRoute').addEventListener('click', function () { toast('경로 변경은 이 연습에 포함되어 있지 않아요.'); });

/* ── 호출 취소 ── */
function openCancel() {
  reason = null;
  $('#cxSelText').textContent = '호출 취소 사유를 선택해 주세요.';
  $('#cxSel').classList.remove('is-set');
  $('#cxGo').disabled = true;
  $$('.rs__item').forEach(function (n) { n.classList.remove('is-on'); });
  $('#cxTime').textContent = hhmm(matchedAt || new Date());
  push('cancel');
}
$('#btnCancel').addEventListener('click', openCancel);
$('#btnCancelTop').addEventListener('click', openCancel);
$('#cxSel').addEventListener('click', function () { push('reason'); });
$('#rsList').addEventListener('click', function (e) {
  var b = e.target.closest('.rs__item');
  if (!b) return;
  reason = b.textContent;
  $$('.rs__item').forEach(function (n) { n.classList.toggle('is-on', n === b); });
  $('#cxSelText').textContent = reason;
  $('#cxSel').classList.add('is-set');
  $('#cxGo').disabled = false;
  pop();
});
$('#cxGo').addEventListener('click', function () {
  if (!reason) return;
  stopTaxi();
  clearTimeout(waitTimer);
  goHome(function () { finish('택시 호출을 취소했어요.\n(사유 : ' + reason + ')'); });
});

/* ── 연습 완료 ── */
function finish(text) {
  $('#doneText').textContent = text;
  push('done');
  TRACK.finish(true);
}
$('#doneAgain').addEventListener('click', function () { location.reload(); });
$('#doneHome').addEventListener('click', function () { location.href = '../'; });

/* ───────────────────── 8.6. 힌트 — 모를 때 누르는 버튼 ─────────────────────
   오른쪽 위 [?] 를 누르면 지금 눌러야 할 자리에 빨간 사각형이 나타난다.
   맞게 누르면 표시가 곧바로 사라진다 — 다음 화면은 다시 스스로 해 보라고.
   눌러야 할 곳이 밀어야 보이는 자리면 사각형 대신 화살표로 알려 준다.        */

var phoneEl  = $('#phone');
var hintBtn  = $('#hintBtn'),  hintLayer = $('#hintLayer');
var hintRing = $('#hintRing'), hintArrow = $('#hintArrow'), hintSay = $('#hintSay');
var hintTarget = null, hintScreen = null, hintText = '', hintRaf = 0, hintTimer = null;

function hintTop() { return stack[stack.length - 1]; }

/* 지금 화면에서 눌러야 할 곳 — 없으면 null */
function hintSpot() {
  var one = function (sel, say) { var el = $(sel); return el ? { el: el, say: say } : null; };
  switch (hintTop()) {
    case 'home':   return one('#svcTaxi', '[택시]를 누르세요') ||
                          one('.home-tab[data-tab="move"]', '[이동할 때]를 먼저 누르세요');
    case 'ad0':    return one('#ad0Close',      '[닫기]를 눌러 광고를 닫으세요');
    case 'ad':     return one('.ad__close',      '[X]를 눌러 광고를 닫으세요');
    case 'taxi':   return one('#rowDest',        '[어디로 갈까요?]를 누르세요');
    case 'search':
      if (!$('#srchInput').value.trim()) return one('#srchInput', '여기에 가려는 곳을 적으세요');
      return one('#srchBody .sug', '찾는 곳을 누르세요') || one('#srchInput', '여기에 가려는 곳을 적으세요');
    case 'route':  return one('#opts .opt',      '부르고 싶은 택시를 누르세요');
    case 'detail': return payMethod ? one('#ctaCall', '[호출하기]를 누르세요')
                                    : one('#btnPay',  '[결제수단 등록]을 누르세요');
    case 'pay':
      if (!$('#payApply').disabled) return one('#payApply', '[적용]을 누르세요');
      if (PAY_BLOCKED[paySel])
        return one('.pm[data-pm="other"]', '카카오페이는 등록된 카드가 없어요\n[다른 결제수단]을 눌러 보세요');
      return one('#payCard .pm', '결제수단을 하나 고르세요');
    case 'ride':
      if (rideScreen.classList.contains('is-wait'))
        return { say: '기사님을 찾는 중이에요.\n잠시 기다려 주세요.' };
      if (FLOW === 'call') return { say: '잘하셨어요!\n택시가 오고 있어요.' };
      return one('#btnCancelTop', '[호출취소]를 누르세요');
    case 'cancel': return $('#cxGo').disabled ? one('#cxSel', '취소하는 이유를 고르세요')
                                              : one('#cxGo',  '[호출 취소하기]를 누르세요');
    case 'reason': return one('#rsList .rs__item', '이유를 하나 누르세요');
    case 'all':    return one('.screen--all .home-nav [data-nav="home"]',  '[홈]을 눌러 돌아가세요');
    case 'noti':   return one('.screen--noti .home-nav [data-nav="home"]', '[홈]을 눌러 돌아가세요');
    case 'uselog': return one('.ul-back', '왼쪽 위 화살표를 눌러 돌아가세요');
    case 'air':     return dpFrom && dpTo ? one('#airSearch', '[항공권 검색]을 누르세요')
                                        : one('#airDate',   '[가는날 - 오는날]을 눌러 날짜를 고르세요');
    case 'airdate': return !dpFrom ? one('.dp-cell:not(:disabled)', '가는날을 누르세요')
                        : !dpTo   ? one('.dp-cell:not(:disabled)', '오는날을 누르세요')
                                  : one('#dpDone', '[선택 완료]를 누르세요');
    case 'airlist': return one('#alList .al-item', '타고 갈 비행기를 누르세요');
    case 'airsel':  return one('#airGo',      '[예매하기]를 누르세요');
    case 'airad':   return one('.screen--airad .ad__close', '[X]를 눌러 광고를 닫으세요');
    case 'airbook':
      if (!chosenPax)  return one('#airPickBtn',  '[탑승객을 선택하세요]를 누르세요');
      if (!paxDone)    return one('#abPickDone',  '[선택 완료]를 누르세요');
      if (!$('#airEmail').value.trim()) return one('#airEmail', '이메일 주소를 적으세요');
      if (!cardSet)    return one('#airCardBtn', '[결제카드 정보입력]을 누르세요');
      return one('#airPay', '[결제하기]를 누르세요');
    case 'airpax':  return savedPax ? one('.air-back', '저장됐어요. 뒤로 가서 고르세요')
                                    : one('#airPaxAdd', '[탑승객 추가]를 누르세요');
    case 'airagree':return agreed ? one('#agOk', '[동의]를 누르세요')
                                   : one('#agAll', '[모두 확인, 동의합니다]를 누르세요');
    case 'airform': return $('#afDone').disabled ? one('#afLastKo', '빈칸을 채우세요')
                                                : one('#afDone', '[입력 완료]를 누르세요');
    case 'airsheet':return one('#airSheetList .as-opt', '하나를 누르세요');
    case 'aircard':
      if ($('#acNum').value.replace(/D/g, '').length < 16) return one('#acNum', '카드번호 16자리를 적으세요');
      if ($('#acExp').value.replace(/D/g, '').length < 4)  return one('#acExp', '유효기간을 적으세요');
      if ($('#acPw').value.length < 2)  return one('#acPw', '비밀번호 앞 2자리를 적으세요');
      if (!cardOwner) return one('#acOwner', '[명의자 선택]을 누르세요');
      return one('#acDone', '[완료]를 누르세요');
    case 'done':   return one('#doneHome',       '연습이 끝났어요');
  }
  return null;
}

/* 밀어야 보이는 자리인지 — 스크롤되는 부모를 찾아 그 안에 들어와 있는지 본다 */
function hintScrollBox(el) {
  for (var n = el.parentElement; n && n !== phoneEl; n = n.parentElement) {
    var ov = getComputedStyle(n).overflowY;
    if ((ov === 'auto' || ov === 'scroll') && n.scrollHeight > n.clientHeight + 4) return n;
  }
  return null;
}

/* 말풍선을 (x,y) 에 놓되 화면 밖으로 나가지 않게 민다 */
function hintSayAt(x, y) {
  var p = phoneEl.getBoundingClientRect(), w = hintSay.offsetWidth, h = hintSay.offsetHeight;
  hintSay.style.left = Math.max(10, Math.min(p.width  - w - 10, x - w / 2)) + 'px';
  hintSay.style.top  = Math.max(10, Math.min(p.height - h - 10, y - h / 2)) + 'px';
}

function hintDraw() {
  var p = phoneEl.getBoundingClientRect();

  if (!hintTarget) {                       // 기다리기만 하면 되는 화면 — 말만 띄운다
    hintRing.hidden = true; hintArrow.hidden = true;
    hintSay.textContent = hintText;
    hintSayAt(p.width / 2, p.height / 2);
    return;
  }

  var r = hintTarget.getBoundingClientRect();
  var box = hintScrollBox(hintTarget), out = 0;
  if (box) {
    var b = box.getBoundingClientRect();
    if (r.bottom > b.bottom - 6) out = 1;        // 위로 밀어 올려야 보인다
    else if (r.top < b.top + 6)  out = -1;       // 아래로 내려야 보인다
  }

  if (out) {                                     // 스크롤 — 화살표
    var ab = (box || phoneEl).getBoundingClientRect();
    var cx = ab.left - p.left + ab.width / 2;
    var cy = out > 0 ? ab.bottom - p.top - 60 : ab.top - p.top + 60;
    hintRing.hidden = true;
    hintArrow.hidden = false;
    hintArrow.classList.toggle('is-up', out < 0);
    hintArrow.style.left = cx + 'px';
    hintArrow.style.top  = cy + 'px';
    hintSay.textContent = out > 0 ? '아래에 있어요\n화면을 밀어 올리세요'
                                  : '위에 있어요\n화면을 끌어 내리세요';
    hintSayAt(cx, out > 0 ? cy - 62 : cy + 62);
    return;
  }

  hintArrow.hidden = true;                       // 화면 안 — 빨간 사각형
  hintRing.hidden = false;
  var PAD = 6;
  hintRing.style.left   = (r.left - p.left - PAD) + 'px';
  hintRing.style.top    = (r.top  - p.top  - PAD) + 'px';
  hintRing.style.width  = (r.width  + PAD * 2) + 'px';
  hintRing.style.height = (r.height + PAD * 2) + 'px';
  hintSay.textContent = hintText;
  var lower = (r.top - p.top) < 130;             // 위쪽 자리면 말풍선을 아래에 붙인다
  hintSayAt(r.left - p.left + r.width / 2,
            lower ? r.bottom - p.top + 42 : r.top - p.top - 42);
}

function hintTick() {
  if (hintLayer.hidden) return;
  if (hintTop() !== hintScreen) { hintHide(); return; }     // 화면이 넘어가면 스스로
  if (hintTarget && !phoneEl.contains(hintTarget)) {        // 목록이 다시 그려졌으면 다시 찾는다
    var s = hintSpot();
    if (!s || !s.el) { hintHide(); return; }
    hintTarget = s.el; hintText = s.say || '';
  }
  hintDraw();
  hintRaf = requestAnimationFrame(hintTick);
}

function hintShow(why) {
  TRACK.hint(hintTop(), why === 'ask' ? 'ask' : 'auto');
  var spot = hintSpot();
  if (!spot) { toast('이 화면에서는 알려 드릴 게 없어요.'); return; }
  hintTarget = spot.el || null;
  hintText   = spot.say || '';
  hintScreen = hintTop();
  hintLayer.hidden = false;
  hintBtn.classList.add('is-on');
  hintDraw();
  cancelAnimationFrame(hintRaf);
  hintRaf = requestAnimationFrame(hintTick);
  clearTimeout(hintTimer);
  if (!hintTarget) hintTimer = setTimeout(hintHide, 3400);  // 기다리는 화면은 저절로 사라진다
}

function hintHide() {
  cancelAnimationFrame(hintRaf); hintRaf = 0;
  clearTimeout(hintTimer);
  hintLayer.hidden = true;
  hintRing.hidden = true;
  hintArrow.hidden = true;
  hintBtn.classList.remove('is-on');
  hintTarget = null; hintScreen = null;
}

hintBtn.addEventListener('click', function () {
  if (hintLayer.hidden) hintShow('ask'); else hintHide();
});

/* 맞게 눌렀으면 표시를 거둔다 — 다음 화면은 다시 스스로 */
document.addEventListener('click', function (e) {
  if (hintLayer.hidden || !hintTarget) return;
  if (e.target === hintTarget || hintTarget.contains(e.target)) hintHide();
}, true);

/* 검색창은 글자를 적기 시작하면 거둔다 */
$('#srchInput').addEventListener('input', function () {
  if (!hintLayer.hidden && hintTarget === this) hintHide();
});

/* ───────────────────── 8.7. 항공권 예매 연습 ─────────────────────
   image/기타 기능 캡처(항공 32장)를 그대로 옮겼다.
   항공 → (허츠 광고) → 편 목록 → 여정 상세 → 예매하기
     ├ 탑승객: 저장 목록 → 동의 → 정보 입력 → 선택 → 선택 완료
     ├ 이메일
     └ 결제카드 정보입력 → 완료
   → [결제하기] → 끝                                                        */

var FLIGHTS = [
  { logo: 'oz', img: 'air-oz', time: '06:30 - 07:45', dep: '06:30', arr: '07:45',
    air: '아시아나항공', code: 'OZ8900', seat: '특가석', pay: '카카오 T 결제 외 1개',
    price: 65900, bag: '무료위탁수하물 : 20Kg (공동운항편 제외)', left: '' },
  { logo: 'tw', img: 'air-tw', time: '07:50 - 09:05', dep: '07:50', arr: '09:05',
    air: '티웨이항공', code: 'TW1802', seat: '할인석', pay: '일반 카드결제 외 1개',
    price: 66420, bag: '무료위탁수하물 : 15Kg', left: '' },
  { logo: 'tw', img: 'air-tw', time: '09:50 - 11:05', dep: '09:50', arr: '11:05',
    air: '티웨이항공', code: 'TW1804', seat: '할인석', pay: '일반 카드결제 외 1개',
    price: 66420, bag: '무료위탁수하물 : 15Kg', left: '2석남음' }
];

var savedPax = null;      // 저장 목록에 넣은 탑승객
var chosenPax = null;     // 예매하기에서 고른 탑승객
var paxDone = false;      // [선택 완료] 까지 눌렀는지
var afSex = null;
var cardOwner = null, cardInst = '일시불', cardSet = false;

/* ── 편 목록 ── */
function renderFlights() {
  $('#alList').innerHTML = FLIGHTS.map(function (f, i) {
    return '<button class="al-item" data-fl="' + i + '">' +
      '<div class="al-time"><img class="al-logo" src="img/' + f.img + '.png" alt="">' + f.time + '</div>' +
      '<div class="al-sub">CJU-GMP · ' + f.air + '<b class="al-seat">' + f.seat + '</b></div>' +
      '<div class="al-pay">' + f.pay + '<b class="al-price">' + won(f.price) + '</b></div>' +
      '<div class="al-note">1인 편도 가격' + (f.left ? ' <em>' + f.left + '</em>' : '') + '</div>' +
      '</button>';
  }).join('');
}
$('#airSearch').addEventListener('click', function () { renderFlights(); push('airlist'); });

$('#alList').addEventListener('click', function (e) {
  var b = e.target.closest('[data-fl]');
  if (!b) return;
  var f = FLIGHTS[+b.dataset.fl];
  $('#ajGoFrom').textContent = TRIP.from + ' ' + f.dep;
  $('#ajGoTo').textContent   = TRIP.from + ' ' + f.arr;
  $('#ajGoName').textContent = f.air + ' ' + f.code + '편';
  $('#ajGoLogo').src = 'img/' + f.img + '.png';
  $('#asTotal').textContent = won(f.price + 27700);
  push('airsel');
});
$('#ajRule').addEventListener('click', function () { toast('운임 규정은 이 연습에 포함되어 있지 않아요.'); });
$('#airGo').addEventListener('click', function () { push('airbook'); });

/* ── 예매하기 · 탑승객 ── */
$('#airPaxList').addEventListener('click', function () { push('airpax'); });
$('#airPickBtn').addEventListener('click', function () {
  if (!savedPax) { toast('먼저 탑승객을 저장해 주세요.'); push('airpax'); return; }
  openAirSheet('탑승객 선택', [savedPax.ko + ' / ' + savedPax.en, '새로운 탑승객 입력'], function (i) {
    if (i === 0) { pop(); setTimeout(function () { setChosen(savedPax); }, 60); }
    else { pop(); setTimeout(function () { push('airpax'); }, 120); }
  });
});
function setChosen(p) {
  chosenPax = p;
  $('#airPickText').textContent = p.ko + ' / ' + p.en;
  $('#airPickBtn').classList.add('is-set');
  $('#roLastKo').textContent  = p.lastKo;
  $('#roFirstKo').textContent = p.firstKo;
  $('#roBirth').textContent   = p.birth;
  $('#roSex').textContent     = p.sex;
  $('#abRo').hidden = false;
}
$('#abPickDone').addEventListener('click', function () {
  paxDone = true;
  $('#abSumKo').textContent  = chosenPax.ko;
  $('#abSumSub').textContent = chosenPax.birth + ' │ ' + chosenPax.sex + ' │ 대한민국';
  $('#abSum').hidden = false;
  $('#abAcc').classList.add('is-done');
  toast('탑승객을 정했어요.');
});

/* ── 예매하기 · 이메일 ── */
$('#airEmail').addEventListener('input', function () {
  this.parentNode.classList.remove('is-bad');
  $('#airEmailErr').hidden = true;
});

/* ── 예매하기 · 결제카드 ── */
$('#airCardBtn').addEventListener('click', function () { push('aircard'); });

$('#airPay').addEventListener('click', function () {
  if (!paxDone) {
    toast(chosenPax ? '[선택 완료]를 눌러 주세요.' : '탑승객을 먼저 선택해 주세요.');
    hintShow(); return;
  }
  var v = $('#airEmail').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    $('#airEmail').parentNode.classList.add('is-bad');
    $('#airEmailErr').textContent = v ? '이메일 주소를 다시 한 번 확인해주세요.' : '이메일을 입력해주세요.';
    $('#airEmailErr').hidden = false;
    hintShow(); return;
  }
  if (!cardSet) { toast('결제카드를 먼저 등록해 주세요.'); hintShow(); return; }
  goHome(function () {
    finish('항공권을 예매했어요.\n제주 → 김포, ' + chosenPax.ko + ' 님\n항공권 예매 연습을 마쳤어요.');
  });
});

/* ── 탑승객 저장 목록 ── */
function renderPaxList() {
  screens.airpax.classList.toggle('has-pax', !!savedPax);
  $('#airPaxCards').innerHTML = savedPax ?
    '<div class="ap-card">' +
      '<div class="ap-card__top"><span class="ap-card__ko">' + esc(savedPax.ko) + '</span>' +
      '<button class="ap-card__fix">수정</button></div>' +
      '<div class="ap-card__en">' + esc(savedPax.en) + '</div>' +
      '<div class="ap-card__sub">' + esc(savedPax.birth) + ' │ ' + esc(savedPax.sex) + ' │ 대한민국</div>' +
    '</div>' : '';
}
onEnter.airpax = renderPaxList;
$('#airPaxAdd').addEventListener('click', function () { push('airagree'); });

/* ── 저장 동의 ── */
var agreed = false;
$('#agAll').addEventListener('click', function () {
  agreed = !agreed;
  this.querySelector('.air-box').classList.toggle('is-on', agreed);
  $('#agOk').disabled = !agreed;
});
$('#agOk').addEventListener('click', function () {
  pop();
  setTimeout(function () { push('airform'); }, 120);
});
onLeave.airagree = function () {
  agreed = false;
  $('#agAll').querySelector('.air-box').classList.remove('is-on');
  $('#agOk').disabled = true;
};

/* ── 탑승객 정보 입력 ── */
var AF = ['#afLastKo', '#afFirstKo', '#afLastEn', '#afFirstEn', '#afBirth'];
function afCheck() {
  $('#afDone').disabled = !(afSex && AF.every(function (s) { return $(s).value.trim(); }));
}
AF.forEach(function (sel) {
  var el = $(sel);
  el.addEventListener('input', function () {
    el.parentNode.classList.remove('is-bad');
    var e = el.parentNode.parentNode.querySelector('.af-err');
    if (e) e.remove();
    afCheck();
  });
  /* 캡처처럼 비워 둔 채 넘어가면 빨갛게 알려 준다 */
  el.addEventListener('blur', function () {
    if (el.value.trim()) return;
    el.parentNode.classList.add('is-bad');
    if (!el.parentNode.parentNode.querySelector('.af-err')) {
      var p = document.createElement('p');
      p.className = 'af-err';
      p.textContent = '입력해주세요.';
      el.parentNode.parentNode.appendChild(p);
    }
  });
});
$$('.af-sex__b').forEach(function (b) {
  b.addEventListener('click', function () {
    afSex = b.dataset.sex;
    $$('.af-sex__b').forEach(function (n) { n.classList.toggle('is-on', n === b); });
    afCheck();
  });
});
[$('#afLastEn'), $('#afFirstEn')].forEach(function (el) {
  el.addEventListener('input', function () { this.value = this.value.toUpperCase(); });
});
$('#afDone').addEventListener('click', function () {
  savedPax = {
    lastKo: $('#afLastKo').value.trim(), firstKo: $('#afFirstKo').value.trim(),
    ko: $('#afLastKo').value.trim() + $('#afFirstKo').value.trim(),
    en: $('#afLastEn').value.trim() + ' ' + $('#afFirstEn').value.trim(),
    birth: $('#afBirth').value.trim(), sex: afSex
  };
  renderPaxList();          // pop 으로 돌아갈 때는 onEnter 가 안 도니 여기서 다시 그린다
  pop();
  toast('탑승객을 저장했어요.');
});
onEnter.airform = function () { setTimeout(function () { $('#afLastKo').focus(); }, 60); };

/* ── 아래에서 올라오는 선택 시트 (탑승객 / 명의자 / 할부) ── */
var airSheetPick = null;
function openAirSheet(title, items, onPick, current) {
  $('#airSheetTitle').textContent = title;
  $('#airSheetList').innerHTML = items.map(function (t, i) {
    var on = (current !== undefined && current === i) ? ' is-on' : '';
    return '<button class="as-opt' + on + '" data-i="' + i + '">' + esc(t) + (on ? '<i>✓</i>' : '') + '</button>';
  }).join('');
  airSheetPick = onPick;
  push('airsheet');
}
$('#airSheetList').addEventListener('click', function (e) {
  var b = e.target.closest('[data-i]');
  if (!b || !airSheetPick) return;
  airSheetPick(+b.dataset.i);
});

/* ── 결제카드 정보입력 ── */
function acCheck() {
  var num = $('#acNum').value.replace(/\D/g, '');
  $('#acDone').disabled = !(num.length === 16 && $('#acExp').value.replace(/\D/g, '').length === 4 &&
                            $('#acPw').value.length === 2 && cardOwner);
}
$('#acNum').addEventListener('input', function () {
  var d = this.value.replace(/\D/g, '').slice(0, 16), out = [];
  for (var i = 0; i < d.length; i += 4) out.push(d.slice(i, i + 4));
  this.value = out.join(' - ');
  acCheck();
});
$('#acExp').addEventListener('input', function () {
  var d = this.value.replace(/\D/g, '').slice(0, 4);
  this.value = d.length > 2 ? d.slice(0, 2) + ' / ' + d.slice(2) : d;
  acCheck();
});
$('#acPw').addEventListener('input', function () {
  this.value = this.value.replace(/\D/g, '').slice(0, 2);
  acCheck();
});
$('#acOwner').addEventListener('click', function () {
  var name = chosenPax ? (chosenPax.ko + ' / ' + chosenPax.en) : (savedPax ? savedPax.ko + ' / ' + savedPax.en : '양지원 / YANG JIWON');
  openAirSheet('카드 명의자 선택', [name], function () {
    cardOwner = name;
    $('#acOwnerText').textContent = name;
    acCheck();
    pop();
  });
});
var INSTALL = ['일시불', '2개월', '3개월', '4개월', '5개월', '6개월', '7개월', '8개월'];
$('#acInst').addEventListener('click', function () {
  openAirSheet('할부 선택', INSTALL, function (i) {
    cardInst = INSTALL[i];
    $('#acInstText').textContent = cardInst;
    pop();
  }, INSTALL.indexOf(cardInst));
});
$('#acDone').addEventListener('click', function () {
  cardSet = true;
  var n = $('#acNum').value.replace(/\D/g, '');
  $('#airCardText').textContent = '카드 ' + n.slice(0, 4) + ' **** **** ' + n.slice(12) + ' · ' + cardInst;
  $('#airCardBtn').classList.add('is-set');
  pop();
  toast('결제카드를 등록했어요.');
});


/* ── 날짜 선택 (가는날 - 오는날) ──
   2026년 9월·10월 두 달을 보여 준다. 가는날을 먼저 고르고 오는날을 고르면
   사이가 파랗게 이어진다. 지난 날짜는 누를 수 없다.                        */
var DP_DAY = ['일', '월', '화', '수', '목', '금', '토'];
var dpFrom = null, dpTo = null;                 // 'YYYY-M-D'
var TRIP = { from: '26.09.05(토)', to: '26.09.15(화)' };   // 편 목록·여정에 쓰는 값
var DP_TODAY = new Date(2026, 8, 3);            // 연습 기준일 (2026.09.03)

function dpKey(y, m, d) { return y + '-' + m + '-' + d; }
function dpNum(k) { var a = k.split('-'); return (+a[0]) * 10000 + (+a[1]) * 100 + (+a[2]); }
function dpLabel(k) {
  var a = k.split('-'), y = +a[0], m = +a[1], d = +a[2];
  var w = DP_DAY[new Date(y, m - 1, d).getDay()];
  return String(y).slice(2) + '.' + ('0' + m).slice(-2) + '.' + ('0' + d).slice(-2) + '(' + w + ')';
}

function renderCalendar() {
  var html = '', base = new Date(2026, 8, 1);
  for (var k = 0; k < 2; k++) {
    var y = base.getFullYear(), m = base.getMonth() + k;
    var yy = y + Math.floor(m / 12), mm = (m % 12) + 1;
    var first = new Date(yy, mm - 1, 1), last = new Date(yy, mm, 0).getDate();
    html += '<div class="dp-month">' + yy + '년 ' + mm + '월</div><div class="dp-grid">';
    for (var b = 0; b < first.getDay(); b++) html += '<div></div>';
    for (var d = 1; d <= last; d++) {
      var key = dpKey(yy, mm, d), n = dpNum(key);
      var past = new Date(yy, mm - 1, d) < DP_TODAY;
      var cls = 'dp-cell' + (new Date(yy, mm - 1, d).getDay() === 0 ? ' sun' : '');
      if (dpFrom && dpTo) {
        var a = dpNum(dpFrom), z = dpNum(dpTo);
        if (n > a && n < z) cls += ' mid';
        if (n === a && a !== z) cls += ' edge edge--s';
        if (n === z && a !== z) cls += ' edge edge--e';
      }
      if (key === dpFrom || key === dpTo) cls += ' pick';
      html += '<button class="' + cls + '" data-d="' + key + '"' + (past ? ' disabled' : '') +
              '><span>' + d + '</span></button>';
    }
    html += '</div>';
  }
  $('#dpBody').innerHTML = html;
  $('#dpGoText').textContent   = dpFrom ? dpLabel(dpFrom) : '날짜를 고르세요';
  $('#dpBackText').textContent = dpTo   ? dpLabel(dpTo)   : '날짜를 고르세요';
  $('#dpGoBox').classList.toggle('is-on', !dpFrom);
  $('#dpBackBox').classList.toggle('is-on', !!dpFrom && !dpTo);
  $('#dpDone').disabled = !(dpFrom && dpTo);
}

$('#airDate').addEventListener('click', function () { renderCalendar(); push('airdate'); });

$('#dpBody').addEventListener('click', function (e) {
  var b = e.target.closest('[data-d]');
  if (!b || b.disabled) return;
  var key = b.dataset.d;
  if (!dpFrom || dpTo) { dpFrom = key; dpTo = null; }        // 새로 고르기 시작
  else if (dpNum(key) < dpNum(dpFrom)) { dpFrom = key; }     // 가는날보다 앞이면 가는날을 바꾼다
  else { dpTo = key; }
  renderCalendar();
});

$('#dpDone').addEventListener('click', function () {
  TRIP.from = dpLabel(dpFrom);
  TRIP.to   = dpLabel(dpTo);
  $('#airDateText').textContent = TRIP.from + ' - ' + TRIP.to;
  $('#airDateText').classList.remove('air-row__ph');
  $('#alDate').textContent = TRIP.from + ' - ' + TRIP.to + ' │ 1명 · 일반석';
  pop();
  toast('날짜를 정했어요.');
});

/* ── 광고 (항공 화면에 들어가면 한 번) — 터치제주 광고로 바꿨다 ── */
var hertzShown = false;
onEnter.air = function () {
  if (hertzShown) return;
  hertzShown = true;
  setTimeout(function () { push('airad'); }, 420);
};
$('#hertzMore').addEventListener('click', function () {
  pop(); toast('광고 자세히 보기는 이 연습에 포함되어 있지 않아요.');
});

/* ───────────────────────── 9. 시작 ───────────────────────── */

function start() {
  renderHomeGrid('move');
  renderStack(false);
  renderIdle();
  setOrigin('제주시청');
  if (K) initS2Map();
  else $('#phone').classList.add('no-map');   // 지도 자리에 안내 문구만 남긴다
  if (FLOW === 'cancel') startFromCall();
  else if (FLOW === 'air') setTimeout(function () { push('air'); }, 200);
  else setTimeout(function () { push('ad0'); }, 500);   // 앱을 열면 시작 광고가 한 번 뜬다
}

/* 취소 연습은 [호출하기] 버튼에서 시작한다 — 제주시청 → 제주국제공항이 미리 잡혀 있다 */
function startFromCall() {
  picked = OPTS[1];
  setPayMethod('card');              // 취소 연습은 결제수단 등록을 건너뛴다
                                     // (카카오페이는 등록된 카드가 없어 고를 수 없다)
  chooseDest(FAVS.airport);
  push('detail');
}

// 개발용 — ?debug 로 열었을 때만 화면을 직접 열어볼 수 있게 열어둔다
if (/[?&]debug/.test(location.search)) {
  window.__app = { push: push, pop: pop, chooseDest: chooseDest, setOrigin: setOrigin, stack: stack,
                   startRide: startRide, matchDriver: matchDriver, toggleUp: toggleUp, openCancel: openCancel };
}

window.addEventListener('resize', function () {
  placeCallSpot();
  if (mapS2) mapS2.relayout();
  if (mapS4) { mapS4.relayout(); fitRoute(lastBounds); }
  if (mapS6) mapS6.relayout();
});

if (window.kakao && window.kakao.maps && window.kakao.maps.load) {
  window.kakao.maps.load(function () { K = window.kakao.maps; start(); });
} else {
  start();
}

})();
