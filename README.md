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
