// 상단 '서비스 상태' 탭의 점 색: 헬스 엔드포인트(60초 CDN 캐시, Neon 안 깨움)를 한 번 읽는다.
// 상태 페이지(/status/)와 같은 기준 — ok=초록, down=빨강, 그 외=노랑, 못 읽으면 회색 그대로.
(function () {
  var dots = document.querySelectorAll(".sdot");
  if (!dots.length || !window.fetch) return;
  var tip = { ok: { ko: "정상", en: "Operational", ru: "Работает" }, warn: { ko: "일부 주의", en: "Degraded", ru: "Есть проблемы" }, bad: { ko: "장애", en: "Outage", ru: "Сбой" } };
  var lang = (document.documentElement.lang || "ko").slice(0, 2);
  fetch("https://api.aquapado.com/priceoverlay/health").then(function (r) { return r.json(); }).then(function (d) {
    var cls = d.status === "ok" ? "ok" : d.status === "down" ? "bad" : "warn";
    dots.forEach(function (el) {
      el.className = "sdot " + cls;
      var a = el.parentNode;
      if (a) a.title = (tip[cls][lang] || tip[cls].en);
    });
  }).catch(function () {});
})();
