'use client';

import { useCallback, useRef, useState } from 'react';

type Props = {
  accept?: string;
  multiple?: boolean;
  label: string;
  sublabel?: string;
  onFiles: (files: File[]) => void;
};

export default function FileDropzone({ accept, multiple, label, sublabel, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(Array.from(list));
    },
    [onFiles],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      data-testid="dropzone"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
        dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 bg-gray-50 hover:border-brand-500 hover:bg-brand-50'
      }`}
    >
      <span className="text-3xl" aria-hidden>
        📂
      </span>
      <p className="font-semibold text-gray-800">{label}</p>
      <p className="text-sm text-gray-500">{sublabel ?? '클릭해서 선택하거나 파일을 끌어다 놓으세요'}</p>
      <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
        🔒 파일은 서버로 전송되지 않습니다
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
