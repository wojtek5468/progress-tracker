// Built-in recipes. Nutrition per 100 g comes from USDA FoodData Central (SR Legacy, public domain);
// the number after each ingredient is its FDC/NDB id so values can be checked. Whey and tortilla
// use typical label values because they vary by brand.

// id: [name, kcal, protein, fat, carbs, source]
const ING = {
  chicken: ['Pierś z kurczaka, surowa', 120, 22.5, 2.6, 0, 'USDA 05062'],
  cod: ['Dorsz, surowy', 82, 17.8, 0.7, 0, 'USDA 15015'],
  salmon: ['Łosoś, surowy', 208, 20.4, 13.4, 0, 'USDA 15236'],
  tuna: ['Tuńczyk w wodzie, odsączony', 116, 25.5, 0.8, 0, 'USDA 15121'],
  beef: ['Wołowina mielona 10% tł., surowa', 176, 20.0, 10.0, 0, 'USDA 23567'],
  egg: ['Jajko kurze', 143, 12.6, 9.5, 0.7, 'USDA 01123'],
  greek: ['Jogurt grecki/skyr 0%', 59, 10.2, 0.4, 3.6, 'USDA 01256'],
  cottage: ['Serek wiejski light', 81, 10.5, 2.3, 4.8, 'USDA 01016'],
  milk: ['Mleko 2%', 50, 3.3, 2.0, 4.8, 'USDA 01079'],
  feta: ['Feta', 264, 14.2, 21.3, 4.1, 'USDA 01019'],
  mozzarella: ['Mozzarella light', 254, 24.3, 15.9, 2.8, 'USDA 01028'],
  whey: ['Odżywka białkowa (whey)', 400, 78, 6, 8, 'typowa etykieta'],
  oats: ['Płatki owsiane', 379, 13.2, 6.5, 67.7, 'USDA 08120'],
  rice: ['Ryż biały, suchy', 365, 7.1, 0.7, 80.0, 'USDA 20444'],
  pasta: ['Makaron, suchy', 371, 13.0, 1.5, 74.7, 'USDA 20120'],
  buckwheat: ['Kasza gryczana, sucha', 343, 13.3, 3.4, 71.5, 'USDA 20008'],
  quinoa: ['Komosa ryżowa, sucha', 368, 14.1, 6.1, 64.2, 'USDA 20035'],
  bread: ['Chleb pełnoziarnisty', 252, 12.5, 3.5, 42.7, 'USDA 18075'],
  tortilla: ['Tortilla pszenna', 306, 8.2, 7.5, 50.0, 'typowa etykieta'],
  potato: ['Ziemniaki, surowe', 77, 2.0, 0.1, 17.5, 'USDA 11352'],
  sweetpotato: ['Batat, surowy', 86, 1.6, 0.1, 20.1, 'USDA 11507'],
  lentils: ['Soczewica czerwona, sucha', 358, 24.0, 2.2, 63.1, 'USDA 16070'],
  chickpeas: ['Ciecierzyca gotowana', 164, 8.9, 2.6, 27.4, 'USDA 16057'],
  broccoli: ['Brokuł', 34, 2.8, 0.4, 6.6, 'USDA 11090'],
  spinach: ['Szpinak', 23, 2.9, 0.4, 3.6, 'USDA 11457'],
  tomato: ['Pomidor', 18, 0.9, 0.2, 3.9, 'USDA 11529'],
  tomatocan: ['Pomidory krojone z puszki', 32, 1.6, 0.3, 7.3, 'USDA 11693'],
  cucumber: ['Ogórek', 15, 0.7, 0.1, 3.6, 'USDA 11205'],
  pepper: ['Papryka czerwona', 31, 1.0, 0.3, 6.0, 'USDA 11821'],
  onion: ['Cebula', 40, 1.1, 0.1, 9.3, 'USDA 11282'],
  lettuce: ['Sałata', 15, 1.4, 0.2, 2.9, 'USDA 11253'],
  avocado: ['Awokado', 160, 2.0, 14.7, 8.5, 'USDA 09037'],
  banana: ['Banan', 89, 1.1, 0.3, 22.8, 'USDA 09040'],
  blueberries: ['Borówki', 57, 0.7, 0.3, 14.5, 'USDA 09050'],
  apple: ['Jabłko', 52, 0.3, 0.2, 13.8, 'USDA 09003'],
  oil: ['Oliwa z oliwek', 884, 0, 100, 0, 'USDA 04053'],
  pb: ['Masło orzechowe', 588, 25.1, 50.4, 19.6, 'USDA 16098'],
  almonds: ['Migdały', 579, 21.2, 49.9, 21.6, 'USDA 12061'],
  chia: ['Nasiona chia', 486, 16.5, 30.7, 42.1, 'USDA 12006'],
  honey: ['Miód', 304, 0.3, 0, 82.4, 'USDA 19296'],
  soy: ['Sos sojowy', 53, 8.1, 0.6, 4.9, 'USDA 16124'],
};

