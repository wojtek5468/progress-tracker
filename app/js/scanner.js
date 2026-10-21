// Barcode scanner with the phone camera. Safari has no BarcodeDetector, so we use
// ZXing (Apache 2.0, vendor/zxing), loaded only when the user taps "Skanuj".
import { icon } from './icons.js';

let zxing = null;

function loadZxing() {
  zxing ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/zxing/zxing.min.js';
    script.onload = () => resolve(window.ZXing);
    script.onerror = () => { zxing = null; reject(new Error('Nie udało się wczytać skanera.')); };
    document.head.append(script);
  });
  return zxing;
}

// Resolves with the EAN/UPC code, or null when the user closes the scanner.
export async function scanBarcode() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Ta przeglądarka nie daje dostępu do aparatu.');
  const ZXing = await loadZxing();
  const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
  ]]]);
  const reader = new ZXing.BrowserMultiFormatReader(hints, 300);

  const overlay = document.createElement('div');
  overlay.className = 'scanner';
  overlay.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="scanner-frame"></div>
    <p class="scanner-hint">Nakieruj aparat na kod kreskowy</p>
    <button type="button" class="scanner-close" aria-label="Zamknij skaner">${icon('x')}</button>`;
  document.body.append(overlay);
  const video = overlay.querySelector('video');

  return new Promise((resolve, reject) => {
    const finish = (value, error) => {
      reader.reset();
      overlay.remove();
      if (error) reject(error); else resolve(value);
    };
    overlay.querySelector('.scanner-close').onclick = () => finish(null);
    reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (result) => {
      if (result) {
        navigator.vibrate?.(80);
        finish(result.getText());
      }
    }).catch((err) => finish(null, new Error(err?.name === 'NotAllowedError'
      ? 'Brak zgody na aparat. Włącz ją w Ustawienia → Safari → Aparat.'
      : 'Nie udało się uruchomić aparatu.')));
  });
}
