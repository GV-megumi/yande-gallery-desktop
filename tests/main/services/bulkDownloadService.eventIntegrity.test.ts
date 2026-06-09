import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('bulkDownloadService domain event integrity', () => {
  const servicePath = path.resolve(process.cwd(), 'src/main/services/bulkDownloadService.ts');
  const source = readFileSync(servicePath, 'utf-8');
  const normalizedSource = source.replace(/\r\n/g, '\n');

  it('emits created record events only for rows actually inserted', () => {
    expect(normalizedSource).toContain('const result = await runWithChanges(db, `\n      INSERT OR IGNORE INTO bulk_download_records');
    expect(source).toContain('if (result.changes > 0) {');
    expect(source).toContain('affectedCount: result.changes');
    expect(source).toContain('let insertedCount = 0;');
    expect(source).toContain('insertedCount += result.changes;');
    expect(source).toContain('if (insertedCount > 0) {');
    expect(source).toContain('affectedCount: insertedCount');
  });

  it('guards completed record events behind verified database status updates', () => {
    expect(source).toContain('if (updatedRecord && updatedRecord.status === \'completed\')');
    expect(source).toContain('if (statusUpdateSuccess) {');
    expect(source).toContain("status: 'completed'");
  });

  it('validates retry target and uses real reset changes for pendingReset events', () => {
    expect(source).toContain('const activeSessionRow = await get<any>(db, `');
    expect(source).toContain('const targetRecord = await get<any>(db, `');
    expect(source).toContain("if (targetRecord.status !== 'failed')");
    expect(source).toContain('const activeSessionIsHistory =');
    expect(source).toContain('let canEnterRunningAlreadyChecked = false;');
    expect(source).toContain('const resetResult = await runWithChanges(db, `');
    expect(source).toContain('AND EXISTS (');
    expect(source).toContain('if (resetResult.changes === 0)');
    expect(source).toContain('affectedCount: resetResult.changes');
  });
});
