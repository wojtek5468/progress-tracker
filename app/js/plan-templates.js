// Ready-made training plans the user can copy into their own categories and then edit.
// Rep ranges, sets and RIR follow common beginner/intermediate guidelines
// (ACSM 2009 progression models; Schoenfeld 2016/2017 on weekly volume and frequency).
// Every exercise id must exist in exercise-catalog.js.

const WARMUP = ['skakanka', 'marsz-wymachy-prostmi-nogiami', 'wykrok-i-globalny-wyprost', 'skretosklony'];
const COOLDOWN = ['sklon-japonski-cobra', '15-oddechow-torem-brzusznym'];

// [exerciseId, sets, reps (number or text), restSec]
const s = (name, main, { warmup = WARMUP, cooldown = COOLDOWN } = {}) => ({ name, warmup, main, cooldown });
const MOBILITY_COOLDOWN = ['child-pose', '15-oddechow-torem-brzusznym'];
const RUN_WARMUP = ['brisk-walk', 'marsz-wymachy-prostmi-nogiami'];
const RUN_COOLDOWN = ['brisk-walk', '4-strech'];
// Run/walk intervals for "Bieganie od zera", one row per week: [sets, reps text].
const RUN_WEEKS = [[8, '1 min bieg / 1,5 min marsz'], [6, '2 min bieg / 1,5 min marsz'], [5, '3 min bieg / 1,5 min marsz'], [4, '5 min bieg / 2 min marsz']];
const run = (week, name) => s(name, [['run-easy', RUN_WEEKS[week][0], RUN_WEEKS[week][1], 0]], { warmup: RUN_WARMUP, cooldown: RUN_COOLDOWN });

