const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** An unknown favorite state cannot enable a new write. */
export function validFavoriteState(value: unknown): value is { is_favorited: boolean } {
  return record(value) && value.error == null && value.success !== false && typeof value.is_favorited === 'boolean';
}

/** Match the API's explicit add, already-present and remove receipts before publishing success. */
export function validFavoriteAcknowledgement(value: unknown, selected: boolean): value is { message: string } {
  if (!record(value) || value.error != null || value.success === false ||
      (value.is_favorited !== undefined && value.is_favorited !== selected)) return false;
  if (!selected) return value.message === '取消收藏成功';
  return (value.message === '收藏成功' && Number.isSafeInteger(value.favorite_id) && Number(value.favorite_id) > 0) ||
    (value.message === '该商品已在收藏夹中' && value.already_favorited === true);
}
