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

- `blok-1`: tygodnie 1–35 z trenerem (27 = Taper, 28 = Zawody)
- `blok-2`: „Tydzień 2.0”, tygodnie 1–3
- `solo`: „Tydzień SOLO”, tygodnie 1–2

## Uwagi do importu

- Excel zamienił część wpisów na daty (np. `7.5` kg → 5 lipca, `5-8` powt. → 8 maja). Importer to odwraca i oznacza pozycję w `importFlags`.
- Zakresy obciążeń i powtórzeń, których nie da się zamienić na liczbę (np. `16kg/20kg`, `6*2`, `30s`), trafiają do `loadText` / `repsText`.
- `percent1RM` jest liczony od 1RM z czasu danego tygodnia, więc `plannedKg` zostaje taki, jak w arkuszu.
- Zdrowie: kroki i aktywne kcal liczone per dzień z jednego źródła (tego z największą sumą), żeby iPhone i pierścień/zegarek się nie dublowały. Sen przypisany do dnia pobudki, nakładające się odcinki scalane.
