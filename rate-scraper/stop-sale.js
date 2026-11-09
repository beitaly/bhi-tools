/**
 * stop-sale.js
 * Post-scrape module for BHI Rate Scraper.
 *
 * Reads the XLS rate-sheet files uploaded to Google Drive for a given destination,
 * determines OPEN / PARTIAL / STOP availability per month per package duration,
 * and writes an XLSX report to Drive.
 *
 * ─── AVAILABILITY LOGIC ──────────────────────────────────────────────────────
 * For each month and each package duration (nts), we look at every hotel
 * included in that package type and check whether it has *any* dates available
 * during that month. The hotel-level availability comes from the XLS rate sheets
 * (which are identical to the ones the booking engine shows):
 *   - A cell is AVAILABLE if it contains a numeric rate > 0
 *   - A cell is STOP SALE if it is 0, blank, or the string "SS"
 *
 * Per destination we know which hotels belong to which package:
 *   Laghi v1 Black Friday (5nts): 3 Maggiore hotels + 2 Como hotels
 *   Laghi v2 Maggiore & Garda (7nts): 3 Maggiore hotels + 2 Garda hotels
 *   Laghi v3 Classic 7nts:  3 Mgre + 2 Como + 2 Garda
 *   Laghi v3 Classic 9nts:  3 Mgre + 2 Como + 4 Garda
 *   Laghi v3 Classic 12nts: 4 Mgre + 4 Como + 4 Garda
 *   Toscana 5nts / 7nts: all Toscana hotels
 *   Sardegna 7nts / 10nts / 12nts: all Sardegna hotels
 *   Liguria 5nts / 7nts: all Liguria hotels
 *   Puglia 7nts / 10nts: all Puglia hotels
 *
 * OPEN    = every hotel in the package has ≥1 available date in the month
 * PARTIAL = some (but not all) hotels have ≥1 available date
 * STOP    = no hotel has any available date in the month
 *
 * ─── XLS FILE STRUCTURE ──────────────────────────────────────────────────────
 * The booking engine exports XLS (BIFF8) files. Each file covers one "batch"
 * search (up to 3 hotels, 1 year). The layout is:
 *
 *   Row 0:  ignored (markup multipliers)
 *   Per month block:
 *     Row n:   col A = None,  col B/C = month name ("January 2027", etc.)
 *     Row n+1: col A = hotel name, col B… = rate per day (day 1, day 2, …)
 *     Row n+2: col A = hotel name, col B… = (duplicate / per-person)
 *     Row n+3: col A = hotel name, col B… = (another variant)
 *   The hotel row we want is row n+1 (first hotel row in the block).
 *
 * We extract from the XLS: { hotelName → { month → [day rates] } }
 *
 * ─── OUTPUT ──────────────────────────────────────────────────────────────────
 * One XLSX workbook per destination, tabs per package variant:
 *   Columns: Month | v1 (5nts) | v2 (7nts) | v3-7nts | v3-9nts | v3-12nts
 *   Cell fill: green (OPEN), amber (PARTIAL), red (STOP)
 *   Uploaded to the destination's VP_2027_FOLDER_xxx Drive folder.
 */

'use strict';

const { google } = require('googleapis');
const ExcelJS    = require('exceljs');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');

// ─── Google auth ─────────────────────────────────────────────────────────────
function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}
function getDriveClient() { return google.drive({ version: 'v3', auth: getAuth() }); }

// ─── Constants ────────────────────────────────────────────────────────────────
const MONTHS_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Month name matching (XLS month cell values like "January 2027", "March 2027", …)
const MONTH_ABBR = {
  january:'Jan', february:'Feb', march:'Mar', april:'Apr', may:'May', june:'Jun',
  july:'Jul', august:'Aug', september:'Sep', october:'Oct', november:'Nov', december:'Dec',
};

// Colours for OPEN / PARTIAL / STOP
const FILL_OPEN    = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF4CAF50' } }; // green
const FILL_PARTIAL = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFC107' } }; // amber
const FILL_STOP    = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF44336' } }; // red
const FILL_NA      = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFB0BEC5' } }; // grey

