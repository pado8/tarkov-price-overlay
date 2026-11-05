"""사이트 링크 수집(11-05, 2판) — 정규식으로 주소를 자르다 괄호·작은따옴표에서 끊기던 가짜 실패를 없앴다.
- HTML 속성(href/src/action)은 html.parser 로
- <script type="application/json"> 데이터는 JSON 으로 풀어 문자열 중 http(s) 주소만
- 그 밖 JS 문자열 속 주소는 완전한 주소 리터럴만(끝이 따옴표로 닫힌 것)
내부 주소는 경로와 앵커(#id)를 따로 기록해 check.py 가 '앵커가 도착 페이지에 있나'까지 본다.
"""
import html.parser, json, pathlib, re, sys, urllib.parse, collections

LAND = pathlib.Path(__file__).resolve().parents[2] / "landing"
SKIP_HOST = ("127.0.0.1", "localhost", "googletagmanager", "googlesyndication", "schema.org", "w3.org", "google-analytics",
             "fundingchoicesmessages", "doubleclick", "gstatic.com", "assets.tarkov.dev")
ext = collections.defaultdict(set)
internal = collections.defaultdict(set)   # (path, anchor) -> pages


class P(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.urls, self.json_blocks, self._in_json = [], [], False
        self._buf = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for k in ("href", "src", "action"):
            if a.get(k):
                self.urls.append(a[k])
        if tag == "script" and (a.get("type") or "").startswith("application/") and "ld+json" not in (a.get("type") or ""):
            self._in_json, self._buf = True, []

    def handle_endtag(self, tag):
        if tag == "script" and self._in_json:
            self.json_blocks.append("".join(self._buf)); self._in_json = False

    def handle_data(self, d):
        if self._in_json:
            self._buf.append(d)


def walk(o, out):
    if isinstance(o, str):
        if o.startswith(("http://", "https://", "/guide/", "/donate/", "/en/", "/ru/", "/zh/", "/about/", "/privacy/", "/status/")):
            out.append(o)
    elif isinstance(o, dict):
        for v in o.values():
            walk(v, out)
    elif isinstance(o, list):
        for v in o:
            walk(v, out)


JSLIT = re.compile(r"""(["'])(https?://[^"'\s<>\\]+)\1""")
for f in LAND.rglob("*"):
    if f.suffix not in (".html", ".js") or "cloudflare" in f.parts:
        continue
    rel = "/" + f.relative_to(LAND).as_posix()
    t = f.read_text(encoding="utf-8", errors="replace")
    urls = []
    if f.suffix == ".html":
        p = P(); p.feed(t)
        urls += p.urls
        for b in p.json_blocks:
            try:
                walk(json.loads(b), urls)
            except Exception:  # noqa: BLE001
                pass
    # HTML 원문을 다시 훑을 땐 &#x27; 같은 엔티티를 풀어야 브라우저가 보는 주소와 같다(안 풀면 가짜 '없는 문서')
    urls += [html.unescape(m[1]) if f.suffix == '.html' else m[1] for m in JSLIT.findall(t)]
    for u in set(urls):
        if u.startswith(("mailto:", "javascript:", "data:", "#")) or "__" in u:
            continue
        pu = urllib.parse.urlparse(u)
        if pu.scheme in ("http", "https"):
            if pu.netloc == "tarkov.aquapado.com":
                internal[(pu.path or "/", pu.fragment)].add(rel)
            elif not any(s in pu.netloc for s in SKIP_HOST):
                ext[u].add(rel)
        elif u.startswith("/") and not u.startswith("//"):
            internal[(pu.path, pu.fragment)].add(rel)
dom = collections.Counter(urllib.parse.urlparse(u).netloc for u in ext)
print("외부 주소", len(ext), "| 도메인별:", dom.most_common(20))
print("내부 (경로, 앵커)", len(internal))
json.dump({"ext": {u: sorted(p)[:3] for u, p in ext.items()},
           "int": [[k[0], k[1], sorted(p)[:3]] for k, p in internal.items()]},
          open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False)
