import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  listWishes,
  createWish,
  updateWish,
  deleteWish,
  ApiError,
} from '../api/wishes';

const NAME_KEY = 'careArchiveUserName';
const LEGACY_KEY = 'wishList';
const MIGRATED_KEY = 'wishListMigrated';

const readStoredName = () => {
  try {
    return (localStorage.getItem(NAME_KEY) || '').trim() || null;
  } catch {
    return null;
  }
};

const readLegacyWishes = () => {
  try {
    const saved = localStorage.getItem(LEGACY_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const NameGate = ({ onSubmit }) => {
  const [name, setName] = useState('');

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50 flex items-center justify-center px-6">
      <div className="relative bg-white/85 backdrop-blur-sm rounded-3xl shadow-xl p-10 max-w-md w-full border border-white/60">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 shadow-xl mb-5">
            <span className="text-4xl">💝</span>
          </div>
          <h1 className="text-2xl font-bold text-warm-800 mb-2">共同关怀档案 · 心愿清单</h1>
          <p className="text-warm-500 leading-relaxed">
            心愿保存在家人共享的档案中，不再只留在各自浏览器里。
            请先填写您的名字，方便记录每一条心愿由谁提出、由谁完成。
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSubmit(name.trim());
          }}
          className="space-y-4"
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="您的名字，例如：大姐 / 阿明"
            maxLength={50}
            autoFocus
            className="w-full px-5 py-4 rounded-2xl border-2 border-rose-100 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 transition-all outline-none text-lg bg-white/70"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white rounded-2xl font-bold text-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            进入共同心愿清单
          </button>
        </form>
      </div>
    </div>
  );
};

