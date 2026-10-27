// Screens for the optional cloud features (sync, phone transfer, reminders) and the report
// for a coach or dietitian.

import { icon } from './icons.js';
import qrcode from '../vendor/qrcode/qrcode.mjs';
import { scanBarcode } from './scanner.js';
import {
  cloudUrl, syncState, enableSync, disableSync, syncNow, adoptRemote, describe, sendTransfer, receiveTransfer, replaceData,
  REMINDERS, pushSupported, startAutoSync, reminderList, savePush, testPush,
} from './cloud.js';
import { encodeData, decodeData } from './importers.js';
import { weightTrend, defaultTrainingDays } from './nutrition.js';
import { e1rmHistory } from './training-plus.js';
import {
  data, esc, fmt, render, save, todayIso, shiftDate, dateLabel, view, sumMacros, targetsFor, weightPoints, exName, avg, currentWeek,
} from './core.js';

const syncLabel = { pushed: 'Wysłano zmiany.', pulled: 'Pobrano zmiany z innego urządzenia.', same: 'Wszystko aktualne.' };
const ago = (iso) => (iso ? new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jeszcze nie');

export async function viewCloud() {
  const s = await syncState();
  const st = data.settings;
  const rem = st.reminders ?? {};
  const url = cloudUrl();
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  render('Synchronizacja i przypomnienia', `
    <div class="section-title">Serwer</div>
    <div class="list form">
      <label class="row stacked"><span>Adres serwera (Cloudflare Worker, instrukcja w tools/progress-cloud-worker)</span>
        <input id="cloud-url" value="${esc(st.cloudUrl ?? '')}" placeholder="${esc(url || 'https://progress-cloud.twoja-nazwa.workers.dev')}" autocomplete="off" inputmode="url"></label>
    </div>
    ${url ? '' : '<p class="muted small" style="margin:0 4px 12px">Bez serwera aplikacja działa normalnie, wszystko zostaje na telefonie. Serwer jest potrzebny tylko do funkcji poniżej.</p>'}

    <div class="section-title">Synchronizacja (szyfrowana)</div>
    <div class="card">
      ${s ? `<p>${icon('lock', 'icon-xs')} Włączona. Ostatnio: ${ago(s.syncedAt)}${s.dirty ? ' · są niewysłane zmiany' : ''}</p>
        <div class="actions"><button type="button" class="btn" id="sync-now" ${url ? '' : 'disabled'}>${icon('refresh-cw', 'icon-sm')} Synchronizuj teraz</button>
        <button type="button" class="btn secondary" id="sync-off">Wyłącz</button></div>`
      : `<p class="small">Te same dane na iPhonie, iPadzie i Macu. Dane są szyfrowane na telefonie Twoim hasłem, więc serwer (ani nikt inny) ich nie odczyta. Bez hasła nie da się ich odzyskać.</p>
        <form id="sync-form" class="form" style="margin-top:8px">
          <input name="pass" type="password" autocomplete="new-password" minlength="12" required placeholder="Hasło synchronizacji (min. 12 znaków)" style="width:100%;max-width:none;text-align:left">
          <button class="btn" type="submit" style="margin-top:8px" ${url ? '' : 'disabled'}>${icon('cloud', 'icon-sm')} Włącz synchronizację</button>
        </form>
        <p class="muted small" style="margin-top:8px">Na drugim urządzeniu wpisz to samo hasło. Najlepiej 4–5 losowych słów.</p>`}
    </div>

    <div class="section-title">Nowy telefon</div>
    <div class="card">
      <p class="small">Przenieś wszystko na nowy telefon bez plików: na starym pokaż kod, na nowym go zeskanuj. Dane są szyfrowane, a kod działa raz, przez godzinę.</p>
      <div class="actions"><button type="button" class="btn" id="send-transfer" ${url ? '' : 'disabled'}>${icon('send', 'icon-sm')} Pokaż kod (stary telefon)</button>
      <button type="button" class="btn secondary" id="receive-transfer" ${url ? '' : 'disabled'}>${icon('qr-code', 'icon-sm')} Zeskanuj kod (nowy)</button></div>
      <div id="qr"></div>
    </div>

    <div class="section-title">Przypomnienia</div>
    ${pushSupported() ? `<div class="list form" id="reminders">
      ${Object.entries(REMINDERS).map(([id, r]) => `<div class="row"><label class="grow" style="display:flex;gap:10px;align-items:center">
        <input type="checkbox" data-rem="${id}" ${rem[id]?.on ? 'checked' : ''} style="width:auto"> ${r.label}</label>
        <input type="time" data-rem-time="${id}" value="${rem[id]?.time ?? r.time}" style="max-width:130px"></div>`).join('')}
    </div>
    <div class="actions"><button type="button" class="btn" id="save-reminders" ${url ? '' : 'disabled'}>${icon('bell', 'icon-sm')} Zapisz przypomnienia</button>
      <button type="button" class="btn secondary" id="test-push" ${url ? '' : 'disabled'}>Wyślij próbne</button></div>
    <p class="muted small" style="margin:8px 4px">Trening przypomina tylko w dni treningowe z profilu. ${standalone ? '' : 'Na iPhonie powiadomienia działają, gdy aplikacja jest dodana do ekranu początkowego (Udostępnij → Do ekranu początkowego) i otwarta stamtąd.'}</p>`
    : `<div class="card"><p class="small">Ta przeglądarka nie obsługuje powiadomień. Na iPhonie dodaj aplikację do ekranu początkowego (Udostępnij → Do ekranu początkowego, iOS 16.4 lub nowszy) i otwórz ją stamtąd.</p></div>`}
    <p class="muted small" style="margin:12px 4px">Serwer przechowuje tylko zaszyfrowane dane, adres powiadomień i godziny przypomnień. Zdjęcia sylwetki nigdy nie opuszczają telefonu.</p>
  `, { back: '#/settings' });

  const busy = async (btn, fn) => {
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Chwila…';
    try {
      await fn();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  };

  document.getElementById('cloud-url').onchange = async (ev) => {
    const v = ev.target.value.trim();
    if (v && !/^https:\/\/[\w.-]+(\/.*)?$/.test(v)) return alert('Adres musi zaczynać się od https://');
    st.cloudUrl = v || null;
    await save();
    viewCloud();
  };

  document.getElementById('sync-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector('button');
    busy(btn, async () => {
      const found = await enableSync(ev.target.pass.value);
      startAutoSync();
      if (found) {
        const theirs = confirm(`Pod tym hasłem są już dane z innego urządzenia: ${describe(found.remote)}.\n\nOK = pobierz je na ten telefon (zastąpią obecne: ${describe(data)})\nAnuluj = zostaw dane z tego telefonu i wyślij je`);
        if (theirs) {
          await adoptRemote(found.remote, found.version);
          alert('Pobrano dane z innego urządzenia.');
        } else alert(syncLabel[(await syncNow({ resolve: 'mine' })).status] ?? 'Gotowe.');
      } else {
        await syncNow();
        alert('Synchronizacja włączona. Na innych urządzeniach wpisz to samo hasło.');
      }
      viewCloud();
    });
  });
  document.getElementById('sync-now')?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    let r = await syncNow();
    if (r.status === 'conflict') {
      const theirs = confirm('Dane zmieniły się i tutaj, i na innym urządzeniu.\n\nOK = weź wersję z innego urządzenia\nAnuluj = zostaw tę i wyślij ją');
      r = await syncNow({ resolve: theirs ? 'theirs' : 'mine' });
    }
    alert(syncLabel[r.status] ?? 'Gotowe.');
    viewCloud();
  }));
  document.getElementById('sync-off')?.addEventListener('click', async () => {
    if (!confirm('Wyłączyć synchronizację na tym urządzeniu? Dane zostają na telefonie.')) return;
    await disableSync();
    viewCloud();
  });

  document.getElementById('send-transfer').onclick = (ev) => busy(ev.currentTarget, async () => {
    const link = await sendTransfer();
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    document.getElementById('qr').innerHTML = `<div class="qr">${qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div>
      <p class="small">Na nowym telefonie: otwórz Progress (z ekranu początkowego) → Ustawienia → Synchronizacja → „Zeskanuj kod”. Kod jest ważny przez godzinę.</p>
      <button type="button" class="link-btn" id="copy-link">Skopiuj link zamiast kodu</button>`;
    document.getElementById('copy-link').onclick = async () => {
      await navigator.clipboard?.writeText(link);
      alert('Link skopiowany. Wklej go na nowym telefonie w „Zeskanuj kod” → anuluj skaner.');
    };
  });
  document.getElementById('receive-transfer').onclick = async () => {
    let code = null;
    try {
      code = await scanBarcode({ qr: true });
    } catch (err) {
      alert(err.message);
    }
    code ??= prompt('Wklej link z drugiego telefonu')?.trim();
    if (code) location.hash = `#/receive/${code.split('#/receive/').pop()}`;
  };

  const remBox = document.getElementById('reminders');
  document.getElementById('save-reminders')?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const next = {};
    for (const id of Object.keys(REMINDERS)) {
      next[id] = { on: remBox.querySelector(`[data-rem="${id}"]`).checked, time: remBox.querySelector(`[data-rem-time="${id}"]`).value || REMINDERS[id].time };
    }
    st.reminders = next;
    const days = data.profile.trainingDays ?? defaultTrainingDays(currentWeek()?.week.sessions.length);
    await savePush(reminderList(next, days));
    await save();
    alert(Object.values(next).some((r) => r.on) ? 'Przypomnienia zapisane.' : 'Przypomnienia wyłączone.');
  }));
  document.getElementById('test-push')?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    await testPush();
  }));
}

