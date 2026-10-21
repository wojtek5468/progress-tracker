import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, queryWords, matchScore, rankByText } from '../app/js/search.js';

test('fold drops Polish diacritics', () => {
  assert.equal(fold('Żółty ser ŁOSOŚ'), 'zolty ser losos');
});

test('long words match other Polish endings', () => {
  assert.deepEqual(queryWords('jajka Pomidory ser'), ['jajk', 'pomidor', 'ser']);
  assert.ok(matchScore(fold('Jajko kurze'), queryWords('jajka')) > 0);
});

test('every word must match', () => {
  assert.equal(matchScore(fold('Jogurt naturalny Pilos'), queryWords('jogurt grecki')), 0);
  assert.ok(matchScore(fold('Jogurt naturalny Pilos'), queryWords('pilos jogurt')) > 0);
});

test('names starting with the query rank first', () => {
  const items = ['Sok z pomarańczy', 'Pomarańcza', 'Czekolada z pomarańczą'];
  assert.deepEqual(rankByText(items, 'pomarancza', (x) => x), ['Pomarańcza', 'Sok z pomarańczy', 'Czekolada z pomarańczą']);
});

test('empty query finds nothing', () => {
  assert.deepEqual(rankByText(['a'], '  ', (x) => x), []);
});
