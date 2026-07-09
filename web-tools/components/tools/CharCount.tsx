'use client';

import { useMemo, useState } from 'react';

function count(text: string) {
  const noSpace = text.replace(/\s/g, '');
  let bytes2 = 0;
  for (const ch of text) {
    bytes2 += ch.charCodeAt(0) > 127 ? 2 : 1;
  }
  return {
    withSpace: [...text].length,
    withoutSpace: [...noSpace].length,
    bytes2,
    bytes3: new TextEncoder().encode(text).length,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    lines: text ? text.split('\n').length : 0,
  };
}

export default function CharCount() {
  const [text, setText] = useState('');
  const stats = useMemo(() => count(text), [text]);

  const tiles = [
    { label: '공백 포함', value: stats.withSpace, unit: '자', main: true },
    { label: '공백 제외', value: stats.withoutSpace, unit: '자', main: true },
    { label: '바이트 (한글 2byte)', value: stats.bytes2, unit: 'byte', main: false },
    { label: '바이트 (UTF-8)', value: stats.bytes3, unit: 'byte', main: false },
    { label: '단어 수', value: stats.words, unit: '개', main: false },
    { label: '줄 수', value: stats.lines, unit: '줄', main: false },
  ];

  return (
    <section>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="글자수를 셀 내용을 입력하거나 붙여넣으세요. 입력 내용은 서버로 전송되지 않습니다."
        rows={10}
        data-testid="cc-input"
        className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand-500 focus:outline-none"
      />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="cc-stats">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={`rounded-xl border p-4 text-center ${
              t.main ? 'border-brand-500 bg-brand-50' : 'border-gray-200'
            }`}
          >
            <p className="text-sm text-gray-500">{t.label}</p>
            <p className={`mt-1 text-2xl font-bold ${t.main ? 'text-brand-600' : 'text-gray-900'}`}>
              {t.value.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-gray-500">{t.unit}</span>
            </p>
          </div>
        ))}
      </div>
      {text && (
        <button
          type="button"
          onClick={() => setText('')}
          className="mt-3 rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
        >
          내용 지우기
        </button>
      )}
    </section>
  );
}
