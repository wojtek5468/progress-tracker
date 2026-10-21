# Model danych (schemaVersion 2)

Jeden plik JSON. Ten sam kształt będzie przechowywany w IndexedDB w PWA, a później zmapowany 1:1 na modele SwiftData.
Pola puste są pomijane. Jednostki: kg, cm, sekundy, minuty snu, daty ISO `YYYY-MM-DD`.

| Klucz | Zawartość | Źródło w arkuszu |
|---|---|---|
| `profile` | `heightCm`, `weightKg`, `birthDate`, `birthYear`, `sex`, `activityLevel` | Cele (+ `--height`/`--weight`), Zdrowie |
| `goals` | `focus[]` (np. zdrowie, mobilność) i `details{}` (konkretne cele per obszar) | Cele |
| `nutrition.legacyTargets` | kcal i makro z arkusza (liczone dla wagi z arkusza, do przeliczenia) | Cele |
| `nutrition.targets` | `maintenanceKcal`, `reductionKcal`, `proteinG`, `fatG`, `carbsG`, `bmrKcal`, `avgActiveKcal`, `avgSteps`, `method` | wyliczone z profilu i Zdrowia |
| `nutrition.products[]` | `{group, items[]}`: co jeść, czego unikać | Dieta produkty |
| `tips[]` | `{section, items[]}` | Wskazówki |
| `warmupTemplates[]` | `{name, items[{order, name, dose, sets}]}` | Rozgrzewka |
| `exercises[]` | `{id, name, uses}`; `id` to slug, nazwy głównych bojów ujednolicone (np. Back SQ/Back squad → Back squat) | wszystkie tygodnie |
| `oneRepMaxes[]` | `{exerciseId, date, weightKg, reps, estimated1RM, source}` | MAX |
| `programs[]` | `{id, name, weeks[]}`; tydzień: `{id, number, label, sourceSheet, sessions[]}` | arkusze tygodni |
| sesja | `{order, blocks[{type: warmup/main/cooldown, items[]}]}`; kolejne pozycje z tym samym `group` to superseria | |
| pozycja planu | `exerciseId, percent1RM (0–1), rir, plannedKg, actualKg, loadText, reps, repsText, sets, tempo, restSec, notes, importFlags` | |
| `dailyLogs[]` | `{date, steps, sleepMin, restingHr, activeKcal, training, kcal}` | Pomiary, Zdrowie |
| `bodyMeasurements[]` | `{date, weightKg, bodyFatPct, leanMassKg}` | Zdrowie |
| `healthWorkouts[]` | `{start, type, durationMin, activeKcal, source}` | Zdrowie |
| `ptSessions[]` | `{card, sessionDates[]}` | Karty treningowe |
| `workoutLogs[]` | wykonane treningi zapisywane w aplikacji: `{id, date, sessionKey, title, durationMin, volumeKg, records[], entries[{exerciseId, note, sets[{kg, reps, rir, warmup}]}]}`; serie z `warmup: true` to rozgrzewka (nie liczą się do objętości ani rekordów) | — |
| `foods[]` | zapisane produkty `{id, source (custom/off/usda/basic/recipe), code, name, brand, per100{kcal,p,f,c}, servingG, lastUsed, favorite}` | — |

## Programy

- `blok-1` („Cykl roczny (35 tyg.)”): tygodnie 1–35 z trenerem (27 = Taper, 28 = Zawody)
- `blok-2` („Powrót do siły (3 tyg.)”): arkusze „Tydzień 2.0”, tygodnie 1–3
- `solo` („Siła + kondycja (2 tyg.)”): arkusze „Tydzień SOLO”, tygodnie 1–2

Aplikacja zmienia stare nazwy („Blok 1 (z trenerem)”, „Blok 2.0”, „SOLO”) na powyższe przy wczytaniu, jeśli nie zostały zmienione ręcznie.

### Gotowe plany z cyklu trenerskiego

`tools/export_templates.py` tnie te programy na fazy i zapisuje je w `app/js/plan-templates-coach.js` jako anonimowe gotowe plany: zostają tylko ćwiczenia, serie, powtórzenia, %1RM, RIR, tempo i przerwy. Kilogramy, notatki, daty i wyniki nie trafiają do repozytorium.

```sh
python3 tools/export_templates.py data/seed.json app/js/plan-templates-coach.js
```

## Uwagi do importu

- Excel zamienił część wpisów na daty (np. `7.5` kg → 5 lipca, `5-8` powt. → 8 maja). Importer to odwraca i oznacza pozycję w `importFlags`.
- Zakresy obciążeń i powtórzeń, których nie da się zamienić na liczbę (np. `16kg/20kg`, `6*2`, `30s`), trafiają do `loadText` / `repsText`.
- `percent1RM` jest liczony od 1RM z czasu danego tygodnia, więc `plannedKg` zostaje taki, jak w arkuszu.
- Zdrowie: kroki i aktywne kcal liczone per dzień z jednego źródła (tego z największą sumą), żeby iPhone i pierścień/zegarek się nie dublowały. Sen przypisany do dnia pobudki, nakładające się odcinki scalane.

## Diet diary (added in the app, not in the seed)

