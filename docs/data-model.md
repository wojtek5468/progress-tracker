# Model danych (schemaVersion 1)

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
| sesja | `{order, blocks[{type: warmup/main/cooldown, items[]}]}` | |
| pozycja planu | `exerciseId, percent1RM (0–1), rir, plannedKg, actualKg, loadText, reps, repsText, sets, tempo, restSec, notes, importFlags` | |
| `dailyLogs[]` | `{date, steps, sleepMin, restingHr, activeKcal, training, kcal}` | Pomiary, Zdrowie |
| `bodyMeasurements[]` | `{date, weightKg, bodyFatPct, leanMassKg}` | Zdrowie |
| `healthWorkouts[]` | `{start, type, durationMin, activeKcal, source}` | Zdrowie |
| `ptSessions[]` | `{card, sessionDates[]}` | Karty treningowe |
| `workoutLogs[]` | wykonane treningi zapisywane w aplikacji (krok 3) | — |

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
| `foods[].code` | | For custom products created after a failed barcode scan, the scanned EAN. |
| `oneRepMaxes[].source` | `'trening'` \| `'ręcznie'` \| sheet | Records are now saved for every exercise (sets up to 10 reps), and can be entered by hand on the exercise screen. |
| `dailyLogs[].sleepMin`, `.restingHr` | | Also written by the Shortcut paste (`sen=7,2 tetno=58`); `waga=`/`tluszcz=` go to `bodyMeasurements`. |

Programs copied from ready-made plans (`app/js/plan-templates.js`) carry `templateId`. Templates have `audience` (`all`/`women`/`men`); coach templates carry full `weeks` instead of a 4-week RIR progression.