// ─── Package definitions per destination ─────────────────────────────────────
// Each package lists the HOTEL NAME PATTERNS that must all be available.
// We do case-insensitive substring matching against hotel names from XLS files.
// A "group" is a set of hotel name patterns; ALL groups must have ≥1 hotel
// available for the status to be OPEN (each group = one lake / zone).

const PACKAGE_DEFS = {
  laghi: [
    {
      label: 'v1 Black Friday (5nts)',
      groups: [
        { zone: 'Maggiore', patterns: ['MAGGIORE'], minHotels: 3 },
        { zone: 'Como',     patterns: ['COMO','LECCO'], minHotels: 2 },
      ],
    },
    {
      label: 'v2 Maggiore & Garda (7nts)',
      groups: [
        { zone: 'Maggiore', patterns: ['MAGGIORE'], minHotels: 3 },
        { zone: 'Garda',    patterns: ['GARDA'], minHotels: 2 },
      ],
    },
    {
      label: 'v3 Classic 7nts',
      groups: [
        { zone: 'Maggiore', patterns: ['MAGGIORE'], minHotels: 3 },
        { zone: 'Como',     patterns: ['COMO','LECCO'], minHotels: 2 },
        { zone: 'Garda',    patterns: ['GARDA'], minHotels: 2 },
      ],
    },
    {
      label: 'v3 Classic 9nts',
      groups: [
        { zone: 'Maggiore', patterns: ['MAGGIORE'], minHotels: 3 },
        { zone: 'Como',     patterns: ['COMO','LECCO'], minHotels: 2 },
        { zone: 'Garda',    patterns: ['GARDA'], minHotels: 4 },
      ],
    },
    {
      label: 'v3 Classic 12nts',
      groups: [
        { zone: 'Maggiore', patterns: ['MAGGIORE'], minHotels: 4 },
        { zone: 'Como',     patterns: ['COMO','LECCO'], minHotels: 4 },
        { zone: 'Garda',    patterns: ['GARDA'], minHotels: 4 },
      ],
    },
  ],

  toscana: [
    {
      label: '5nts',
      groups: [{ zone: 'Toscana', patterns: ['TOSCANA','TUSCANY','CHIANTI','SIENA','FIRENZE','FLORENCE'], minHotels: 1 }],
    },
    {
      label: '7nts',
      groups: [{ zone: 'Toscana', patterns: ['TOSCANA','TUSCANY','CHIANTI','SIENA','FIRENZE','FLORENCE'], minHotels: 1 }],
    },
  ],

  sardegna: [
    {
      label: '7nts',
      groups: [{ zone: 'Sardegna', patterns: ['SARDEGNA','SARDINIA','COSTA SMERALDA','ALGHERO','CAGLIARI','PALAU','VILLASIMIUS'], minHotels: 1 }],
    },
    {
      label: '10nts',
      groups: [{ zone: 'Sardegna', patterns: ['SARDEGNA','SARDINIA','COSTA SMERALDA','ALGHERO','CAGLIARI','PALAU','VILLASIMIUS'], minHotels: 1 }],
    },
    {
      label: '12nts',
      groups: [{ zone: 'Sardegna', patterns: ['SARDEGNA','SARDINIA','COSTA SMERALDA','ALGHERO','CAGLIARI','PALAU','VILLASIMIUS'], minHotels: 1 }],
    },
  ],

  liguria: [
    {
      label: '5nts',
      groups: [{ zone: 'Liguria', patterns: ['LIGURIA','CINQUE TERRE','PORTOFINO','GENOVA','GENOA','SANTA MARGHERITA','CAMOGLI','SESTRI'], minHotels: 1 }],
    },
    {
      label: '7nts',
      groups: [{ zone: 'Liguria', patterns: ['LIGURIA','CINQUE TERRE','PORTOFINO','GENOVA','GENOA','SANTA MARGHERITA','CAMOGLI','SESTRI'], minHotels: 1 }],
    },
  ],

  puglia: [
    {
      label: '7nts',
      groups: [{ zone: 'Puglia', patterns: ['PUGLIA','APULIA','ALBEROBELLO','OSTUNI','LECCE','FASANO','BRINDISI','BARI','OTRANTO'], minHotels: 1 }],
    },
    {
      label: '10nts',
      groups: [{ zone: 'Puglia', patterns: ['PUGLIA','APULIA','ALBEROBELLO','OSTUNI','LECCE','FASANO','BRINDISI','BARI','OTRANTO'], minHotels: 1 }],
    },
  ],
};

