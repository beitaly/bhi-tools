/**
 * package-proposal.js
 * Post-processing module for the BHI Rate Scraper.
 *
 * Reads from the Italian_Lakes_2027_4S master spreadsheet (4★ Superior filter)
 * and builds a VP Package Proposal Google Sheet with:
 *   - Months as rows (Mar–Oct)
 *   - Per package (5nts, 7nts, 9nts, 12nts): MIN sell, Blended sell,
 *     VP 2027 contract price, VP 2026 actual, Diff €, Diff %
 *
 * ─── PRICING CHAIN ───────────────────────────────────────────────────────────
 * VP sell price = (accommodation_netto_pp + experiences_netto_pp) × 1.06 × 1.23
 *   1.06 = BHI markup (6%)
 *   1.23 = Italian VAT (23%)
 *
 * ─── DATA SOURCE ────────────────────────────────────────────────────────────
 * Primary: Italian_Lakes_2027_4S spreadsheet (ID: 196Egjjzswzz7ul2qgHcBlxNM0xsZQXK-IDibY7VkV-8)
 *   - "5 nts", "7 nts", "9 nts" tabs: per-hotel MEDIA AVG/MIN rates per lake
 *   - "VP Contract Paste" tab: final 2027 VP contract prices (rounded €10)
 *   - "Prorata" tab: 2027 blended sell + 2026 VP actual per month
 * 12nts: derived from per-night lake rates extracted from the 9nts tab
 *
 * ─── EXPERIENCE COSTS (netto per person) ────────────────────────────────────
 * Lago Maggiore:  Cheese & wine tasting — €33/pp
 * Lago di Como:   Crociera with aperitivo — €55/pp
 * Lago di Garda:  Wine farmhouse tasting (7nts simple) — €30/pp
 *                 Wine experience near Bardolino (9nts/12nts elaborate) — €50/pp
 *
 * ─── PACKAGE STRUCTURE (nights per lake) ────────────────────────────────────
 * 5nts:  3 Maggiore + 2 Como  (no Garda)
 * 7nts:  3 Maggiore + 2 Como + 2 Garda
 * 9nts:  3 Maggiore + 2 Como + 4 Garda
 * 12nts: 4 Maggiore + 4 Como + 4 Garda  (derived)
 */

'use strict';

const { google } = require('googleapis');

// ─── Spreadsheet IDs ─────────────────────────────────────────────────────────
const SS_4S_ID = '196Egjjzswzz7ul2qgHcBlxNM0xsZQXK-IDibY7VkV-8'; // Italian_Lakes_2027_4S (copy in shared drive)

// ─── Experience costs (netto per person) ─────────────────────────────────────
const EXPERIENCES = {
  maggiore_cheese_tasting:   33,  // €33/pp — degustazione vini cantina con vista alpina
  como_boat_aperitivo:       55,  // €55/pp — crociera sul Lago di Como con aperitivo
  garda_wine_bardolino_7nts: 30,  // €30/pp — degustazione vini (simple, 7nts)
  garda_wine_bardolino_9nts: 50,  // €50/pp — wine experience elaborate (9nts/12nts)
};

// ─── Package definitions ──────────────────────────────────────────────────────
const PACKAGES = {
  '5nts': {
    nights:      { maggiore: 3, como: 2, garda: 0 },
    expTotal:    EXPERIENCES.maggiore_cheese_tasting + EXPERIENCES.como_boat_aperitivo,  // 88
    tabName:     '5 nts',
    label:       '5 nights (3 Mgre + 2 Como)',
  },
  '7nts': {
    nights:      { maggiore: 3, como: 2, garda: 2 },
    expTotal:    EXPERIENCES.maggiore_cheese_tasting + EXPERIENCES.como_boat_aperitivo + EXPERIENCES.garda_wine_bardolino_7nts,  // 118
    tabName:     '7 nts',
    label:       '7 nights (3 Mgre + 2 Como + 2 Garda)',
  },
  '9nts': {
    nights:      { maggiore: 3, como: 2, garda: 4 },
    expTotal:    EXPERIENCES.maggiore_cheese_tasting + EXPERIENCES.como_boat_aperitivo + EXPERIENCES.garda_wine_bardolino_9nts,  // 138
    tabName:     '9 nts',
    label:       '9 nights (3 Mgre + 2 Como + 4 Garda)',
  },
  '12nts': {
    nights:      { maggiore: 4, como: 4, garda: 4 },
    expTotal:    EXPERIENCES.maggiore_cheese_tasting + EXPERIENCES.como_boat_aperitivo + EXPERIENCES.garda_wine_bardolino_9nts,  // 138
    tabName:     null,   // no dedicated tab; derived from 9nts per-night rates
    label:       '12 nights (4 Mgre + 4 Como + 4 Garda)',
  },
};

