/**
 * BHI Rate Scraper
 * Logs into hotels.bestholidaysinitaly.com, runs year-long rate searches
 * per destination/hotel batch, downloads XLS files and uploads to Google Drive.
 *
 * Environment variables required:
 *   BHI_USERNAME        — portal login username
 *   BHI_PASSWORD        — portal login password
 *   GOOGLE_CREDENTIALS  — Google service account JSON (stringified)
 *   PORT                — HTTP port for the trigger endpoint (Railway sets this)
 */

const { chromium } = require('playwright');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const express = require('express');

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = 'https://hotels.bestholidaysinitaly.com';
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

// Google Drive folder IDs — fill these in after creating the folders in Drive
// or run `node setup-drive.js` to create them automatically.
const DRIVE_FOLDERS = {
  laghi:    process.env.DRIVE_FOLDER_LAGHI    || '',
  toscana:  process.env.DRIVE_FOLDER_TOSCANA  || '',
  sardegna: process.env.DRIVE_FOLDER_SARDEGNA || '',
  liguria:  process.env.DRIVE_FOLDER_LIGURIA  || '',
};

// ─── Hotel batches (max 3 per search) ────────────────────────────────────────
// Each entry: { destination, driveFolder, hotels: [[batch of ≤3], ...] }
// Hotels are the exact names as they appear in the booking engine search.

