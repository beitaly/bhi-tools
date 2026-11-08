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
  // Portal format: NAME - CITIES_NAMES (from hotels.csv cities_names column)
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 1',
    hotels: ['PALLANZA - LAKE MAGGIORE', 'MILAN SPERANZA AU LAC - LAKE MAGGIORE', 'GRAND HOTEL DES ILES BORROMEES - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 2',
    hotels: ['GRAND HOTEL MAJESTIC - LAKE MAGGIORE', 'LA PALMA - LAKE MAGGIORE', 'REGINA PALACE - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 3',
    hotels: ['GRAND HOTEL DINO - LAKE MAGGIORE', 'VILLA  E PALAZZO AMINTA HOTEL BEAUTY & SPA - LAKE MAGGIORE', 'GRAND HOTEL BRISTOL - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 4',
    hotels: ['LIDO PALACE - BAVENO - VERBANIA', 'SIMPLON - LAKE MAGGIORE', 'ASTORIA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 5',
    hotels: ['ALBERGO VERBANO - LAKE MAGGIORE', 'HOTEL CANNERO LAKESIDE RESORT - LAKE MAGGIORE', 'GHIFFA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 1',
    hotels: ['GRAND HOTEL TREMEZZO - LAKE COMO', 'GRAND HOTEL VILLA SERBELLONI - LAKE COMO', 'GRAND HOTEL VICTORIA CONCEPT & SPA - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 2',
    hotels: ['HILTON LAKE COMO - LAKE COMO', 'GRAND HOTEL MENAGGIO - LAKE COMO', 'HOTEL BAZZONI - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 3',
    hotels: ['TERMINUS - LAKE COMO', 'VILLA FLORI - LAKE COMO', 'GRAND HOTEL IMPERIALE RESORT&SPA - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 4',
    hotels: ['LAURIN - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 1',
    hotels: ['GRAND HOTEL GARDONE - LAKE GARDA', 'SPLENDID PALACE - LKGD', 'LAURIN - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 2',
    hotels: ['RELAIS CORTE PARADISO - LAKE GARDA', 'HOTEL CONTINENTAL - LAKE GARDA', 'HOTEL TERMINUS - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 3',
    hotels: ['INTERNATIONAL - LAKE GARDA', 'HOTEL CONTINENTAL - TONELLI HOTELS - LAKE GARDA', 'HOTEL VILLA CARLOTTA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 4',
    hotels: ['LIDO PALACE - LAKE GARDA'],
  },

  // ── TOSCANA ──────────────────────────────────────────────────────────────
  // Portal format: NAME - CITIES_NAMES (verified from CSV)
  {
    destination: 'toscana',
    label: 'Florence',
    hotels: ['GRIFONE - FLORENCE', 'VILLA STANLEY - FLORENCE', 'VILLA OLMI FIRENZE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence alternatives',
    hotels: ['RELAIS FATTORIA BELVEDERE - MONTECATINI VAL DI CECINA - PISA', 'FATTORIA DEGLI USIGNOLI - REGGELLO - FIRENZE'],
  },
  {
    destination: 'toscana',
    label: 'Siena / Volterra',
    hotels: ['HOTEL EXECUTIVE - SIENA', 'PALAZZO DEI PRIORI - SIENA', 'IL CHIOSTRO DEL CARMINE - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Siena alternatives',
    hotels: ['PRECISE HOUSE MONTAPERTI SIENA - SIENA', 'PARK HOTEL - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Pisa / Volterra',
    hotels: ['HOTEL SAN LINO - VOLTERRA - PISA'],
  },

  // ── SARDEGNA ─────────────────────────────────────────────────────────────
  // Portal format: NAME - CITIES_NAMES (verified from CSV)
  {
    destination: 'sardegna',
    label: 'Costa Smeralda — batch 1',
    hotels: ['CALA DI VOLPE, A LUXURY COLLECTION HOTEL, COSTA SMERALDA - PORTO CERVO - OLBIA TEMPIO', 'PITRIZZA - PORTO CERVO - OLBIA TEMPIO', 'ROMAZZINO, A LUXURY COLLECTION HOTEL, COSTA SMERALDA - PORTO CERVO - OLBIA TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Costa Smeralda — batch 2',
    hotels: ['CERVO HOTEL COSTA SMERALDA RESORT - PORTO CERVO - OLBIA TEMPIO', 'HOTEL PULICINU - BAJA SARDINIA - OLBIA-TEMPIO', 'GRAND HOTEL SMERALDO BEACH - BAJA SARDINIA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Costa Smeralda — batch 3',
    hotels: ['GRAND RELAIS DEI NURAGHI - BAJA SARDINIA - OLBIA-TEMPIO', 'COLONNA GRAND HOTEL CAPO TESTA - SANTA TERESA DI GALLURA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'North coast — batch 1',
    hotels: ['MARINEDDA THALASSO & SPA - ISOLA ROSSA - OLBIA-TEMPIO', 'RELAX TORRERUJA THALASSO & SPA - ISOLA ROSSA - OLBIA-TEMPIO', 'HOTEL & SPA RIVIERA CASTELSARDO - CASTELSARDO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'South — batch 1',
    hotels: ['IS MORUS RELAIS - SANTA MARGHERITA DI PULA - CAGLIARI', 'HOTEL FLAMINGO - SANTA MARGHERITA DI PULA - CAGLIARI', 'FORTE VILLAGE RESORT - SANTA MARGHERITA DI PULA - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'South — batch 2',
    hotels: ['FORTE VILLAGE RESORT - IL VILLAGGIO - SANTA MARGHERITA DI PULA - CAGLIARI', 'FORTE VILLAGE RESORT - LE PALME - SANTA MARGHERITA DI PULA - CAGLIARI', 'FORTE VILLAGE RESORT - IL BORGO - SANTA MARGHERITA DI PULA - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'South — batch 3',
    hotels: ['FORTE VILLAGE RESORT - HOTEL PINETA - SANTA MARGHERITA DI PULA - CAGLIARI', 'FORTE VILLAGE RESORT - VILLA DEL PARCO - SANTA MARGHERITA DI PULA - CAGLIARI', 'HOTEL REGINA MARGHERITA - CAGLIARI'],
  },

  // ── LIGURIA ──────────────────────────────────────────────────────────────
  // Portal format: NAME - CITIES_NAMES (verified from CSV)
  {
    destination: 'liguria',
    label: 'Sanremo — batch 1',
    hotels: ['ROYAL HOTEL SANREMO - SANREMO - IMPERIA', 'MIRAMARE THE PALACE HOTEL - SANREMO - IMPERIA', 'GRAND HOTEL LONDRA - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Sanremo — batch 2',
    hotels: ['GRAND HOTEL DES ANGLAIS - SANREMO - IMPERIA', 'NAZIONALE - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Santa Margherita / Rapallo — batch 1',
    hotels: ['IMPERIALE PALACE - SANTA MARGHERITA LIGURE - GENOA', 'GRAND HOTEL MIRAMARE - SANTA MARGHERITA LIGURE - GENOA', 'LIDO PALACE - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Santa Margherita / Rapallo — batch 2',
    hotels: ['EXCELSIOR PALACE - RAPALLO - GENUA', 'GRAND HOTEL BRISTOL RESORT & SPA - RAPALLO - GENUA', 'LAURIN - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Sestri Levante',
    hotels: ['GRAND HOTEL DEI CASTELLI - SESTRI LEVANTE - GENOVA', 'GRAND HOTEL VILLA BALBI - SESTRI LEVANTE - GENOVA', 'GRANDE ALBERGO - SESTRI LEVANTE - GENOVA'],
  },
  {
    destination: 'liguria',
    label: 'Genova',
    hotels: ['GRAND HOTEL SAVOIA - GENOA', 'HOTEL CONTINENTAL - GENOA'],
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

      // Now we know the endpoint: hotel_search.php?term=<query>
      // minimumInputLength: 2, so use 2-letter prefixes (aa, ab, ... zz)
      const allHotels = new Map(); // text -> id (deduplicate)
      const alpha = 'abcdefghijklmnopqrstuvwxyz';
      const queries = [];
      for (const a of alpha) for (const b of alpha) queries.push(a + b);

      for (const term of queries) {
        const results = await page.evaluate(async ({ baseUrl, term }) => {
          const r = await fetch(`${baseUrl}/hotel_search.php?term=${encodeURIComponent(term)}`, { credentials: 'include' });
          const text = await r.text();
          try { return JSON.parse(text); } catch(e) { return { error: text.substring(0, 200) }; }
        }, { baseUrl: BASE_URL, term });

        const items = (results && results.results) ? results.results : (Array.isArray(results) ? results : []);
        for (const item of items) {
          if (item.text && !allHotels.has(item.text)) allHotels.set(item.text, item.id || '');
        }
        if (items.length > 0) console.log(`  ${term}: ${items.length} results (total unique: ${allHotels.size})`);
        await page.waitForTimeout(100);
      }
      console.log(`  → Finished a-z sweep, total unique hotels: ${allHotels.size}`);

      const hotels = [...allHotels.keys()].sort();
      const outPath = path.join(DOWNLOAD_DIR, '_hotels_list.txt');
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

app.get('/debug/scriptsjs', (req, res) => {
  const f = path.join(DOWNLOAD_DIR, '_scripts.js');
  if (!fs.existsSync(f)) return res.json({ status: 'not ready' });
  res.setHeader('Content-Type', 'text/plain');
  res.send(fs.readFileSync(f));
});

app.get('/debug/netlog', (req, res) => {
  const f = path.join(DOWNLOAD_DIR, '_network_requests.json');
  if (!fs.existsSync(f)) return res.json({ status: 'not ready' });
  res.setHeader('Content-Type', 'application/json');
  res.send(fs.readFileSync(f));
});

app.get('/debug/s2config', (req, res) => {
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