// ─── Pricing constants ────────────────────────────────────────────────────────
const BHI_MARKUP  = 1.06;
const ITALIAN_VAT = 1.23;
const TOTAL_MARKUP = BHI_MARKUP * ITALIAN_VAT;  // 1.3038

// ─── Months ───────────────────────────────────────────────────────────────────
const ACTIVE_MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

// ─── Google API clients ───────────────────────────────────────────────────────
function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  });
}
function getDriveClient()  { return google.drive({ version: 'v3', auth: getAuth() }); }
function getSheetsClient() { return google.sheets({ version: 'v4', auth: getAuth() }); }

// ─── Helper: parse €-prefixed number string ───────────────────────────────────
function parseEuro(str) {
  if (!str) return null;
  const v = parseFloat(String(str).replace(/[€,\s]/g, ''));
  return isNaN(v) || v === 0 ? null : v;
}

/**
 * Read a package tab from Italian_Lakes_2027_4S.
 * Returns per-night rates per lake per month:
 *   { maggiore: { Mar: { avg, min }, ... }, como: {...}, garda: {...} }
 *
 * The tab structure:
 *   Row 1: title "[merged] ITALIAN LAKES 2027  4S★  ·  X NTS"
 *   Row 2: months (B=Mar, C=Apr, ... I=Oct)
 *   Row 3: "DEST 1 nights — Lago Maggiore: 3"
 *   Row 4: "DEST 2 nights — Lago di Como: 2"
 *   Row 5: "DEST 3 nights — Lago di Garda: X"
 *   Then per-lake sections with hotel rows (AVG pp/night, MIN pp/night)
 *   followed by "MEDIA AVG" and "MEDIA MIN" summary rows.
 *
 * MEDIA AVG/MIN are TOTAL accommodation costs pp for all nights at that lake
 * (nights already multiplied in by the per-hotel calculation).
 * We divide by the destination's night count to get per-night rates.
 */
async function readLakeMediaRates(sheets, ssId, tabName) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: ssId,
    range: `'${tabName}'!A1:J200`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 6) return null;

  // Row 1 (index 1): month headers in cols B–I (index 1–8)
  const monthRow   = rows[1] || [];
  const monthCols  = {};   // month → column index (0-based)
  ACTIVE_MONTHS.forEach(m => {
    const idx = monthRow.findIndex(c => String(c).trim() === m);
    if (idx >= 0) monthCols[m] = idx;
  });

  // Rows 2–4: night counts
  const nightsMap = { maggiore: 0, como: 0, garda: 0 };
  for (let r = 2; r <= 5; r++) {
    const row = rows[r] || [];
    const label = String(row[0] || '').toLowerCase();
    const count = parseInt(row[1] || '0', 10) || 0;
    if (label.includes('maggiore')) nightsMap.maggiore = count;
    else if (label.includes('como'))    nightsMap.como    = count;
    else if (label.includes('garda'))   nightsMap.garda   = count;
  }

  // Scan remaining rows for lake sections and MEDIA rows
  const LAKE_PATTERNS = {
    maggiore: /lago\s+maggiore|dest\s+1/i,
    como:     /lago\s+di\s+como|dest\s+2/i,
    garda:    /lago\s+di\s+garda|lago\s+garda|dest\s+3/i,
  };

  const result = { maggiore: {}, como: {}, garda: {} };
  let currentLake = null;

  for (let r = 5; r < rows.length; r++) {
    const row  = rows[r] || [];
    const colA = String(row[0] || '').trim();

    // Detect new lake section
    for (const [lake, pattern] of Object.entries(LAKE_PATTERNS)) {
      if (pattern.test(colA)) { currentLake = lake; break; }
    }
    if (!currentLake) continue;

    const nights = nightsMap[currentLake];
    if (!nights) continue;   // e.g. Garda nights = 0 in 5nts tab

    // Look for MEDIA AVG and MEDIA MIN rows
    const isMediaAvg = /media\s+avg/i.test(colA);
    const isMediaMin = /media\s+min/i.test(colA);
    if (!isMediaAvg && !isMediaMin) continue;

    ACTIVE_MONTHS.forEach(month => {
      const colIdx = monthCols[month];
      if (colIdx === undefined) return;
      const totalCost = parseEuro(row[colIdx]);
      if (totalCost === null) return;
      const perNight = totalCost / nights;  // convert total-nights cost → per-night

      if (!result[currentLake][month]) result[currentLake][month] = {};
      if (isMediaAvg) result[currentLake][month].avg = perNight;
      if (isMediaMin) result[currentLake][month].min = perNight;
    });
  }

  return { rates: result, nightsInTab: nightsMap };
}