export async function viewReceive(code) {
  render('Odbieranie danych', '<div class="card"><p>Pobieram i odszyfrowuję…</p></div>', { back: '#/settings' });
  try {
    const { incoming, done } = await receiveTransfer(code);
    render('Odbieranie danych', `
      <div class="card"><p>Dane z drugiego telefonu: ${describe(incoming)}.</p>
      ${data ? '<p class="small error-text" style="margin-top:6px">Zastąpią dane, które są teraz na tym telefonie.</p>' : ''}</div>
      <button class="btn" id="accept">${icon('check', 'icon-sm')} Wczytaj na ten telefon</button>
    `, { back: '#/settings' });
    document.getElementById('accept').onclick = async () => {
      await replaceData(incoming);
      await done();
      startAutoSync();
      location.hash = '#/today';
    };
  } catch (err) {
    render('Odbieranie danych', `<div class="card"><p>${esc(err.message)}</p></div>`, { back: data ? '#/cloud' : '#/' });
  }
}

// ---------- report for a coach or dietitian ----------

// A compact summary of the last `weeks` weeks; nothing beyond what is shown in the report.
export function buildReport(weeks = 4, end = todayIso()) {
  const start = shiftDate(end, -weeks * 7 + 1);
  const trend = weightTrend(weightPoints());
  const trendAt = (d) => [...trend].reverse().find((x) => x.date <= d)?.trend ?? null;
  const rows = [];
  for (let i = 0; i < weeks; i++) {
    const ws = shiftDate(start, i * 7);
    const we = shiftDate(ws, 6);
    const days = Array.from({ length: 7 }, (_, k) => shiftDate(ws, k));
    const logged = days.filter((d) => (data.foodLog[d] ?? []).length);
    const eaten = logged.map((d) => sumMacros(data.foodLog[d]));
    const logs = data.workoutLogs.filter((l) => l.date >= ws && l.date <= we);
    const r = (x) => (x == null ? null : Math.round(x));
    rows.push({
      start: ws,
      w: trendAt(we),
      kcal: r(avg(eaten.map((e) => e.kcal))), p: r(avg(eaten.map((e) => e.p))),
      tk: r(avg(logged.map((d) => targetsFor(d)?.kcal).filter(Boolean))), tp: r(avg(logged.map((d) => targetsFor(d)?.protein).filter(Boolean))),
      days: logged.length,
      wo: logs.length,
      sets: logs.reduce((n, l) => n + (l.entries ?? []).reduce((m, e) => m + e.sets.filter((x) => !x.warmup).length, 0), 0),
      steps: r(avg(days.map((d) => (data.dailyLogs ?? []).find((x) => x.date === d)?.steps).filter((x) => x != null))),
    });
  }
  // The most trained lifts in the period: estimated 1RM at the start and the end.
  const inPeriod = data.workoutLogs.filter((l) => l.date >= start && l.date <= end);
  const count = new Map();
  for (const l of inPeriod) for (const e of l.entries ?? []) count.set(e.exerciseId, (count.get(e.exerciseId) ?? 0) + 1);
  const lifts = [...count].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => {
    const h = e1rmHistory(inPeriod, id);
    return h.length ? { n: exName(id), a: h[0].e1rm, b: Math.max(...h.slice(-3).map((x) => x.e1rm)) } : null;
  }).filter(Boolean);
  const meas = (data.bodyMeasurements ?? []).filter((m) => m.date >= start && m.date <= end && m.waistCm);
  const t = targetsFor(end);
  return {
    v: 1, kind: 'report', from: start, to: end, rows, lifts,
    waist: meas.length >= 2 ? [meas[0].waistCm, meas.at(-1).waistCm] : null,
    goal: t ? { kcal: t.kcal, p: t.protein, f: t.fat, c: t.carbs, goal: t.goal } : null,
    goalWeight: data.profile.goalWeightKg ?? null,
  };
}

