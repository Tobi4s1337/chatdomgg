import { describe, expect, it } from 'vitest';
import { createPassportHttp } from './http';
import { createPassportReader } from './read';
import { simulatedPassportAuthorities } from './simulated';

const sim = simulatedPassportAuthorities('few', { signedIn: true, travelsHidden: false });
const http = createPassportHttp({
  reader: createPassportReader(sim.ports), clock: () => sim.now, origins: ['https://chatdom.gg'],
  subject: async request => (new URL(request.url).pathname === '/c/pellam_rook/passport' ? sim.key : null),
});
const post = (body: string, init: { path?: string; origin?: string; type?: string } = {}) => http.handle(new Request(`https://chatdom.gg${init.path ?? '/c/pellam_rook/passport'}`, {
  method: 'POST', body, headers: { 'content-type': init.type ?? 'application/json', ...(init.origin ? { origin: init.origin } : {}) },
}));

describe('the passport over HTTP', () => {
  it('answers a book read for the card the path names, never cached', async () => {
    const response = await post('{"op":"book"}', { origin: 'https://chatdom.gg' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).book.holder.name).toBe('Pellam Rook');
  });

  it('refuses other origins, other methods, a subject in the body and unknown cards', async () => {
    expect((await post('{"op":"book"}', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await http.handle(new Request('https://chatdom.gg/c/pellam_rook/passport'))).status).toBe(405);
    expect((await post('{"op":"book","personId":"930000003"}')).status).toBe(400);
    expect((await post('{"op":"book"}', { type: 'text/plain' })).status).toBe(415);
    expect((await post('{"op":"book"}', { path: '/c/nobody/passport' })).status).toBe(404);
    expect((await post('x'.repeat(4096))).status).toBe(413);
  });
});
