/* ==========================================================================
   연습 기록 남기기 — 반 링크(?c=코드)로 들어온 수강생일 때만 동작한다.
   그냥 사이트에서 자유롭게 연습하는 사람은 아무것도 기록하지 않는다.

   무엇을 남기나
     · 화면마다 얼마나 오래 머물렀는지
     · [?] 를 눌러 도움을 청한 횟수 (ask)
     · 잘못 눌러서 도움말이 저절로 뜬 횟수 (auto)
     · 연습을 끝까지 마쳤는지

   app.js 는 window.TRACK.at / .hint / .finish 만 부른다.
   이 파일이 뜨기 전에 부른 것들은 index.html 의 임시 창구가 모아 두었다가
   여기서 시각까지 그대로 이어받는다.
   ========================================================================== */
import { db, anonUser, doc, setDoc, serverTimestamp }
  from "../common/fb.js?v=202609032113";
import { stuckLevel, STEPS } from "../common/steps.js?v=202609032113";

var STORE = 'tj.student';
var qs    = new URLSearchParams(location.search);
var code  = (qs.get('c') || '').toUpperCase();
var flow  = qs.get('flow') || 'all';

var saved = null;
try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) {}
if (!code && saved) code = saved.code || '';

/* 반 링크로 들어온 사람이 아니면 여기서 끝 — 기록도, 접속도 하지 않는다 */
if (!code || !saved || saved.code !== code || !saved.name) {
  window.TRACK = { at: noop, hint: noop, finish: noop };
} else {
  start();
}
function noop() {}

function start() {
  var attemptId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  var t0        = Date.now();
  var steps     = {};                 /* 화면이름 → {ms, visits, ask, auto} */
  var cur       = null, curAt = t0;
  var done      = false, dirty = false, uid = null;

  function rec(name) {
    return steps[name] || (steps[name] = { ms: 0, visits: 0, ask: 0, auto: 0 });
  }

  /* ── app.js 가 부르는 세 가지 ── */
  var api = {
    at: function (name, at) {
      at = at || Date.now();
      if (cur === name) return;
      if (cur) rec(cur).ms += at - curAt;
      cur = name; curAt = at;
      rec(name).visits++;
      dirty = true;
    },
    hint: function (name, kind, at) {
      rec(name || cur || 'home')[kind === 'auto' ? 'auto' : 'ask']++;
      dirty = true;
    },
    finish: function (ok, at) {
      at = at || Date.now();
      if (cur) { rec(cur).ms += at - curAt; curAt = at; }
      done = true; dirty = true;
      save(true);
    }
  };

  /* 이 파일이 뜨기 전에 쌓인 것부터 시각 그대로 처리한다 */
  var pending = (window.TRACK && window.TRACK.q) || [];
  window.TRACK = api;
  pending.forEach(function (e) { api[e[0]].apply(null, e[1].concat(e[2])); });

  /* ── 저장 ── */
  function summary() {
    var stuck = [], hints = 0, level = 0;
    Object.keys(steps).forEach(function (n) {
      if (!STEPS[n] || STEPS[n].skip) return;
      hints += steps[n].ask + steps[n].auto;
      var lv = stuckLevel(n, steps[n]);
      if (lv > 0) { stuck.push({ step: n, level: lv, ms: steps[n].ms,
                                 ask: steps[n].ask, auto: steps[n].auto }); }
      level = Math.max(level, lv);
    });
    stuck.sort(function (a, b) { return b.level - a.level || b.ms - a.ms; });
    return { stuck: stuck, hints: hints, level: level };
  }

  async function save(final) {
    if (!dirty) return;
    dirty = false;
    if (!uid) { try { uid = (await anonUser()).uid; } catch (e) { return; } }
    var now = Date.now();
    var live = cur ? now - curAt : 0;                 /* 지금 화면에서 머무는 중인 시간 */
    var snap = JSON.parse(JSON.stringify(steps));
    if (cur && !done) snap[cur].ms += live;
    var s = summary();
    var body = {
      flow: flow, startedAt: t0, endedAt: now, totalMs: now - t0,
      completed: done, steps: snap, stuck: s.stuck, hints: s.hints, level: s.level,
      updatedAt: serverTimestamp()
    };
    var base = 'classes/' + code + '/students/' + uid;
    try {
      await setDoc(doc(db, base + '/attempts/' + attemptId), body, { merge: true });
      /* 명단에도 요약을 남긴다 — 교사 화면이 이것만 읽고 표를 그린다.
         merge 는 results 안을 덮어쓰지 않고 이 연습 칸만 갈아 끼운다. */
      var r = { lastSeenAt: now, results: {} };
      r.results[flow] = {
        completed: done, level: s.level, hints: s.hints, totalMs: now - t0,
        stuckCount: s.stuck.length, at: now, attemptId: attemptId
      };
      await setDoc(doc(db, base), r, { merge: true });
    } catch (e) {
      if (!final) dirty = true;                        /* 다음 기회에 다시 */
      console.warn('[track] 저장 실패', e);
    }
  }

  setInterval(function () { save(false); }, 15000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') save(false);
  });
  window.addEventListener('pagehide', function () { save(false); });
}
