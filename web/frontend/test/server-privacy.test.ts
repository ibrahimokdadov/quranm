import { describe, expect, it } from 'vitest';
import { app } from '../server/app';

describe('public server privacy boundary', () => {
  it.each(['/api/reports', '/api/reports/example/audio', '/api/diagnostics', '/api/diagnostics/example/audio', '/admin', '/admin/login', '/storage/reports/example/audio.wav'])('does not expose or accept private data at %s', async path => {
    for (const method of ['GET', 'POST']) {
      const response = await app.request(path, { method, headers: { Cookie: 'admin_auth=1' } });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Not found' });
    }
  });
  it('serves health with privacy and model isolation headers', async () => {
    const response = await app.request('/api/health');
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
  });
});
