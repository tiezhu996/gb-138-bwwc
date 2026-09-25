const { ApiError } = require('./errors');

const MAX_TEXT_LENGTH = 500;

const validateText = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new ApiError('badRequest', '心愿内容不能为空');
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new ApiError('badRequest', `心愿内容不能超过 ${MAX_TEXT_LENGTH} 个字`);
  }
  return trimmed;
};

const createWishService = (store) => {
  const list = () => store.list();

  const create = ({ text, actor }) => {
    const trimmed = validateText(text);
    return store.create({ text: trimmed, createdBy: actor });
  };

  // 仅提出人可以修改自己尚未完成的心愿；version 不匹配则返回冲突供前端提示
  const edit = async (id, { text, version }, actor) => {
    if (!Number.isInteger(version) || version < 1) {
      throw new ApiError('badRequest', '缺少心愿版本号');
    }
    const trimmed = validateText(text);

    const wish = await store.find(id);
    if (!wish) throw new ApiError('notFound', '心愿不存在或已被撤回');
    if (wish.createdBy !== actor) {
      throw new ApiError('forbidden', '只有提出人可以修改这条心愿');
    }
    if (wish.completed) {
      throw new ApiError('conflict', '心愿已完成，不能再修改', { current: wish });
    }

    const result = await store.update(id, { text: trimmed }, version);
    if (result === null) throw new ApiError('notFound', '心愿不存在或已被撤回');
    if (result.conflict) {
      throw new ApiError('conflict', '这条心愿刚被家人改过，请先查看最新内容', { current: result.current });
    }
    return result.wish;
  };

  // 任何家人都可以把未完成的心愿标记完成；系统记录完成人和完成时间
  const complete = async (id, { version }, actor) => {
    if (!Number.isInteger(version) || version < 1) {
      throw new ApiError('badRequest', '缺少心愿版本号');
    }

    const wish = await store.find(id);
    if (!wish) throw new ApiError('notFound', '心愿不存在或已被撤回');
    if (wish.completed) {
      throw new ApiError('conflict', '这条心愿刚刚已被家人完成', { current: wish });
    }

    const now = new Date().toISOString();
    const result = await store.update(
      id,
      { completed: true, completedBy: actor, completedAt: now },
      version,
    );
    if (result === null) throw new ApiError('notFound', '心愿不存在或已被撤回');
    if (result.conflict) {
      throw new ApiError('conflict', '这条心愿刚被家人改过，请先查看最新内容', { current: result.current });
    }
    return result.wish;
  };

  // 仅提出人可以撤回自己尚未完成的心愿
  const remove = async (id, actor) => {
    const wish = await store.find(id);
    if (!wish) throw new ApiError('notFound', '心愿不存在或已被撤回');
    if (wish.createdBy !== actor) {
      throw new ApiError('forbidden', '只有提出人可以撤回这条心愿');
    }
    if (wish.completed) {
      throw new ApiError('conflict', '心愿已完成，不能撤回', { current: wish });
    }
    await store.remove(id);
  };

  return { list, create, edit, complete, remove };
};

module.exports = { createWishService };
