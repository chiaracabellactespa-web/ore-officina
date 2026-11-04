/* Ore Officina - strumenti per le schede di accettazione:
   lettura del PDF, lettura del codice a barre (fotocamera o foto), riduzione delle foto. */
(function (root) {
  'use strict';
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const ZXING = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';

  /* ---------- lettura dei campi dal testo del PDF ----------
     items = [{ s: testo, x, y }] con coordinate PDF (y cresce verso l'alto).
     Nel foglio ogni etichetta ("Targa:") ha il suo valore subito sotto, alla stessa x. */
  function parseAccettazione(items) {
    const it = items.filter(i => i.s && i.s.trim()).map(i => ({ s: i.s.trim(), x: i.x, y: i.y }));
    const below = (label, maxDy) => {
      const l = it.find(i => i.s.toLowerCase().startsWith(label.toLowerCase()));
      if (!l) return '';
      return it.filter(i => i !== l && Math.abs(i.x - l.x) <= 4 && i.y < l.y && l.y - i.y <= (maxDy || 14))
        .sort((a, b) => b.y - a.y).map(i => i.s)[0] || '';
    };
    const below2 = label => {            // valore su piu' righe (es. Versione)
      const l = it.find(i => i.s.toLowerCase().startsWith(label.toLowerCase()));
      if (!l) return '';
      return it.filter(i => i !== l && Math.abs(i.x - l.x) <= 6 && i.y < l.y && l.y - i.y <= 24)
        .sort((a, b) => b.y - a.y).map(i => i.s).join(' ');
    };
    const bc = it.find(i => /^\d{10,14}[A-Z]$/.test(i.s)) || it.find(i => /^\d{12,}$/.test(i.s));
    const number = below('Numero documento:');
    const date = below('Data documento:');
    const dmy = v => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
    // descrizione del lavoro: righe nella colonna "Descrizione", tra l'intestazione e "Totale"
    const dh = it.find(i => i.s === 'Descrizione'), tot = it.find(i => /^Totale/.test(i.s));
    let request = '';
    if (dh) {
      const x0 = dh.x - 6, x1 = (it.find(i => i.s === 'Udm') || { x: dh.x + 190 }).x - 4, yMin = tot ? tot.y + 4 : 0;
      request = it.filter(i => i.y < dh.y - 3 && i.y > yMin && i.x >= x0 && i.x < x1)
        .sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
    }
    const model = below('Fabbrica e tipo:');
    const version = below2('Versione:');
    const ver = version.split('|')[0].trim();
    const km = parseInt(String(below('Km:')).replace(/\D/g, ''), 10);
    const year = (/(\d{4})$/.exec(date) || [])[1] || '';
    return {
      barcode: bc ? bc.s : '',
      sheet_no: number,
      code: number ? (year ? number + '/' + year : number) : '',
      customer: below('Destinatario:'),
      plate: below('Targa:').toUpperCase(),
      model: [model, ver].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      vin: below('Telaio:').toUpperCase(),
      km: Number.isFinite(km) ? String(km) : '',
      due: dmy(below('Consegna prev.:')),
      request
    };
  }

  /* ---------- caricamento script esterni (solo quando servono) ---------- */
  const loaded = {};
  function loadScript(src) {
    return loaded[src] || (loaded[src] = new Promise((ok, ko) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok;
      s.onerror = () => { delete loaded[src]; ko(new Error('Impossibile caricare lo strumento di lettura. Controlla la connessione.')); };
      document.head.append(s);
    }));
  }

  /* ---------- PDF -> campi ---------- */
  async function readPdf(file) {
    await loadScript(PDFJS + 'pdf.min.js');
    const lib = root.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page = await doc.getPage(1), tc = await page.getTextContent();
    return parseAccettazione(tc.items.map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5] })));
  }

  /* ---------- foto: riduzione e lettura del codice a barre ---------- */
  function shrink(file, maxSide, quality) {
    return new Promise((ok, ko) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? ok(b) : ko(new Error('Foto non leggibile')), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Foto non leggibile')); };
      img.src = url;
    });
  }
  const FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'qr_code'];
  async function nativeDetector() {
    if (!('BarcodeDetector' in root)) return null;
    try {
      const sup = await root.BarcodeDetector.getSupportedFormats();
      const f = FORMATS.filter(x => sup.includes(x));
      return f.length ? new root.BarcodeDetector({ formats: f }) : null;
    } catch (e) { return null; }
  }
  async function zxingReader() {
    await loadScript(ZXING);
    const Z = root.ZXing, hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    return new Z.BrowserMultiFormatReader(hints);
  }
  async function barcodeFromImage(blob) {            // legge il codice a barre da una foto
    const det = await nativeDetector();
    if (det) {
      try { const r = await det.detect(await createImageBitmap(blob)); if (r.length) return r[0].rawValue; } catch (e) { /* prova l'altro metodo */ }
    }
    // ZXing: prima la foto intera, poi a fasce orizzontali (su un foglio intero il codice e' piccolo)
    const reader = await zxingReader(), Z = root.ZXing;
    const bmp = await createImageBitmap(blob), k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const W = Math.round(bmp.width * k), H = Math.round(bmp.height * k);
    const tries = [[0, 1]];
    [[0.25, 0.125], [0.35, 0.15]].forEach(([f, s]) => { for (let y = 0; y + f <= 1.001; y += s) tries.push([y, f]); });
    for (const [y, f] of tries) {
      const c = document.createElement('canvas'); c.width = W; c.height = Math.round(H * f);
      c.getContext('2d').drawImage(bmp, 0, Math.round(bmp.height * y), bmp.width, Math.round(bmp.height * f), 0, 0, c.width, c.height);
      try { return reader.decodeBitmap(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(c)))).getText(); }
      catch (e) { /* prossimo tentativo */ }
    }
    return '';
  }

  /* ---------- scansione dal vivo con la fotocamera ---------- */
  function scan(onCode) {
    const wrap = document.createElement('div'); wrap.className = 'scanner';
    wrap.innerHTML = '<video playsinline muted autoplay></video><div class="frame" aria-hidden="true"></div><p class="hint">Inquadra il codice a barre</p><button type="button" class="btn big stop">Chiudi</button>';
    document.body.append(wrap);
    const video = wrap.querySelector('video'); let stream = null, stopped = false, reader = null, timer = 0;
    const stop = () => {
      if (stopped) return; stopped = true; clearInterval(timer);
      try { if (reader) reader.reset(); } catch (e) { /* ignora */ }
      if (stream) stream.getTracks().forEach(t => t.stop());
      wrap.remove();
    };
    wrap.querySelector('button').addEventListener('click', stop);
    const found = v => { if (stopped || !v) return; stop(); onCode(String(v).trim()); };
    const fail = m => { stop(); onCode(null, m); };
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fail('Questo telefono non permette di usare la fotocamera da qui.');
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false }); }
      catch (e) { return fail(e && e.name === 'NotAllowedError' ? 'Fotocamera non consentita. Abilitala nelle impostazioni del telefono.' : 'Fotocamera non disponibile.'); }
      if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream; try { await video.play(); } catch (e) { /* ignora */ }
      const det = await nativeDetector();
      if (det) {
        timer = setInterval(async () => { try { const r = await det.detect(video); if (r.length) found(r[0].rawValue); } catch (e) { /* frame non pronto */ } }, 250);
      } else {
        try {                                   // niente lettore video di ZXing: un fotogramma ogni 300 ms su un canvas
          reader = await zxingReader(); const Z = root.ZXing, cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
          timer = setInterval(() => {
            if (!video.videoWidth) return;
            const k = Math.min(1, 1280 / video.videoWidth); cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
            cx.drawImage(video, 0, 0, cv.width, cv.height);
            try { found(reader.decodeBitmap(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(cv)))).getText()); } catch (e) { /* nessun codice in questo fotogramma */ }
          }, 300);
        } catch (e) { fail(e.message); }
      }
    })();
    return stop;
  }

  const norm = v => String(v || '').trim().toUpperCase();
  const strip = v => norm(v).replace(/[A-Z]$/, '');           // 260229868746K == 260229868746
  function matchJob(jobs, code) {                              // trova il lavoro dal codice letto
    const c = norm(code); if (!c) return null;
    return jobs.find(j => [j.barcode, j.code].some(x => norm(x) === c)) ||
           jobs.find(j => [j.barcode].some(x => x && strip(x) === strip(c) && /^\d{8,}/.test(strip(c))));
  }

  const api = { parseAccettazione, readPdf, shrink, barcodeFromImage, scan, matchJob };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OfficinaScheda = api;
})(typeof window !== 'undefined' ? window : globalThis);
