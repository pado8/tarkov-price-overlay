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
  } else if (!entry.c) {
    // 2026-11-02: 세션 도중에 ?src= 가 붙은 페이지로 왔으면(가이드 → 랜딩 '다운로드' 버튼 = /?src=guide) 그 표식을 채운다.
    // 전엔 세션 첫 페이지에서만 읽어 가이드에서 시작한 세션의 다운로드에 campaign 이 안 남았다.
    try {
      var q2 = new URLSearchParams(location.search);
      var c2 = (q2.get("src") || q2.get("utm_source") || "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 24);
      if (c2) { entry.c = c2; sessionStorage.setItem("ent", JSON.stringify(entry)); }
    } catch (e) {}
  }
  // GA4 커스텀 이벤트(페이지에 gtag 가 있을 때만). 방문자·클릭 수는 GA4 가 세고, Neon 비콘은 다운로드 행만 남긴다.
  function ga(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {}
  }
  var onGuide = /^\/guide\//.test(location.pathname);
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
    // 2026-11-02: 페이지뷰(view)는 더 이상 Neon에 보내지 않는다 — 가이드 1,800쪽이 색인되며 뷰마다 DB를 깨워
    //   11-01 하루에 컴퓨트 +9.85h(월 한도의 10%). 페이지뷰는 Vercel Analytics·GA4가 세고, 이 비콘은 다운로드(유입원·첫 페이지 포함)만 보낸다.
    if (false && !isBot) {
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
      ga("download_click", { target: tg, site: onGuide ? "guide" : "landing", from_guide: entry.c && /^guide/.test(entry.c) ? 1 : 0 });
      send({ kind: "download", target: tg });
      return;
    }
    // 가이드 → 랜딩 '다운로드' 버튼(/?src=guide, /en?src=guide …). 통계 콘솔 '한눈에'의 "가이드에서 다운로드로" 가 이 수를 센다.
    var g = onGuide && e.target.closest && e.target.closest('a[href*="src=guide"]');
    if (g) ga("guide_download_cta", { page: location.pathname });
  });
})();
