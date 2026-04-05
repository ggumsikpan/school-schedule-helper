'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Child, CHILD_COLORS } from '@/lib/types';
import { getChildren, saveChildren } from '@/lib/storage';

const EMPTY_CHILD: Omit<Child, 'id' | 'color'> = {
  name: '',
  school: '',
  grade: 1,
  className: '',
  boardUrl: '',
  postUrl: '',
};

export default function SettingsPage() {
  const [children, setChildren] = useState<Child[]>([]);
  const [editing, setEditing] = useState<Child | null>(null);
  const [form, setForm] = useState(EMPTY_CHILD);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setChildren(getChildren());
  }, []);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_CHILD);
    setShowForm(true);
  }

  function openEdit(child: Child) {
    setEditing(child);
    setForm({ name: child.name, school: child.school, grade: child.grade, className: child.className, boardUrl: child.boardUrl, postUrl: child.postUrl ?? '' });
    setShowForm(true);
  }

  function handleSave() {
    if (!form.name.trim() || !form.boardUrl.trim()) {
      alert('이름과 게시판 URL은 필수입니다.');
      return;
    }

    let updated: Child[];
    if (editing) {
      updated = children.map(c => c.id === editing.id ? { ...editing, ...form } : c);
    } else {
      const newChild: Child = {
        id: Date.now().toString(),
        color: String(children.length % CHILD_COLORS.length),
        ...form,
      };
      updated = [...children, newChild];
    }

    saveChildren(updated);
    setChildren(updated);
    setShowForm(false);
  }

  function handleDelete(id: string) {
    if (!confirm('정말 삭제할까요?')) return;
    const updated = children.filter(c => c.id !== id);
    saveChildren(updated);
    setChildren(updated);
  }


  return (
    <div className="min-h-screen bg-amber-50">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-amber-600 font-medium text-sm">← 돌아가기</Link>
          <h1 className="text-lg font-bold text-amber-800">설정</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* 아이 목록 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-gray-700">아이 프로필</h2>
            <button
              onClick={openAdd}
              className="text-sm px-3 py-1.5 bg-amber-500 text-white rounded-full font-medium active:scale-95 transition-transform"
            >
              + 추가
            </button>
          </div>

          {children.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-gray-400 text-sm">
              아직 등록된 아이가 없어요
            </div>
          )}

          <div className="space-y-2">
            {children.map((child, idx) => {

              const color = CHILD_COLORS[idx % CHILD_COLORS.length];
              return (
                <div key={child.id} className={`${color.bg} border-2 ${color.border} rounded-2xl p-4`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-8 h-8 rounded-full ${color.badge} text-white flex items-center justify-center text-sm font-bold`}>
                        {child.name[0]}
                      </span>
                      <div>
                        <p className={`font-bold ${color.text}`}>{child.name}</p>
                        <p className="text-xs text-gray-500">{child.school} {child.grade}학년 {child.className}반</p>
                        <p className="text-xs text-gray-400 truncate max-w-[200px]">{child.boardUrl}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(child)} className="text-xs text-gray-500 underline">수정</button>
                      <button onClick={() => handleDelete(child.id)} className="text-xs text-red-400 underline">삭제</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 캐시 초기화 */}
        <button
          onClick={() => {
            if (confirm('저장된 시간표 데이터를 모두 삭제할까요?')) {
              localStorage.removeItem('ssh_schedules');
              alert('초기화 완료. 새로고침 버튼으로 다시 불러오세요.');
            }
          }}
          className="w-full py-3 rounded-2xl border border-gray-200 text-sm text-gray-400 bg-white"
        >
          시간표 데이터 초기화
        </button>

        {/* 등록/수정 폼 */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-end z-50" onClick={() => setShowForm(false)}>
            <div
              className="bg-white rounded-t-3xl w-full max-w-lg mx-auto p-6 space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="font-bold text-gray-800 text-lg">{editing ? '아이 정보 수정' : '아이 추가'}</h3>

              <div>
                <label className="text-sm text-gray-600 font-medium block mb-1">이름 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예: 민준"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="text-sm text-gray-600 font-medium block mb-1">학교 이름</label>
                <input
                  type="text"
                  value={form.school}
                  onChange={e => setForm(f => ({ ...f, school: e.target.value }))}
                  placeholder="예: 행복초등학교"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-sm text-gray-600 font-medium block mb-1">학년</label>
                  <select
                    value={form.grade}
                    onChange={e => setForm(f => ({ ...f, grade: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
                  >
                    {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}학년</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-sm text-gray-600 font-medium block mb-1">반</label>
                  <input
                    type="text"
                    value={form.className}
                    onChange={e => setForm(f => ({ ...f, className: e.target.value }))}
                    placeholder="예: 1"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600 font-medium block mb-1">주간학습안내 게시판 URL *</label>
                <input
                  type="url"
                  value={form.boardUrl}
                  onChange={e => setForm(f => ({ ...f, boardUrl: e.target.value }))}
                  placeholder="https://school.kr/board/..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400"
                />
                <p className="text-xs text-gray-400 mt-1">학교 홈페이지 → 학급 → 주간학습안내 <b>목록</b> 페이지 주소</p>
              </div>

              <div>
                <label className="text-sm text-gray-600 font-medium block mb-1">
                  최신 게시물 URL
                  <span className="ml-1 text-amber-500 font-bold text-xs">★ 이미지가 안 뜰 때 이걸 쓰세요</span>
                </label>
                <input
                  type="url"
                  value={form.postUrl ?? ''}
                  onChange={e => setForm(f => ({ ...f, postUrl: e.target.value }))}
                  placeholder="https://school.kr/board/view?id=..."
                  className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-amber-400 bg-amber-50"
                />
                <p className="text-xs text-gray-400 mt-1">
                  학교 홈페이지에서 이번 주 주간학습안내 게시물을 직접 열고, 그 URL을 붙여넣으세요.<br/>
                  매주 새 게시물이 올라오면 여기를 업데이트하면 돼요.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-3 border border-gray-300 text-gray-600 rounded-xl font-medium"
                >
                  취소
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold active:scale-95 transition-transform"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