/**
 * Read VP Contract Paste tab.
 * Returns: { '5nts': { Mar: 900, Apr: 1000, ... }, '7nts': {...}, '9nts': {...} }
 */
async function readVpContractPrices(sheets, ssId) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: ssId,
    range: `'VP Contract Paste'!A1:I10`,
  });
  const rows = resp.data.values || [];

  // Find month header row (contains "Mar", "Apr", ...)
  let monthCols = {};
  let headerRowIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (row && ACTIVE_MONTHS.some(m => row.includes(m))) {
      headerRowIdx = r;
      row.forEach((c, i) => { if (ACTIVE_MONTHS.includes(c)) monthCols[c] = i; });
      break;
    }
  }
  if (headerRowIdx < 0) return {};

  const PKG_PATTERNS = { '5nts': /5\s*nts/i, '7nts': /7\s*nts/i, '9nts': /9\s*nts/i };
  const result = {};

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row  = rows[r] || [];
    const colA = String(row[0] || '');
    for (const [pkg, pattern] of Object.entries(PKG_PATTERNS)) {
      if (pattern.test(colA)) {
        result[pkg] = {};
        ACTIVE_MONTHS.forEach(month => {
          const v = parseEuro(row[monthCols[month]]);
          if (v !== null) result[pkg][month] = v;
        });
        break;
      }
    }
  }
  return result;
}

/**
 * Read Prorata tab for 2027 blended sell price (pp) and 2026 VP actual (pp).
 * Returns: { '5nts': { Mar: { sell27, vp26 }, ... }, '7nts': {...}, '9nts': {...} }
 *
 * Tab structure (repeating blocks):
 *   "5 NTS" header → sub-header (Month, 2027 Sell Price (pp), 2026 VP Actual (pp), ...)
 *   → rows Mar–Oct
 *   blank row → "7 NTS" block → ... → "9 NTS" block
 */
async function readProrata(sheets, ssId) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: ssId,
    range: `'Prorata'!A1:F60`,
  });
  const rows = resp.data.values || [];

  const result = {};
  const PKG_PATTERNS = { '5nts': /5\s*nts/i, '7nts': /7\s*nts/i, '9nts': /9\s*nts/i };

  let currentPkg = null;
  let sell27Col  = -1;
  let vp26Col    = -1;

  for (let r = 0; r < rows.length; r++) {
    const row  = rows[r] || [];
    const colA = String(row[0] || '').trim();

    // Detect package section header
    for (const [pkg, pattern] of Object.entries(PKG_PATTERNS)) {
      if (pattern.test(colA) && !colA.toLowerCase().includes('month')) {
        currentPkg = pkg;
        result[pkg] = {};
        sell27Col = -1;
        vp26Col   = -1;
        break;
      }
    }
    if (!currentPkg) continue;

    // Detect sub-header row (contains "2027 Sell" and "2026 VP")
    const rowStr = row.join(' ').toLowerCase();
    if (rowStr.includes('2027') && rowStr.includes('2026') && rowStr.includes('month')) {
      row.forEach((c, i) => {
        const cl = String(c).toLowerCase();
        if (cl.includes('2027') && cl.includes('sell')) sell27Col = i;
        if (cl.includes('2026') && cl.includes('vp'))   vp26Col   = i;
      });
      continue;
    }

    // Data rows: Month in col A
    if (sell27Col < 0 || vp26Col < 0) continue;
    if (!ACTIVE_MONTHS.includes(colA)) continue;

    const sell27 = parseEuro(row[sell27Col]);
    const vp26   = parseEuro(row[vp26Col]);
    if (sell27 !== null || vp26 !== null) {
      result[currentPkg][colA] = { sell27, vp26 };
    }
  }

  return result;
}

/**
 * Compute per-night lake rates for 12nts by extracting per-night values
 * from the 9nts tab (which has all 3 lakes).
 * Returns: { maggiore: { Mar: { avg, min }, ... }, como: {...}, garda: {...} }
 */
