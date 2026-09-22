import { describe, expect, it } from 'vitest';
import { OpeningBasmala } from '../../src/recitation/opening';
import { BASMALA } from '../../src/recitation/search';
import { costTable } from '../../src/recitation/phonemeCost';

const token = (sym: string, frame = 10) => ({ sym, frame, margin: .9 });
describe('optional opening boundary', () => {
  it('preserves the ayah onset even when it shares a token with the opening', () => {
    const opening = new OpeningBasmala(costTable());
    expect(opening.feed([token(BASMALA.slice(0, -1))])).toEqual({ tokens: [], opening: 'listening' });
    expect(opening.feed([token('مءَلِف', 20)])).toEqual({ tokens: [token('ءَلِف', 20)], opening: 'complete' });
    expect(opening.feed([token('لَاااااام')])).toEqual({ tokens: [token('لَاااااام')] });
  });

  it('replays a direct start unchanged and never removes later Bismillah words', () => {
    const opening = new OpeningBasmala(costTable());
    expect(opening.feed([token('ءَ')])).toEqual({ tokens: [] });
    expect(opening.feed([token('لِف', 20)])).toEqual({ tokens: [token('ءَ'), token('لِف', 20)] });
    expect(opening.feed([token(BASMALA)])).toEqual({ tokens: [token(BASMALA)] });
  });

  it('bounds the wait for a damaged or unfinished opening', () => {
    const opening = new OpeningBasmala(costTable());
    const damaged = token(BASMALA.slice(0, 15) + 'ق'.repeat(30));
    expect(opening.feed([damaged])).toEqual({ tokens: [damaged] });
  });
});
