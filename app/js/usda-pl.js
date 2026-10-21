// Polish <-> English helpers for the USDA database, which only has English names.
// Queries are translated word by word before searching; result names are translated
// segment by segment (USDA names are comma-separated, e.g. "Chicken, breast, raw").

const PL_EN = {
  kurczak: 'chicken', kurczaka: 'chicken', kurczakiem: 'chicken', indyk: 'turkey', indyka: 'turkey',
  wołowina: 'beef', wołowe: 'beef', wieprzowina: 'pork', schab: 'pork loin', boczek: 'bacon', szynka: 'ham',
  pierś: 'breast', piersi: 'breast', udo: 'thigh', udko: 'drumstick', mielone: 'ground', mielona: 'ground', wątróbka: 'liver',
  łosoś: 'salmon', łososia: 'salmon', dorsz: 'cod', tuńczyk: 'tuna', makrela: 'mackerel', śledź: 'herring', krewetki: 'shrimp', pstrąg: 'trout', sardynki: 'sardines',
  jajko: 'egg', jajka: 'egg', jaja: 'egg', białko: 'white', żółtko: 'yolk',
  mleko: 'milk', jogurt: 'yogurt', ser: 'cheese', twaróg: 'cottage cheese', serek: 'cottage cheese', masło: 'butter', śmietana: 'sour cream', kefir: 'kefir', mozzarella: 'mozzarella', parmezan: 'parmesan',
  ryż: 'rice', makaron: 'pasta', kasza: 'groats', gryczana: 'buckwheat', jaglana: 'millet', jęczmienna: 'barley', kuskus: 'couscous', komosa: 'quinoa', quinoa: 'quinoa',
  płatki: 'oats', owsiane: 'oats', owsianka: 'oatmeal', chleb: 'bread', bułka: 'roll', mąka: 'flour', pełnoziarnisty: 'whole wheat', żytni: 'rye', tortilla: 'tortilla',
  ziemniak: 'potato', ziemniaki: 'potatoes', batat: 'sweet potato', bataty: 'sweet potato',
  brokuł: 'broccoli', brokuły: 'broccoli', kalafior: 'cauliflower', marchew: 'carrot', marchewka: 'carrot', pomidor: 'tomato', pomidory: 'tomatoes', ogórek: 'cucumber',
  papryka: 'pepper', cebula: 'onion', czosnek: 'garlic', szpinak: 'spinach', sałata: 'lettuce', kapusta: 'cabbage', cukinia: 'zucchini', bakłażan: 'eggplant', pieczarki: 'mushrooms', grzyby: 'mushrooms',
  fasola: 'beans', fasolka: 'green beans', groszek: 'peas', ciecierzyca: 'chickpeas', soczewica: 'lentils', kukurydza: 'corn', burak: 'beet', buraki: 'beets', dynia: 'pumpkin', awokado: 'avocado', tofu: 'tofu',
  jabłko: 'apple', jabłka: 'apple', banan: 'banana', banany: 'banana', pomarańcza: 'orange', truskawki: 'strawberries', borówki: 'blueberries', maliny: 'raspberries', winogrona: 'grapes', gruszka: 'pear', śliwka: 'plum', kiwi: 'kiwi', mango: 'mango', ananas: 'pineapple', arbuz: 'watermelon', cytryna: 'lemon', daktyle: 'dates', rodzynki: 'raisins',
  orzechy: 'nuts', włoskie: 'walnuts', laskowe: 'hazelnuts', migdały: 'almonds', nerkowce: 'cashew', arachidowe: 'peanuts', ziemne: 'peanuts', 'masło orzechowe': 'peanut butter', słonecznik: 'sunflower seeds', pestki: 'seeds', siemię: 'flaxseed', chia: 'chia',
  oliwa: 'olive oil', olej: 'oil', miód: 'honey', cukier: 'sugar', czekolada: 'chocolate', kakao: 'cocoa', dżem: 'jam',
  surowy: 'raw', surowa: 'raw', surowe: 'raw', gotowany: 'cooked', gotowana: 'cooked', gotowane: 'cooked', pieczony: 'roasted', pieczona: 'roasted', smażony: 'fried', suchy: 'dry', sucha: 'dry', suszone: 'dried', mrożone: 'frozen',
  grecki: 'greek', naturalny: 'plain', odtłuszczony: 'nonfat', biały: 'white', biała: 'white', brązowy: 'brown', czerwona: 'red', czerwony: 'red', zielony: 'green', chudy: 'lean', chuda: 'lean', 'z': '', 'i': '', 'w': '', 'bez': 'without',
};

