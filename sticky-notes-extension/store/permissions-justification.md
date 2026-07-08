# Chrome Web Store — Permission Justifications

심사 제출 폼(Privacy practices 탭)에 그대로 붙여넣을 수 있는 영어 사유 문구.

## Single purpose description

> Sticky Notes lets users place movable sticky notes on top of any webpage. Notes are
> edited in place, dragged to any position, and automatically saved locally so they
> reappear on the same site (or on all sites, per the user's choice) after reloads
> and browser restarts.

## `storage`

> The storage permission is required to persist the user's notes (text, position,
> size, color, and per-site/global visibility scope) and the extension settings in
> chrome.storage.local. Without it, all notes would be lost when the page is
> reloaded or the browser is closed. All data stays on the user's device; nothing
> is transmitted to any server.

## Host access — content script on `<all_urls>`

> The core feature of this extension is showing the user's own sticky notes on the
> pages where they created them, automatically, every time the page loads. The
> content script therefore must run on all sites: it checks local storage for notes
> saved for the current domain (plus the user's "all sites" notes) and renders them.
> The content script only draws the extension's own note UI in an isolated Shadow
> DOM; it does not read, collect, or modify page content, and it makes no network
> requests.

### activeTab으로 줄일 수 없는 이유 (내부 검토 기록 — 폼에는 아래 영어 단락 사용)

`activeTab`은 사용자가 툴바 아이콘을 클릭하는 순간에만, 그 탭에 한해 일시적으로
권한을 부여한다. 즉:

1. **자동 복원 불가** — 페이지를 새로 열거나 새로고침하면 권한이 사라져, 사용자가
   매 페이지·매 방문마다 아이콘을 눌러야 메모가 다시 나타난다. "붙여두면 계속
   보이는 포스트잇"이라는 확장의 단일 목적 자체가 성립하지 않는다.
2. **전역 메모 불가** — "모든 사이트에서 표시" 모드는 아이콘 클릭 없이도 모든
   페이지에서 렌더링되어야 한다.

폼 제출용 영어 단락:

> We evaluated activeTab as an alternative, but it only grants temporary access to
> a single tab after the user clicks the toolbar icon. Sticky notes must reappear
> automatically when a page is loaded or reloaded — without requiring the user to
> click the icon on every page visit — otherwise the product's single purpose
> (persistent sticky notes) is impossible. Therefore a content script on all URLs
> is the minimum access level that supports the feature.

## Remote code

> This extension does not use remote code. All JavaScript and CSS are packaged in
> the extension. There are no external script tags, no CDN resources, no eval(),
> and no dynamically fetched code.

## Data usage disclosure (Privacy practices 탭 체크 항목)

- 수집하는 데이터 유형: **없음** — "User activity", "Website content" 등 모든 항목 체크 해제.
  (메모 텍스트는 사용자가 직접 작성한 콘텐츠이며 기기 밖으로 나가지 않음 → "collected"에 해당하지 않음)
- I do not sell or transfer user data to third parties … → 3개 인증 문구 모두 체크 가능.