async function readPerNightRatesFrom9nts(sheets, ssId) {
  const { rates } = await readLakeMediaRates(sheets, ssId, '9 nts') || {};
  if (!rates) return null;
  // rates already contains per-night values (divided by night count)
  return rates;
}

/**
 * Compute sell price per person for a given accommodation netto pp and experience total.
 */
function sellPrice(accNettoPP, expTotal) {
  return Math.round((accNettoPP + expTotal) * TOTAL_MARKUP);
}

/**
 * Build and upload the VP Package Proposal sheet to Drive.
 *
 * Layout:
 *   Row 1: Title
 *   Row 2: Note / date
 *   Row 3: blank
 *   Row 4: Package group headers (spanning 6 cols each)
 *   Row 5: Column sub-headers
 *   Rows 6–13: Data rows (Mar → Oct)
 *   Row 14: blank
 *   Row 15: Legend / notes
 */
async function buildProposalSheet(ratesConfig, folderId, runDate) {
  const drive  = getDriveClient();
  const sheets = getSheetsClient();

  // ── Create the spreadsheet ──────────────────────────────────────────────────
  const title = `VP 2027 — Laghi 4S★ — Package Proposal ${runDate}`;
  const createResp = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name:     title,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents:  [folderId],
    },
    fields: 'id, webViewLink',
  });
  const ssId = createResp.data.id;

  const { perNightRates, vpContract, prorata } = ratesConfig;
  const PKG_KEYS = ['5nts', '7nts', '9nts', '12nts'];

  // ── Build data matrix ───────────────────────────────────────────────────────
  // Row 4: package group header
  // Row 5: column sub-headers
  // Rows 6–13: months

  // Row 4 — group headers
  const row4 = [''];
  for (const pkg of PKG_KEYS) {
    row4.push(PACKAGES[pkg].label, '', '', '', '', '');
  }

  // Row 5 — column sub-headers
  const row5 = ['Month'];
  const colHeaders = ['MIN (pp)', 'Blended (pp)', 'VP 2027 (pp)', 'VP 2026 (pp)', 'Diff €', 'Diff %'];
  for (let i = 0; i < PKG_KEYS.length; i++) row5.push(...colHeaders);

  // Rows 6–13 — data
  const dataRows = [row4, row5];

  for (const month of ACTIVE_MONTHS) {
    const row = [month];

    for (const pkg of PKG_KEYS) {
      const { nights, expTotal } = PACKAGES[pkg];
      const lakes = ['maggiore', 'como', 'garda'];

      // ── Compute MIN and Blended from per-night lake rates ─────────────────
      let minAccNetto     = 0;
      let blendedAccNetto = 0;
      let hasRates        = true;

      for (const lake of lakes) {
        const n = nights[lake];
        if (!n) continue;
        const lakeData = perNightRates[lake]?.[month];
        if (!lakeData?.min || !lakeData?.avg) { hasRates = false; break; }
        minAccNetto     += lakeData.min * n;
        blendedAccNetto += ((lakeData.avg + lakeData.min) / 2) * n;
      }

      const minSell     = hasRates ? sellPrice(minAccNetto, expTotal)     : null;
      const blendedSell = hasRates ? sellPrice(blendedAccNetto, expTotal) : null;

      // ── VP 2027 contract price ────────────────────────────────────────────
      // 12nts: no contract entry — use blended + experiences (best estimate)
      let vp27 = vpContract[pkg]?.[month] ?? null;
      if (vp27 === null && blendedSell !== null && pkg === '12nts') {
        vp27 = blendedSell;  // best estimate for 12nts
      }

      // ── VP 2026 actual ────────────────────────────────────────────────────
      // Available for 5nts, 7nts, 9nts from Prorata tab.
      let vp26  = null;
      if (pkg !== '12nts') {
        vp26 = prorata[pkg]?.[month]?.vp26 ?? null;
      }

      // ── Diff columns ──────────────────────────────────────────────────────
      let diffEuro = null;
      let diffPct  = null;
      if (vp27 !== null && vp26 !== null) {
        diffEuro = vp27 - vp26;
        diffPct  = ((vp27 - vp26) / vp26) * 100;
      }

      row.push(
        minSell     !== null ? minSell     : '—',
        blendedSell !== null ? blendedSell : '—',
        vp27        !== null ? vp27        : '—',
        vp26        !== null ? vp26        : (pkg === '12nts' ? 'n/a' : '—'),
        diffEuro    !== null ? Math.round(diffEuro)         : '—',
        diffPct     !== null ? `${diffPct.toFixed(1)}%`     : '—',
      );
    }

    dataRows.push(row);
  }

  // Notes row
  dataRows.push([]);
  dataRows.push([
    'Notes:',
    'MIN = cheapest 4S★ hotel rate × nights + experiences × 1.06 × 1.23  |  ' +
    'Blended = (MEDIA_AVG+MEDIA_MIN)/2 × nights + experiences × 1.06 × 1.23  |  ' +
    'VP 2027 = contract price from VP Contract Paste (rounded €10); 12nts = Blended estimate  |  ' +
    'VP 2026 = from Prorata tab (VP contract PDFs, 4★ tier)  |  ' +
    'Source: Italian_Lakes_2027_4S spreadsheet',
  ]);

  // ── Write values ─────────────────────────────────────────────────────────────
  const titleRows = [
    [`VP 2027 — LAGHI 4S★ — Package Proposal`],
    [`Generated: ${runDate}  |  Star tier: 4S★ only  |  Pricing: acc netto × 1.06 × 1.23`],
    [],
  ];
  const allRows = [...titleRows, ...dataRows];

  await sheets.spreadsheets.values.update({
    spreadsheetId: ssId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: { values: allRows },
  });

  // ── Formatting ───────────────────────────────────────────────────────────────
  const PKG_COL_START = 1;
  const PKG_COL_WIDTH = 6;
  const DATA_START_ROW = 5;
  const DATA_END_ROW   = DATA_START_ROW + ACTIVE_MONTHS.length;
  const TOTAL_COLS     = 1 + PKG_KEYS.length * PKG_COL_WIDTH;

  const COLOR_HEADER_DARK  = { red: 0.133, green: 0.267, blue: 0.533 };
  const COLOR_HEADER_MID   = { red: 0.286, green: 0.427, blue: 0.690 };
  const COLOR_PKG_ALT      = [
    { red: 0.878, green: 0.906, blue: 0.961 },
    { red: 0.863, green: 0.925, blue: 0.878 },
    { red: 0.996, green: 0.945, blue: 0.816 },
    { red: 0.961, green: 0.878, blue: 0.878 },
  ];
  const COLOR_WHITE = { red: 1, green: 1, blue: 1 };

  const fmtRequests = [];

  fmtRequests.push({
    repeatCell: {
      range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: {
        backgroundColor: COLOR_HEADER_DARK,
        textFormat: { foregroundColor: COLOR_WHITE, bold: true, fontSize: 12 },
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  });

  fmtRequests.push({
    repeatCell: {
      range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2 },
      cell: { userEnteredFormat: {
        backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
        textFormat: { italic: true },
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  });

  for (let p = 0; p < PKG_KEYS.length; p++) {
    const startCol = PKG_COL_START + p * PKG_COL_WIDTH;
    fmtRequests.push({
      repeatCell: {
        range: { sheetId: 0, startRowIndex: 3, endRowIndex: 4, startColumnIndex: startCol, endColumnIndex: startCol + PKG_COL_WIDTH },
        cell: { userEnteredFormat: {
          backgroundColor: COLOR_PKG_ALT[p],
          textFormat: { bold: true },
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    });
    fmtRequests.push({
      mergeCells: {
        range: { sheetId: 0, startRowIndex: 3, endRowIndex: 4, startColumnIndex: startCol, endColumnIndex: startCol + PKG_COL_WIDTH },
        mergeType: 'MERGE_ALL',
      },
    });
  }

  fmtRequests.push({
    repeatCell: {
      range: { sheetId: 0, startRowIndex: 4, endRowIndex: 5 },
      cell: { userEnteredFormat: {
        backgroundColor: COLOR_HEADER_MID,
        textFormat: { foregroundColor: COLOR_WHITE, bold: true },
        horizontalAlignment: 'CENTER',
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  });

  for (let p = 0; p < PKG_KEYS.length; p++) {
    const startCol = PKG_COL_START + p * PKG_COL_WIDTH;
    fmtRequests.push({
      repeatCell: {
        range: { sheetId: 0, startRowIndex: DATA_START_ROW, endRowIndex: DATA_END_ROW,
                 startColumnIndex: startCol + 5, endColumnIndex: startCol + 6 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(horizontalAlignment)',
      },
    });
    fmtRequests.push({
      repeatCell: {
        range: { sheetId: 0, startRowIndex: DATA_START_ROW, endRowIndex: DATA_END_ROW,
                 startColumnIndex: startCol + 4, endColumnIndex: startCol + 5 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(horizontalAlignment)',
      },
    });
  }

  fmtRequests.push({
    repeatCell: {
      range: { sheetId: 0, startRowIndex: DATA_START_ROW, endRowIndex: DATA_END_ROW,
               startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: 'userEnteredFormat(textFormat)',
    },
  });

  const notesRowIdx = DATA_END_ROW + 1;
  fmtRequests.push({
    repeatCell: {
      range: { sheetId: 0, startRowIndex: notesRowIdx, endRowIndex: notesRowIdx + 1 },
      cell: { userEnteredFormat: {
        backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
        textFormat: { italic: true, fontSize: 8 },
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  });

  fmtRequests.push({
    autoResizeDimensions: {
      dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: TOTAL_COLS },
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ssId,
    requestBody: { requests: fmtRequests },
  });

  console.log(`  ✓ Proposal sheet created: ${createResp.data.webViewLink}`);
  return createResp.data;
}

// ─── Main entry point ─────────────────────────────────────────────────────────
async function buildPackageProposal(destination, _driveSpreadsheetIds, proposalFolderId, runDate) {
  if (destination !== 'laghi') {
    console.log(`  ℹ  Package proposal not yet implemented for '${destination}' — skipping.`);
    return null;
  }

  console.log('\n📦  Building VP 4S★ package proposal for Laghi…');
  console.log(`    Source: Italian_Lakes_2027_4S (${SS_4S_ID})`);

  const sheets = getSheetsClient();

  console.log('  → Reading per-night lake rates from 9nts tab…');
  const { rates: perNightRates9 } = await readLakeMediaRates(sheets, SS_4S_ID, '9 nts') || {};
  if (!perNightRates9) throw new Error('Could not read 9nts tab from Italian_Lakes_2027_4S');

  console.log('  → Reading per-night lake rates from 5nts and 7nts tabs…');
  const { rates: perNightRates5 } = await readLakeMediaRates(sheets, SS_4S_ID, '5 nts') || {};
  const { rates: perNightRates7 } = await readLakeMediaRates(sheets, SS_4S_ID, '7 nts') || {};

  const perNightRates = { maggiore: {}, como: {}, garda: {} };
  for (const month of ACTIVE_MONTHS) {
    perNightRates.maggiore[month] = perNightRates5?.maggiore?.[month]
                                 || perNightRates7?.maggiore?.[month]
                                 || perNightRates9?.maggiore?.[month]
                                 || null;
    perNightRates.como[month]     = perNightRates5?.como?.[month]
                                 || perNightRates7?.como?.[month]
                                 || perNightRates9?.como?.[month]
                                 || null;
    perNightRates.garda[month]    = perNightRates7?.garda?.[month]
                                 || perNightRates9?.garda?.[month]
                                 || null;
  }

  console.log('  → Reading VP Contract Paste tab…');
  const vpContract = await readVpContractPrices(sheets, SS_4S_ID);
  console.log(`    VP contract rows found: ${Object.keys(vpContract).join(', ') || 'none'}`);

  console.log('  → Reading Prorata tab…');
  const prorata = await readProrata(sheets, SS_4S_ID);
  console.log(`    Prorata sections found: ${Object.keys(prorata).join(', ') || 'none'}`);

  console.log('  → Building proposal sheet…');
  const proposalFile = await buildProposalSheet(
    { perNightRates, vpContract, prorata },
    proposalFolderId,
    runDate,
  );

  return proposalFile;
}

module.exports = { buildPackageProposal, EXPERIENCES, PACKAGES, TOTAL_MARKUP };

// ─── Standalone CLI: node package-proposal.js laghi ──────────────────────────
if (require.main === module) {
  const dest = process.argv[2] || 'laghi';
  const VP_2027_FOLDER_ID = process.env.VP_2027_FOLDER_LAGHI || '1KQNpmHcVW0nTbcztgUophIM100PvlLL1';
  const runDate = new Date().toISOString().slice(0, 10);

  buildPackageProposal(dest, [], VP_2027_FOLDER_ID, runDate)
    .then(file => {
      if (file) console.log(`\n✅  Proposal created: ${file.webViewLink}`);
    })
    .catch(err => {
      console.error('\n❌  Error:', err.message);
      process.exit(1);
    });
}
