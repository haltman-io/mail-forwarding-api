import { PublicHttpException } from "../errors/public-http.exception.js";

export function parsePagination(
  query: Record<string, unknown>,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): { limit: number; offset: number } {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 200;

  const limitRaw = query?.limit;
  const offsetRaw = query?.offset;

  const limitNum = limitRaw === undefined ? defaultLimit : Number(limitRaw);
  const offsetNum = offsetRaw === undefined ? 0 : Number(offsetRaw);

  if (!Number.isInteger(limitNum) || limitNum <= 0) {
    throw new PublicHttpException(400, { error: "invalid_params", field: "limit" });
  }
  if (!Number.isInteger(offsetNum) || offsetNum < 0) {
    throw new PublicHttpException(400, { error: "invalid_params", field: "offset" });
  }

  return {
    limit: Math.min(limitNum, maxLimit),
    offset: offsetNum,
  };
}
