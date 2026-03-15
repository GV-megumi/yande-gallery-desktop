export function canOpenWikiTitleQuery(query: string): boolean {
  const trimmed = query.trim();

  if (!trimmed) {
    return false;
  }

  if (/\s/.test(trimmed)) {
    return false;
  }

  if (trimmed.includes(':')) {
    return false;
  }

  if (trimmed.startsWith('-') || trimmed.startsWith('~')) {
    return false;
  }

  return true;
}
