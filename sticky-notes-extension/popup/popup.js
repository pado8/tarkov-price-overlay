// 팝업: 메모 목록 표시, 새 메모 생성, 전체 표시 토글, 삭제.
// 메모 데이터는 storage에서 직접 읽고, 페이지 조작(생성/포커스)만 content script에 메시지로 요청한다.
(() => {
  'use strict';

  const NOTE_PREFIX = 'note_';
  const t = (key) => chrome.i18n.getMessage(key) || key;

  let activeTabId = null;
  let host = null; // 현재 탭의 hostname (content script 응답, 없으면 null)

  // data-i18n 속성 기반 로컬라이즈
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.title = t('appName');
  document.getElementById('version').textContent =
    'v' + chrome.runtime.getManifest().version;

  const newNoteBtn = document.getElementById('newNoteBtn');
  const visibleToggle = document.getElementById('visibleToggle');
  const notice = document.getElementById('notice');
  const siteSection = document.getElementById('siteSection');
  const siteHost = document.getElementById('siteHost');
  const siteList = document.getElementById('siteList');
  const globalList = document.getElementById('globalList');

  async function sendToTab(msg) {
    if (activeTabId == null) return null;
    try {
      return await chrome.tabs.sendMessage(activeTabId, msg);
    } catch {
      return null; // content script가 없는 페이지 (chrome:// 등)
    }
  }

  function renderList(ul, notes) {
    ul.textContent = '';
    if (notes.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = t('popupEmpty');
      ul.appendChild(li);
      return;
    }
    notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const note of notes) {
      const li = document.createElement('li');
      li.className = 'item';

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.dataset.color = note.color || 'yellow';

      const preview = document.createElement('span');
      preview.className = 'preview';
      const text = (note.text || '').trim().split('\n')[0];
      if (text) {
        preview.textContent = text;
      } else {
        preview.textContent = t('popupEmptyNote');
        preview.classList.add('empty-text');
      }

      // 가리기/보이게 하기 토글
      const eye = document.createElement('button');
      eye.className = 'eye';
      eye.type = 'button';
      if (note.hidden) {
        li.classList.add('hidden-note');
        eye.classList.add('show-btn');
        eye.textContent = t('popupShowNote');
      } else {
        eye.textContent = '👁';
        eye.title = t('noteHideTip');
      }
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        note.hidden = !note.hidden;
        note.updatedAt = Date.now();
        chrome.storage.local.set({ [NOTE_PREFIX + note.id]: note });
      });

      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.title = t('noteDeleteTip');
      del.textContent = '×';

      // 2단계 삭제 확인: 첫 클릭 → "삭제" 확정 버튼으로 변신
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (del.classList.contains('confirm')) {
          chrome.storage.local.remove(NOTE_PREFIX + note.id);
          li.remove();
        } else {
          del.classList.add('confirm');
          del.textContent = t('confirmDelete');
          setTimeout(() => {
            del.classList.remove('confirm');
            del.textContent = '×';
          }, 2500);
        }
      });

      // 항목 클릭 → 현재 탭에서 해당 메모 강조 (가려진 메모는 페이지에 없음)
      li.addEventListener('click', () => {
        if (!note.hidden) sendToTab({ type: 'focus', id: note.id });
      });

      li.append(dot, preview, eye, del);
      ul.appendChild(li);
    }
  }

  async function refresh() {
    const all = await chrome.storage.local.get(null);
    const settings = Object.assign(
      { defaultScope: 'site', notesVisible: true },
      all.settings
    );
    visibleToggle.checked = settings.notesVisible !== false;

    const notes = Object.entries(all)
      .filter(([k, v]) => k.startsWith(NOTE_PREFIX) && v)
      .map(([, v]) => v);

    if (host !== null) {
      siteSection.hidden = false;
      siteHost.textContent = host;
      renderList(siteList, notes.filter((n) => n.scope === 'site' && n.domain === host));
    } else {
      siteSection.hidden = true;
    }
    renderList(globalList, notes.filter((n) => n.scope === 'global'));
  }

  newNoteBtn.addEventListener('click', async () => {
    const res = await sendToTab({ type: 'create' });
    if (res && res.ok) {
      window.close();
    } else {
      notice.hidden = false;
    }
  });

  visibleToggle.addEventListener('change', async () => {
    const all = await chrome.storage.local.get('settings');
    const settings = Object.assign(
      { defaultScope: 'site', notesVisible: true },
      all.settings
    );
    settings.notesVisible = visibleToggle.checked;
    await chrome.storage.local.set({ settings });
  });

  document.getElementById('optionsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // 다른 곳(콘텐츠 스크립트)에서 바뀌면 목록 갱신
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') refresh();
  });

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab ? tab.id : null;
    const state = await sendToTab({ type: 'getState' });
    if (state && state.host !== undefined) {
      host = state.host; // 빈 문자열일 수도 있음 (file:// 등)
    } else {
      notice.hidden = false;
      newNoteBtn.disabled = true;
    }
    await refresh();
  })();
})();