export const TEMPLATES = [
  {
    id: 'fbw-3',
    place: 'gym',
    name: 'FBW – całe ciało 3×',
    level: 'Początkujący',
    equipment: 'Siłownia',
    perWeek: 3,
    desc: 'Każdy trening angażuje całe ciało. Najlepszy start: dużo nauki techniki, krótkie treningi (ok. 50 min), dni przerwy pomiędzy.',
    progression: 'Gdy we wszystkich seriach zrobisz górny zakres powtórzeń, dodaj 2,5 kg (nogi 5 kg).',
    sessions: [
      s('FBW A', [['back-squat', 3, '8-10', 120], ['bench-press', 3, '8-10', 120], ['row-cable', 3, '10-12', 90], ['rdl', 2, '10', 90], ['plank', 3, '30s', 60]]),
      s('FBW B', [['deadlift', 3, '5-6', 150], ['db-ohp', 3, '8-10', 90], ['lat-pull-down', 3, '10-12', 90], ['lunge', 2, '10/noga', 90], ['pallof-press', 2, '12/strona', 60]]),
      s('FBW C', [['leg-press', 3, '10-12', 120], ['incline-bench-press-db', 3, '10-12', 90], ['1-arm-db-row', 3, '10-12', 90], ['hip-thrust', 3, '10-12', 90], ['side-delt-db-lateral-raises', 2, '12-15', 60]]),
    ],
  },
  {
    id: 'sila-5x5',
    place: 'gym',
    name: 'Siła 5×5',
    level: 'Początkujący',
    equipment: 'Siłownia (sztanga)',
    perWeek: 3,
    desc: 'Klasyczny plan siłowy na sztandze: dwa treningi A i B na zmianę (A-B-A, potem B-A-B). Mało ćwiczeń, ciężkie serie.',
    progression: 'Dodawaj 2,5 kg co trening, gdy zrobisz 5×5. Po dwóch nieudanych treningach zejdź 10% i buduj od nowa.',
    sessions: [
      s('5×5 A', [['back-squat', 5, 5, 180], ['bench-press', 5, 5, 180], ['bent-over-row-bar', 5, 5, 150]]),
      s('5×5 B', [['back-squat', 5, 5, 180], ['ohp', 5, 5, 180], ['deadlift', 1, 5, 180]]),
      s('5×5 A', [['back-squat', 5, 5, 180], ['bench-press', 5, 5, 180], ['bent-over-row-bar', 5, 5, 150]]),
    ],
  },
  {
    id: 'gora-dol-4',
    place: 'gym',
    name: 'Góra / Dół 4×',
    level: 'Średniozaawansowany',
    equipment: 'Siłownia',
    perWeek: 4,
    desc: 'Każda partia dwa razy w tygodniu. Dzień A cięższy (mniej powtórzeń), dzień B więcej powtórzeń. Np. pon, wt, czw, pt.',
    progression: 'Podwójna progresja: najpierw dobijaj powtórzenia do górnej granicy, potem dodaj ciężar.',
    sessions: [
      s('Góra A', [['bench-press', 4, '5-7', 150], ['bent-over-row-bar', 4, '6-8', 120], ['db-ohp', 3, '8-10', 90], ['lat-pull-down', 3, '8-10', 90], ['db-curl', 2, '10-12', 60], ['tricpes-press-v-grip-cable', 2, '10-12', 60]]),
      s('Dół A', [['back-squat', 4, '5-7', 180], ['rdl', 3, '8-10', 120], ['leg-curl-machine', 3, '10-12', 90], ['calf-raise-machine', 3, '10-12', 60], ['plank', 3, '45s', 60]]),
      s('Góra B', [['ohp', 4, '6-8', 120], ['pull-up', 4, '6-10', 120], ['incline-bench-press-db', 3, '10-12', 90], ['row-cable', 3, '10-12', 90], ['face-pull', 3, '15', 60], ['side-delt-db-lateral-raises', 3, '12-15', 60]]),
      s('Dół B', [['deadlift', 3, '4-6', 180], ['bulgarian-sq', 3, '8-10/noga', 90], ['hip-thrust', 3, '10-12', 90], ['leg-extension', 3, '12-15', 60], ['hollow-body', 3, '30s', 60]]),
    ],
  },
  {
    id: 'ppl-3',
    place: 'gym',
    name: 'Push / Pull / Nogi',
    level: 'Średniozaawansowany',
    equipment: 'Siłownia',
    perWeek: 3,
    desc: 'Pchanie, przyciąganie i nogi w osobne dni. Przy większej ilości czasu powtórz cykl 2× w tygodniu (6 treningów).',
    progression: 'Podwójna progresja; w ostatniej serii zostaw 1–2 powtórzenia w zapasie.',
    sessions: [
      s('Push', [['bench-press', 4, '6-8', 150], ['db-ohp', 3, '8-10', 90], ['incline-bench-press-db', 3, '10-12', 90], ['side-delt-db-lateral-raises', 3, '12-15', 60], ['tricpes-press-v-grip-cable', 3, '10-12', 60]]),
      s('Pull', [['pull-up', 4, '6-10', 120], ['bent-over-row-bar', 3, '8-10', 120], ['lat-pull-down', 3, '10-12', 90], ['face-pull', 3, '15', 60], ['db-curl', 3, '10-12', 60]]),
      s('Nogi', [['back-squat', 4, '6-8', 180], ['rdl', 3, '8-10', 120], ['leg-press', 3, '10-12', 90], ['leg-curl-machine', 3, '10-12', 60], ['calf-raise-machine', 4, '10-15', 60]]),
    ],
  },
  {
    id: 'dom-3',
    place: 'home',
    name: 'Dom – bez sprzętu',
    level: 'Początkujący',
    equipment: 'Bez sprzętu (krzesło)',
    perWeek: 3,
    desc: 'Dwa treningi siłowe z masą ciała i jeden kondycyjny w obwodzie. Ok. 30–40 minut, wystarczy kawałek podłogi.',
    progression: 'Dodawaj powtórzenia, potem utrudniaj wersję ćwiczenia (np. pompki z kolan → klasyczne → nogi na podwyższeniu).',
    sessions: [
      s('Dom A', [['bodyweight-squat', 3, '15-20', 60], ['push-up', 3, 'max', 90], ['reverse-lunge', 3, '10/noga', 60], ['glute-bridge', 3, '15', 60], ['plank', 3, '30s', 45], ['superman', 3, '12', 45]]),
      s('Dom B', [['bulgarian-sq', 3, '10/noga', 60], ['pike-push-up', 3, '8-10', 90], ['bench-dips', 3, '12', 60], ['sl-rdl', 3, '10/noga', 60], ['mountain-climbers', 3, '30s', 45], ['lateral-plank', 3, '20s/strona', 45]]),
      s('Dom C – kondycja', [['jumping-jacks', 4, '40s', 20], ['burpess', 4, '40s', 20], ['bodyweight-squat', 4, '40s', 20], ['push-up', 4, '40s', 20], ['mountain-climbers', 4, '40s', 20]], { cooldown: ['4-strech', '15-oddechow-torem-brzusznym'] }),
    ],
  },
  {
    id: 'posladki-nogi-3',
    place: 'gym',
    name: 'Pośladki i nogi + góra',
    level: 'Początkujący / średni',
    equipment: 'Siłownia',
    perWeek: 3,
    desc: 'Dwa treningi z naciskiem na pośladki i nogi oraz jeden na górę ciała, żeby sylwetka rozwijała się równo. Popularny wybór u kobiet.',
    progression: 'Podwójna progresja; w hip thruście dodawaj 5 kg, w ćwiczeniach izolowanych powtórzenia.',
    sessions: [
      s('Pośladki A', [['hip-thrust', 4, '8-10', 120], ['bulgarian-sq', 3, '10/noga', 90], ['rdl', 3, '10', 90], ['abductor-machine-3s-pause', 3, '15', 60], ['plank', 3, '30s', 45]]),
      s('Góra', [['lat-pull-down', 3, '10-12', 90], ['db-ohp', 3, '10-12', 90], ['row-cable', 3, '10-12', 90], ['incline-bench-press-db', 3, '10-12', 90], ['face-pull', 2, '15', 60]]),
      s('Pośladki B', [['leg-press', 3, '10-12', 120], ['glute-bridge', 3, '15', 60], ['reverse-lunge', 3, '10/noga', 90], ['leg-curl-machine', 3, '12', 60], ['glute-kickback-cable', 3, '12/noga', 45]]),
    ],
  },
  {
    id: 'fbw-2',
    place: 'gym',
    name: 'FBW 2× – dla zabieganych',
    level: 'Każdy poziom',
    equipment: 'Siłownia',
    perWeek: 2,
    desc: 'Minimum, które realnie daje efekty: dwa treningi całego ciała po ok. 60 min, np. wtorek i sobota.',
    progression: 'Podwójna progresja; przy dwóch treningach ostatnią serię rób blisko upadku (RIR 1).',
    sessions: [
      s('FBW A', [['back-squat', 3, '6-8', 150], ['bench-press', 3, '6-8', 150], ['lat-pull-down', 3, '8-10', 90], ['rdl', 3, '8-10', 120], ['side-delt-db-lateral-raises', 2, '12-15', 60], ['plank', 2, '45s', 45]]),
      s('FBW B', [['deadlift', 3, '5', 180], ['db-ohp', 3, '8-10', 90], ['row-cable', 3, '10-12', 90], ['leg-press', 3, '10-12', 120], ['db-curl', 2, '12', 60], ['tricpes-press-v-grip-cable', 2, '12', 60]]),
    ],
  },
  {
    id: 'hybryda-3',
    place: 'gym',
    name: 'Siła + kondycja',
    level: 'Średniozaawansowany',
    equipment: 'Siłownia',
    perWeek: 3,
    desc: 'Ciężkie ćwiczenia wielostawowe, a na koniec krótki, intensywny finisher kondycyjny (ok. 10 min).',
    progression: 'Ciężary jak w planach siłowych; w finisherze skracaj przerwy lub dokładaj rundę.',
    sessions: [
      s('Hybryda A', [['back-squat', 4, '5', 180], ['pull-up', 4, '5-8', 120], ['kettle-swing', 5, '15', 45], ['burpess', 5, '10', 45]]),
      s('Hybryda B', [['bench-press', 4, '5', 180], ['bent-over-row-bar', 4, '6-8', 120], ['rowing-machine', 5, '250 m', 60], ['farmer-walk', 4, '30 m', 60]]),
      s('Hybryda C', [['deadlift', 3, '4-5', 180], ['db-ohp', 3, '8-10', 90], ['mountain-climbers', 5, '30s', 30], ['air-bike', 5, '20s mocno / 40s lekko', 0]]),
    ],
  },
  {
    id: 'hantle-dom-3',
    place: 'home',
    name: 'Hantle w domu',
    level: 'Początkujący / średni',
    equipment: 'Para hantli (najlepiej regulowanych)',
    perWeek: 3,
    desc: 'Pełne treningi z samymi hantlami, bez ławki. Dobra opcja, gdy nie chcesz chodzić na siłownię.',
    progression: 'Gdy zrobisz górny zakres powtórzeń, zwiększ ciężar albo zwolnij tempo opuszczania (3 s).',
    sessions: [
      s('Hantle A', [['goblet-sq', 3, '10-12', 90], ['db-floor-press', 3, '10-12', 90], ['1-arm-db-row', 3, '10-12/rękę', 60], ['db-rdl', 3, '10-12', 90], ['plank', 3, '40s', 45]]),
      s('Hantle B', [['reverse-lunge', 3, '10/noga', 90], ['db-ohp', 3, '10-12', 90], ['db-prone-row', 3, '12', 60], ['glute-bridge', 3, '15', 60], ['db-curl', 2, '12', 45], ['bench-dips', 2, '12', 45]]),
      s('Hantle C', [['bulgarian-sq', 3, '10/noga', 90], ['push-up', 3, 'max', 90], ['1-arm-db-row', 3, '10-12/rękę', 60], ['sl-rdl', 3, '10/noga', 60], ['side-delt-db-lateral-raises', 3, '15', 45]]),
    ],
  },
  {
    id: 'kettlebell-3',
    place: 'home',
    name: 'Kettlebell',
    level: 'Początkujący / średni',
    equipment: 'Jeden kettlebell (12–24 kg)',
    perWeek: 3,
    desc: 'Siła i kondycja z jednym odważnikiem. Swing to podstawa: ruch z bioder, nie z rąk.',
    progression: 'Najpierw powtórzenia, potem cięższy kettlebell; swing dobijaj do 10×15.',
    sessions: [
      s('KB A', [['kettle-swing', 5, '15', 60], ['goblet-sq', 4, '10', 90], ['kb-press', 3, '8/rękę', 90], ['row-kettle-wide-elbow', 3, '10/rękę', 60], ['plank', 3, '40s', 45]]),
      s('KB B', [['turkish-get-up', 3, '2/stronę', 90], ['front-sq-kettlbell', 3, '8-10', 90], ['kettlebell-clean', 4, '6/rękę', 60], ['reverse-lunge', 3, '10/noga', 60], ['farmer-walk-1arm', 3, '30 m/rękę', 60]]),
      s('KB C – obwód', [['kettle-swing', 5, '20', 30], ['goblet-sq', 5, '10', 30], ['push-up', 5, '10', 30], ['mountain-climbers', 5, '30s', 30]]),
    ],
  },
  {
    id: 'kalistenika-3',
    place: 'home',
    name: 'Kalistenika',
    level: 'Średniozaawansowany',
    equipment: 'Drążek i poręcze (np. plac street workout)',
    perWeek: 3,
    desc: 'Trening z masą ciała na drążku i poręczach. Gdy nie dajesz rady podciągnąć się 5 razy, użyj gumy albo wersji ekscentrycznej.',
    progression: 'Dokładaj powtórzenia; po 3×12 przejdź na trudniejszą wersję (np. podciąganie z obciążeniem).',
    sessions: [
      s('Kalistenika A', [['pull-up', 4, '5-8', 120], ['dips', 4, '6-10', 120], ['bulgarian-sq', 3, '10/noga', 90], ['hanging-knee-raise', 3, '10-12', 60]]),
      s('Kalistenika B', [['inverted-row', 4, '10-12', 90], ['pike-push-up', 4, '8-10', 90], ['sl-sq-box', 3, '6-8/noga', 90], ['hollow-body', 3, '30s', 45]]),
      s('Kalistenika C', [['eccentric-pull-up', 3, '5 (5 s w dół)', 120], ['push-up', 4, 'max', 90], ['reverse-lunge', 3, '12/noga', 60], ['lateral-plank', 3, '30s/strona', 45]]),
    ],
  },
  {
    id: 'bieganie-od-zera',
    place: 'cardio',
    name: 'Bieganie od zera',
    level: 'Początkujący',
    equipment: 'Buty do biegania',
    perWeek: 3,
    noRir: true,
    desc: 'Przeplatanie biegu z marszem. Co tydzień biegasz dłużej; po 4 tygodniach ok. 20 minut biegu w treningu.',
    progression: 'Jeśli tydzień był za trudny, powtórz go zamiast przechodzić dalej.',
    sessions: [run(0, 'Bieg 1'), run(0, 'Bieg 2'), run(0, 'Bieg 3')],
    weekSessions: [0, 1, 2, 3].map((w) => [run(w, 'Bieg 1'), run(w, 'Bieg 2'), run(w, 'Bieg 3')]),
  },
  {
    id: 'mobilnosc-3',
    place: 'cardio',
    name: 'Mobilność i zdrowe plecy',
    level: 'Każdy poziom',
    equipment: 'Mata',
    perWeek: 3,
    noRir: true,
    desc: 'Krótkie sesje (ok. 20 min) na sztywne biodra i plecy po pracy przy biurku. Dobrze łączą się z każdym innym planem.',
    progression: 'Wydłużaj czas w pozycjach i zakres ruchu, bez bólu.',
    sessions: [
      s('Mobilność A', [['cat-cow', 2, '10', 0], ['hip-90-90', 2, '8/strona', 0], ['thoracic-rotation', 2, '8/strona', 0], ['brid-dog', 3, '8/strona', 30], ['glute-bridge', 3, '12', 30]], { warmup: [], cooldown: MOBILITY_COOLDOWN }),
      s('Mobilność B', [['mobilizacja-stawu-skokowego', 2, '10/noga', 0], ['wykrok-w-podporze-przodem-i-rotacja', 2, '6/strona', 0], ['dead-bug-band', 3, '8/strona', 30], ['lateral-plank', 2, '20s/strona', 30], ['hang', 3, '20-30s', 45]], { warmup: [], cooldown: MOBILITY_COOLDOWN }),
      s('Mobilność C', [['cat-cow', 2, '10', 0], ['sklon-japonski-cobra', 2, '30s', 0], ['lezenie-v-nogi', 2, '60s', 0], ['superman', 3, '10', 30], ['plank', 3, '30s', 30]], { warmup: [], cooldown: MOBILITY_COOLDOWN }),
    ],
  },
];

