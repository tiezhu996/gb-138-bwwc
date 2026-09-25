import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getMemberName,
  saveMemberName,
  fetchWishes,
  createWish,
  editWish,
  completeWish,
  removeWish,
  subscribeWishes,
  ApiError,
} from '../api/wishes';

const formatDateTime = (iso) =>
  new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const NameGate = ({ onSubmit }) => {
  const [name, setName] = useState('');

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50 flex items-center justify-center px-6">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-rose-200/30 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-pink-200/30 rounded-full blur-3xl" />
      </div>
      <div className="relative bg-white/85 backdrop-blur-sm rounded-3xl shadow-xl p-10 w-full max-w-md border border-white/60">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 shadow-lg mb-5">
            <span className="text-4xl">👨‍👩‍👧</span>
          </div>
          <h2 className="text-2xl font-bold text-warm-800 mb-2">家人，请先登记您的名字</h2>
          <p className="text-warm-500 leading-relaxed">
            心愿清单是全家共用的关怀档案，
            <br />
            请留下您的名字，方便记录每条心愿由谁提出、由谁完成。
          </p>
        </div>
        <div className="space-y-4">
          <input
            type="text"
            value={name}
            autoFocus
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="您的称呼，如：女儿小敏"
            className="w-full px-5 py-4 rounded-2xl border-2 border-rose-100 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 transition-all outline-none text-lg bg-white/70"
          />
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="w-full px-8 py-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white rounded-2xl font-bold text-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            进入共同心愿清单
          </button>
        </div>
      </div>
    </div>
  );
};