| Field | Shape | Notes |
|---|---|---|
| `foods` | `[{id, name, brand, source: 'off'\|'usda'\|'custom'\|'recipe', code, per100: {kcal, p, f, c}, servingG, lastUsed}]` | Products the user picked from Open Food Facts / USDA, created by hand, or built-in recipes added to the diary. |
| `mealTemplates` | `[{id, name, items: [{foodId, grams}]}]` | "Zapisz jako posiłek": a saved set of products added in one tap. |
| `foodLog` | `{ 'YYYY-MM-DD': [{id, meal: 'breakfast'\|'lunch'\|'dinner'\|'snack', foodId, grams}] }` | Macros are computed from the product at read time, so editing a product updates past entries. |
| `dailyLogs[].steps`, `.activeKcal` | numbers | Also written by manual entry or the iOS Shortcut paste (`kroki=… kcal=…`). |
| `settings.stepsGoal`, `settings.usdaKey`, `settings.foodTab`, `settings.templateAudience` | | Daily step goal (default 8000), optional personal USDA API key, last used tab in the add-food screen, last ready-made plan filter (`all`/`women`/`men`). |
| `profile.tdeeMode` | `'formula'` (default) \| `'adaptive'` | `adaptive`: maintenance kcal comes from the food diary and the slope of weigh-ins over the last 28 days (needs 14+ days of data). |
| `workoutLogs[].entries[]` | `{exerciseId, sets: [{kg, reps, rir?}], note?}` | RIR per set and a note per exercise are optional. Workouts started without a plan have `sessionKey: 'free'`. |
| `foodLog[date][]` quick entry | `{id, meal, quick: {name, kcal, p, f, c}}` | "Szybki wpis": calories without a product; no `foodId`/`grams`. |
| `bodyMeasurements[]` tape | `waistCm, hipsCm, chestCm, armCm, thighCm` | One row per day; weight and tape values are merged into it. |
| `foods[].code` | | For custom products created after a failed barcode scan, the scanned EAN. |
| `oneRepMaxes[].source` | `'trening'` \| `'ręcznie'` \| sheet | Records are now saved for every exercise (sets up to 10 reps), and can be entered by hand on the exercise screen. |
| `dailyLogs[].sleepMin`, `.restingHr` | | Also written by the Shortcut paste (`sen=7,2 tetno=58`); `waga=`/`tluszcz=` go to `bodyMeasurements`. |

Programs copied from ready-made plans (`app/js/plan-templates.js`) carry `templateId`. Templates have `audience` (`all`/`women`/`men`); coach templates carry full `weeks` instead of a 4-week RIR progression.

## Wersje

Aplikacja wczytuje pliki z wersją równą lub starszą od swojej i podnosi je krokami z `app/js/migrate.js`.
Plik z nowszej wersji jest odrzucany, żeby stara kopia aplikacji nie zgubiła pól, których nie zna.
`tools/import_xlsx.py` nadal tworzy wersję 1; aplikacja sama ją zaktualizuje.

- 1 → 2: jedno wyszukiwanie produktów (usunięte `settings.foodTab`), nowe opcjonalne pola `warmup` w seriach i `favorite` w produktach.

Pola dodane w wersji 2 bez migracji (opcjonalne): `profile.goalWeightKg`, `profile.goalDate`, `profile.carbCycling`, `profile.trainingDays[]` (1 = poniedziałek),
`settings.lastReviewDate`, `settings.autoProgression`, `settings.restSound`, `settings.barKg`, `settings.plates[]`, `workoutLogs[].importKey` (trening z Hevy/Strong), pozycja planu `group` (superseria).

Pola dodane później w wersji 2, też opcjonalne i bez migracji:

| Pole | Kształt | Uwagi |
|---|---|---|
| `workoutLogs[].cardio` | `{type, minutes, km?, avgHr?, kcal}` | Cardio wpisane w aplikacji: `entries: []`, `volumeKg: 0`. Kcal z MET: (MET−1) × kg × h. |
| `settings.pain` | `{ [exerciseId]: {note, since} }` | „Boli”: przy nowym treningu ćwiczenie jest zamieniane na podobne (`swappedFor` w szkicu). |
| `settings.equipment[]` | nazwy z `EQUIPMENT` | Pusty = pełna siłownia. Zamiany i gotowe plany biorą pod uwagę tylko ten sprzęt; pozycja planu po zamianie ma `swappedFrom`. |
| `settings.trendOnly` | bool | Pokazuje tylko wygładzony trend wagi. |
| `recipes[]` | `{id, name, portions, minutes, meals[], items: [{key, name, grams, per100}], steps[]}` | Własne przepisy; `key` to `source:code` produktu, a `per100` jest kopią, więc przepis nie zależy od listy produktów. |
| `mealPlan` | `{ 'YYYY-MM-DD': [{id, meal, recipeId, portions}] }` | Jadłospis; `settings.shoppingChecked` = odhaczone pozycje listy zakupów (`tydzień|key`). |
| `dailyLogs[].waterMl` | number | Woda; cel `settings.waterGoalMl` albo 35 ml/kg. |
| `foods[].per100.fib`, `.sug`, `.sat`, `.salt` | g na 100 g | Błonnik, cukry, tłuszcze nasycone, sól (z OFF, USDA albo wpisane). |
| `foods[].pricePerKg`, `foods[].uses` | | Cena do kosztu dnia i białka za złotówkę; licznik użyć do kolejności podpowiedzi. |
| `profile.weeklyBudget`, `settings.mealTargets` | bool | Budżet tygodnia (±15% dziennie); cel kalorii przy posiłkach (domyślnie włączony). |
| `challenges[]` | `{id, kind: 'steps'\|'protein'\|'water'\|'log'\|'workouts', target, days, start, name, from?}` | Wyzwania z linku; postęp liczony z danych na telefonie. |
| `settings.cloudUrl`, `settings.reminders`, `settings.reportName` | | Adres własnego Workera, przypomnienia `{workout\|weigh\|food: {on, time}}`, imię w raporcie i zaproszeniach. |

Poza `data` (osobne klucze IndexedDB, nie trafiają do kopii ani synchronizacji): `photos` (zdjęcia sylwetki jako JPEG),
`sync` (identyfikator skrytki, token i klucz synchronizacji), `reminders` (lista dla service workera), `offAccount`, `draft`.
