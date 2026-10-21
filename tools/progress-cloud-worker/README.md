# Synchronizacja, nowy telefon i przypomnienia (Cloudflare Worker)

Jeden mały serwer dla trzech opcjonalnych funkcji aplikacji:

- **synchronizacja** między urządzeniami: dane są szyfrowane na telefonie (AES-GCM, klucz z hasła
  przez PBKDF2), serwer trzyma tylko zaszyfrowane bajty i nie zna hasła;
- **przeniesienie na nowy telefon** kodem QR: zaszyfrowana paczka leży na serwerze maks. godzinę
  i znika po pierwszym odczycie;
- **przypomnienia push** (trening, ważenie, posiłki): serwer zna tylko adres powiadomień i godziny,
  wysyła puste powiadomienie, a treść podstawia telefon.

Darmowy plan Cloudflare wystarcza (KV: 1 GB, 100 000 odczytów i 1000 zapisów dziennie; cron).
Aplikacja wysyła zmiany najwyżej raz na minutę po ostatniej edycji, więc limit zapisów jest daleko.

## Wdrożenie (ok. 10 minut, w przeglądarce)

1. Zaloguj się na https://dash.cloudflare.com (to samo konto co dla `off-search`).
2. **Storage & Databases → KV → Create** i nazwij przestrzeń `progress-cloud`.
3. **Workers & Pages → Create → Create Worker**, nazwa `progress-cloud`, **Deploy**.
4. **Edit code**, zastąp całą treść zawartością `worker.js`, **Deploy**.
5. W workerze: **Settings → Bindings → Add → KV namespace**, nazwa zmiennej `CLOUD`,
   przestrzeń `progress-cloud`, zapisz.
6. **Settings → Trigger events → Add → Cron trigger**, wyrażenie `*/15 * * * *`, zapisz.
   (Bez tego synchronizacja i przenoszenie działają, a przypomnienia nie.)
7. Skopiuj adres workera, np. `https://progress-cloud.twoja-nazwa.workers.dev`, i wpisz go w
   aplikacji: **Ustawienia → Synchronizacja, nowy telefon, przypomnienia → Adres serwera**
   (albo podaj go Claude'owi, żeby wpisał go na stałe w `app/js/cloud.js`, stała `CLOUD_URL`).

Test: `https://progress-cloud.twoja-nazwa.workers.dev/push/key` zwraca `{"key":"..."}`
(klucz VAPID worker tworzy sam przy pierwszym użyciu i trzyma w KV).

Jeśli aplikacja zmieni adres, dopisz go do `ALLOWED_ORIGINS` w `worker.js`.

## Prywatność

- Hasło synchronizacji nie opuszcza telefonu. Z hasła powstają trzy rzeczy: identyfikator skrytki,
  token zapisu (serwer trzyma tylko jego skrót) i klucz szyfrujący. Bez hasła danych nie da się odczytać,
  także po stronie Cloudflare.
- Zdjęcia sylwetki nie są synchronizowane ani przenoszone.
- Testy: `npm test` (plik `tests/cloud.test.js` uruchamia worker z KV w pamięci).
