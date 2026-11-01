// In-app dialogs and notices instead of the browser's alert/confirm/prompt: a bottom sheet
// (native <dialog>, so focus and VoiceOver stay inside it) and a short notice at the bottom
// with an optional "Cofnij". Deleting things uses undo instead of "Czy na pewno?".
import { data, save, setData, esc } from './core.js';

const live = () => {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  return el;
};

let toastTimer = null;
// A short notice. `action` = { label, run } adds a button (e.g. Cofnij).
export function toast(message, { action = null, ms = action ? 6000 : 3000 } = {}) {
  const el = live();
  clearTimeout(toastTimer);
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  if (action) {
    el.querySelector('button').onclick = () => {
      el.classList.remove('show');
      action.run();
    };
  }
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Runs a change and offers to take it back: the whole data is restored as it was before.
export async function undoable(message, change) {
  const before = structuredClone(data);
  const result = await change();
  if (result === false) return;
  await save();
  toast(message, {
    action: {
      label: 'Cofnij',
      run: async () => {
        setData(before);
        await save();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        toast('Przywrócono.');
      },
    },
  });
}

// One sheet; `body` is HTML, `buttons` = [{ label, value, style }]. Resolves with the value.
function sheet({ title = '', message = '', body = '', buttons, cancelValue = null }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    dlg.setAttribute('aria-labelledby', 'sheet-title');
    dlg.innerHTML = `<form method="dialog">
      ${title ? `<h2 id="sheet-title">${esc(title)}</h2>` : ''}
      ${message ? `<p class="sheet-msg">${esc(message).replace(/\n/g, '<br>')}</p>` : ''}
      ${body}
      <div class="sheet-buttons">${buttons.map((b, i) => `<button class="btn ${b.style ?? ''}" value="${i}"${b.submit ? ' data-submit' : ''}>${esc(b.label)}</button>`).join('')}</div>
    </form>`;
    if (!title) dlg.removeAttribute('aria-labelledby');
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    let value = cancelValue;
    form.addEventListener('submit', (e) => {
      const i = e.submitter?.value ?? buttons.findIndex((b) => b.submit);
      const b = buttons[Number(i)];
      if (b) value = typeof b.value === 'function' ? b.value(dlg) : b.value;
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(value);
    });
    // Tapping outside the sheet cancels it.
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.showModal();
    (dlg.querySelector('input, textarea, select') ?? dlg.querySelector('.sheet-buttons .btn:not(.secondary)') ?? dlg.querySelector('button'))?.focus();
  });
}

export const say = (message, title = '') => sheet({ title, message, buttons: [{ label: 'OK', value: true }] });

// A sheet with prepared HTML (e.g. a list of what is new).
export const info = (title, html, ok = 'OK') => sheet({ title, body: html, buttons: [{ label: ok, value: true }] });

// Yes/no question. `danger` colours the confirming button red.
export const ask = (message, { title = '', ok = 'OK', cancel = 'Anuluj', danger = false } = {}) => sheet({
  title, message, cancelValue: false,
  buttons: [{ label: ok, value: true, style: danger ? 'danger-fill' : '' }, { label: cancel, value: false, style: 'secondary' }],
});

// Choice between several answers: options = [{ label, value, style? }]. Cancel gives null.
export const choose = (message, options, { title = '', cancel = 'Anuluj' } = {}) => sheet({
  title, message,
  buttons: [...options, ...(cancel ? [{ label: cancel, value: null, style: 'secondary' }] : [])],
});

// Text field. Resolves with the text (trimmed) or null when cancelled.
export const askText = (label, { title = '', value = '', placeholder = '', type = 'text', ok = 'Zapisz', hint = '', inputmode = '' } = {}) => sheet({
  title,
  body: `<label class="sheet-field"><span>${esc(label)}</span>
    <input name="v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"${inputmode ? ` inputmode="${inputmode}"` : ''}></label>
    ${hint ? `<p class="muted small sheet-hint">${esc(hint)}</p>` : ''}`,
  buttons: [{ label: ok, submit: true, value: (dlg) => dlg.querySelector('input').value.trim() }, { label: 'Anuluj', value: null, style: 'secondary' }],
});

// Shows text the user can select and copy, when the clipboard is not available.
export const showCopy = (label, text) => sheet({
  title: label,
  body: `<textarea class="sheet-copy" readonly rows="3">${esc(text)}</textarea>`,
  buttons: [{ label: 'Gotowe', value: true }],
}).then(() => null);

// Copies text; falls back to a sheet with the text selected.
export async function copyText(text, done = 'Skopiowano.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    await showCopy('Skopiuj', text);
  }
}
