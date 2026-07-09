'use client';

import { useState } from 'react';

const DAY_MS = 86_400_000;

function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmt(d: Date): string {
  const week = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${week})`;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

const TABS = [
  { key: 'dday', label: '디데이 (남은 날)' },
  { key: 'between', label: '날짜 차이 (며칠째)' },
  { key: 'add', label: '날짜 더하기' },
] as const;

export default function Dday() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('dday');
  const [date1, setDate1] = useState('');
  const [date2, setDate2] = useState('');
  const [addDays, setAddDays] = useState('100');

  const t = today();
  const d1 = parseDate(date1);
  const d2 = parseDate(date2);

  let result: { title: string; lines: string[] } | null = null;

  if (tab === 'dday' && d1) {
    const diff = diffDays(d1, t);
    result = {
      title: diff > 0 ? `D-${diff}` : diff === 0 ? 'D-Day' : `D+${-diff}`,
      lines: [
        `${fmt(d1)}까지 ${diff > 0 ? `${diff}일 남았습니다.` : diff === 0 ? '바로 오늘입니다!' : `${-diff}일 지났습니다.`}`,
      ],
    };
  } else if (tab === 'between' && d1) {
    const end = d2 ?? t;
    const diff = diffDays(end, d1);
    if (diff >= 0) {
      // 한국 관례: 시작일 = 1일차
      const nth = diff + 1;
      const to100 = new Date(d1.getTime() + 99 * DAY_MS);
      const to1year = new Date(d1.getFullYear() + 1, d1.getMonth(), d1.getDate());
      result = {
        title: `${nth.toLocaleString()}일째`,
        lines: [
          `${fmt(d1)}부터 ${fmt(end)}까지, 시작일을 1일차로 세면 ${nth.toLocaleString()}일째입니다. (만 ${diff.toLocaleString()}일)`,
          `100일: ${fmt(to100)} · 1주년: ${fmt(to1year)}`,
        ],
      };
    } else {
      result = { title: '날짜 확인', lines: ['종료일이 시작일보다 빠릅니다.'] };
    }
  } else if (tab === 'add' && d1) {
    const n = parseInt(addDays, 10);
    if (!Number.isNaN(n)) {
      const target = new Date(d1.getTime() + n * DAY_MS);
      const anniversary = new Date(d1.getTime() + (n - 1) * DAY_MS);
      result = {
        title: fmt(target),
        lines: [
          `${fmt(d1)}에서 ${n.toLocaleString()}일 후는 ${fmt(target)}입니다.`,
          `기념일 기준(시작일=1일차)으로 "${n}일째 되는 날"은 ${fmt(anniversary)}입니다.`,
        ],
      };
    }
  }

  return (
    <section>
      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            type="button"
            role="tab"
            aria-selected={tab === tb.key}
            onClick={() => setTab(tb.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              tab === tb.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-gray-700">
          {tab === 'dday' ? '목표 날짜' : tab === 'between' ? '시작 날짜' : '기준 날짜'}
          <input
            type="date"
            value={date1}
            onChange={(e) => setDate1(e.target.value)}
            data-testid="dday-date1"
            className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand-500 focus:outline-none"
          />
        </label>
        {tab === 'between' && (
          <label className="block text-sm font-medium text-gray-700">
            종료 날짜 (비우면 오늘)
            <input
              type="date"
              value={date2}
              onChange={(e) => setDate2(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand-500 focus:outline-none"
            />
          </label>
        )}
        {tab === 'add' && (
          <label className="block text-sm font-medium text-gray-700">
            더할 일수
            <input
              type="number"
              value={addDays}
              onChange={(e) => setAddDays(e.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 focus:border-brand-500 focus:outline-none"
            />
            <span className="mt-2 flex gap-2">
              {[100, 200, 365, 1000].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAddDays(String(n))}
                  className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-200"
                >
                  +{n}일
                </button>
              ))}
            </span>
          </label>
        )}
      </div>

      {result && (
        <div className="mt-6 rounded-2xl border border-brand-500 bg-brand-50 p-6 text-center" data-testid="dday-result">
          <p className="text-3xl font-extrabold text-brand-600">{result.title}</p>
          {result.lines.map((line, i) => (
            <p key={i} className="mt-2 text-sm text-gray-700">
              {line}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
