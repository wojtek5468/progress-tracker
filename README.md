# Progress Tracker

Aplikacja (PWA na iPhone'a) do planowania treningów, diety i śledzenia postępów.
Wersja webowa jest pierwsza; model danych jest neutralny, żeby później przenieść go do SwiftUI.

## Aplikacja

Statyczna PWA w `app/` (HTML, CSS, moduły JS, bez kroku budowania). Dane trzymane w IndexedDB na telefonie, działa offline (service worker).

Podgląd lokalnie:

```sh
npx http-server app -p 8080
```

Instalacja na iPhonie: otwórz adres aplikacji w Safari → Udostępnij → „Do ekranu początkowego”, potem w aplikacji wybierz plik `seed.json`.

Ikony interfejsu: [Lucide](https://lucide.dev) (licencja ISC, `app/vendor/lucide/LICENSE`). Ikona aplikacji jest własna (`app/icons/icon.svg`).
Skaner kodów kreskowych: [ZXing](https://github.com/zxing-js/library) 0.21.3 (licencja Apache 2.0, `app/vendor/zxing/LICENSE`), wczytywany dopiero po stuknięciu „Skanuj”.

## Testy

Obliczenia (1RM, talerze, rozgrzewka, makro, trend wagi, wyszukiwanie, migracje danych) mają testy w `tests/`:

```sh
npm test
```

Działają na Node 22 bez instalowania zależności; GitHub uruchamia je przy każdym PR.

## Import danych z arkusza

```sh
pip install openpyxl
python3 tools/import_xlsx.py trening.xlsx data/seed.json --height <cm> --weight <kg>
```

Opcjonalnie dane z aplikacji Zdrowie (Zdrowie → zdjęcie profilu → Eksportuj wszystkie dane zdrowia):

```sh
python3 tools/import_health.py apple_health_export/eksport.xml data/seed.json
```

Wynik (`data/seed.json`) zawiera dane osobiste, dlatego `data/` jest w `.gitignore`.
Aplikacja wczytuje ten plik przez ekran importu i trzyma dane lokalnie na telefonie.

Opis formatu: [docs/data-model.md](docs/data-model.md).

## Polska baza produktów (offline)

Przy każdym wdrożeniu (i co poniedziałek) workflow `pages.yml` uruchamia `tools/build_off_pl.py`, który z eksportu
[Open Food Facts](https://world.openfoodfacts.org) wybiera produkty sprzedawane w Polsce (także marki własne sieci)
i zapisuje je w `app/data/off-pl.json`. Plik nie jest w repozytorium; buduje się na GitHubie i jest cache'owany przez tydzień.
Dane: Open Food Facts, licencja [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Zakładka „Ze sklepu” szuka najpierw w tym pliku
(offline), a gdy nic nie znajdzie, w API Open Food Facts.

Produkty dodane ręcznie (z kodem kreskowym) można z ekranu produktu wysłać do Open Food Facts z własnego, darmowego konta OFF.
Login zostaje w IndexedDB na telefonie i nie trafia do kopii zapasowej.
