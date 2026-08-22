import { describe, expect, it } from 'vitest';
import { contentDisposition } from './object-storage.js';

describe('contentDisposition', () => {
  it('always downloads as an attachment, with a safe ASCII fallback and the exact UTF-8 name', () => {
    expect(contentDisposition('report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    const tricky = contentDisposition('résumé "final"\r\nX-Evil: 1.pdf');
    expect(tricky.startsWith('attachment; filename="r_sum_ _final___X-Evil: 1.pdf"')).toBe(true);
    expect(tricky).not.toMatch(/[\r\n]/);
    expect(tricky).toContain(encodeURIComponent('résumé'));
  });
});