const SEARCH_BATCHES = [
  // ── LAGHI ────────────────────────────────────────────────────────────────
  // Portal format: DISTINCTIVE NAME - CITY
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 1',
    hotels: ['PALLANZA - VERBANIA', 'SPERANZA AU LAC - STRESA', 'PARADISO - STRESA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 2',
    hotels: ['MAJESTIC - VERBANIA', 'LA PALMA - STRESA', 'ILES BORROMEES - STRESA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 3',
    hotels: ['ASTORIA - STRESA', 'DE CHARME - LAVENO', 'CANNERO - CANNERO RIVIERA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 4',
    hotels: ['GHIFFA - GHIFFA', 'ANCORA - GHIFFA', 'BEL SIT - BAVENO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 5',
    hotels: ['VILLA PORTA - VERBANIA', 'REGINA PALACE - STRESA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 1',
    hotels: ['BARCHETTA EXCELSIOR - COMO', 'ASNIGO - COMO', 'COMO - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 2',
    hotels: ['AXOLUTE - COMO', 'ALBAVILLA - ALBAVILLA', 'DUE CORTI - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 3',
    hotels: ['PONTEVECCHIO - LECCO', 'MENAGGIO - MENAGGIO', 'BELVEDERE - BELLAGIO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 4',
    hotels: ['RADAELLI - COMO', 'GRISO - MALGRATE', 'SEVEN PARK - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 5',
    hotels: ['VILLA CIPRESSI - VARENNA', 'ROYAL VICTORIA - VARENNA', 'HILTON LAKE COMO - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 6',
    hotels: ['SHERATON LAKE COMO - COMO', 'PALACE HOTEL LAKE COMO - COMO', 'LEONARDO DA VINCI - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 1',
    hotels: ['ACQUAVIVA DEL GARDA - DESENZANO DEL GARDA', 'ZIBA - MONIGA DEL GARDA', 'DONNA SILVIA - MANERBA DEL GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 2',
    hotels: ['FLAMINIA - SIRMIONE', 'SIRMIONE - SIRMIONE', 'ALEVIC - SIRMIONE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 3',
    hotels: ['OCELLE - SIRMIONE', 'HI HOTELS SIRMIONE - SIRMIONE', 'CONTINENTAL - SIRMIONE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 4',
    hotels: ['SIRMIONE TERME - SIRMIONE', 'DU PARC - PESCHIERA DEL GARDA', 'KRISTAL PALACE - SIRMIONE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 5',
    hotels: ['PARADISO SUITE - PESCHIERA DEL GARDA', 'EUROPA - PESCHIERA DEL GARDA', 'BELLA ITALIA - PESCHIERA DEL GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 6',
    hotels: ['SISAN - LAZISE', 'ALI DEL FRASSINO - PESCHIERA DEL GARDA', 'PARCHI DEL GARDA - LAZISE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 7',
    hotels: ['PARADISO & GOLF - PESCHIERA DEL GARDA', 'ENJOY GARDA - LAZISE', 'CAESIUS - BARDOLINO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 8',
    hotels: ['RIVA - RIVA DEL GARDA', 'PORTICI - RIVA DEL GARDA', 'ARCO SMART - ARCO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 9',
    hotels: ['LUISE - RIVA DEL GARDA', 'SOLE - RIVA DEL GARDA', 'AQUILA D\'ORO - RIVA DEL GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 10',
    hotels: ['BOFFENIGO - COSTERMANO', 'DU LAC ET DU PARC - RIVA DEL GARDA', 'LIBERTY - ARCO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 11',
    hotels: ['GARDA BELLEVUE - GARDA', 'RIVALTA - CASTELNUOVO DEL GARDA', 'SPLENDID SOLE - MANERBA DEL GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 12',
    hotels: ['SAVOY PALACE - RIVA DEL GARDA', 'MONASTERO - GARGNANO', 'POIANO - GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 13',
    hotels: ['VILLA ARCADIO - SALO'],
  },

  // ── TOSCANA ──────────────────────────────────────────────────────────────
  // Portal format: DISTINCTIVE NAME - CITY (English city names, no "Hotel" prefix)
  {
    destination: 'toscana',
    label: 'Florence',
    hotels: ['GRIFONE - FLORENCE', 'STANLEY - FLORENCE', 'VILLA OLMI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence alternatives',
    hotels: ['LOCANDA DELL\'AMOROSA - SINALUNGA', 'FATTORIA BELVEDERE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Siena / Chianti',
    hotels: ['EXECUTIVE - SIENA', 'PALAZZO DEI PRIORI - VOLTERRA', 'CHIOSTRO DEL CARMINE - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Siena alternatives',
    hotels: ['MONTAPERTI - SIENA', 'DEGLI USIGNOLI - FIRENZE'],
  },
  {
    destination: 'toscana',
    label: 'Pisa',
    hotels: ['BOLOGNA - PISA', 'SAN LINO - VOLTERRA'],
  },

  // ── SARDEGNA ─────────────────────────────────────────────────────────────
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 1',
    hotels: ['UNAHOTELS T Hotel Cagliari', "Caesar's Hotel", 'Flora Hotel'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 2',
    hotels: ['Holiday Inn Cagliari', 'Hotel Villa Fanny', 'Miramare Cagliari Hotel Museo'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 3',
    hotels: ['Phi Hotel Sighientu'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo — batch 1',
    hotels: ['Rina Hotel Alghero', 'Hotel & Spa Riviera Castelsardo', 'Hotel Catalunya'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo — batch 2',
    hotels: ['Villa Barbarina Nature Resort', 'Alghero Resort Country', 'Hotel Oasis'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo — batch 3',
    hotels: ['Calabona', 'LH Pedraladda Resort', 'BW Hotel Blumarea'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo — batch 4',
    hotels: ['Hotel Punta Negra', 'San Marco', 'Soleado'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo — batch 5',
    hotels: ['Janus Hotel', 'Alma di Alghero'],
  },
  {
    destination: 'sardegna',
    label: 'Olbia / Arzachena — batch 1',
    hotels: ['Hotel Panorama', 'Mercure Olbia', 'Jazz Hotel'],
  },
  {
    destination: 'sardegna',
    label: 'Olbia / Arzachena — batch 2',
    hotels: ['Essenza', 'For You Hotel', 'Colonna Palace Mediterraneo'],
  },
  {
    destination: 'sardegna',
    label: 'Olbia / Arzachena — batch 3',
    hotels: ['Hotel DP Olbia Sardinia', 'Hotel Sa Pedra', 'Green Sporting Club'],
  },

  // ── LIGURIA ──────────────────────────────────────────────────────────────
  {
    destination: 'liguria',
    label: 'La Spezia / Cinque Terre',
    hotels: ['CDH Hotel La Spezia', 'Firenze e Continentale', 'B&B Cinque Terre Gateway'],
  },
  {
    destination: 'liguria',
    label: 'Cinque Terre / Camogli',
    hotels: ['Cinque Terre Bridge', 'Hotel Palme'],
  },
  {
    destination: 'liguria',
    label: 'Sestri Levante / Rapallo',
    hotels: ['Grande Albergo', 'Grand Hotel dei Castelli', 'Grand Hotel Villa Balbi'],
  },
  {
    destination: 'liguria',
    label: 'Sestri / Portovenere',
    hotels: ['Hotel Vis a Vis', 'Hotel Cristallo Park', 'Hotiday Room Collection Porto Venere'],
  },
  {
    destination: 'liguria',
    label: 'Genova transit',
    hotels: ['AC Hotel Genova by Marriott', 'BW Moderno Verdi', 'BW Plus City Hotel'],
  },
];

// ─── Google Drive helper ─────────────────────────────────────────────────────

function getDriveClient() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  return google.drive({ version: 'v3', auth });
}

async function uploadToDrive(filePath, fileName, folderId) {
  if (!folderId) {
    console.warn(`  ⚠  No Drive folder configured — skipping upload of ${fileName}`);
    return null;
  }
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/vnd.ms-excel',
      body: fs.createReadStream(filePath),
    },
    fields: 'id, name, webViewLink',
  });
  return res.data;
}

// ─── Scraper core ─────────────────────────────────────────────────────────────

async function login(page) {
  console.log('  → Navigating to login page…');
  // Use 'domcontentloaded' — more reliable than 'networkidle' for portals with
  // persistent background polling that never fully settle
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for the login form to actually appear
  await page.waitForSelector('input[type="password"]', { timeout: 30000 });
  console.log('  → Login form found, filling credentials…');

  await page.fill('input[name="username"], input[type="text"]:first-of-type', process.env.BHI_USERNAME);
  await page.fill('input[name="password"], input[type="password"]', process.env.BHI_PASSWORD);
  await page.click('button[type="submit"], input[type="submit"]');

  // Wait for the page to change after login rather than a nav event
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
    .catch(() => page.waitForTimeout(5000)); // fallback: just wait 5s if no nav fires
  console.log('  ✓ Logged in — current URL:', page.url());
}

async function runBatch(page, batch, downloadDir) {
  console.log(`\n  🔍  ${batch.label} (${batch.hotels.length} hotel${batch.hotels.length > 1 ? 's' : ''})`);

  // Navigate to search page (login + search are both on index.php)
  await page.goto(`${BASE_URL}/index.php`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // The "Select Hotels" field is a Select2 multi-select widget.
  // The underlying element is <select id="hotels-select">.
  // We interact via the Select2 JS API for reliability.
  await page.waitForSelector('#hotels-select', { timeout: 15000 });

  for (const hotelName of batch.hotels) {
    console.log(`    → Selecting: ${hotelName}`);

    // Click the Select2 search textarea to open the dropdown
    const searchBox = page.locator('textarea.select2-search__field[aria-label="Search"]').nth(1); // nth(1) = hotels (nth(0) = cities)
    await searchBox.click();
    await searchBox.fill('');
    // Hotel names are in portal format: "DISTINCTIVE NAME - CITY"
    // Search using the first significant word (before the dash)
    const beforeDash = hotelName.split(' - ')[0].trim();
    const searchTerm = beforeDash.split(' ')[0].substring(0, 10);
    console.log(`    → Search term: "${searchTerm}" for: ${hotelName}`);
    await searchBox.type(searchTerm, { delay: 80 });

    // Wait for Select2 to finish searching (clear the "Searching…" state)
    await page.waitForFunction(() => {
      const opts = document.querySelectorAll('.select2-results__option');
      return opts.length > 0 && ![...opts].every(o => o.textContent.includes('Searching'));
    }, { timeout: 10000 }).catch(() => null);

    // Find and click the best matching option
    const options = await page.locator('.select2-results__option').all();
    // Match: hotel names are in portal format "DISTINCTIVE - CITY"
    // Find the option whose text matches our portal-format name most closely
    const targetLower = hotelName.toLowerCase();
    const targetParts = targetLower.split(' - ').map(s => s.trim());
    let matched = false;
    for (const opt of options) {
      const text = (await opt.textContent() || '').trim();
      const textLower = text.toLowerCase();
      // Check all parts of our name appear in the option text
      if (targetParts.every(part => textLower.includes(part))) {
        await opt.click();
        matched = true;
        console.log(`    ✓ Matched: "${text}"`);
        break;
      }
    }
    // Fallback: match just the first part (before the dash)
    if (!matched) {
      for (const opt of options) {
        const text = (await opt.textContent() || '').trim();
        const textLower = text.toLowerCase();
        if (textLower.includes(targetParts[0])) {
          await opt.click();
          matched = true;
          console.log(`    ⚠ Partial match: "${text}"`);
          break;
        }
      }
    }
    if (!matched && options.length > 0) {
      // Fallback: pick first result
      const text = (await options[0].textContent() || '').trim();
      await options[0].click();
      console.log(`    ⚠ Fallback first result: "${text}"`);
    } else if (!matched) {
      console.warn(`    ✗ No results for: ${hotelName}`);
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(400);
  }

  // Click "Schedule search by year" button
  console.log('    → Clicking "Schedule search by year"…');
  await page.click('button:has-text("Schedule search by year"), input[value*="Schedule search by year"]');

  // The form submission takes us to (or reloads to) status.php
  // Use a navigation wait with fallback
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => page.waitForTimeout(5000));

  // If we're not on status.php yet, click "Search status" link/button
  if (!page.url().includes('status.php')) {
    console.log('    → Navigating to status.php…');
    const statusBtn = page.locator('button:has-text("Search status"), a:has-text("Search status"), a[href*="status"]').first();
    await statusBtn.click({ timeout: 10000 }).catch(async () => {
      await page.goto(`${BASE_URL}/status.php`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    });
    await page.waitForTimeout(3000);
  }

  // On status.php — wait for download link (XLS file for this search)
  // The search runs server-side so it may take a minute; poll for up to 5 minutes
  console.log('    → Waiting for XLS download link on status page…');
  const downloadLink = page.locator(
    'a[href$=".xls"], a[href$=".xlsx"], a:has-text("Download"), a:has-text("XLS"), a:has-text("Excel")'
  ).first();

  await downloadLink.waitFor({ timeout: 300000 }); // up to 5 min for server-side search

  const date = new Date().toISOString().slice(0, 10);
  const safeName = batch.label.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const fileName = `bhi_rates_${batch.destination}_${safeName}_${date}.xls`;
  const filePath = path.join(downloadDir, fileName);

  console.log('    → Downloading XLS…');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadLink.click(),
  ]);
  await download.saveAs(filePath);
  console.log(`  ✓ Downloaded → ${fileName}`);
  return { filePath, fileName };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function runScraper(targetDestination = null) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    acceptDownloads: true,
  });
  const page = await context.newPage();

  const results = [];
  const errors = [];

  try {
    await login(page);

    const batches = targetDestination
      ? SEARCH_BATCHES.filter(b => b.destination === targetDestination)
      : SEARCH_BATCHES;

    console.log(`\n📋  Running ${batches.length} search batch(es)…`);

    for (const batch of batches) {
      try {
        const { filePath, fileName } = await runBatch(page, batch, DOWNLOAD_DIR);

        // Upload to Drive
        const folderId = DRIVE_FOLDERS[batch.destination];
        console.log(`  ☁  Uploading to Drive (${batch.destination})…`);
        const driveFile = await uploadToDrive(filePath, fileName, folderId);
        if (driveFile) {
          console.log(`  ✓ Drive: ${driveFile.webViewLink}`);
          results.push({ batch: batch.label, file: fileName, drive: driveFile.webViewLink });
        } else {
          results.push({ batch: batch.label, file: fileName, drive: null });
        }

        // Small pause between searches to be polite to the server
        await page.waitForTimeout(2000);
      } catch (err) {
        console.error(`  ✗ Error on "${batch.label}": ${err.message}`);
        errors.push({ batch: batch.label, error: err.message });
      }
    }
  } finally {
    await browser.close();
  }

  return { results, errors };
}

// ─── Express trigger endpoint ─────────────────────────────────────────────────
// GET /run          → run all destinations
// GET /run/laghi    → run only Laghi batches
// GET /run/toscana  → run only Toscana batches
// etc.
// GET /health       → health check

const app = express();

app.get('/', (req, res) => res.json({
  service: 'BHI Rate Scraper',
  endpoints: {
    health:       'GET /health',
    run_all:      'GET /run',
    run_dest:     'GET /run/:destination  (laghi | toscana | sardegna | liguria)',
    list_files:   'GET /files',
    download:     'GET /files/:filename',
  },
}));

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Debug: login and dump all interactive elements on the search page (async)
// GET /debug/form  → starts the inspection, returns immediately
// GET /debug/result → returns the saved JSON once it's ready
const DEBUG_FILE = path.join(DOWNLOAD_DIR, '_debug_form.json');

app.get('/debug/form', (req, res) => {
  res.json({ status: 'started', poll: '/debug/result', note: 'check /debug/result in ~90 seconds' });
  // Run in background
  (async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await login(page);
      await page.waitForTimeout(3000); // let JS widgets initialise
      const info = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll(
          'input, select, textarea, button, [role="combobox"], [role="listbox"], [role="textbox"], [contenteditable]'
        ));
        return elements.map(el => ({
          tag: el.tagName,
          type: el.type || '',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
          className: (el.className || '').substring(0, 100),
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          text: (el.textContent || '').trim().substring(0, 80),
          visible: el.offsetParent !== null,
        }));
      });
      const formHtml = await page.evaluate(() => {
        const form = document.querySelector('form');
        return form ? form.outerHTML.substring(0, 6000) : document.body.innerHTML.substring(0, 6000);
      });
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
      fs.writeFileSync(DEBUG_FILE, JSON.stringify({ url: page.url(), ts: new Date().toISOString(), elements: info, formHtmlSnippet: formHtml }, null, 2));
      console.log('  ✓ Debug form dump saved to _debug_form.json');
    } catch (err) {
      fs.writeFileSync(DEBUG_FILE, JSON.stringify({ error: err.message, ts: new Date().toISOString() }, null, 2));
      console.error('  ✗ Debug error:', err.message);
    } finally {
      await browser.close();
    }
  })();
});

app.get('/debug/result', (req, res) => {
  if (!fs.existsSync(DEBUG_FILE)) {
    return res.json({ status: 'not ready yet — try again in 30 seconds' });
  }
  const data = JSON.parse(fs.readFileSync(DEBUG_FILE, 'utf8'));
  res.json(data);
});

// Dump every option from the hotels-select dropdown as plain text (one per line)
app.get('/debug/hotels', (req, res) => {
  res.json({ status: 'started', poll: '/debug/hotels-result' });
  (async () => {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await login(page);
      await page.waitForSelector('#hotels-select', { timeout: 15000 });
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

      // Intercept ALL network requests to find the Select2 AJAX endpoint
      const capturedRequests = [];
      const capturedResponses = [];
      page.on('request', req => {
        capturedRequests.push({ url: req.url(), method: req.method(), headers: req.headers() });
      });
      page.on('response', async resp => {
        try {
          const url = resp.url();
          const ct = resp.headers()['content-type'] || '';
          if (ct.includes('json') || ct.includes('text')) {
            const body = await resp.text().catch(() => '');
            if (body.length < 500000) capturedResponses.push({ url, status: resp.status(), ct, body: body.substring(0, 2000) });
          }
        } catch(e) {}
      });

      // Trigger Select2 search
      const searchBox = page.locator('textarea.select2-search__field[aria-label="Search"]').nth(1);
      await searchBox.click();
      await searchBox.type('a', { delay: 100 });
      await page.waitForTimeout(4000);

      // Save everything we captured
      fs.writeFileSync(path.join(DOWNLOAD_DIR, '_network_requests.json'), JSON.stringify({ requests: capturedRequests, responses: capturedResponses }, null, 2));

      // Also find the Select2 init code in the page source
      const select2Config = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script:not([src])')).map(s => s.textContent);
        return scripts.filter(s => s.includes('select2') || s.includes('hotels-select') || s.includes('ajax'));
      });
      fs.writeFileSync(path.join(DOWNLOAD_DIR, '_select2_config.json'), JSON.stringify(select2Config, null, 2));

      const hotels = ['[check /debug/network and /debug/select2config]'];
      const outPath = path.join(DOWNLOAD_DIR, '_hotels_list.txt');
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
      fs.writeFileSync(outPath, hotels.join('\n'));
      fs.writeFileSync(path.join(DOWNLOAD_DIR, '_hotels_list.json'), JSON.stringify({ count: hotels.length, hotels }, null, 2));
      console.log(`  ✓ Hotels list saved: ${hotels.length} entries`);
    } catch (err) {
      fs.writeFileSync(path.join(DOWNLOAD_DIR, '_hotels_list.json'), JSON.stringify({ error: err.message }));
      console.error('  ✗ Hotels list error:', err.message);
    } finally {
      await browser.close();
    }
  })();
});

app.get('/debug/network', (req, res) => {
  const f = path.join(DOWNLOAD_DIR, '_network_requests.json');
  if (!fs.existsSync(f)) return res.json({ status: 'not ready' });
  res.setHeader('Content-Type', 'application/json');
  res.send(fs.readFileSync(f));
});

app.get('/debug/select2config', (req, res) => {
  const f = path.join(DOWNLOAD_DIR, '_select2_config.json');
  if (!fs.existsSync(f)) return res.json({ status: 'not ready' });
  res.setHeader('Content-Type', 'application/json');
  res.send(fs.readFileSync(f));
});

app.get('/debug/hotels-result', (req, res) => {
  const jsonPath = path.join(DOWNLOAD_DIR, '_hotels_list.json');
  const txtPath = path.join(DOWNLOAD_DIR, '_hotels_list.txt');
  if (!fs.existsSync(jsonPath)) return res.json({ status: 'not ready yet' });
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (data.error) return res.status(500).json(data);
  // Return as plain text for easy reading
  if (req.query.format === 'json') return res.json(data);
  res.setHeader('Content-Type', 'text/plain');
  res.send(fs.readFileSync(txtPath, 'utf8'));
});

// List all downloaded files
app.get('/files', (req, res) => {
  try {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      return res.json({ files: [], message: 'No files downloaded yet. Run /run first.' });
    }
    const files = fs.readdirSync(DOWNLOAD_DIR)
      .filter(f => f.endsWith('.xls') || f.endsWith('.xlsx'))
      .map(f => {
        const stat = fs.statSync(path.join(DOWNLOAD_DIR, f));
        return {
          name: f,
          size: `${(stat.size / 1024).toFixed(1)} KB`,
          downloaded: stat.mtime.toISOString().slice(0, 16).replace('T', ' '),
          url: `/files/${f}`,
        };
      })
      .sort((a, b) => b.downloaded.localeCompare(a.downloaded));
    res.json({ count: files.length, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download a specific file
app.get('/files/:filename', (req, res) => {
  const filePath = path.join(DOWNLOAD_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(filePath);
});

app.get('/run/:destination?', async (req, res) => {
  const dest = req.params.destination || null;
  console.log(`\n🚀  Scrape triggered — destination: ${dest || 'ALL'}`);
  res.json({ status: 'started', destination: dest || 'all', ts: new Date().toISOString() });

  // Run in background so the HTTP response returns immediately
  runScraper(dest)
    .then(({ results, errors }) => {
      console.log(`\n✅  Scrape complete. ${results.length} succeeded, ${errors.length} failed.`);
      if (errors.length) console.error('Errors:', errors);
    })
    .catch(err => console.error('Fatal scraper error:', err));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏨  BHI Rate Scraper ready on port ${PORT}`);
  console.log(`   Health:  GET /health`);
  console.log(`   Run all: GET /run`);
  console.log(`   Run one: GET /run/laghi | /run/toscana | /run/sardegna | /run/liguria\n`);
});
