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
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 1',
    hotels: ['Pallanza by LVG Hotel Collection', 'Milan Speranza au Lac', 'Villa Paradiso'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 2',
    hotels: ['Grand Hotel Majestic', 'Hotel La Palma', 'Iles Borromees'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 3',
    hotels: ['Astoria', 'De Charme Laveno', 'Hotel Cannero Lakeside Resort'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 4',
    hotels: ['Ghiffa', 'Ancora', 'Bel Sit'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 5',
    hotels: ['Relais Villa Porta', 'Regina Palace'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 1',
    hotels: ['Barchetta Excelsior', 'Asnigo', 'Como'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 2',
    hotels: ['Axolute Comfort', 'Albavilla Hotel & Co.', 'Albergo Le Due Corti'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 3',
    hotels: ['NH Lecco Pontevecchio', 'Grand Hotel Menaggio', 'Belvedere'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 4',
    hotels: ["Red's Radaelli", 'Griso Collection', 'Seven Park'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 5',
    hotels: ['Hotel Villa Cipressi', 'Royal Victoria', 'Hilton Lake Como'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como — batch 6',
    hotels: ['Sheraton Lake Como', 'Palace Hotel Lake Como', 'BW Leonardo da Vinci'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 1',
    hotels: ['Acquaviva del Garda', 'The Ziba Hotel & Spa', 'Donna Silvia'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 2',
    hotels: ['Flaminia', 'Sirmione', 'Alevic Hotel Sirmione'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 3',
    hotels: ['Hotel Ocelle Thermae & Spa', 'HI Hotels Sirmione Lakeview Pool', 'Hotel Continental Wellness & Spa'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 4',
    hotels: ['Hotel Sirmione Terme', 'Du Parc', 'Kristal Palace'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 5',
    hotels: ['Villa Paradiso Suite', 'Hotel Europa', 'Hotel Bella Italia'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 6',
    hotels: ['Sisan Family Resort', 'Le Ali del Frassino', 'TH Lazise Hotel Parchi del Garda'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 7',
    hotels: ['Active Hotel Paradiso & Golf', 'Enjoy Garda', 'Caesius Thermae & Spa Resort'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 8',
    hotels: ['Grand Hotel Riva', 'Hotel Portici Romantik & Wellness', 'Arco Smart Hotel'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 9',
    hotels: ['Hotel Luise', 'Hotel Sole Relax & Panorama', 'Hotel Aquila dOro'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 10',
    hotels: ['Hotel Boffenigo The Golden Hour', 'Du Lac et Du Parc', 'Grand Hotel Liberty'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 11',
    hotels: ['Garda Bellevue', 'Rivalta Life Style Hotel', 'Splendid Sole'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 12',
    hotels: ['Savoy Palace', 'Monastero Resort & Spa', 'Poiano Resort'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda — batch 13',
    hotels: ['Villa Arcadio Hotel & Resort'],
  },

  // ── TOSCANA ──────────────────────────────────────────────────────────────
  {
    destination: 'toscana',
    label: 'Florence',
    hotels: ['Hotel Grifone Firenze', 'Villa Stanley', 'Villa Olmi MGallery'],
  },
  {
    destination: 'toscana',
    label: 'Florence alternatives',
    hotels: ['La Locanda dellAmorosa', 'Fattoria Belvedere'],
  },
  {
    destination: 'toscana',
    label: 'Siena / Chianti',
    hotels: ['Executive Hotel Siena', 'Palazzo dei Priori', 'Il Chiostro del Carmine'],
  },
  {
    destination: 'toscana',
    label: 'Siena alternatives',
    hotels: ['Montaperti', 'Relais degli Usignoli'],
  },
  {
    destination: 'toscana',
    label: 'Pisa',
    hotels: ['Hotel Bologna', 'San Lino'],
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

  // Wait for the search form — the "Select Hotels" typeahead input
  // The form is on the same page as login; after login it shows the search form
  await page.waitForSelector('input[placeholder*="hotel"], input[placeholder*="Hotel"]', { timeout: 15000 });

  // The "Select Hotels" field is a typeahead — type each hotel name, wait for
  // the dropdown, click the first suggestion, then type the next one.
  const hotelInput = page.locator('input[placeholder*="hotel"], input[placeholder*="Hotel"]').first();

  for (const hotelName of batch.hotels) {
    await hotelInput.click();
    await hotelInput.fill(''); // clear any previous partial input
    await hotelInput.type(hotelName.substring(0, 4), { delay: 80 }); // type first 4 chars to trigger suggestions
    console.log(`    → Typing "${hotelName.substring(0, 4)}" for: ${hotelName}`);

    // Wait for autocomplete dropdown
    const suggestion = page.locator(
      'li[role="option"], .autocomplete-item, .select2-result, .ui-menu-item, ' +
      '[class*="suggestion"], [class*="dropdown"] li, [class*="option"]'
    ).first();

    try {
      await suggestion.waitFor({ timeout: 8000 });
      // Try to click the item that most closely matches the full hotel name
      const allSuggestions = await page.locator(
        'li[role="option"], .autocomplete-item, .select2-result, .ui-menu-item, ' +
        '[class*="suggestion"], [class*="dropdown"] li, [class*="option"]'
      ).all();
      let clicked = false;
      for (const s of allSuggestions) {
        const text = (await s.textContent() || '').trim();
        if (text && hotelName.toLowerCase().includes(text.toLowerCase().substring(0, 6))) {
          await s.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        // Fallback: click the first suggestion
        await suggestion.click();
      }
      console.log(`    ✓ Selected: ${hotelName}`);
      await page.waitForTimeout(500); // small pause between selections
    } catch (e) {
      console.warn(`    ⚠  No autocomplete suggestion for: ${hotelName} — ${e.message}`);
      // Press Escape to close any open dropdown and continue
      await page.keyboard.press('Escape');
    }
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

// Debug: login and dump all interactive elements on the search page
app.get('/debug/form', async (req, res) => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page);
    // Wait a beat for any JS widgets to initialise
    await page.waitForTimeout(3000);
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
        className: (el.className || '').substring(0, 80),
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        text: (el.textContent || '').trim().substring(0, 60),
        visible: el.offsetParent !== null,
      }));
    });
    // Also grab a snippet of the form HTML
    const formHtml = await page.evaluate(() => {
      const form = document.querySelector('form');
      return form ? form.outerHTML.substring(0, 4000) : document.body.innerHTML.substring(0, 4000);
    });
    res.json({ url: page.url(), elements: info, formHtmlSnippet: formHtml });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await browser.close();
  }
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