// RIR (reps in reserve) for 4 weeks: start easy, finish close to failure.
const WEEK_RIR = [3, 2, 2, 1];

export const PLACES = { gym: 'Siłownia', home: 'Dom', cardio: 'Kondycja i mobilność' };

export function buildProgram(template, id) {
  const weeks = WEEK_RIR.map((rir, wi) => ({
    id: `${id}-w${wi + 1}`,
    number: wi + 1,
    label: template.noRir ? null : wi === 0 ? 'start, RIR 3' : `RIR ${rir}`,
    sessions: (template.weekSessions?.[wi] ?? template.sessions).map((sess, si) => {
      let order = 0;
      const plain = (ids) => ids.map((exerciseId) => ({ order: ++order, exerciseId }));
      return {
        order: si + 1,
        name: sess.name,
        blocks: [
          { type: 'warmup', items: plain(sess.warmup) },
          {
            type: 'main',
            items: sess.main.map(([exerciseId, sets, reps, restSec]) => ({
              order: ++order, exerciseId, sets, ...(restSec ? { restSec } : {}), ...(template.noRir ? {} : { rir }),
              ...(typeof reps === 'number' ? { reps } : { repsText: reps }),
            })),
          },
          { type: 'cooldown', items: plain(sess.cooldown) },
        ],
      };
    }),
  }));
  return { id, name: template.name, templateId: template.id, weeks };
}

export const templateExerciseIds = (t) => [...new Set((t.weekSessions?.flat() ?? t.sessions).flatMap((x) => [...x.warmup, ...x.main.map((m) => m[0]), ...x.cooldown]))];
