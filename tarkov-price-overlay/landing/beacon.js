// 랜딩·가이드·상태 페이지 공용 유입 비콘 (쿠키 없음, 방문자 ID 없음).
//
// view: 봇 제외 + 경로별 세션 1회만. download: 릴리즈 링크 클릭.
// 페이지뷰 자체는 Vercel Analytics도 세지만, 유입원별 전환율(뷰→다운로드)을
// 보려면 download와 같은 테이블에 있어야 한다. 서버측 비상 정지 = web.ts의 WEB_VIEW_OFF.
//
// 세션 첫 진입 정보(entry)를 sessionStorage에 한 번 적어 두고 모든 이벤트에
// 같이 보낸다. 그래야 "구글 → 가이드 → 메인 → 다운로드"처럼 사이트 안에서
// 옮겨 다닌 뒤의 다운로드도 처음 유입원(구글)과 첫 페이지(가이드)로 잡힌다.
// 캠페인 표식: 링크에 ?src=dc1 (또는 utm_source) 를 붙이면 그 값이 남는다.
(function () {
  // 운영 주소에서만 보낸다. 로컬 미리보기·vercel.app 주소는 유입원이 비어 'direct'로
  // 섞여 들어갔다(2026-10-26 발견). 비콘 자체를 시험할 땐 주소에 ?beacon=test.
  if (location.hostname !== "tarkov.aquapado.com" && !/[?&]beacon=test\b/.test(location.search)) return;
  var API = "https://api.aquapado.com/priceoverlay/web";
  function beacon(b) {
    try { navigator.sendBeacon(API, new Blob([JSON.stringify(b)], { type: "text/plain" })); } catch (e) {}
  }
  var entry = null;
  try { entry = JSON.parse(sessionStorage.getItem("ent") || "null"); } catch (e) {}
  if (!entry) {
    var c = "";
    try {
      var q = new URLSearchParams(location.search);
      c = (q.get("src") || q.get("utm_source") || "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 24);
    } catch (e) {}
    var ref = document.referrer || "";
    if (/^https?:\/\/tarkov\.aquapado\.com\//.test(ref)) ref = ""; // 새 탭 등으로 세션이 끊긴 내부 이동
    entry = { ref: ref, path: location.pathname, c: c };
    try { sessionStorage.setItem("ent", JSON.stringify(entry)); } catch (e) {}
  }
  function send(b) {
    b.path = location.pathname;
    b.ref = document.referrer;
    b.entry_ref = entry.ref;
    b.entry_path = entry.path;
    b.campaign = entry.c;
    beacon(b);
  }
  try {
    var UA = navigator.userAgent || "";
    var isBot = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|curl|wget|python-requests|facebookexternalhit|embedly/i.test(UA);
    var VKEY = "vw:" + location.pathname;
    var sendView = function () {
      try { if (sessionStorage.getItem(VKEY) === "1") return; sessionStorage.setItem(VKEY, "1"); } catch (e) {}
      send({ kind: "view" });
    };
    if (!isBot) {
      if (document.visibilityState === "visible") sendView();
      else document.addEventListener("visibilitychange", function h() {
        if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", h); sendView(); }
      });
    }
  } catch (e) {}
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest('a[href*="/releases"]');
    if (t) {
      var tg = /\/latest/.test(t.href) ? "latest" : "list";
      if (window.va) window.va("event", { name: "download_click", target: tg });
      send({ kind: "download", target: tg });
    }
  });
})();