// 冲突提示：家人的提交不会互相覆盖，必须先看到对方刚改了什么再决定
const ConflictDialog = ({ conflict, onClose, onUseMine, busy }) => {
  if (!conflict) return null;
  const { current, draftText } = conflict;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-warm-900/40 backdrop-blur-sm px-6">
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-lg">
        <div className="flex items-center gap-3 mb-5">
          <span className="text-3xl">⚠️</span>
          <h3 className="text-xl font-bold text-warm-800">家人刚刚更新了这条心愿</h3>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-4">
          <p className="text-sm text-amber-700 font-medium mb-2">清单里现在的内容：</p>
          <p className={`text-lg text-warm-800 mb-3 ${current.completed ? 'line-through text-warm-400' : ''}`}>
            {current.text}
          </p>
          <p className="text-sm text-warm-500">
            {current.completed
              ? `已由 ${current.completedBy} 于 ${formatDateTime(current.completedAt)} 完成`
              : `提出人：${current.createdBy}，最近更新于 ${formatDateTime(current.updatedAt)}`}
          </p>
        </div>

        {draftText !== undefined && draftText !== current.text && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 mb-6">
            <p className="text-sm text-rose-700 font-medium mb-2">您刚刚想提交的内容：</p>
            <p className="text-lg text-warm-800">{draftText}</p>
          </div>
        )}

        <p className="text-sm text-warm-500 mb-6">
          为避免盖掉家人的改动，请确认要以哪个版本为准。
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-5 py-3 rounded-2xl font-semibold bg-warm-100 text-warm-700 hover:bg-warm-200 transition-colors"
          >
            以最新内容为准
          </button>
          {!current.completed && (
            <button
              onClick={onUseMine}
              disabled={busy}
              className="px-5 py-3 rounded-2xl font-semibold bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
            >
              {conflict.kind === 'complete' ? '完成最新版本' : '仍提交我的内容'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const WishList = () => {
  const [me, setMe] = useState(getMemberName);
  const [wishes, setWishes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [newWish, setNewWish] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  // 锁定打开编辑框时看到的版本：期间家人若改过，保存会收到 409 并展示对方的改动
  const [editingVersion, setEditingVersion] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const inflightRef = useRef(null);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;
    const task = fetchWishes()
      .then((data) => {
        setWishes(data);
        setLoadError('');
      })
      .catch(() => {
        setLoadError('暂时无法读取共同心愿清单，请检查网络后重试。');
      })
      .finally(() => {
        inflightRef.current = null;
        setLoading(false);
      });
    inflightRef.current = task;
    return task;
  }, []);

  useEffect(() => {
    if (!me) return;
    refresh();
    const unsubscribe = subscribeWishes(() => refresh());
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [me, refresh]);

  if (!me) {
    return (
      <NameGate
        onSubmit={(name) => {
          saveMemberName(name);
          setMe(name);
        }}
      />
    );
  }

  const addWish = async () => {
    const text = newWish.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setActionMessage('');
    try {
      await createWish(text);
      setNewWish('');
      await refresh();
    } catch (err) {
      setActionMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (wish) => {
    setEditingId(wish.id);
    setEditText(wish.text);
    setEditingVersion(wish.version);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
    setEditingVersion(null);
  };

  const submitEdit = async (wish, text, version) => {
    setEditSaving(true);
    setActionMessage('');
    try {
      await editWish(wish.id, text, version);
      setEditingId(null);
      setEditText('');
      setEditingVersion(null);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details?.current) {
        setConflict({ kind: 'edit', current: err.details.current, draftText: text });
      } else {
        setActionMessage(err.message);
      }
    } finally {
      setEditSaving(false);
    }
  };

  const toggleComplete = async (wish) => {
    if (wish.completed) return;
    setActionMessage('');
    try {
      await completeWish(wish.id, wish.version);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details?.current) {
        setConflict({ kind: 'complete', current: err.details.current });
      } else {
        setActionMessage(err.message);
      }
    }
  };

  const withdraw = async (wish) => {
    if (!window.confirm(`确定要撤回头心愿「${wish.text}」吗？`)) return;
    setActionMessage('');
    try {
      await removeWish(wish.id);
      await refresh();
    } catch (err) {
      setActionMessage(err.message);
    }
  };

  const resolveConflict = async (useMine) => {
    const { kind, current, draftText } = conflict;
    if (!useMine) {
      setConflict(null);
      await refresh();
      return;
    }
    setBusy(true);
    try {
      if (kind === 'edit') {
        await editWish(current.id, draftText, current.version);
      } else {
        await completeWish(current.id, current.version);
      }
      setConflict(null);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details?.current) {
        setConflict({ ...conflict, current: err.details.current });
      } else {
        setActionMessage(err.message);
        setConflict(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const filteredWishes = wishes.filter((wish) => {
    if (filter === 'active') return !wish.completed;
    if (filter === 'completed') return wish.completed;
    return true;
  });

  const completedCount = wishes.filter((w) => w.completed).length;
  const activeCount = wishes.length - completedCount;

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-rose-200/30 rounded-full blur-3xl" />
        <div className="absolute top-40 right-20 w-96 h-96 bg-pink-200/30 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-1/3 w-80 h-80 bg-fuchsia-200/30 rounded-full blur-3xl" />
      </div>

      <header className="relative bg-white/70 backdrop-blur-md shadow-sm sticky top-0 z-20 border-b border-white/50">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="p-2.5 hover:bg-warm-100 rounded-full transition-colors group"
            >
              <svg className="w-6 h-6 text-warm-600 group-hover:text-rose-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-warm-800">共同心愿清单</h1>
              <p className="text-xs text-warm-500">全家共用的关怀档案 · 实时同步</p>
            </div>
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-full pl-4 pr-2 py-1.5">
              <span className="text-sm text-warm-600">
                当前身份：<span className="font-semibold text-rose-700">{me}</span>
              </span>
              <button
                onClick={() => {
                  if (window.confirm('要切换为其他家人吗？')) {
                    localStorage.removeItem('familyMemberName');
                    setMe('');
                  }
                }}
                className="text-xs px-3 py-1 rounded-full text-rose-600 hover:bg-rose-100 transition-colors"
              >
                切换
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-16">
          <div className="inline-flex items-center justify-center w-28 h-28 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 shadow-2xl mb-6">
            <span className="text-6xl">✨</span>
          </div>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur-sm rounded-full text-sm text-rose-600 font-medium mb-6 shadow-sm border border-rose-100">
            <span>💝</span>
            <span>心愿 · 温暖 · 实现</span>
          </div>
          <h2 className="text-4xl font-bold text-warm-900 mb-4">
            共同心愿清单
          </h2>
          <p className="text-lg text-warm-600 max-w-xl mx-auto leading-relaxed">
            每位家人都能在这里添上心愿望，谁提出、谁实现都有记录。
            轮流照护时看到的是同一份清单，每一份温暖都不会被漏掉。
          </p>
        </div>

        <div className="relative bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl p-8 mb-6 border border-white/60">
          <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-gradient-to-br from-rose-400 to-pink-500" />
          </div>
          <p className="relative text-sm text-warm-500 mb-3">
            以 <span className="font-semibold text-rose-700">{me}</span> 的名义添加心愿
          </p>
          <div className="relative flex gap-4">
            <input
              type="text"
              value={newWish}
              onChange={(e) => setNewWish(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addWish()}
              placeholder="写下一个心愿..."
              maxLength={500}
              className="flex-1 px-5 py-4 rounded-2xl border-2 border-rose-100 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 transition-all outline-none text-lg bg-white/50"
            />
            <button
              onClick={addWish}
              disabled={!newWish.trim() || submitting}
              className="px-8 py-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white rounded-2xl font-bold text-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg"
            >
              {submitting ? '提交中…' : '添加'}
            </button>
          </div>
        </div>

        {actionMessage && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 rounded-2xl px-5 py-3 text-sm">
            {actionMessage}
          </div>
        )}

        <div className="flex justify-center gap-3 mb-8">
          {[
            { id: 'all', label: '全部', count: wishes.length, icon: '📋' },
            { id: 'active', label: '待完成', count: activeCount, icon: '⏳' },
            { id: 'completed', label: '已完成', count: completedCount, icon: '✅' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-6 py-3 rounded-2xl font-semibold transition-all duration-300 flex items-center gap-2 ${
                filter === tab.id
                  ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-lg'
                  : 'bg-white/80 backdrop-blur-sm text-warm-600 hover:bg-rose-50 shadow-md border border-white/60'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              <span className={`text-sm ${filter === tab.id ? 'text-white/80' : 'text-warm-400'}`}>({tab.count})</span>
            </button>
          ))}
        </div>

        {wishes.length > 0 && (
          <div className="flex justify-between items-center mb-6 px-2">
            <div className="flex items-center gap-3 bg-white/60 backdrop-blur-sm rounded-full px-5 py-2.5 shadow-sm border border-white/50">
              <span className="text-warm-500">进度</span>
              <div className="w-32 h-2 bg-warm-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-rose-500 to-pink-500 rounded-full transition-all duration-500"
                  style={{ width: `${wishes.length > 0 ? (completedCount / wishes.length) * 100 : 0}%` }}
                />
              </div>
              <span className="text-warm-600 font-semibold">
                {completedCount} / {wishes.length}
              </span>
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-16 text-warm-400 text-lg">正在读取共同心愿清单…</div>
        )}

        {!loading && loadError && (
          <div className="bg-white/80 rounded-3xl shadow-xl p-12 text-center border border-white/60">
            <p className="text-warm-600 text-lg mb-4">{loadError}</p>
            <button
              onClick={() => refresh()}
              className="px-6 py-3 bg-gradient-to-r from-rose-500 to-pink-500 text-white rounded-2xl font-semibold shadow-lg"
            >
              重新加载
            </button>
          </div>
        )}

        {!loading && !loadError && (
          <div className="space-y-4">
            {filteredWishes.length === 0 ? (
              <div className="relative bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl p-16 text-center border border-white/60 overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 opacity-10">
                  <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-gradient-to-br from-rose-400 to-pink-500" />
                </div>
                <div className="relative">
                  <div className="text-7xl mb-6">
                    {filter === 'all' ? '📝' : filter === 'active' ? '🎉' : '💪'}
                  </div>
                  <h3 className="text-2xl font-bold text-warm-800 mb-3">
                    {filter === 'all' ? '还没有心愿' : filter === 'active' ? '太棒了！所有心愿都已完成' : '还没有完成的心愿'}
                  </h3>
                  <p className="text-warm-500 text-lg">
                    {filter === 'all' ? '在上方输入框写下第一个心愿吧' : '继续保持这份温暖和力量'}
                  </p>
                </div>
              </div>
            ) : (
              filteredWishes.map((wish) => {
                const mine = wish.createdBy === me;
                const isEditing = editingId === wish.id;
                return (
                  <div
                    key={wish.id}
                    className={`group relative bg-white/80 backdrop-blur-sm rounded-2xl p-6 flex items-start gap-5 transition-all duration-300 hover:shadow-xl border border-white/60 overflow-hidden ${
                      wish.completed ? 'bg-gradient-to-r from-green-50/80 to-emerald-50/80' : ''
                    }`}
                  >
                    <button
                      onClick={() => toggleComplete(wish)}
                      disabled={wish.completed}
                      title={wish.completed ? '心愿已完成' : '由我来完成这条心愿'}
                      className={`w-10 h-10 rounded-full border-3 flex items-center justify-center transition-all duration-300 flex-shrink-0 mt-0.5 ${
                        wish.completed
                          ? 'bg-gradient-to-br from-green-500 to-emerald-500 border-transparent text-white shadow-lg scale-110'
                          : 'border-warm-300 hover:border-green-400 hover:bg-green-50'
                      }`}
                    >
                      {wish.completed && (
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex gap-3 mb-2">
                          <input
                            type="text"
                            value={editText}
                            autoFocus
                            maxLength={500}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitEdit(wish, editText.trim(), editingVersion);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            className="flex-1 px-4 py-2.5 rounded-xl border-2 border-rose-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 outline-none text-lg bg-white"
                          />
                          <button
                            onClick={() => submitEdit(wish, editText.trim(), editingVersion)}
                            disabled={!editText.trim() || editSaving}
                            className="px-4 py-2.5 bg-rose-500 text-white rounded-xl font-semibold hover:bg-rose-600 transition-colors disabled:opacity-50"
                          >
                            保存
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={editSaving}
                            className="px-4 py-2.5 bg-warm-100 text-warm-600 rounded-xl font-semibold hover:bg-warm-200 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <p className={`text-xl ${wish.completed ? 'text-warm-400 line-through' : 'text-warm-800 font-medium'}`}>
                          {wish.text}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-warm-400 mt-2">
                        <span className="inline-flex items-center gap-1">
                          <span>🙋</span>
                          <span>
                            {wish.createdBy} 提出 · {formatDateTime(wish.createdAt)}
                          </span>
                        </span>
                        {wish.completed && (
                          <span className="inline-flex items-center gap-1 text-green-600">
                            <span>✅</span>
                            <span>
                              {wish.completedBy} 完成 · {formatDateTime(wish.completedAt)}
                            </span>
                          </span>
                        )}
                        {!wish.completed && !mine && (
                          <span className="text-warm-300">仅提出人可修改或撤回</span>
                        )}
                      </div>
                    </div>

                    {!isEditing && !wish.completed && mine && (
                      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEdit(wish)}
                          title="修改我的心愿"
                          className="p-3 text-warm-300 hover:text-rose-500 hover:bg-rose-50 rounded-2xl transition-all"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => withdraw(wish)}
                          title="撤回头心愿"
                          className="p-3 text-warm-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {wishes.length > 0 && (
          <div className="relative mt-12 bg-gradient-to-r from-rose-500 via-pink-500 to-fuchsia-500 rounded-3xl p-10 text-center shadow-2xl overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
            <p className="relative text-xl text-white leading-relaxed">
              💝 每一个心愿都是对生活的热爱，每一次完成都是爱的见证。
              <br />
              愿所有美好的心愿都能如愿以偿。
            </p>
          </div>
        )}
      </main>

      <ConflictDialog
        conflict={conflict}
        busy={busy}
        onClose={() => resolveConflict(false)}
        onUseMine={() => resolveConflict(true)}
      />

      <footer className="relative bg-gradient-to-r from-rose-800 to-pink-900 text-white/80 py-10 mt-20">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="text-2xl">🕊️</span>
            <span className="text-lg font-semibold text-white">安宁疗护信息指南</span>
          </div>
          <p className="text-sm text-white/50 max-w-xl mx-auto">
            本平台仅供信息参考，具体诊疗请遵医嘱。如有紧急情况，请立即就医。
          </p>
        </div>
      </footer>
    </div>
  );
};

export default WishList;
