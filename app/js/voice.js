// Speaking a meal instead of typing it. Safari's speech recognition works like keyboard
// dictation (Apple processes the audio); nothing goes to our server.

const Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
export const voiceSupported = () => Boolean(Recognition);

// Listens once and resolves with the text heard ('' when nothing was said).
export function listen({ lang = 'pl-PL', onPartial = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    let text = '';
    rec.onresult = (ev) => {
      text = [...ev.results].map((r) => r[0].transcript).join(' ').trim();
      onPartial(text);
    };
    rec.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') resolve('');
      else reject(new Error(ev.error === 'not-allowed' ? 'Brak zgody na mikrofon. Włącz go w Ustawieniach iPhone’a → Safari → Mikrofon.' : 'Nie udało się rozpoznać mowy.'));
    };
    rec.onend = () => resolve(text);
    rec.start();
  });
}
