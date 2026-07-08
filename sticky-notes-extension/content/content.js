// 스티키 메모 content script.
// 모든 페이지에서 실행되어 저장된 메모를 Shadow DOM 레이어로 렌더링하고,
// 편집/이동/크기조절/삭제를 chrome.storage.local에 반영한다.
(() => {
  'use strict';

  // SPA 등에서 중복 주입 방지
  if (window.__stickyNotesLoaded) return;
  window.__stickyNotesLoaded = true;

  const NOTE_PREFIX = 'note_';
  const HOSTNAME = location.hostname;
  const COLORS = ['yellow', 'green', 'pink', 'blue', 'purple'];
  const DEFAULT_W = 220;
  const DEFAULT_H = 180;
  const MIN_W = 160;
  const MIN_H = 120;
  const SAVE_DEBOUNCE_MS = 300;

  const t = (key) => chrome.i18n.getMessage(key) || key;

  // crypto.randomUUID는 보안 컨텍스트(HTTPS) 전용이라 HTTP 페이지용 폴백을 둔다
  const genId = () =>
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  let settings = { defaultScope: 'site', notesVisible: true };
  let layer = null; // Shadow root 안의 메모 컨테이너
  let zCounter = 10;
  const noteEls = new Map(); // id -> { el, textarea }
  const saveTimers = new Map(); // id -> timeout
  let draggingId = null; // 드래그/리사이즈 중인 메모 (onChanged 반영 억제용)

  // ---------- Shadow DOM 레이어 ----------

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    const host = document.createElement('div');
    // 페이지 CSS의 영향을 받지 않도록 인라인으로 고정
    host.style.cssText =
      'all:initial; position:fixed; left:0; top:0; width:0; height:0; ' +
      'z-index:2147483647; pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STICKY_NOTES_CSS;
    shadow.appendChild(style);
    layer = document.createElement('div');
    layer.id = 'layer';
    shadow.appendChild(layer);
    // body가 통째로 교체되는 SPA 대비, documentElement에 부착
    document.documentElement.appendChild(host);
    // 열린 팔레트는 레이어 아무 곳이나 누르면 닫기
    layer.addEventListener('pointerdown', closeAllPalettes, true);
    applyVisibility();
    return layer;
  }

  function applyVisibility() {
    if (layer) layer.style.display = settings.notesVisible ? '' : 'none';
  }

  function closeAllPalettes() {
    if (!layer) return;
    layer.querySelectorAll('.palette.open').forEach((p) => p.classList.remove('open'));
  }

  // ---------- 저장 ----------

  function noteKey(id) {
    return NOTE_PREFIX + id;
  }

  function saveNote(note) {
    note.updatedAt = Date.now();
    chrome.storage.local.set({ [noteKey(note.id)]: note });
  }

  function scheduleSave(note) {
    clearTimeout(saveTimers.get(note.id));
    saveTimers.set(
      note.id,
      setTimeout(() => {
        saveTimers.delete(note.id);
        saveNote(note);
      }, SAVE_DEBOUNCE_MS)
    );
  }

  function matchesPage(note) {
    return note.scope === 'global' || note.domain === HOSTNAME;
  }

  function clampPos(note) {
    note.x = Math.max(0, Math.min(note.x, window.innerWidth - 60));
    note.y = Math.max(0, Math.min(note.y, window.innerHeight - 40));
  }

  // ---------- 메모 렌더링 ----------

  // 접힘 상태를 요소에 반영 (렌더 시 + onChanged 동기화 시 공용)
  function applyCollapsed(el, note) {
    el.classList.toggle('collapsed', !!note.collapsed);
    const btn = el.querySelector('.collapse-btn');
    if (btn) {
      btn.textContent = note.collapsed ? '▸' : '▾'; // ▸ / ▾
      btn.title = t(note.collapsed ? 'noteExpandTip' : 'noteCollapseTip');
    }
  }

  function renderNote(note) {
    if (noteEls.has(note.id) || note.hidden) return;
    ensureLayer();
    clampPos(note);

    const el = document.createElement('div');
    el.className = 'note';
    el.dataset.id = note.id;
    el.dataset.color = COLORS.includes(note.color) ? note.color : COLORS[0];
    el.dataset.scope = note.scope;
    el.style.left = note.x + 'px';
    el.style.top = note.y + 'px';
    el.style.width = (note.w || DEFAULT_W) + 'px';
    el.style.height = (note.h || DEFAULT_H) + 'px';
    el.style.zIndex = ++zCounter;

    const header = document.createElement('div');
    header.className = 'note-header';

    const scopeBadge = document.createElement('button');
    scopeBadge.className = 'scope-badge';
    scopeBadge.type = 'button';
    scopeBadge.title = t('noteScopeToggleTip');
    scopeBadge.textContent = t(note.scope === 'global' ? 'noteScopeGlobal' : 'noteScopeSite');

    const space = document.createElement('div');
    space.className = 'header-space';

    const colorBtn = document.createElement('button');
    colorBtn.className = 'color-btn';
    colorBtn.type = 'button';
    colorBtn.title = t('noteColorTip');

    const palette = document.createElement('div');
    palette.className = 'palette';
    for (const c of COLORS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.dataset.color = c;
      palette.appendChild(dot);
    }

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'collapse-btn';
    collapseBtn.type = 'button';

    const hideBtn = document.createElement('button');
    hideBtn.className = 'hide-btn';
    hideBtn.type = 'button';
    hideBtn.title = t('noteHideTip');
    hideBtn.textContent = '👁'; // 👁

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.type = 'button';
    deleteBtn.title = t('noteDeleteTip');
    deleteBtn.textContent = '×';

    header.append(scopeBadge, space, collapseBtn, colorBtn, hideBtn, deleteBtn);

    const textarea = document.createElement('textarea');
    textarea.className = 'note-text';
    textarea.placeholder = t('notePlaceholder');
    textarea.value = note.text || '';
    textarea.spellcheck = false;

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';

    const confirmBar = document.createElement('div');
    confirmBar.className = 'confirm-bar';
    const confirmMsg = document.createElement('div');
    confirmMsg.textContent = t('noteDeleteConfirm');
    const confirmActions = document.createElement('div');
    confirmActions.className = 'confirm-actions';
    const confirmYes = document.createElement('button');
    confirmYes.className = 'confirm-yes';
    confirmYes.type = 'button';
    confirmYes.textContent = t('confirmDelete');
    const confirmNo = document.createElement('button');
    confirmNo.className = 'confirm-no';
    confirmNo.type = 'button';
    confirmNo.textContent = t('confirmCancel');
    confirmActions.append(confirmYes, confirmNo);
    confirmBar.append(confirmMsg, confirmActions);

    el.append(header, textarea, resizeHandle, confirmBar, palette);
    layer.appendChild(el);
    noteEls.set(note.id, { el, textarea });
    applyCollapsed(el, note);

    // --- 이벤트 ---

    // 아무 곳이나 누르면 맨 앞으로
    el.addEventListener('pointerdown', () => {
      el.style.zIndex = ++zCounter;
    });

    // 텍스트 자동 저장
    textarea.addEventListener('input', () => {
      note.text = textarea.value;
      scheduleSave(note);
    });

    // 메모 입력이 페이지의 전역 단축키(예: GitHub 핫키)를 건드리지 않도록 차단
    for (const type of ['keydown', 'keyup', 'keypress']) {
      textarea.addEventListener(type, (e) => e.stopPropagation());
    }

    // 범위 전환 (이 사이트 ↔ 모든 사이트)
    scopeBadge.addEventListener('click', () => {
      note.scope = note.scope === 'global' ? 'site' : 'global';
      note.domain = note.scope === 'site' ? HOSTNAME : '';
      el.dataset.scope = note.scope;
      scopeBadge.textContent = t(note.scope === 'global' ? 'noteScopeGlobal' : 'noteScopeSite');
      saveNote(note);
    });

    // 접기/펼치기
    collapseBtn.addEventListener('click', () => {
      note.collapsed = !note.collapsed;
      applyCollapsed(el, note);
      saveNote(note);
    });

    // 가리기 — 다시 보이려면 팝업 목록의 "보이게 하기"
    hideBtn.addEventListener('click', () => {
      note.hidden = true;
      saveNote(note);
      removeNoteEl(note.id);
    });

    // 색상 팔레트
    colorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = palette.classList.contains('open');
      closeAllPalettes();
      if (!wasOpen) palette.classList.add('open');
    });
    palette.addEventListener('pointerdown', (e) => e.stopPropagation());
    palette.addEventListener('click', (e) => {
      const dot = e.target.closest('button[data-color]');
      if (!dot) return;
      note.color = dot.dataset.color;
      el.dataset.color = note.color;
      palette.classList.remove('open');
      saveNote(note);
    });

    // 삭제 (확인 후)
    deleteBtn.addEventListener('click', () => {
      confirmBar.classList.add('open');
    });
    confirmNo.addEventListener('click', () => {
      confirmBar.classList.remove('open');
    });
    confirmYes.addEventListener('click', () => {
      removeNoteEl(note.id);
      chrome.storage.local.remove(noteKey(note.id));
    });

    // 드래그 이동 (헤더, 버튼 제외)
    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      draggingId = note.id;
      const startX = e.clientX - note.x;
      const startY = e.clientY - note.y;
      header.setPointerCapture(e.pointerId);
      const onMove = (ev) => {
        note.x = ev.clientX - startX;
        note.y = ev.clientY - startY;
        clampPos(note);
        el.style.left = note.x + 'px';
        el.style.top = note.y + 'px';
      };
      const onUp = () => {
        header.removeEventListener('pointermove', onMove);
        header.removeEventListener('pointerup', onUp);
        header.removeEventListener('pointercancel', onUp);
        draggingId = null;
        saveNote(note);
      };
      header.addEventListener('pointermove', onMove);
      header.addEventListener('pointerup', onUp);
      header.addEventListener('pointercancel', onUp);
    });

    // 크기 조절
    resizeHandle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      draggingId = note.id;
      const startW = el.offsetWidth;
      const startH = el.offsetHeight;
      const startX = e.clientX;
      const startY = e.clientY;
      resizeHandle.setPointerCapture(e.pointerId);
      const onMove = (ev) => {
        note.w = Math.max(MIN_W, startW + (ev.clientX - startX));
        note.h = Math.max(MIN_H, startH + (ev.clientY - startY));
        el.style.width = note.w + 'px';
        el.style.height = note.h + 'px';
      };
      const onUp = () => {
        resizeHandle.removeEventListener('pointermove', onMove);
        resizeHandle.removeEventListener('pointerup', onUp);
        resizeHandle.removeEventListener('pointercancel', onUp);
        draggingId = null;
        saveNote(note);
      };
      resizeHandle.addEventListener('pointermove', onMove);
      resizeHandle.addEventListener('pointerup', onUp);
      resizeHandle.addEventListener('pointercancel', onUp);
    });
  }

  function removeNoteEl(id) {
    const entry = noteEls.get(id);
    if (entry) {
      entry.el.remove();
      noteEls.delete(id);
    }
    clearTimeout(saveTimers.get(id));
    saveTimers.delete(id);
  }

  // 다른 탭에서 변경된 메모를 현재 요소에 반영
  function updateNoteEl(note) {
    const entry = noteEls.get(note.id);
    if (!entry) return;
    if (!matchesPage(note) || note.hidden) {
      removeNoteEl(note.id);
      return;
    }
    const { el, textarea } = entry;
    // 이 탭에서 조작 중이면 덮어쓰지 않는다
    if (draggingId === note.id) return;
    const shadowActive = el.getRootNode().activeElement;
    if (shadowActive !== textarea && textarea.value !== (note.text || '')) {
      textarea.value = note.text || '';
    }
    el.dataset.color = COLORS.includes(note.color) ? note.color : COLORS[0];
    el.dataset.scope = note.scope;
    el.querySelector('.scope-badge').textContent = t(
      note.scope === 'global' ? 'noteScopeGlobal' : 'noteScopeSite'
    );
    el.style.left = note.x + 'px';
    el.style.top = note.y + 'px';
    el.style.width = (note.w || DEFAULT_W) + 'px';
    el.style.height = (note.h || DEFAULT_H) + 'px';
    applyCollapsed(el, note);
  }

  // ---------- 생성 ----------

  function createNote() {
    const count = noteEls.size;
    const note = {
      id: genId(),
      text: '',
      x: 80 + (count % 6) * 32,
      y: 80 + (count % 6) * 32,
      w: DEFAULT_W,
      h: DEFAULT_H,
      color: COLORS[count % COLORS.length],
      scope: settings.defaultScope === 'global' ? 'global' : 'site',
      domain: settings.defaultScope === 'global' ? '' : HOSTNAME,
      hidden: false,
      collapsed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // 숨김 상태에서 만들면 보이도록 자동 해제
    if (!settings.notesVisible) {
      settings.notesVisible = true;
      chrome.storage.local.set({ settings });
      applyVisibility();
    }
    renderNote(note);
    saveNote(note);
    const entry = noteEls.get(note.id);
    if (entry) entry.textarea.focus();
  }

  // ---------- 초기 로드 ----------

  async function init() {
    const all = await chrome.storage.local.get(null);
    if (all.settings) settings = Object.assign(settings, all.settings);
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(NOTE_PREFIX) && value && matchesPage(value) && !value.hidden) {
        renderNote(value);
      }
    }
    applyVisibility();
  }

  // ---------- 스토리지 변경 반영 (다른 탭/팝업과 동기화) ----------

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings && changes.settings.newValue) {
      settings = Object.assign(settings, changes.settings.newValue);
      applyVisibility();
    }
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(NOTE_PREFIX)) continue;
      const note = change.newValue;
      if (!note) {
        removeNoteEl(key.slice(NOTE_PREFIX.length));
      } else if (noteEls.has(note.id)) {
        updateNoteEl(note);
      } else if (matchesPage(note) && !note.hidden) {
        renderNote(note);
      }
    }
  });

  // ---------- 팝업 메시지 ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'create') {
      createNote();
      sendResponse({ ok: true });
    } else if (msg.type === 'getState') {
      sendResponse({ host: HOSTNAME });
    } else if (msg.type === 'focus') {
      const entry = noteEls.get(msg.id);
      if (entry) {
        entry.el.style.zIndex = ++zCounter;
        entry.el.classList.remove('flash');
        // reflow로 애니메이션 재시작
        void entry.el.offsetWidth;
        entry.el.classList.add('flash');
      }
      sendResponse({ ok: !!entry });
    }
  });

  init();
})();