const WishList = () => {
  const [me, setMe] = useState(readStoredName);
  const [nameDraft, setNameDraft] = useState('');
  const [wishes, setWishes] = useState([]);
  const [newWish, setNewWish] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [savingNew, setSavingNew] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [editing, setEditing] = useState(null);
  // { id, action: 'complete' | 'delete', wish: 最新版本 }
  const [conflict, setConflict] = useState(null);
  const [legacyCount, setLegacyCount] = useState(0);
  const [migrating, setMigrating] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    try {
      const data = await listWishes('all');
      setWishes(data.wishes || []);
      if (!silent) setLoading(false);
    } catch (err) {
      if (silent) return; // 后台轮询失败不打扰家人（下次可见或轮询时再试）
      setLoading(false);
      setNotice({ type: 'error', message: err.message });
    }
  }, []);

  useEffect(() => {
    if (!me) return undefined;
    setLoading(true);
    refresh();

    const timer = setInterval(() => refresh(true), 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [me, refresh]);

  // 进入档案后检查旧浏览器里遗留的本地心愿
  useEffect(() => {
    if (!me) return;
    let migrated = true;
    try {
      migrated = localStorage.getItem(MIGRATED_KEY) === '1';
    } catch {
      // 无法访问本地存储时视为已迁移，避免反复提示
    }
    if (!migrated) {
      setLegacyCount(readLegacyWishes().length);
    }
  }, [me]);

  if (!me) {
    return (
      <NameGate
        onSubmit={(name) => {
          try {
            localStorage.setItem(NAME_KEY, name);
          } catch {
            // 私密模式等情况下仍允许本次使用
          }
          setMe(name);
        }}
      />
    );
  }

  const switchName = () => {
    if (!nameDraft.trim()) return;
    const next = nameDraft.trim();
    try {
      localStorage.setItem(NAME_KEY, next);
    } catch {
      // ignore
    }
    setMe(next);
    setNameDraft('');
    setEditing(null);
    setConflict(null);
    setNotice({ type: 'success', message: `已切换为：${next}` });
  };

  const addWish = async () => {
    const text = newWish.trim();
    if (!text || savingNew) return;
    setSavingNew(true);
    setNotice(null);
    try {
      const data = await createWish(me, { text });
      setWishes((prev) => [...prev, data.wish]);
      setNewWish('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.wish) {
        setNotice({ type: 'info', message: `${err.wish.createdBy} 已经提出过同样的心愿啦` });
      } else {
        setNotice({ type: 'error', message: err.message });
      }
    } finally {
      setSavingNew(false);
    }
  };

  const completeWish = async (wish) => {
    if (wish.completed || busyId) return;
    setBusyId(wish.id);
    setNotice(null);
    try {
      const data = await updateWish(me, wish.id, {
        completed: true,
        expectedVersion: wish.version,
      });
      setWishes((prev) => prev.map((w) => (w.id === wish.id ? data.wish : w)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.wish) {
        // 后提交不能盖掉先提交：先看到对方刚做的修改
        setConflict({ id: wish.id, action: 'complete', wish: err.wish });
        setWishes((prev) => prev.map((w) => (w.id === wish.id ? err.wish : w)));
      } else {
        setNotice({ type: 'error', message: err.message });
      }
    } finally {
      setBusyId(null);
    }
  };

  const withdrawWish = async (wish) => {
    if (busyId) return;
    if (!window.confirm(`确定要撤掉「${wish.text}」这条心愿吗？`)) return;
    setBusyId(wish.id);
    setNotice(null);
    try {
      await deleteWish(me, wish.id, wish.version);
      setWishes((prev) => prev.filter((w) => w.id !== wish.id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.wish) {
        setConflict({ id: wish.id, action: 'delete', wish: err.wish });
        setWishes((prev) => prev.map((w) => (w.id === wish.id ? err.wish : w)));
      } else if (err instanceof ApiError && err.status === 403) {
        setNotice({ type: 'error', message: err.message });
      } else {
        setNotice({ type: 'error', message: err.message });
      }
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (expectedVersion) => {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) {
      setNotice({ type: 'error', message: '心愿内容不能为空' });
      return;
    }
    setEditing((prev) => ({ ...prev, saving: true, conflict: null }));
    try {
      // 用开始编辑时的版本提交：若期间有家人先改过，服务端会拒绝并返回最新内容
      const data = await updateWish(me, editing.id, {
        text,
        expectedVersion,
      });
      setWishes((prev) => prev.map((w) => (w.id === editing.id ? data.wish : w)));
      setEditing(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.wish) {
        // 对方先改了：展示对方的最新版本，由本人决定采用哪个
        setEditing((prev) => ({ ...prev, saving: false, conflict: err.wish }));
        setWishes((prev) => prev.map((w) => (w.id === editing.id ? err.wish : w)));
      } else {
        setEditing((prev) => ({ ...prev, saving: false }));
        setNotice({ type: 'error', message: err.message });
      }
    }
  };

  const cancelEdit = () => setEditing(null);

  const migrateLegacy = async () => {
    const legacy = readLegacyWishes();
    if (legacy.length === 0) {
      setLegacyCount(0);
      return;
    }
    setMigrating(true);
    setNotice(null);
    let imported = 0;
    const created = [];
    for (const item of legacy) {
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!text) continue;
      try {
        // 本机旧记录无法考证原提出人，由导入的家人代为提出
        const data = await createWish(me, {
          text,
          completed: item.completed === true,
          completedAt: item.completed === true ? item.completedAt : undefined,
        });
        created.push(data.wish);
        imported += 1;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.wish) {
          created.push(err.wish);
        }
      }
    }
    if (created.length > 0) {
      setWishes((prev) => {
        const existing = new Map(prev.map((w) => [w.id, w]));
        created.forEach((w) => existing.set(w.id, w));
        return Array.from(existing.values());
      });
    }
    try {
      localStorage.setItem(MIGRATED_KEY, '1');
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // ignore
    }
    setLegacyCount(0);
    setMigrating(false);
    setNotice({
      type: 'success',
      message:
        imported > 0
          ? `已把 ${imported} 条本机旧心愿导入共同档案，由您（${me}）代为提出`
          : '本机旧心愿与共同档案重复，未重复导入',
    });
  };

  const discardLegacy = () => {
    try {
      localStorage.setItem(MIGRATED_KEY, '1');
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // ignore
    }
    setLegacyCount(0);
  };

  const filteredWishes = wishes.filter((wish) => {
    if (filter === 'active') return !wish.completed;
    if (filter === 'completed') return wish.completed;
    return true;
  });

  const completedCount = wishes.filter((w) => w.completed).length;
  const activeCount = wishes.length - completedCount;

  const renderConflictBanner = () => {
    if (!conflict) return null;
    const latest = conflict.wish;
    let description;
    if (latest.completed) {
      description = `${latest.completedBy} 刚刚已完成这条心愿（${formatTime(latest.completedAt)}）`;
    } else {
      description = `${latest.updatedBy || '其他家人'} 刚刚把内容改成了：「${latest.text}」`;
    }
    return (
      <div className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="flex-1">
            <p className="font-bold text-amber-800">
              {conflict.action === 'delete' ? '这条心愿刚被家人改动，未能撤掉' : '这条心愿刚有家人更新'}
            </p>
            <p className="text-amber-700 mt-1">{description}</p>
            <p className="text-amber-600 text-sm mt-1">清单已刷新为最新结果，请查看后再决定是否继续操作。</p>
          </div>
          <button
            onClick={() => setConflict(null)}
            className="px-4 py-2 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors"
          >
            知道了
          </button>
        </div>
      </div>
    );
  };

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
              <h1 className="text-2xl font-bold text-warm-800">心愿清单</h1>
              <p className="text-xs text-warm-500">共同关怀档案 · 家人共享同一份心愿</p>
            </div>
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-full pl-4 pr-1 py-1">
              <span className="text-sm text-rose-500">当前家人</span>
              <span className="text-sm font-bold text-rose-700 max-w-[7rem] truncate">{me}</span>
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && switchName()}
                placeholder="换一位家人"
                maxLength={50}
                className="hidden sm:block w-24 px-3 py-1.5 text-sm rounded-full border border-rose-200 bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none"
              />
              <button
                onClick={switchName}
                disabled={!nameDraft.trim()}
                className="text-sm px-3 py-1.5 rounded-full bg-white border border-rose-200 text-rose-600 font-semibold hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                切换
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 shadow-2xl mb-6">
            <span className="text-5xl">✨</span>
          </div>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur-sm rounded-full text-sm text-rose-600 font-medium mb-6 shadow-sm border border-rose-100">
            <span>👨‍👩‍👧‍👦</span>
            <span>共同档案 · 心愿 · 温暖 · 实现</span>
          </div>
          <h2 className="text-3xl font-bold text-warm-900 mb-4">家人共享的心愿清单</h2>
          <p className="text-lg text-warm-600 max-w-xl mx-auto leading-relaxed">
            每一条心愿都记录在共同的关怀档案里：谁提出、谁完成，一目了然。
            提出人可以修改或撤掉自己未完成的心愿，其他家人也可以帮忙标记完成。
          </p>
        </div>

        {legacyCount > 0 && (
          <div className="mb-8 rounded-2xl border-2 border-sky-200 bg-sky-50 p-5">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-2xl">📥</span>
              <p className="flex-1 text-sky-800 min-w-[12rem]">
                检测到这台设备的浏览器里还留着 <strong>{legacyCount}</strong> 条仅保存在本地的旧心愿，
                是否导入共同档案与家人共享？
              </p>
              <div className="flex gap-3">
                <button
                  onClick={migrateLegacy}
                  disabled={migrating}
                  className="px-5 py-2.5 rounded-xl bg-sky-500 text-white font-semibold hover:bg-sky-600 disabled:opacity-50 transition-colors"
                >
                  {migrating ? '导入中…' : '导入共同档案'}
                </button>
                <button
                  onClick={discardLegacy}
                  disabled={migrating}
                  className="px-5 py-2.5 rounded-xl bg-white border border-sky-200 text-sky-600 font-semibold hover:bg-sky-100 disabled:opacity-50 transition-colors"
                >
                  不再保留
                </button>
              </div>
            </div>
          </div>
        )}

        {notice && (
          <div
            className={`mb-6 rounded-2xl p-4 flex items-start gap-3 border ${
              notice.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : notice.type === 'info'
                  ? 'bg-sky-50 border-sky-200 text-sky-700'
                  : 'bg-green-50 border-green-200 text-green-700'
            }`}
          >
            <button
              onClick={() => setNotice(null)}
              className="ml-auto opacity-60 hover:opacity-100 text-lg leading-none"
              aria-label="关闭提示"
            >
              ×
            </button>
            <p className="flex-1 font-medium">{notice.message}</p>
          </div>
        )}

        {renderConflictBanner()}

        <div className="relative bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl p-8 mb-10 border border-white/60">
          <div className="relative flex gap-4">
            <input
              type="text"
              value={newWish}
              onChange={(e) => setNewWish(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addWish()}
              placeholder={`以「${me}」的名义写下一个心愿...`}
              maxLength={1000}
              className="flex-1 px-5 py-4 rounded-2xl border-2 border-rose-100 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 transition-all outline-none text-lg bg-white/50"
            />
            <button
              onClick={addWish}
              disabled={!newWish.trim() || savingNew}
              className="px-8 py-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white rounded-2xl font-bold text-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg"
            >
              {savingNew ? '提交中…' : '添加'}
            </button>
          </div>
        </div>

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
          <div className="flex items-center mb-6 px-2">
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

        <div className="space-y-4">
          {loading ? (
            <div className="relative bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl p-16 text-center border border-white/60">
              <div className="text-5xl mb-4 animate-pulse">⏳</div>
              <p className="text-warm-500 text-lg">正在从共同关怀档案读取心愿…</p>
            </div>
          ) : filteredWishes.length === 0 ? (
            <div className="relative bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl p-16 text-center border border-white/60 overflow-hidden">
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
              const isOwner = wish.createdBy === me;
              const isEditing = editing?.id === wish.id;
              return (
                <div
                  key={wish.id}
                  className={`group relative bg-white/80 backdrop-blur-sm rounded-2xl p-6 flex items-start gap-5 transition-all duration-300 hover:shadow-xl border border-white/60 overflow-hidden ${
                    wish.completed ? 'bg-gradient-to-r from-green-50/80 to-emerald-50/80' : ''
                  } ${isEditing ? 'ring-2 ring-rose-300' : ''}`}
                >
                  <button
                    onClick={() => completeWish(wish)}
                    disabled={wish.completed || busyId === wish.id}
                    title={wish.completed ? '已完成' : `${me} 标记完成`}
                    className={`w-10 h-10 mt-0.5 rounded-full border-3 flex items-center justify-center transition-all duration-300 flex-shrink-0 ${
                      wish.completed
                        ? 'bg-gradient-to-br from-green-500 to-emerald-500 border-transparent text-white shadow-lg scale-110'
                        : 'border-warm-300 hover:border-green-400 hover:bg-green-50 disabled:opacity-60'
                    }`}
                  >
                    {wish.completed ? (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : busyId === wish.id ? (
                      <span className="text-sm">…</span>
                    ) : null}
                  </button>

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={editing.text}
                          onChange={(e) =>
                            setEditing((prev) => ({ ...prev, text: e.target.value }))
                          }
                          maxLength={1000}
                          autoFocus
                          className="w-full px-4 py-3 rounded-xl border-2 border-rose-200 focus:border-rose-400 focus:ring-4 focus:ring-rose-100 outline-none text-lg bg-white"
                        />
                        {editing.conflict && (
                          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                            <p className="font-bold text-amber-800 text-sm mb-1">
                              ⚠️ 在您编辑期间，{editing.conflict.updatedBy || '其他家人'} 刚改过这条心愿
                            </p>
                            {editing.conflict.completed ? (
                              <p className="text-amber-700 text-sm">
                                {editing.conflict.completedBy} 已将它标记完成，未完成的心愿才能修改。
                              </p>
                            ) : (
                              <p className="text-amber-700 text-sm">
                                家人的最新内容：「{editing.conflict.text}」
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2 mt-3">
                              <button
                                onClick={() => {
                                  const latest = editing.conflict;
                                  if (latest.completed) {
                                    setEditing(null);
                                    return;
                                  }
                                  // 已看过家人的最新内容：采用它，并以最新版本为继续修改的基准
                                  setEditing({
                                    id: wish.id,
                                    text: latest.text,
                                    baseVersion: latest.version,
                                    saving: false,
                                    conflict: null,
                                  });
                                }}
                                className="px-4 py-2 text-sm rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600"
                              >
                                {editing.conflict.completed ? '关闭编辑' : '采用家人的内容'}
                              </button>
                              {!editing.conflict.completed && (
                                <button
                                  onClick={() => saveEdit(editing.conflict.version)}
                                  disabled={editing.saving}
                                  className="px-4 py-2 text-sm rounded-lg bg-white border border-amber-400 text-amber-700 font-semibold hover:bg-amber-100 disabled:opacity-50"
                                >
                                  {editing.saving ? '提交中…' : '仍用我的内容再次提交'}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(editing.baseVersion)}
                            disabled={editing.saving || Boolean(editing.conflict)}
                            className="px-5 py-2 rounded-xl bg-rose-500 text-white font-semibold hover:bg-rose-600 disabled:opacity-50 transition-colors"
                          >
                            {editing.saving ? '保存中…' : '保存'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={editing.saving}
                            className="px-5 py-2 rounded-xl bg-white border border-warm-200 text-warm-600 font-semibold hover:bg-warm-50 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className={`text-xl ${wish.completed ? 'text-warm-400 line-through' : 'text-warm-800 font-medium'}`}>
                          {wish.text}
                        </p>
                        <div className="text-sm text-warm-400 mt-2 space-y-1">
                          <p className="flex items-center gap-1.5 flex-wrap">
                            <span>💛</span>
                            <span>
                              由 <strong className="text-warm-500">{wish.createdBy}</strong> 提出 ·{' '}
                              {formatTime(wish.createdAt)}
                            </span>
                          </p>
                          {wish.completed && (
                            <p className="flex items-center gap-1.5 flex-wrap text-green-600">
                              <span>✅</span>
                              <span>
                                由 <strong>{wish.completedBy}</strong> 完成 ·{' '}
                                {formatTime(wish.completedAt)}
                              </span>
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {!isEditing && !wish.completed && isOwner && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() =>
                          setEditing({
                            id: wish.id,
                            text: wish.text,
                            baseVersion: wish.version,
                            saving: false,
                            conflict: null,
                          })
                        }
                        disabled={Boolean(busyId)}
                        title="修改我的心愿"
                        className="p-3 text-warm-400 hover:text-rose-500 hover:bg-rose-50 rounded-2xl transition-all"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => withdrawWish(wish)}
                        disabled={Boolean(busyId)}
                        title="撤掉我的心愿"
                        className="p-3 text-warm-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

        {wishes.length > 0 && (
          <div className="relative mt-12 bg-gradient-to-r from-rose-500 via-pink-500 to-fuchsia-500 rounded-3xl p-10 text-center shadow-2xl overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
            <p className="relative text-xl text-white leading-relaxed">
              💝 每一个心愿都是对生活的热爱，每一次完成都是爱的见证。
              <br />
              无论由谁提出、由谁实现，都是一家人共同守护的温暖。
            </p>
          </div>
        )}
      </main>

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
