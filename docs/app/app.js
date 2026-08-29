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
  }, { location: LL(origin), radius: 20000, size: 10 });
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
  }, { location: LL(origin), radius: 20000, size: 15 });
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
};
onLeave.detail = function () {
  screens.route.classList.remove('has-detail');
  setTimeout(function () { fitRoute(lastBounds); }, 30);
};

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
  toast(trip.to.name + '까지 ' + picked.name + '\n' + won(fareOf(picked)) + ' 예상으로 호출했어요.\n(연습이라 실제로 배차되지는 않아요)');
});

/* ───────────────────────── 6. 결제수단 시트 ───────────────────────── */

var paySel = null;
onEnter.pay = function () {
  paySel = payMethod || 'kakaopay';   // 처음 열 때도 카카오페이가 골라져 있다
  syncPay();
};

function syncPay() {
  $$('.pm').forEach(function (el) { el.classList.toggle('is-on', el.dataset.pm === paySel); });
  $('#deckKakaopay').hidden = paySel !== 'kakaopay';
  $('#deckOther').hidden = paySel !== 'other';
  $('#payNote').hidden = !paySel;
  $('#payApply').disabled = !paySel;

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
$('#payApply').addEventListener('click', function () {
  payMethod = paySel;
  var lab = $('#payLabel'), btn = $('#btnPay');
  lab.textContent = PAY_LABEL[payMethod];
  btn.classList.add('is-set');
  var ico = btn.querySelector('svg,img');
  if (payMethod === 'other') {
    var img = document.createElement('img');
    img.src = 'img/pay-direct.png'; img.alt = '';
    if (ico) btn.replaceChild(img, ico);
  } else if (ico && ico.tagName === 'IMG') {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'i22');
    svg.innerHTML = '<use href="#ic-plus"/>';
    btn.replaceChild(svg, ico);
  }
  pop();
  toast(PAY_LABEL[payMethod] + '(으)로 결제수단을 설정했어요.');
});

/* ───────────────────────── 7. 광고 팝업 ───────────────────────── */

var adShown = false;
$('#adShare').addEventListener('click', function () { pop(); toast('친구에게 공유했어요.'); });
$('#adMore').addEventListener('click', function () { pop(); toast('광고 자세히 보기는 이 연습에 포함되어 있지 않아요.'); });

/* ───────────────────────── 8. 홈 → 택시 ───────────────────────── */

function openTaxi() {
  push('taxi');
  if (mapS2) setTimeout(function () { mapS2.relayout(); mapS2.setCenter(LL(origin)); }, 30);
  if (!adShown) { adShown = true; setTimeout(function () { push('ad'); }, 320); }
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

/* ───────────────────────── 9. 시작 ───────────────────────── */

function start() {
  renderStack(false);
  renderIdle();
  setOrigin('제주시청');
  if (K) initS2Map();
  else $('#phone').classList.add('no-map');   // 지도 자리에 안내 문구만 남긴다
}

// 개발용 — ?debug 로 열었을 때만 화면을 직접 열어볼 수 있게 열어둔다
if (/[?&]debug/.test(location.search)) {
  window.__app = { push: push, pop: pop, chooseDest: chooseDest, setOrigin: setOrigin, stack: stack };
}

window.addEventListener('resize', function () {
  if (mapS2) mapS2.relayout();
  if (mapS4) { mapS4.relayout(); fitRoute(lastBounds); }
});

if (window.kakao && window.kakao.maps && window.kakao.maps.load) {
  window.kakao.maps.load(function () { K = window.kakao.maps; start(); });
} else {
  start();
}

})();
