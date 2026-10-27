// Front and back body outline with muscles shaded by how much they were trained.
// Drawn from simple shapes (our own drawing), so there is no licence to worry about.

const L = (x) => 100 - x; // mirror to the other side

// [muscle, ellipse cx, cy, rx, ry] for the left side; the right side is mirrored.
const FRONT = [
  ['shoulders', 31, 47, 8, 7], ['chest', 41.5, 53, 9.5, 7], ['biceps', 24.5, 66, 4.8, 10],
  ['forearms', 20.5, 88, 4.2, 11], ['abs', 46, 70, 3.6, 5], ['abs', 46, 81, 3.6, 5], ['abs', 46, 92, 3.4, 4.5],
  ['abs', 38.5, 82, 3, 9], ['abductors', 34.5, 106, 3, 7], ['quads', 42, 129, 7, 19],
  ['adductors', 47, 119, 2.6, 9], ['calves', 41.5, 170, 4.6, 13],
];
const BACK = [
  ['traps', 43, 41, 8, 6], ['shoulders', 31, 47, 8, 7], ['lats', 38.5, 66, 7.5, 13],
  ['midBack', 46, 57, 4, 9], ['triceps', 24.5, 66, 4.8, 10], ['forearms', 20.5, 88, 4.2, 11],
  ['lowerBack', 46, 85, 3.6, 8], ['glutes', 43, 106, 8, 8.5], ['hamstrings', 42, 134, 6.6, 17],
  ['calves', 41.5, 168, 5.6, 13],
];

// Body outline (neutral): head, neck, torso, arms, hands, legs, feet.
const BODY = `
  <circle cx="50" cy="17" r="11"/>
  <rect x="45" y="27" width="10" height="10" rx="3"/>
  <path d="M28 40 Q50 32 72 40 L70 100 Q50 108 30 100 Z"/>
  <rect x="19" y="40" width="12" height="38" rx="6"/><rect x="69" y="40" width="12" height="38" rx="6"/>
  <rect x="16" y="74" width="10" height="28" rx="5"/><rect x="74" y="74" width="10" height="28" rx="5"/>
  <circle cx="20" cy="106" r="4.5"/><circle cx="80" cy="106" r="4.5"/>
  <rect x="32" y="98" width="17" height="54" rx="8"/><rect x="51" y="98" width="17" height="54" rx="8"/>
  <rect x="35" y="150" width="13" height="38" rx="6"/><rect x="52" y="150" width="13" height="38" rx="6"/>
  <ellipse cx="41" cy="191" rx="6" ry="3"/><ellipse cx="59" cy="191" rx="6" ry="3"/>`;

function figure(shapes, values, dx, label) {
  const parts = shapes.flatMap(([m, cx, cy, rx, ry]) => {
    const v = Math.max(0, Math.min(1, values[m] ?? 0));
    const style = `fill-opacity:${(0.12 + 0.88 * v).toFixed(2)}`;
    return [cx, L(cx)].map((x) => `<ellipse data-m="${m}" cx="${x}" cy="${cy}" rx="${rx}" ry="${ry}" style="${style}"/>`);
  });
  return `<g transform="translate(${dx} 0)"><g class="mm-body">${BODY}</g><g class="mm-muscle">${parts.join('')}</g>
    <text x="50" y="206" text-anchor="middle" class="mm-label">${label}</text></g>`;
}

// values: muscle → 0..1 (share of the weekly goal, for example)
export function bodyMap(values) {
  return `<svg class="muscle-map" viewBox="0 0 210 212" role="img" aria-label="Mapa trenowanych mięśni">
    ${figure(FRONT, values, 0, 'Przód')}${figure(BACK, values, 110, 'Tył')}</svg>`;
}
