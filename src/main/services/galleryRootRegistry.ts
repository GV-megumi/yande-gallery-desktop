/**
 * 图库根路径登记表（进程内同步缓存）
 *
 * 为什么需要它：app:// 协议处理器对每个本地图片请求都要同步判定路径是否在受控根内
 * （见 index.ts getControlledAppProtocolRoots / resolveAppProtocolFilePath），
 * 不能每次请求都异步查 sqlite。因此用一个内存 Set 缓存所有图库的 folderPath，
 * 启动时由 init.ts 从 DB 装载（loadGalleryRoots），之后由 galleryService 在
 * 创建/删除图库时增量维护（addGalleryRoot / removeGalleryRoot）。
 *
 * 存入的字符串应与 DB galleries.folderPath 一致（均经 normalizePath 处理）；
 * index.ts 取出后会再过一遍 normalizeControlledRoot（resolve + win32 小写），
 * 归一化职责仍留在 index.ts，本登记表只负责"有哪些根"。
 */
const galleryRoots = new Set<string>();

/** 启动时整体装载（清空后写入），传入 DB 中所有图库的 folderPath */
export function loadGalleryRoots(paths: string[]): void {
  galleryRoots.clear();
  for (const p of paths) {
    if (p) {
      galleryRoots.add(p);
    }
  }
}

/** 新建图库后调用 */
export function addGalleryRoot(folderPath: string): void {
  if (folderPath) {
    galleryRoots.add(folderPath);
  }
}

/** 删除图库后调用 */
export function removeGalleryRoot(folderPath: string): void {
  if (folderPath) {
    galleryRoots.delete(folderPath);
  }
}

/** 同步读取当前所有图库根路径（返回副本） */
export function getGalleryRootsSnapshot(): string[] {
  return Array.from(galleryRoots);
}