const sign = (x, digits = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fmt(Math.abs(x), digits)}`;

export function reportHtml(r) {
  const first = r.rows.find((x) => x.w != null);
  const last = [...r.rows].reverse().find((x) => x.w != null);
  return `
    <div class="report">
      <p class="muted small">${dateLabel(r.from)} – ${dateLabel(r.to)}${r.name ? ` · ${esc(r.name)}` : ''}</p>
      <div class="stats">
        <div class="stat"><div class="label">Waga (trend)</div><div class="value">${last ? fmt(last.w, 1) : '–'}<span class="unit">kg</span></div>
          <div class="sub small muted">${first && last && first !== last ? `${sign(last.w - first.w)} kg` : ''}${r.goalWeight ? ` · cel ${fmt(r.goalWeight, 1)} kg` : ''}</div></div>
        <div class="stat"><div class="label">Cel dzienny</div><div class="value">${r.goal ? fmt(r.goal.kcal) : '–'}<span class="unit">kcal</span></div>
          <div class="sub small muted">${r.goal ? `B ${fmt(r.goal.p)} · T ${fmt(r.goal.f)} · W ${fmt(r.goal.c)} g` : ''}</div></div>
      </div>
      <table class="report-table">
        <thead><tr><th>Tydzień</th><th>Waga</th><th>kcal</th><th>Białko</th><th>Dni</th><th>Treningi</th><th>Serie</th><th>Kroki</th></tr></thead>
        <tbody>${r.rows.map((x) => `<tr><td>${dateLabel(x.start)}</td><td>${x.w != null ? fmt(x.w, 1) : '–'}</td>
          <td>${x.kcal != null ? fmt(x.kcal) : '–'}${x.tk ? `<small>/${fmt(x.tk)}</small>` : ''}</td>
          <td>${x.p != null ? fmt(x.p) : '–'}${x.tp ? `<small>/${fmt(x.tp)}</small>` : ''}</td>
          <td>${x.days}/7</td><td>${x.wo}</td><td>${x.sets}</td><td>${x.steps != null ? fmt(x.steps) : '–'}</td></tr>`).join('')}</tbody>
      </table>
      <p class="small muted">kcal i białko: średnia z dni z wpisami / cel. Waga: wygładzony trend z końca tygodnia.</p>
      ${r.lifts.length ? `<div class="section-title">Siła (szacowany 1RM)</div>
        <div class="list">${r.lifts.map((l) => `<div class="row"><span class="grow">${esc(l.n)}</span><span class="sub">${fmt(l.a, 1)} → ${fmt(l.b, 1)} kg</span><b>${sign(l.b - l.a)}</b></div>`).join('')}</div>` : ''}
      ${r.waist ? `<p class="small" style="margin:12px 4px">Talia: ${fmt(r.waist[0], 1)} → ${fmt(r.waist[1], 1)} cm (${sign(r.waist[1] - r.waist[0])} cm)</p>` : ''}
      ${r.note ? `<div class="card"><p class="small">${esc(r.note)}</p></div>` : ''}
    </div>`;
}

export function viewReport(weeks = 4) {
  const n = Number(weeks) || 4;
  const r = buildReport(n);
  render('Raport dla trenera', `
    <div class="segmented no-print">${[4, 8, 12].map((w) => `<a href="#/report/${w}" class="${w === n ? 'active' : ''}">${w} tyg.</a>`).join('')}</div>
    ${reportHtml(r)}
    <div class="list form no-print" style="margin-top:12px">
      <label class="row stacked"><span>Imię (opcjonalnie)</span><input id="rep-name" value="${esc(data.settings.reportName ?? '')}"></label>
      <label class="row stacked"><span>Uwagi dla trenera (opcjonalnie)</span><textarea id="rep-note" rows="2"></textarea></label>
    </div>
    <div class="actions no-print">
      <button type="button" class="btn" id="share-report">${icon('send', 'icon-sm')} Wyślij link</button>
      <button type="button" class="btn secondary" id="print-report">${icon('printer', 'icon-sm')} Drukuj / PDF</button>
    </div>
    <p class="muted small no-print" style="margin:8px 4px">Link zawiera tylko to podsumowanie (nie cały dziennik) i otwiera się bez instalowania aplikacji. Nic nie trafia na serwer.</p>
  `, { back: '#/progress' });
  document.getElementById('print-report').onclick = () => window.print();
  document.getElementById('share-report').onclick = async () => {
    const name = document.getElementById('rep-name').value.trim();
    data.settings.reportName = name || null;
    await save();
    const code = await encodeData({ ...r, name: name || undefined, note: document.getElementById('rep-note').value.trim() || undefined });
    const url = `${location.origin}${location.pathname}#/report-view/${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Raport z postępów', text: `Raport ${dateLabel(r.from)} – ${dateLabel(r.to)}`, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    await navigator.clipboard?.writeText(url);
    alert('Link do raportu skopiowany.');
  };
}

export async function viewReportShared(code) {
  let r;
  try {
    r = await decodeData(code);
    if (r?.kind !== 'report' || !Array.isArray(r.rows)) throw new Error('To nie jest raport z aplikacji Progress.');
  } catch (err) {
    return render('Raport', `<div class="card"><p>${esc(err.message)}</p></div>`, { back: data ? '#/today' : null });
  }
  render('Raport z postępów', `${reportHtml(r)}
    <button type="button" class="btn secondary no-print" id="print-report" style="margin-top:12px">${icon('printer', 'icon-sm')} Drukuj / PDF</button>`, { back: data ? '#/today' : null });
  document.getElementById('print-report').onclick = () => window.print();
}
