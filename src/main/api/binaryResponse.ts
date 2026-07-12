import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { ApiHttpError } from './types.js';
import type { ApiRequestContext } from './types.js';

const CACHE_CONTROL = 'private, max-age=604800';

const MIME_BY_EXT: Record<string, string> = {
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

export function contentTypeForFile(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function buildWeakEtag(size: number, mtimeMs: number): string {
  return `W/"${size}-${mtimeMs}"`;
}

export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) {
    return false;
  }
  if (ifNoneMatch.trim() === '*') {
    return true;
  }
  return ifNoneMatch.split(',').map((value) => value.trim()).includes(etag);
}

/**
 * 解析单段 Range 头。null = 无 Range；'invalid' = 语法错/多段/不可满足（→416，spec §5.2）。
 * end 超出文件末尾时按 RFC 截断到 size-1。
 */
export function parseRangeHeader(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return 'invalid';
  }
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') {
    return 'invalid';
  }
  if (startStr === '') {
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0 || size === 0) {
      return 'invalid';
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startStr);
  const end = endStr === '' ? size - 1 : Number(endStr);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end < start) {
    return 'invalid';
  }
  return { start, end: Math.min(end, size - 1) };
}

export function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export function hasStartedResponse(context: ApiRequestContext): boolean {
  return context.res.headersSent || context.res.writableEnded;
}

export function destroyStartedResponse(context: ApiRequestContext, error: unknown): void {
  context.res.destroy(error instanceof Error ? error : new Error(String(error)));
}

function clearEntityHeaders(context: ApiRequestContext): void {
  // 抛错走 JSON envelope 前清掉实体头：206 分支已设置 Content-Length/Content-Type/Content-Range，
  // 流启动前失败时这三个头会残留到 404/500 JSON 错误响应上，必须一并清除
  context.res.removeHeader('Content-Length');
  context.res.removeHeader('Content-Type');
  context.res.removeHeader('Content-Range');
}

/**
 * 统一二进制响应：stat → 弱 ETag/Cache-Control/Accept-Ranges → If-None-Match 304
 * → Range 校验（非法 416）→ 206/200 流式。handler 用它后必须 return undefined。
 */
export async function serveBinaryFile(
  context: ApiRequestContext,
  filePath: string,
  internalMessage: string,
  contentType: string = contentTypeForFile(filePath),
): Promise<undefined> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new ApiHttpError(404, 'NOT_FOUND', 'Resource not found');
    }
    throw new ApiHttpError(500, 'INTERNAL_ERROR', internalMessage);
  }
  // 0 字节文件不是可服务的二进制内容：当作 404 而非发 Content-Length:0 的 200。生成中断/失败会在
  // 缓存路径留下 0 字节残骸，空体 200 会被客户端图片库（Coil 等）缓存成「成功但空」条目并永久命中，
  // 且客户端重试重打同一 URL 仍命中这条空缓存、无法自愈（真机联调实证的封面「加载失败」投毒）。
  if (!stat.isFile() || stat.size === 0) {
    throw new ApiHttpError(404, 'NOT_FOUND', 'Resource not found');
  }

  const { req, res } = context;
  const etag = buildWeakEtag(stat.size, stat.mtimeMs);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', CACHE_CONTROL);
  res.setHeader('Accept-Ranges', 'bytes');

  // If-None-Match 优先于 Range（RFC 9110 §13.2.2）
  const ifNoneMatch = Array.isArray(req.headers['if-none-match'])
    ? req.headers['if-none-match'].join(', ')
    : req.headers['if-none-match'];
  if (etagMatches(ifNoneMatch, etag)) {
    res.statusCode = 304;
    res.end();
    return undefined;
  }

  const rangeHeader = Array.isArray(req.headers.range) ? req.headers.range[0] : req.headers.range;
  const range = parseRangeHeader(rangeHeader, stat.size);
  if (range === 'invalid') {
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    throw new ApiHttpError(416, 'VALIDATION_ERROR', 'Range not satisfiable');
  }

  try {
    res.setHeader('Content-Type', contentType);
    if (range) {
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
      await pipeline(createReadStream(filePath, { start: range.start, end: range.end }), res);
    } else {
      res.statusCode = 200;
      res.setHeader('Content-Length', stat.size);
      await pipeline(createReadStream(filePath), res);
    }
    return undefined;
  } catch (error) {
    if (hasStartedResponse(context)) {
      destroyStartedResponse(context, error);
      return undefined;
    }
    clearEntityHeaders(context);
    if (isMissingFileError(error)) {
      throw new ApiHttpError(404, 'NOT_FOUND', 'Resource not found');
    }
    throw new ApiHttpError(500, 'INTERNAL_ERROR', internalMessage);
  }
}