const EN_PL = {
  chicken: 'kurczak', broiler: '', 'broilers or fryers': '', 'broiler or fryers': '', turkey: 'indyk', beef: 'wołowina', pork: 'wieprzowina', ham: 'szynka', bacon: 'boczek', lamb: 'jagnięcina', veal: 'cielęcina',
  breast: 'pierś', thigh: 'udo', drumstick: 'podudzie', wing: 'skrzydło', leg: 'noga', liver: 'wątróbka', ground: 'mielone', loin: 'schab', tenderloin: 'polędwica', steak: 'stek',
  'meat only': 'samo mięso', 'meat and skin': 'mięso ze skórą', skinless: 'bez skóry', boneless: 'bez kości', 'separable lean only': 'chude części', 'lean only': 'chude',
  fish: 'ryba', salmon: 'łosoś', atlantic: 'atlantycki', farmed: 'hodowlany', wild: 'dziki', cod: 'dorsz', tuna: 'tuńczyk', mackerel: 'makrela', herring: 'śledź', trout: 'pstrąg', sardine: 'sardynki', shrimp: 'krewetki', crustaceans: 'skorupiaki', mollusks: 'mięczaki',
  egg: 'jajko', eggs: 'jajka', whole: 'całe', white: 'białe', yolk: 'żółtko',
  milk: 'mleko', yogurt: 'jogurt', greek: 'grecki', plain: 'naturalny', cheese: 'ser', 'cottage cheese': 'serek wiejski', cottage: 'wiejski', butter: 'masło', cream: 'śmietana', 'sour cream': 'kwaśna śmietana', nonfat: 'odtłuszczony', lowfat: 'niskotłuszczowy', 'reduced fat': 'o obniżonej zawartości tłuszczu', fluid: 'płynne',
  rice: 'ryż', brown: 'brązowy', 'long-grain': 'długoziarnisty', 'medium-grain': 'średnioziarnisty', 'short-grain': 'krótkoziarnisty', enriched: 'wzbogacony', unenriched: 'niewzbogacony',
  pasta: 'makaron', spaghetti: 'spaghetti', noodles: 'makaron', oats: 'płatki owsiane', oat: 'owies', cereals: 'płatki', bread: 'chleb', 'whole-wheat': 'pełnoziarnisty', 'whole wheat': 'pełnoziarnisty', rye: 'żytni', flour: 'mąka', buckwheat: 'gryka', groats: 'kasza', millet: 'proso (kasza jaglana)', barley: 'jęczmień', couscous: 'kuskus', quinoa: 'komosa ryżowa', tortillas: 'tortille',
  potatoes: 'ziemniaki', potato: 'ziemniak', 'sweet potato': 'batat', 'sweet potatoes': 'bataty', 'flesh and skin': 'miąższ ze skórką',
  broccoli: 'brokuł', cauliflower: 'kalafior', carrots: 'marchew', carrot: 'marchew', tomatoes: 'pomidory', tomato: 'pomidor', 'red, ripe': 'czerwone, dojrzałe', cucumber: 'ogórek', 'with peel': 'ze skórką',
  peppers: 'papryka', sweet: 'słodka', red: 'czerwona', green: 'zielona', yellow: 'żółta', onions: 'cebula', garlic: 'czosnek', spinach: 'szpinak', lettuce: 'sałata', cabbage: 'kapusta', zucchini: 'cukinia', 'squash, summer, zucchini': 'cukinia', eggplant: 'bakłażan', mushrooms: 'pieczarki',
  beans: 'fasola', kidney: 'czerwona', black: 'czarna', 'snap': 'szparagowa', peas: 'groszek', chickpeas: 'ciecierzyca', 'chickpeas (garbanzo beans, bengal gram)': 'ciecierzyca', lentils: 'soczewica', corn: 'kukurydza', beets: 'buraki', pumpkin: 'dynia', avocados: 'awokado', tofu: 'tofu',
  apples: 'jabłka', apple: 'jabłko', bananas: 'banany', oranges: 'pomarańcze', strawberries: 'truskawki', blueberries: 'borówki', raspberries: 'maliny', grapes: 'winogrona', pears: 'gruszki', plums: 'śliwki', kiwifruit: 'kiwi', mangos: 'mango', pineapple: 'ananas', watermelon: 'arbuz', lemons: 'cytryny', dates: 'daktyle', raisins: 'rodzynki',
  nuts: 'orzechy', walnuts: 'orzechy włoskie', english: '', hazelnuts: 'orzechy laskowe', almonds: 'migdały', cashew: 'nerkowce', peanuts: 'orzeszki ziemne', 'peanut butter': 'masło orzechowe', seeds: 'nasiona', 'sunflower seed kernels': 'pestki słonecznika', flaxseed: 'siemię lniane', 'chia seeds': 'nasiona chia',
  oil: 'olej', 'olive': 'oliwa', 'salad or cooking': '', honey: 'miód', sugar: 'cukier', 'sugars': 'cukier', chocolate: 'czekolada', dark: 'gorzka', cocoa: 'kakao',
  raw: 'surowe', cooked: 'gotowane', boiled: 'gotowane', 'cooked, boiled': 'gotowane', roasted: 'pieczone', baked: 'pieczone', fried: 'smażone', grilled: 'grillowane', broiled: 'z grilla', braised: 'duszone', steamed: 'na parze', dry: 'suche', dried: 'suszone', frozen: 'mrożone', canned: 'z puszki', 'drained solids': 'odsączone', 'mature seeds': 'nasiona', 'without salt': 'bez soli', 'with salt': 'z solą', 'without skin': 'bez skóry', unprepared: 'nieprzygotowane', regular: 'zwykłe', 'all varieties': 'wszystkie odmiany', fresh: 'świeże', 'in water': 'w wodzie', 'light': 'jasny', 'smooth style': 'kremowe', 'chunk style': 'z kawałkami',
};

export function queryToEnglish(query) {
  let q = ` ${query.toLowerCase()} `;
  // Multi-word phrases first.
  for (const [pl, en] of Object.entries(PL_EN)) if (pl.includes(' ')) q = q.replaceAll(` ${pl} `, ` ${en} `);
  const words = q.trim().split(/\s+/).map((w) => (w in PL_EN ? PL_EN[w] : w)).filter(Boolean);
  return [...new Set(words)].join(' ');
}

export function nameToPolish(name) {
  const parts = name.split(/,\s*/).map((part) => {
    const lower = part.toLowerCase();
    if (lower in EN_PL) return EN_PL[lower];
    // Translate word by word, leaving unknown words as they are.
    return lower.split(/\s+/).map((w) => (w in EN_PL ? EN_PL[w] : w)).filter(Boolean).join(' ');
  }).filter(Boolean);
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