export const INGREDIENTS = Object.fromEntries(Object.entries(ING).map(([id, [name, kcal, p, f, c, source]]) =>
  [id, { name, per100: { kcal, p, f, c }, source }]));

// meals: which meal of the day the recipe fits. items: [ingredientId, grams for the whole recipe].
const r = (id, name, meals, minutes, portions, items, steps) => ({ id, name, meals, minutes, portions, items, steps });

export const RECIPES = [
  r('owsianka-bialkowa', 'Owsianka białkowa z borówkami', ['breakfast'], 10, 1,
    [['oats', 60], ['milk', 200], ['whey', 25], ['blueberries', 100], ['almonds', 10]],
    ['Zagotuj płatki z mlekiem (3–4 min).', 'Zdejmij z ognia, wmieszaj odżywkę.', 'Posyp borówkami i posiekanymi migdałami.']),
  r('jajecznica-pomidory', 'Jajecznica z pomidorami na chlebie', ['breakfast', 'dinner'], 10, 1,
    [['egg', 150], ['tomato', 120], ['bread', 70], ['oil', 5]],
    ['Rozgrzej oliwę, wbij 3 jajka.', 'Mieszaj na małym ogniu do ścięcia.', 'Podawaj z pokrojonym pomidorem i 2 kromkami chleba.']),
  r('skyr-owoce', 'Skyr z owocami i masłem orzechowym', ['breakfast', 'snack'], 3, 1,
    [['greek', 250], ['banana', 100], ['blueberries', 80], ['pb', 15]],
    ['Przełóż skyr do miski.', 'Dodaj pokrojonego banana i borówki, polej masłem orzechowym.']),
  r('omlet-szpinak-feta', 'Omlet ze szpinakiem i fetą', ['breakfast', 'dinner'], 12, 1,
    [['egg', 150], ['spinach', 60], ['feta', 30], ['bread', 35], ['oil', 5]],
    ['Podsmaż szpinak na oliwie, aż zwiędnie.', 'Zalej roztrzepanymi jajkami, posyp fetą.', 'Smaż pod przykryciem 4–5 min. Podawaj z kromką chleba.']),
  r('kanapki-serek', 'Kanapki z serkiem wiejskim i warzywami', ['breakfast', 'dinner'], 5, 1,
    [['bread', 105], ['cottage', 150], ['cucumber', 80], ['pepper', 60]],
    ['Posmaruj 3 kromki serkiem wiejskim.', 'Ułóż pokrojony ogórek i paprykę, dopraw pieprzem.']),
  r('pudding-chia', 'Pudding chia na noc', ['breakfast', 'snack'], 5, 1,
    [['chia', 30], ['milk', 200], ['greek', 100], ['honey', 10], ['blueberries', 80]],
    ['Wymieszaj chia z mlekiem i miodem, odstaw na noc do lodówki.', 'Rano dodaj jogurt i owoce.']),
  r('kurczak-ryz-brokul', 'Kurczak z ryżem i brokułem', ['lunch', 'dinner'], 25, 2,
    [['chicken', 300], ['rice', 140], ['broccoli', 300], ['oil', 10], ['soy', 20]],
    ['Ugotuj ryż.', 'Kurczaka pokrój w kostkę, podsmaż na oliwie 6–8 min, dopraw.', 'Brokuła ugotuj na parze 5 min.', 'Wymieszaj z sosem sojowym i podziel na 2 porcje.']),
  r('losos-ziemniaki', 'Łosoś z ziemniakami i mizerią', ['lunch', 'dinner'], 30, 2,
    [['salmon', 250], ['potato', 500], ['cucumber', 200], ['greek', 100]],
    ['Ziemniaki ugotuj w osolonej wodzie (20 min).', 'Łososia piecz 15 min w 200°C.', 'Ogórka zetrzyj lub pokrój w plasterki, wymieszaj z jogurtem, solą i koperkiem.']),
  r('spaghetti-bolognese', 'Spaghetti bolognese', ['lunch', 'dinner'], 30, 3,
    [['pasta', 240], ['beef', 400], ['tomatocan', 400], ['onion', 100], ['oil', 10]],
    ['Cebulę zeszklij na oliwie, dodaj mięso i smaż do zbrązowienia.', 'Dodaj pomidory, przyprawy (oregano, bazylia, czosnek) i duś 15 min.', 'Ugotuj makaron al dente, podziel na 3 porcje.']),
  r('dal-soczewica', 'Dal z czerwonej soczewicy z ryżem', ['lunch', 'dinner'], 30, 3,
    [['lentils', 200], ['tomatocan', 400], ['onion', 100], ['spinach', 100], ['rice', 150], ['oil', 15]],
    ['Cebulę podsmaż na oliwie z curry, kuminem i czosnkiem.', 'Dodaj soczewicę, pomidory i 600 ml wody, gotuj 15–20 min.', 'Na koniec wmieszaj szpinak. Podawaj z ryżem.']),
  r('tortilla-kurczak', 'Tortilla z kurczakiem i warzywami', ['lunch', 'dinner'], 20, 2,
    [['tortilla', 120], ['chicken', 250], ['pepper', 150], ['lettuce', 60], ['greek', 80], ['oil', 5]],
    ['Kurczaka pokrój w paski i usmaż z papryką na oliwie (przyprawa do fajitas).', 'Jogurt dopraw czosnkiem i solą.', 'Nałóż na 2 tortille z sałatą, sosem i zawiń.']),
  r('dorsz-kasza', 'Dorsz z kaszą gryczaną i szpinakiem', ['lunch', 'dinner'], 25, 2,
    [['cod', 300], ['buckwheat', 120], ['spinach', 150], ['oil', 10]],
    ['Ugotuj kaszę.', 'Dorsza dopraw i usmaż na oliwie po 3–4 min z każdej strony.', 'Szpinak podsmaż z czosnkiem.']),
  r('bowl-quinoa', 'Bowl z komosą, ciecierzycą i awokado', ['lunch'], 20, 2,
    [['quinoa', 120], ['chickpeas', 240], ['avocado', 140], ['tomato', 200], ['cucumber', 150], ['feta', 60]],
    ['Ugotuj komosę (ok. 15 min) i ostudź.', 'Pokrój warzywa i awokado.', 'Ułóż wszystko w miskach, dopraw cytryną, solą i pieprzem.']),
  r('salatka-tunczyk', 'Sałatka z tuńczykiem i jajkiem', ['lunch', 'dinner'], 15, 1,
    [['tuna', 120], ['egg', 100], ['lettuce', 100], ['tomato', 150], ['cucumber', 100], ['oil', 10], ['bread', 35]],
    ['Ugotuj jajka na twardo (9 min).', 'Pokrój warzywa, dodaj odsączonego tuńczyka i jajka.', 'Polej oliwą, dopraw. Podawaj z kromką chleba.']),
  r('kurczak-bataty', 'Kurczak z pieczonymi batatami', ['lunch', 'dinner'], 40, 2,
    [['chicken', 300], ['sweetpotato', 400], ['broccoli', 250], ['oil', 15]],
    ['Bataty pokrój w kostkę, wymieszaj z połową oliwy i przyprawami, piecz 30 min w 200°C.', 'Kurczaka piecz razem z batatami przez ostatnie 20 min.', 'Brokuła ugotuj na parze.']),
  r('makaron-kurczak-szpinak', 'Makaron z kurczakiem i szpinakiem', ['lunch', 'dinner'], 20, 2,
    [['pasta', 160], ['chicken', 250], ['spinach', 150], ['mozzarella', 60], ['tomato', 150], ['oil', 10]],
    ['Ugotuj makaron.', 'Kurczaka usmaż na oliwie, dodaj pomidory i szpinak, duś 3 min.', 'Wymieszaj z makaronem i posyp startą mozzarellą.']),
  r('shake-banan', 'Shake białkowy z bananem', ['snack', 'breakfast'], 3, 1,
    [['milk', 300], ['whey', 30], ['banana', 120], ['oats', 30]],
    ['Zmiksuj wszystko w blenderze na gładko.']),
  r('jablko-pb', 'Jabłko z masłem orzechowym', ['snack'], 2, 1,
    [['apple', 180], ['pb', 20]],
    ['Pokrój jabłko w ćwiartki i podawaj z masłem orzechowym.']),
  r('serek-miod', 'Serek wiejski z miodem i orzechami', ['snack', 'dinner'], 2, 1,
    [['cottage', 200], ['honey', 10], ['almonds', 15]],
    ['Przełóż serek do miski, polej miodem, posyp migdałami.']),
];

export function recipeTotals(recipe) {
  const t = { kcal: 0, p: 0, f: 0, c: 0, grams: 0 };
  for (const [id, g] of recipe.items) {
    const n = INGREDIENTS[id].per100;
    t.kcal += n.kcal * g / 100; t.p += n.p * g / 100; t.f += n.f * g / 100; t.c += n.c * g / 100; t.grams += g;
  }
  return t;
}

// Raw ingredient weights; cooking changes water content but not the totals per portion.
export function recipePer100(recipe) {
  const t = recipeTotals(recipe);
  const k = 100 / t.grams;
  const r1 = (x) => Math.round(x * k * 10) / 10;
  return { per100: { kcal: Math.round(t.kcal * k), p: r1(t.p), f: r1(t.f), c: r1(t.c) }, portionG: Math.round(t.grams / recipe.portions) };
}