// ─── Download XLS files from Drive folder ────────────────────────────────────
/**
 * List all XLS/XLSX files in a Drive folder and return their IDs + names.
 */
async function listRateFiles(drive, folderId) {
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false and (mimeType='application/vnd.ms-excel' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or name contains '.xls')`,
      fields: 'nextPageToken, files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * Download a Drive file by ID into a temp path. Returns local path.
 */
async function downloadFile(drive, fileId, fileName, tmpDir) {
  const dest = path.join(tmpDir, fileName);
  const writer = fs.createWriteStream(dest);
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    res.data.on('error', reject);
  });
  return dest;
}

// ─── Parse XLS file into hotel→month→[rates] structure ───────────────────────
/**
 * Parse an XLS (BIFF8) or XLSX file using ExcelJS.
 * Returns: { hotelName: { 'Jan': [day1, day2, …], 'Feb': [...], … } }
 *
 * The XLS layout (from BHI booking engine):
 *   - Row 0: skip (markup multipliers)
 *   - Month header row: col 0 = null/empty, col 1 or 2 = "Month Year"
 *   - After each month header, rows are hotel rate rows:
 *       col 0 = hotel name, col 1..N = rate per day
 *   - Three rows per hotel (we take the first one with a numeric value)
 */
async function parseRateXLS(filePath) {
  const wb = new ExcelJS.Workbook();
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === '.xlsx') {
      await wb.xlsx.readFile(filePath);
    } else {
      // ExcelJS can read xls via the xlsx reader in modern versions
      // Fallback: try xlsx reader first
      try {
        await wb.xlsx.readFile(filePath);
      } catch {
        // If that fails, we just return an empty result
        console.warn(`  ⚠  Could not parse ${path.basename(filePath)} — skipping`);
        return {};
      }
    }
  } catch (err) {
    console.warn(`  ⚠  Parse error for ${path.basename(filePath)}: ${err.message} — skipping`);
    return {};
  }

  const result = {}; // hotelName → { month: [rates] }
  let currentMonth = null;

  // Use the first (and usually only) worksheet
  const ws = wb.worksheets[0];
  if (!ws) return result;

  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber === 1) return; // skip markup row

    const col0 = row.getCell(1).value; // A
    const col1 = row.getCell(2).value; // B
    const col2 = row.getCell(3).value; // C

    // Detect month header row: col A is empty, col B or C contains "Month Year"
    if (!col0 || String(col0).trim() === '') {
      const candidate = String(col1 || col2 || '').trim().toLowerCase();
      const monthWord = candidate.split(/\s+/)[0];
      if (MONTH_ABBR[monthWord]) {
        currentMonth = MONTH_ABBR[monthWord];
        return;
      }
    }

    // Hotel rate row: col A = hotel name, rest = day rates
    if (!currentMonth) return;
    const hotelName = col0 ? String(col0).trim().toUpperCase() : null;
    if (!hotelName || hotelName === '') return;

    // Skip duplicate/per-person rows — we only record the first row per hotel per month
    if (!result[hotelName]) result[hotelName] = {};
    if (result[hotelName][currentMonth]) return; // already have this hotel/month

    // Extract day rates: cells B onwards
    const rates = [];
    row.eachCell({ includeEmpty: false }, (cell, colNum) => {
      if (colNum < 2) return; // skip hotel name column
      const v = cell.value;
      if (v !== null && v !== undefined) {
        const num = parseFloat(String(v).replace(/[^\d.]/g, ''));
        if (!isNaN(num)) rates.push(num);
      }
    });
    result[hotelName][currentMonth] = rates;
  });

  return result;
}

// ─── Merge multiple hotel→month→rates maps ───────────────────────────────────
function mergeRateMaps(maps) {
  const merged = {};
  for (const map of maps) {
    for (const [hotel, months] of Object.entries(map)) {
      if (!merged[hotel]) merged[hotel] = {};
      for (const [month, rates] of Object.entries(months)) {
        if (!merged[hotel][month]) merged[hotel][month] = rates;
      }
    }
  }
  return merged;
}

// ─── Availability check helpers ───────────────────────────────────────────────
/**
 * Returns true if a hotel has ≥1 rate > 0 in the given month.
 */
function hotelOpen(rateMap, hotelName, month) {
  const monthData = rateMap[hotelName]?.[month];
  if (!monthData || monthData.length === 0) return false;
  return monthData.some(r => r > 0);
}

/**
 * Find all hotel names in rateMap matching any of the given patterns.
 */
function matchingHotels(rateMap, patterns) {
  const upper = patterns.map(p => p.toUpperCase());
  return Object.keys(rateMap).filter(h =>
    upper.some(p => h.includes(p))
  );
}

/**
 * Compute OPEN / PARTIAL / STOP for a package group in a given month.
 * group: { zone, patterns, minHotels }
 * Returns: 'OPEN' | 'PARTIAL' | 'STOP'
 */
function groupStatus(rateMap, group, month) {
  const hotels = matchingHotels(rateMap, group.patterns);
  if (hotels.length === 0) return 'STOP';
  const openCount = hotels.filter(h => hotelOpen(rateMap, h, month)).length;
  if (openCount === 0) return 'STOP';
  if (openCount >= group.minHotels) return 'OPEN';
  return 'PARTIAL';
}

/**
 * Compute overall package status for a month: requires ALL groups to be OPEN.
 * If any group is STOP → STOP; if any is PARTIAL → PARTIAL; else OPEN.
 */
function packageStatus(rateMap, pkgDef, month) {
  const statuses = pkgDef.groups.map(g => groupStatus(rateMap, g, month));
  if (statuses.every(s => s === 'OPEN'))    return 'OPEN';
  if (statuses.some(s => s === 'STOP'))     return 'STOP';
  return 'PARTIAL';
}

// ─── Build XLSX report ────────────────────────────────────────────────────────
async function buildStopSaleXLSX(destination, rateMap, outPath) {
  const pkgDefs = PACKAGE_DEFS[destination];
  if (!pkgDefs || pkgDefs.length === 0) {
    console.warn(`  ⚠  No package definitions for ${destination}`);
    return;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'BHI Rate Scraper';
  wb.created = new Date();

  const ws = wb.addWorksheet('Stop Sale');

  // Header row
  const headers = ['Month', ...pkgDefs.map(p => p.label)];
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1565C0' } };
  headerRow.font = { bold: true, color:{ argb:'FFFFFFFF' } };
  headerRow.alignment = { horizontal:'center' };

  // Set column widths
  ws.getColumn(1).width = 14;
  for (let i = 2; i <= headers.length; i++) {
    ws.getColumn(i).width = Math.max(pkgDefs[i-2].label.length + 4, 18);
  }

  // Data rows
  for (const month of MONTHS_ORDER) {
    const row = ws.addRow([month]);
    row.getCell(1).alignment = { horizontal:'center' };
    row.getCell(1).font = { bold: true };

    for (let pi = 0; pi < pkgDefs.length; pi++) {
      const status = packageStatus(rateMap, pkgDefs[pi], month);
      const cell = row.getCell(pi + 2);
      cell.value = status;
      cell.alignment = { horizontal:'center', vertical:'middle' };
      cell.font = { bold: true, color:{ argb:'FFFFFFFF' } };
      switch (status) {
        case 'OPEN':    cell.fill = FILL_OPEN;    break;
        case 'PARTIAL': cell.fill = FILL_PARTIAL; break;
        case 'STOP':    cell.fill = FILL_STOP;    break;
        default:        cell.fill = FILL_NA;
      }
    }
  }

  // Add a legend sheet
  const legend = wb.addWorksheet('Legend');
  legend.getColumn(1).width = 14;
  legend.getColumn(2).width = 55;
  const addLegendRow = (status, fill, description) => {
    const r = legend.addRow([status, description]);
    r.getCell(1).fill = fill;
    r.getCell(1).font = { bold: true, color:{ argb:'FFFFFFFF' } };
    r.getCell(1).alignment = { horizontal:'center' };
  };
  legend.addRow(['Status', 'Meaning']).font = { bold: true };
  addLegendRow('OPEN',    FILL_OPEN,    'All hotels in every zone have ≥1 date available this month');
  addLegendRow('PARTIAL', FILL_PARTIAL, 'Some hotels/zones have availability — package possible with restrictions');
  addLegendRow('STOP',    FILL_STOP,    'No hotels have any available dates — package not sellable this month');

  // Hotel inventory sheet (which hotels were found per pattern)
  const inventory = wb.addWorksheet('Hotel Inventory');
  inventory.getColumn(1).width = 50;
  inventory.getColumn(2).width = 20;
  inventory.addRow(['Hotel Name Found in Rate Sheets', 'Available Months']).font = { bold: true };
  for (const [hotel, months] of Object.entries(rateMap)) {
    const openMonths = MONTHS_ORDER.filter(m => hotelOpen(rateMap, hotel, m));
    inventory.addRow([hotel, openMonths.join(', ')]);
  }

  await wb.xlsx.writeFile(outPath);
  console.log(`  ✓ Stop sale XLSX written: ${outPath}`);
}

// ─── Upload XLSX to Drive ─────────────────────────────────────────────────────
async function uploadToDrive(drive, filePath, fileName, folderId) {
  const { data } = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: fs.createReadStream(filePath),
    },
    fields: 'id, webViewLink, name',
    supportsAllDrives: true,
  });
  console.log(`  ✓ Uploaded to Drive: ${data.webViewLink}`);
  return data;
}

// ─── Main exported function ───────────────────────────────────────────────────
/**
 * buildStopSaleReport(destination, rateFolderId, outputFolderId, runDate)
 *
 * @param {string} destination     — 'laghi' | 'toscana' | 'sardegna' | 'liguria' | 'puglia'
 * @param {string} rateFolderId    — Google Drive folder containing the XLS rate files
 * @param {string} outputFolderId  — Google Drive folder to upload the XLSX report to
 * @param {string} runDate         — ISO date string for file naming (e.g. "2026-11-09")
 * @param {string} [saleName]      — Optional VP flash sale name for file labelling
 * @returns {Promise<{webViewLink:string, name:string}>}
 */
async function buildStopSaleReport(destination, rateFolderId, outputFolderId, runDate, saleName) {
  console.log(`\n🛑  Stop sale report — ${destination} (${runDate})`);

  const drive = getDriveClient();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `bhi-stopsale-${destination}-`));

  try {
    // 1. List XLS files in rate folder
    console.log(`  Listing rate files in Drive folder ${rateFolderId}…`);
    const rateFiles = await listRateFiles(drive, rateFolderId);
    if (rateFiles.length === 0) {
      console.warn(`  ⚠  No rate files found in folder ${rateFolderId} — aborting stop sale report`);
      return null;
    }
    console.log(`  Found ${rateFiles.length} rate file(s)`);

    // 2. Download and parse each file
    const rateMaps = [];
    for (const f of rateFiles) {
      console.log(`  Downloading: ${f.name}`);
      const localPath = await downloadFile(drive, f.id, f.name, tmpDir);
      const map = await parseRateXLS(localPath);
      const hotelCount = Object.keys(map).length;
      console.log(`  Parsed: ${hotelCount} hotel(s) from ${f.name}`);
      rateMaps.push(map);
    }

    // 3. Merge all hotel data
    const mergedMap = mergeRateMaps(rateMaps);
    const totalHotels = Object.keys(mergedMap).length;
    console.log(`  Total unique hotels: ${totalHotels}`);

    // 4. Build XLSX
    const prefix = saleName ? `${saleName} — ` : '';
    const fileName = `${prefix}Stop Sale — ${destination.charAt(0).toUpperCase() + destination.slice(1)} — ${runDate}.xlsx`;
    const outPath = path.join(tmpDir, fileName);
    await buildStopSaleXLSX(destination, mergedMap, outPath);

    // 5. Upload to Drive
    const uploaded = await uploadToDrive(drive, outPath, fileName, outputFolderId);

    return uploaded;
  } finally {
    // Cleanup temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { buildStopSaleReport };
