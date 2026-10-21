# Wyszukiwanie produktów po nazwie (Cloudflare Worker)

Wyszukiwarka Open Food Facts nie pozwala na zapytania z przeglądarki (brak nagłówków CORS).
Ten mały pośrednik dokłada je dla adresu aplikacji i trzyma odpowiedzi przez dobę.
Darmowy plan Cloudflare: 100 000 zapytań dziennie, bez karty.

## Wdrożenie (ok. 5 minut, w przeglądarce)

1. Załóż darmowe konto na https://dash.cloudflare.com/sign-up.
2. Wejdź w **Workers & Pages → Create → Create Worker** (szablon „Hello World”),
   nazwij go `off-search` i kliknij **Deploy**.
3. Kliknij **Edit code**, zastąp całą treść zawartością `worker.js` i kliknij **Deploy**.
4. Skopiuj adres workera, np. `https://off-search.twoja-nazwa.workers.dev`.
5. Wpisz go w `app/js/foods-api.js` w stałej `OFF_SEARCH_PROXY` (albo podaj go Claude'owi).

Test: `https://off-search.twoja-nazwa.workers.dev/search?q=skyr&page_size=1` powinien zwrócić JSON.

Jeśli aplikacja zmieni adres, dopisz go do `ALLOWED_ORIGINS` w `worker.js`.
