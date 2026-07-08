// 옵션: 새 메모의 기본 표시 범위 설정. 변경 즉시 저장.
(() => {
  'use strict';

  const t = (key) => chrome.i18n.getMessage(key) || key;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.title = t('optionsTitle');

  const saved = document.getElementById('saved');
  let savedTimer = null;

  async function load() {
    const all = await chrome.storage.local.get('settings');
    const settings = Object.assign(
      { defaultScope: 'site', notesVisible: true },
      all.settings
    );
    const radio = document.querySelector(
      `input[name="defaultScope"][value="${settings.defaultScope}"]`
    );
    if (radio) radio.checked = true;
  }

  document.querySelectorAll('input[name="defaultScope"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      const all = await chrome.storage.local.get('settings');
      const settings = Object.assign(
        { defaultScope: 'site', notesVisible: true },
        all.settings
      );
      settings.defaultScope = radio.value;
      await chrome.storage.local.set({ settings });
      saved.hidden = false;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => {
        saved.hidden = true;
      }, 1500);
    });
  });

  load();
})();
