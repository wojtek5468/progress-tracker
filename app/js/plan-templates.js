// Ready-made training plans the user can copy into their own categories and then edit.
// Rep ranges, sets and RIR follow common beginner/intermediate guidelines
// (ACSM 2009 progression models; Schoenfeld 2016/2017 on weekly volume and frequency).
// Every exercise id must exist in exercise-catalog.js.

const WARMUP = ['skakanka', 'marsz-wymachy-prostmi-nogiami', 'wykrok-i-globalny-wyprost', 'skretosklony'];
const COOLDOWN = ['sklon-japonski-cobra', '15-oddechow-torem-brzusznym'];

// [exerciseId, sets, reps (number or text), restSec]
const s = (name, main, { warmup = WARMUP, cooldown = COOLDOWN } = {}) => ({ name, warmup, main, cooldown });

export const TEMPLATES = [
  {
    id: 'fbw-3',
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
];

// RIR (reps in reserve) for 4 weeks: start easy, finish close to failure.
const WEEK_RIR = [3, 2, 2, 1];

export function buildProgram(template, id) {
  const weeks = WEEK_RIR.map((rir, wi) => ({
    id: `${id}-w${wi + 1}`,
    number: wi + 1,
    label: wi === 0 ? 'start, RIR 3' : `RIR ${rir}`,
    sessions: template.sessions.map((sess, si) => {
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
              order: ++order, exerciseId, sets, restSec, rir,
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

export const templateExerciseIds = (t) => [...new Set(t.sessions.flatMap((x) => [...x.warmup, ...x.main.map((m) => m[0]), ...x.cooldown]))];
