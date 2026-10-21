import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMealText, lineGrams, unitGrams, searchName } from '../app/js/measures.js';

test('quick text entry splits items and reads quantities', () => {
  assert.deepEqual(parseMealText('2 jajka, kromka chleba i łyżka masła; 150g ryżu, pół banana, 1/2 szklanki mleka'), [
    { qty: 2, unit: 'szt', name: 'jajka' },
    { qty: 1, unit: 'kromka', name: 'chleba' },
    { qty: 1, unit: 'lyzka', name: 'masła' },
    { qty: 150, unit: 'g', name: 'ryżu' },
    { qty: 0.5, unit: 'szt', name: 'banana' },
    { qty: 0.5, unit: 'szklanka', name: 'mleka' },
  ]);
  assert.deepEqual(parseMealText('dwie kromki chleba żytniego'), [{ qty: 2, unit: 'kromka', name: 'chleba żytniego' }]);
  assert.deepEqual(parseMealText('200 g skyru'), [{ qty: 200, unit: 'g', name: 'skyru' }]);
});

test('household measures in grams', () => {
  assert.equal(lineGrams({ qty: 2, unit: 'szt', name: 'jajka' }, { name: 'Jajko kurze' }), 110);
  assert.equal(lineGrams({ qty: 2, unit: 'kromka', name: 'chleba' }, { name: 'Chleb żytni' }), 70);
  assert.equal(lineGrams({ qty: 1, unit: 'lyzka', name: 'oliwy' }, { name: 'Oliwa z oliwek' }), 10);
  assert.equal(lineGrams({ qty: 150, unit: 'g', name: 'ryżu' }, null), 150);
  assert.equal(unitGrams('szt', 'Ryż biały'), null);
  assert.equal(unitGrams('szt', 'Baton proteinowy XYZ', 45), 40);
  assert.equal(unitGrams('porcja', 'Cokolwiek', 30), 30);
});

test('search name is stemmed and drops measure words', () => {
  assert.equal(searchName('chleba żytniego'), 'chleb zytni');
  assert.equal(searchName('ryżu'), 'ryz');
});
