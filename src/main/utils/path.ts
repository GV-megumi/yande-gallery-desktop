import path from 'path';

/**
 * 规范化路径
 * - 转换为绝对路径
 * - 统一路径分隔符（Windows/Unix）
 * - 去除末尾的分隔符
 */
export function normalizePath(filePath: string): string {
  let normalized = path.normalize(filePath);

  // 统一使用系统路径分隔符
  normalized = normalized.split(path.sep).join(path.sep);

  // 去除末尾的分隔符（除非是根目录）
  if (normalized.length > 1 && (normalized.endsWith('/') || normalized.endsWith('\\'))) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * 转义 SQL LIKE 模式里的通配符，供 `... LIKE ? ESCAPE '\'` 使用。
 *
 * SQLite LIKE 把 `_`（任意单字符）和 `%`（任意多字符）当通配符；用文件夹路径做
 * 前缀匹配（`filepath LIKE prefix%`）时，路径里的 `_`/`%` 会被当成通配符，导致
 * 兄弟目录被误命中（例如前缀 `M:\gal_1\` 会匹配到 `M:\galA1\...`，`_` = 任意字符）。
 *
 * 用反斜杠 `\` 作为转义符，对 `\`、`%`、`_` 三者各加前缀 `\`（反斜杠须先转义自身，
 * 否则它会吞掉后面字符的转义语义）。调用方必须在 SQL 里配套写明 `ESCAPE '\'`。
 *
 * 注意：仅转义"参与匹配的字面前缀"；末尾通配 `%`（以及非递归模式里的 `sep%` 段）
 * 是有意保留的通配符，不要经过本函数。
 *
 * @param s 要作为字面量参与 LIKE 匹配的字符串（通常是 normalizePath 后的路径前缀）
 * @returns 转义后的字符串，可安全拼接末尾通配符
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, c => '\\' + c);
}

/**
 * 获取目录路径（去除文件名）
 * @param filePath 完整文件路径
 */
export function getDirectoryPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  const directory = path.dirname(normalized);
  return directory;
}

/**
 * 判断路径是否是子路径
 * @param parent 父路径
 * @param child 子路径
 */
export function isSubPath(parent: string, child: string): boolean {
  const normalizedParent = normalizePath(parent) + path.sep;
  const normalizedChild = normalizePath(child) + path.sep;
  return normalizedChild.startsWith(normalizedParent);
}

/**
 * 获取相对路径
 * @param from 源路径
 * @param to 目标路径
 */
export function getRelativePath(from: string, to: string): string {
  const normalizedFrom = normalizePath(from);
  const normalizedTo = normalizePath(to);
  const relative = path.relative(normalizedFrom, normalizedTo);
  return normalizePath(relative);
}

/**
 * 判断路径是否为绝对路径
 */
export function isAbsolutePath(filePath: string): boolean {
  return path.isAbsolute(filePath);
}

/**
 * 合并路径
 */
export function joinPaths(...paths: string[]): string {
  return normalizePath(path.join(...paths));
}

/**
 * 从URL或路径中提取扩展名
 * @param filePath URL或文件路径
 */
export function extractExtension(filePath: string): string {
  const basename = path.basename(filePath);
  const ext = path.extname(basename).toLowerCase();
  return ext;
}

/**
 * 从URL或路径中提取文件名（不含扩展名）
 * @param filePath URL或文件路径
 */
export function extractFilename(filePath: string): string {
  const basename = path.basename(filePath);
  const filename = path.basename(basename, path.extname(basename));
  return filename;
}

/**
 * 规范化多个路径
 * @param paths 路径数组
 */
export function normalizePaths(paths: string[]): string[] {
  return paths.map(p => normalizePath(p));
}
