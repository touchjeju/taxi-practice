/* ==========================================================================
   파이어베이스 연결 — 교사용 · 학생용 · 연습 앱이 모두 이 파일 하나를 쓴다.
   프로젝트 ttest-af6cf 의 웹 앱 "taxi-practice-web" 설정값이다.
   apiKey 는 웹에 드러나도 되는 값이다(카카오 JS 키와 같은 성격).
   실제 보호는 firestore.rules 가 한다.
   ========================================================================== */
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup,
         GoogleAuthProvider, signOut, setPersistence, browserLocalPersistence }
  from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import { getFirestore, collection, collectionGroup, doc, getDoc, getDocs,
         setDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
         onSnapshot, serverTimestamp, writeBatch, increment }
  from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

export const app  = initializeApp({
  projectId:         "ttest-af6cf",
  appId:             "1:555020900922:web:0dc9f8c5afe13cbc943303",
  storageBucket:     "ttest-af6cf.firebasestorage.app",
  apiKey:            "AIzaSyAjknaXCq8EMSptVMy4j35AagWmlrXLpW0",
  authDomain:        "ttest-af6cf.firebaseapp.com",
  messagingSenderId: "555020900922"
});
export const auth = getAuth(app);
export const db   = getFirestore(app);

/* 로그인 상태를 기기에 남겨 둔다 — 학생이 다음 시간에 다시 와도 같은 사람으로 잡힌다 */
setPersistence(auth, browserLocalPersistence).catch(function () {});

export { onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider,
         signOut, collection, collectionGroup, doc, getDoc, getDocs, setDoc,
         updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot,
         serverTimestamp, writeBatch, increment };

/* 로그인이 끝날 때까지 기다린다 */
export function waitUser() {
  return new Promise(function (res) {
    var off = onAuthStateChanged(auth, function (u) { off(); res(u); });
  });
}

/* 학생이 쓰는 익명 로그인 — 기기마다 한 사람 */
export async function anonUser() {
  var u = await waitUser();
  if (u) return u;
  var c = await signInAnonymously(auth);
  return c.user;
}
