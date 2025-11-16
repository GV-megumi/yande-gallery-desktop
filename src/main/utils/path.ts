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
