/**
 * package-proposal.js
 * Post-processing module for the BHI Rate Scraper.
 *
 * Builds VP Package Proposal Google Sheets for all four BHI destinations:
 *   - Laghi (Italian Lakes)   — 3 package variants, 4★ and 4★S tiers, 5/7/9/12nts
 *   - Toscana (Tuscany)       — 5nts and 7nts
 *   - Sardegna (Sardinia)     — 7nts, 10nts, 12nts (with and without experiences)
 *   - Liguria                 — 5nts and 7nts
 *
 * ─── PRICING CHAIN ───────────────────────────────────────────────────────────
 * VP sell price = (accommodation_netto_pp + experiences_netto_pp) × 1.06 × 1.23
 *   1.06 = BHI markup (6%)
 *   1.23 = Italian VAT (23%)
 *
 * ─── LAGHI PACKAGE VARIANTS ──────────────────────────────────────────────────
 * v1 "Black Friday" (5nts only):
 *   5nts: 3 Mgre + 2 Como
 *   Experiences: Maggiore wine tasting €16 + Como boat €28 (5nts short version) = €44
 *
 * v2 "Maggiore & Garda" (7nts only):
 *   7nts: 3 Mgre + 2 Garda + NO Como
 *   Experiences: Maggiore wine €16 + Garda boat €12 = €28 (5nts boat rates)
 *   NOTE: Como boat (€50) only included for 7nts+ WITH Como nights
 *
 * v3 "Classic" (7nts, 9nts, 12nts):
 *   7nts:  3 Mgre + 2 Como + 2 Garda
 *   9nts:  3 Mgre + 2 Como + 4 Garda
 *   12nts: 4 Mgre + 4 Como + 4 Garda
 *   Experiences (all variants):
 *     Maggiore wine tasting: €33
 *     Como boat with aperitivo: €55 (7nts+)
 *     Garda wine: €30 (7nts), €50 (9nts/12nts), wine tasting €35 (12nts only → see below)
 *   12nts also includes wine tasting in Tuscany/elsewhere: +€35
 *
 * ─── 2026 VP ACTUAL PRICES (from Drive PDFs) ─────────────────────────────────
 * Hardcoded from June 2026 VP contracts.
 *
 * ─── DATA SOURCE (Laghi) ─────────────────────────────────────────────────────
 * 4★S: Italian_Lakes_2027_4S (ID: SS_4S_ID)
 * 4★ : Italian_Lakes_2027_4 (ID: SS_4STAR_LAKES_ID env var — sheet TBD post-scrape)
 * Tuscany/Sardinia/Liguria: scraped XLS files from Drive (post-scrape)
 */

'use strict';

const { google } = require('googleapis');

// ─── Spreadsheet IDs ─────────────────────────────────────────────────────────
const SS_4S_ID         = '196Egjjzswzz7ul2qgHcBlxNM0xsZQXK-IDibY7VkV-8';
const SS_4STAR_ID      = process.env.SS_4STAR_LAKES_ID || '';  // set once 4★ sheet is built

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
  const v = parseFloat(String(str).replace(/[€,.\s]/g, '').replace(',', '.'));
  // Handle European decimal (1.050 = 1050)
  const v2 = parseFloat(String(str).replace(/[€\s]/g, '').replace('.', '').replace(',', '.'));
  const best = isNaN(v2) ? v : v2;
  return isNaN(best) || best === 0 ? null : best;
}

// Better euro parser that handles "€1.050" (European thousand separator)
function parseEuroStr(str) {
  if (!str) return null;
  // Remove currency symbol and spaces
  let s = String(str).replace(/[€\s]/g, '');
  // If contains both . and , treat . as thousand sep, , as decimal
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes('.') && !s.includes(',')) {
    // Could be thousand sep (1.050) or decimal (1.5)
    const parts = s.split('.');
    if (parts[1] && parts[1].length === 3) {
      // Thousand separator
      s = s.replace(/\./g, '');
    }
    // else keep as decimal
  } else if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.');
  }
  const v = parseFloat(s);
  return isNaN(v) || v === 0 ? null : v;
}

// ─── Months ───────────────────────────────────────────────────────────────────
const ACTIVE_MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

// ─── Pricing constants ────────────────────────────────────────────────────────
const BHI_MARKUP   = 1.06;
const ITALIAN_VAT  = 1.23;
const TOTAL_MARKUP = BHI_MARKUP * ITALIAN_VAT;  // 1.3038

function sellPrice(accNettoPP, expNettoPP) {
  return Math.round((accNettoPP + expNettoPP) * TOTAL_MARKUP);
}

// ─── 2026 VP Actuals (hardcoded from Drive contract PDFs) ────────────────────
//
// Laghi: months Jun–Oct only (winter not in scope for Lakes)
// Key: { 'Jun': price, ... }  — missing months = null (no contract that season)
const VP2026 = {
  laghi: {
    // 4★ tier
    '4star': {
      '5nts':  { Jun: 470,  Jul: 500,  Aug: 580,  Sep: 540,  Oct: 470 },
      '7nts':  { Jun: 690,  Jul: 720,  Aug: 760,  Sep: 740,  Oct: 620 },
      '9nts':  { Jun: 950,  Jul: 1050, Aug: 1100, Sep: 1050, Oct: 980 },
      '12nts': null,  // no 12nts contract in 2026
    },
    // 4★S tier
    '4sstar': {
      '5nts':  { Jun: 620,  Jul: 650,  Aug: 680,  Sep: 670,  Oct: 580 },
      '7nts':  { Jun: 890,  Jul: 940,  Aug: 1050, Sep: 1020, Oct: 820 },
      '9nts':  { Jun: 1100, Jul: 1190, Aug: 1250, Sep: 1200, Oct: 1100 },
      '12nts': null,
    },
  },

  // Sardinia: Aug 2026 contract covers Aug26–Jun27 (all one contract)
  // The PDF includes both 2026 and 2027 dates — we store them all, keyed to what's relevant
  sardegna: {
    // 7nts (with experiences: Tavolara boat + wine tasting = €80pp)
    '7nts': {
      Aug: 665,  Sep: 610,  Oct: 350,  Nov: 340,
      // 2027 months from same contract (VP carry-over)
      Mar: 350,  Apr: 390,  May: 400,  Jun: 560,
    },
    // 10nts (with experiences: boat + wine + cooking class = €170pp)
    '10nts': {
      Aug: 950,  Sep: 875,  Oct: 500,  Nov: 490,
      Mar: 500,  Apr: 560,  May: 570,  Jun: 800,
    },
    // 12nts (with experiences: boat + wine + cooking class = €170pp)
    '12nts': {
      Aug: 1140, Sep: 1046, Oct: 600,  Nov: 590,
      Mar: 600,  Apr: 670,  May: 690,  Jun: 960,
    },
  },

  // Tuscany: Sept 2026 contract covers Oct26–Jun27
  toscana: {
    '5nts': { Oct: 400, Nov: 360, Dec: 290, Jan: 300, Feb: 270, Mar: 290, Apr: 375, May: 400, Jun: 420 },
    '7nts': { Oct: 500, Nov: 390, Dec: 375, Jan: 425, Feb: 397, Mar: 425, Apr: 520, May: 580, Jun: 590 },
  },

  // Liguria: June 2026 contract covers Jun–Oct
  liguria: {
    '5nts': { Jun: 590, Jul: 630, Aug: 670, Sep: 580, Oct: 500 },
    '7nts': { Jun: 830, Jul: 885, Aug: 940, Sep: 820, Oct: 700 },
  },
};

// ─── Package configs ──────────────────────────────────────────────────────────

// LAGHI — three variants, each has its own experience stack
// Experience costs are netto per person

const LAGHI_VARIANTS = {
  // v1: Black Friday — 5nts only, stripped-down experience stack
  'v1_black_friday': {
    label: 'v1 — Black Friday (5 nts)',
    packages: {
      '5nts': {
        nights:   { maggiore: 3, como: 2, garda: 0 },
        // Shorter versions of experiences (5nts pricing)
        expTotal: 16 + 28,   // Maggiore wine €16 + Como boat 5nts €28 = €44
        tabName:  '5 nts',
        label:    '5 nts (3 Mgre + 2 Como)',
      },
    },
  },
  // v2: Maggiore & Garda — 7nts, NO Como
  'v2_maggiore_garda': {
    label: 'v2 — Maggiore & Garda (7 nts)',
    packages: {
      '7nts': {
        nights:   { maggiore: 3, como: 0, garda: 2 },
        expTotal: 16 + 12,   // Maggiore wine €16 + Garda boat €12 = €28
        tabName:  '7 nts',
        label:    '7 nts (3 Mgre + 2 Garda, no Como)',
      },
    },
  },
  // v3: Classic — 7/9/12nts with all 3 lakes
  'v3_classic': {
    label: 'v3 — Classic (7/9/12 nts)',
    packages: {
      '7nts': {
        nights:   { maggiore: 3, como: 2, garda: 2 },
        expTotal: 33 + 55 + 30,   // Mgre wine €33 + Como boat €55 + Garda wine 7nts €30 = €118
        tabName:  '7 nts',
        label:    '7 nts (3 Mgre + 2 Como + 2 Garda)',
      },
      '9nts': {
        nights:   { maggiore: 3, como: 2, garda: 4 },
        expTotal: 33 + 55 + 50,   // Mgre €33 + Como €55 + Garda elaborate 9nts €50 = €138
        tabName:  '9 nts',
        label:    '9 nts (3 Mgre + 2 Como + 4 Garda)',
      },
      '12nts': {
        nights:   { maggiore: 4, como: 4, garda: 4 },
        expTotal: 33 + 55 + 50 + 35,  // + extra wine tasting €35 = €173
        tabName:  null,   // derived from 9nts per-night rates
        label:    '12 nts (4 Mgre + 4 Como + 4 Garda)',
      },
    },
  },
};

// SARDEGNA — single variant, three durations
const SARDEGNA_PACKAGES = {
  '7nts': {
    expTotal: 80,   // Tavolara boat + wine tasting = €80pp
    label:    '7 nts (Cagliari → Alghero → Olbia)',
  },
  '10nts': {
    expTotal: 170,  // boat + wine + cooking class = €170pp
    label:    '10 nts (Cagliari → Alghero → Arbatax → Olbia)',
  },
  '12nts': {
    expTotal: 170,  // same experience stack as 10nts
    label:    '12 nts (full island circuit)',
  },
};

// TOSCANA — single variant
const TOSCANA_PACKAGES = {
  '5nts': { expTotal: 35,  label: '5 nts (Florence hills + Volterra)' },
  '7nts': { expTotal: 45,  label: '7 nts (Florence + Siena + Volterra)' },
};

// LIGURIA — single variant
const LIGURIA_PACKAGES = {
  '5nts': { expTotal: 45,  label: '5 nts (La Spezia + Rapallo/SML)' },
  '7nts': { expTotal: 60,  label: '7 nts (La Spezia + Rapallo/SML full)' },
};

// ─── Google Sheets helpers ────────────────────────────────────────────────────

/**
 * Read a package tab from the Lakes master spreadsheet.
 * Returns per-night rates per lake per month:
 *   { rates: { maggiore: { Mar: { avg, min }, ... }, como: {...}, garda: {...} }, nightsInTab }
 */
async function readLakeMediaRates(sheets, ssId, tabName) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: ssId,
    range: `'${tabName}'!A1:J200`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 6) return null;

  const monthRow  = rows[1] || [];
  const monthCols = {};
  ACTIVE_MONTHS.forEach(m => {
    const idx = monthRow.findIndex(c => String(c).trim() === m);
    if (idx >= 0) monthCols[m] = idx;
  });

  const nightsMap = { maggiore: 0, como: 0, garda: 0 };
  for (let r = 2; r <= 4; r++) {
    const row   = rows[r] || [];
    const label = String(row[0] || '').toLowerCase();
    const count = parseInt(row[1] || '0', 10) || 0;
    if (label.includes('maggiore')) nightsMap.maggiore = count;
    else if (label.includes('como'))    nightsMap.como    = count;
    else if (label.includes('garda'))   nightsMap.garda   = count;
  }

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

    for (const [lake, pattern] of Object.entries(LAKE_PATTERNS)) {
      if (pattern.test(colA)) { currentLake = lake; break; }
    }
    if (!currentLake) continue;

    const nights = nightsMap[currentLake];
    if (!nights) continue;

    const isMediaAvg = /media\s+avg/i.test(colA);
    const isMediaMin = /media\s+min/i.test(colA);
    if (!isMediaAvg && !isMediaMin) continue;

    ACTIVE_MONTHS.forEach(month => {
      const colIdx = monthCols[month];
      if (colIdx === undefined) return;
      const totalCost = parseEuroStr(row[colIdx]);
      if (totalCost === null) return;
      const perNight = totalCost / nights;

      if (!result[currentLake][month]) result[currentLake][month] = {};
      if (isMediaAvg) result[currentLake][month].avg = perNight;
      if (isMediaMin) result[currentLake][month].min = perNight;
    });
  }

  return { rates: result, nightsInTab: nightsMap };
}

/**
 * Read VP Contract Paste tab.
 * Returns: { '5nts': { Mar: 900, ... }, '7nts': {...}, '9nts': {...} }
 */
async function readVpContractPrices(sheets, ssId) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: ssId,
    range: `'VP Contract Paste'!A1:I10`,
  });
  const rows = resp.data.values || [];

  let monthCols    = {};
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
          const v = parseEuroStr(row[monthCols[month]]);
          if (v !== null) result[pkg][month] = v;
        });
        break;
      }
    }
  }
  return result;
}

/**
 * Read Prorata tab for 2027 blended sell + 2026 VP actual.
 * Returns: { '5nts': { Mar: { sell27, vp26 }, ... }, ... }
 */
async function readProrata(sheets, ssId) {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: ssId,
    range: `'Prorata'!A1:F60`,
  });
  const rows = resp.data.values || [];

  const result      = {};
  const PKG_PATTERNS = { '5nts': /5\s*nts/i, '7nts': /7\s*nts/i, '9nts': /9\s*nts/i };

  let currentPkg = null;
  let sell27Col  = -1;
  let vp26Col    = -1;

  for (let r = 0; r < rows.length; r++) {
    const row  = rows[r] || [];
    const colA = String(row[0] || '').trim();

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

    const rowStr = row.join(' ').toLowerCase();
    if (rowStr.includes('2027') && rowStr.includes('2026') && rowStr.includes('month')) {
      row.forEach((c, i) => {
        const cl = String(c).toLowerCase();
        if (cl.includes('2027') && cl.includes('sell')) sell27Col = i;
        if (cl.includes('2026') && cl.includes('vp'))   vp26Col   = i;
      });
      continue;
    }

    if (sell27Col < 0 || vp26Col < 0) continue;
    if (!ACTIVE_MONTHS.includes(colA)) continue;

    const sell27 = parseEuroStr(row[sell27Col]);
    const vp26   = parseEuroStr(row[vp26Col]);
    if (sell27 !== null || vp26 !== null) {
      result[currentPkg][colA] = { sell27, vp26 };
    }
  }

  return result;
}

// ─── Sheet builder ────────────────────────────────────────────────────────────

/**
 * Create a new Google Spreadsheet in Drive with named tabs.
 * Returns { ssId, webViewLink, tabIds: { tabName: sheetId } }
 *
 * @param {string} title      — file name in Drive
 * @param {string} folderId   — parent Drive folder
 * @param {string[]} tabNames — list of tab names (first tab replaces default "Sheet1")
 */
async function createSpreadsheetWithTabs(title, folderId, tabNames) {
  const drive  = getDriveClient();
  const sheets = getSheetsClient();

  const createResp = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name:     title,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents:  [folderId],
    },
    fields: 'id, webViewLink',
  });
  const ssId        = createResp.data.id;
  const webViewLink = createResp.data.webViewLink;

  // Rename first tab and add the rest
  const addRequests = [];
  addRequests.push({
    updateSheetProperties: {
      properties: { sheetId: 0, title: tabNames[0] },
      fields: 'title',
    },
  });
  for (let i = 1; i < tabNames.length; i++) {
    addRequests.push({ addSheet: { properties: { title: tabNames[i] } } });
  }
  const batchResp = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ssId,
    requestBody: { requests: addRequests },
  });

  // Map tab name → sheetId
  const tabIds = { [tabNames[0]]: 0 };
  const replies = batchResp.data.replies || [];
  for (let i = 1; i < tabNames.length; i++) {
    const reply = replies[i];  // replies[0] is updateSheetProperties (no sheetId)
    tabIds[tabNames[i]] = reply?.addSheet?.properties?.sheetId ?? i;
  }

  return { ssId, webViewLink, tabIds };
}

/**
 * Write VP proposal data into one tab of an existing spreadsheet.
 *
 * @param {object} opts
 *   ssId:         string   — target spreadsheet ID
 *   sheetId:      number   — numeric tab ID (0-based)
 *   tabName:      string   — tab name (for A1 range notation)
 *   pkgDefs:      { pkgKey: { label, expTotal } }
 *   monthData:    { pkgKey: { month: { min, blended, vp27, vp26 } } }
 *   title:        string
 *   runDate:      string
 *   tier:         string   — e.g. '4★S', '4★', ''
 *   variantLabel: string
 *   notes:        string
 *   usedMonths:   string[]
 */
async function writeProposalTab(opts) {
  const { ssId, sheetId, tabName, pkgDefs, monthData, title, runDate, tier, variantLabel, notes, usedMonths } = opts;
  const sheets = getSheetsClient();

  const PKG_KEYS      = Object.keys(pkgDefs);
  const PKG_COL_WIDTH = 6;

  // ── Build value matrix ──────────────────────────────────────────────────────
  const colHeaders = ['MIN (pp)', 'Blended (pp)', 'VP 2027 (pp)', 'VP 2026 (pp)', 'Diff €', 'Diff %'];

  // Row 1: Title
  // Row 2: Subtitle/note
  // Row 3: blank
  // Row 4: package group headers
  // Row 5: column sub-headers
  // Rows 6–N: data months

  const row4 = [''];
  for (const pkg of PKG_KEYS) {
    row4.push(pkgDefs[pkg].label, '', '', '', '', '');
  }

  const row5 = ['Month'];
  for (let i = 0; i < PKG_KEYS.length; i++) row5.push(...colHeaders);

  const dataRows = [row4, row5];

  for (const month of usedMonths) {
    const row = [month];
    for (const pkg of PKG_KEYS) {
      const d = monthData[pkg]?.[month];
      if (!d) {
        row.push('—', '—', '—', '—', '—', '—');
        continue;
      }
      const { min, blended, vp27, vp26 } = d;
      let diffEuro = null;
      let diffPct  = null;
      if (vp27 !== null && vp26 !== null) {
        diffEuro = vp27 - vp26;
        diffPct  = ((vp27 - vp26) / vp26) * 100;
      }
      row.push(
        min     != null ? min     : '—',
        blended != null ? blended : '—',
        vp27    != null ? vp27    : '—',
        vp26    != null ? vp26    : (pkg === '12nts' ? 'n/a' : '—'),
        diffEuro != null ? Math.round(diffEuro) : '—',
        diffPct  != null ? `${diffPct.toFixed(1)}%` : '—',
      );
    }
    dataRows.push(row);
  }

  const notesText = notes ||
    'MIN = cheapest netto × 1.06 × 1.23  |  ' +
    'Blended = (AVG+MIN)/2 × 1.06 × 1.23  |  ' +
    'VP 2027 = contract price from source sheet  |  ' +
    'VP 2026 = from Drive VP contract PDFs  |  ' +
    'Diff = VP 2027 − VP 2026';

  const titleText = tier ? `${title}  [${tier}]` : title;
  const subtitleText = variantLabel
    ? `Generated: ${runDate}  |  ${variantLabel}  |  Pricing: acc netto × 1.06 × 1.23`
    : `Generated: ${runDate}  |  Pricing: acc netto × 1.06 × 1.23`;

  const allRows = [
    [titleText],
    [subtitleText],
    [],
    ...dataRows,
    [],
    [notesText],
  ];

  // Escape single quotes in tab name for A1 notation
  const safeTab = tabName.replace(/'/g, "\\'");
  await sheets.spreadsheets.values.update({
    spreadsheetId: ssId,
    range: `'${safeTab}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: allRows },
  });

  // ── Formatting ───────────────────────────────────────────────────────────────
  const sid            = sheetId;   // numeric tab ID
  const PKG_COL_START  = 1;
  const DATA_START_ROW = 5;
  const DATA_END_ROW   = DATA_START_ROW + usedMonths.length;
  const TOTAL_COLS     = 1 + PKG_KEYS.length * PKG_COL_WIDTH;

  const COLOR_HEADER_DARK = { red: 0.133, green: 0.267, blue: 0.533 };
  const COLOR_HEADER_MID  = { red: 0.286, green: 0.427, blue: 0.690 };
  const COLOR_PKG_ALT = [
    { red: 0.878, green: 0.906, blue: 0.961 },
    { red: 0.863, green: 0.925, blue: 0.878 },
    { red: 0.996, green: 0.945, blue: 0.816 },
    { red: 0.961, green: 0.878, blue: 0.878 },
    { red: 0.918, green: 0.859, blue: 0.961 },
  ];
  const COLOR_WHITE = { red: 1, green: 1, blue: 1 };

  const fmtRequests = [];

  fmtRequests.push({
    repeatCell: {
      range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: {
        backgroundColor: COLOR_HEADER_DARK,
        textFormat: { foregroundColor: COLOR_WHITE, bold: true, fontSize: 12 },
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  });

  fmtRequests.push({
    repeatCell: {
      range: { sheetId: sid, startRowIndex: 1, endRowIndex: 2 },
      cell: { userEnteredFormat: {
        backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
        textFormat: { italic: true },
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  });

  for (let p = 0; p < PKG_KEYS.length; p++) {
    const startCol = PKG_COL_START + p * PKG_COL_WIDTH;
    const color    = COLOR_PKG_ALT[p % COLOR_PKG_ALT.length];
    fmtRequests.push({
      repeatCell: {
        range: { sheetId: sid, startRowIndex: 3, endRowIndex: 4, startColumnIndex: startCol, endColumnIndex: startCol + PKG_COL_WIDTH },
        cell: { userEnteredFormat: { backgroundColor: color, textFormat: { bold: true } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    });
    fmtRequests.push({
      mergeCells: {
        range: { sheetId: sid, startRowIndex: 3, endRowIndex: 4, startColumnIndex: startCol, endColumnIndex: startCol + PKG_COL_WIDTH },
        mergeType: 'MERGE_ALL',
      },
    });
  }

  fmtRequests.push({
    repeatCell: {
      range: { sheetId: sid, startRowIndex: 4, endRowIndex: 5 },
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
    for (const offset of [4, 5]) {
      fmtRequests.push({
        repeatCell: {
          range: { sheetId: sid, startRowIndex: DATA_START_ROW, endRowIndex: DATA_END_ROW,
                   startColumnIndex: startCol + offset, endColumnIndex: startCol + offset + 1 },
          cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
          fields: 'userEnteredFormat(horizontalAlignment)',
        },
      });
    }
  }

  fmtRequests.push({
    repeatCell: {
      range: { sheetId: sid, startRowIndex: DATA_START_ROW, endRowIndex: DATA_END_ROW,
               startColumnIndex: 0, endColumnIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: 'userEnteredFormat(textFormat)',
    },
  });

  const notesRowIdx = DATA_END_ROW + 1;
  fmtRequests.push({
    repeatCell: {
      range: { sheetId: sid, startRowIndex: notesRowIdx, endRowIndex: notesRowIdx + 1 },
      cell: { userEnteredFormat: {
        backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
        textFormat: { italic: true, fontSize: 8 },
      }},
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    },
  });

  fmtRequests.push({
    autoResizeDimensions: {
      dimensions: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: TOTAL_COLS },
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ssId,
    requestBody: { requests: fmtRequests },
  });
}

/**
 * Build and upload a VP Package Proposal Google Sheet (single-tier, single-tab).
 * Used for Sardegna / Toscana / Liguria which have no tier split.
 */
async function buildProposalSheet(opts) {
  const { title, pkgDefs, monthData, folderId, runDate, tier, variantLabel, notes } = opts;
  const drive = getDriveClient();

  const usedMonths = ACTIVE_MONTHS.filter(m =>
    Object.values(monthData).some(md => md[m])
  );

  const { ssId, webViewLink, tabIds } = await createSpreadsheetWithTabs(title, folderId, ['Proposal']);
  const sheetId = tabIds['Proposal'] ?? 0;

  await writeProposalTab({
    ssId, sheetId, tabName: 'Proposal',
    pkgDefs, monthData,
    title, runDate, tier, variantLabel, notes,
    usedMonths,
  });

  console.log(`  ✓ Proposal sheet: ${webViewLink}`);
  return { id: ssId, webViewLink };
}

// ─── LAGHI builder ────────────────────────────────────────────────────────────

/**
 * Compute pkgDefs + monthData for one tier of one variant.
 */
function computeLaghiVariantData(variantDef, perNight, vpContract, prorata, tierKey) {
  const vp2026tier = VP2026.laghi[tierKey];
  const pkgDefs   = {};
  const monthData = {};

  for (const [pkgKey, pkg] of Object.entries(variantDef.packages)) {
    pkgDefs[pkgKey]   = { label: pkg.label, expTotal: pkg.expTotal };
    monthData[pkgKey] = {};

    for (const month of ACTIVE_MONTHS) {
      const { nights, expTotal } = pkg;

      let minAccNetto     = 0;
      let blendedAccNetto = 0;
      let hasRates        = true;

      for (const lake of ['maggiore', 'como', 'garda']) {
        const n = nights[lake];
        if (!n) continue;
        const lakeData = perNight[lake]?.[month];
        if (!lakeData?.min || !lakeData?.avg) { hasRates = false; break; }
        minAccNetto     += lakeData.min * n;
        blendedAccNetto += ((lakeData.avg + lakeData.min) / 2) * n;
      }

      const minSell     = hasRates ? sellPrice(minAccNetto, expTotal)     : null;
      const blendedSell = hasRates ? sellPrice(blendedAccNetto, expTotal) : null;

      let vp27 = vpContract[pkgKey]?.[month] ?? null;
      if (vp27 === null && blendedSell !== null && pkgKey === '12nts') vp27 = blendedSell;

      const vp26 = (vp2026tier && vp2026tier[pkgKey])
        ? (vp2026tier[pkgKey][month] ?? null)
        : (prorata[pkgKey]?.[month]?.vp26 ?? null);

      monthData[pkgKey][month] = { min: minSell, blended: blendedSell, vp27, vp26 };
    }
  }

  return { pkgDefs, monthData };
}

async function buildLaghiProposal(proposalFolderId, runDate, saleName) {
  console.log('\n📦  Building Laghi VP package proposals…');
  const salePrefix = saleName ? `${saleName} — ` : '';

  const sheets = getSheetsClient();
  const files  = [];

  // Tiers to include
  const tierConfigs = [
    { tier: '4★S', tierKey: '4sstar', ssId: SS_4S_ID },
    ...(SS_4STAR_ID ? [{ tier: '4★', tierKey: '4star', ssId: SS_4STAR_ID }] : []),
  ];

  // Read source data for each tier up front
  console.log('  → Reading source sheets for all tiers…');
  const tierData = {};
  await Promise.all(tierConfigs.map(async ({ tier, tierKey, ssId }) => {
    const [data5, data7, data9, vpContract, prorata] = await Promise.all([
      readLakeMediaRates(sheets, ssId, '5 nts'),
      readLakeMediaRates(sheets, ssId, '7 nts'),
      readLakeMediaRates(sheets, ssId, '9 nts'),
      readVpContractPrices(sheets, ssId),
      readProrata(sheets, ssId),
    ]);
    const perNight = { maggiore: {}, como: {}, garda: {} };
    for (const month of ACTIVE_MONTHS) {
      perNight.maggiore[month] = data5?.rates?.maggiore?.[month] || data7?.rates?.maggiore?.[month] || data9?.rates?.maggiore?.[month] || null;
      perNight.como[month]     = data5?.rates?.como?.[month]     || data7?.rates?.como?.[month]     || data9?.rates?.como?.[month]     || null;
      perNight.garda[month]    = data7?.rates?.garda?.[month]    || data9?.rates?.garda?.[month]    || null;
    }
    tierData[tierKey] = { tier, ssId, perNight, vpContract, prorata };
  }));

  // One file per variant, one tab per tier
  for (const [variantKey, variantDef] of Object.entries(LAGHI_VARIANTS)) {
    console.log(`\n  → Variant: ${variantDef.label}`);

    const tabNames  = tierConfigs.map(tc => tc.tier);   // ['4★S'] or ['4★S', '4★']
    const fileTitle = `${salePrefix}VP 2027 — Laghi — ${variantDef.label} — ${runDate}`;

    console.log(`    Creating file "${fileTitle}" with tabs: ${tabNames.join(', ')}…`);
    const { ssId: outSsId, webViewLink, tabIds } = await createSpreadsheetWithTabs(fileTitle, proposalFolderId, tabNames);

    for (const { tier, tierKey } of tierConfigs) {
      const { perNight, vpContract, prorata } = tierData[tierKey];
      const { pkgDefs, monthData } = computeLaghiVariantData(variantDef, perNight, vpContract, prorata, tierKey);

      const usedMonths = ACTIVE_MONTHS.filter(m =>
        Object.values(monthData).some(md => md[m])
      );

      console.log(`    Writing tab "${tier}"…`);
      await writeProposalTab({
        ssId:         outSsId,
        sheetId:      tabIds[tier] ?? 0,
        tabName:      tier,
        pkgDefs,
        monthData,
        title:        fileTitle,
        runDate,
        tier,
        variantLabel: variantDef.label,
        usedMonths,
      });
    }

    console.log(`  ✓ ${webViewLink}`);
    files.push({ id: outSsId, webViewLink });
  }

  return files;
}

// ─── SARDEGNA builder ─────────────────────────────────────────────────────────

/**
 * Build Sardinia proposal from a scraped source spreadsheet (Drive XLS).
 * @param {string} sourceSheetId   — ID of the scraped Sardinia Google Sheet in Drive
 * @param {string} proposalFolderId
 * @param {string} runDate
 */
async function buildSardegnaProposal(sourceSheetId, proposalFolderId, runDate, saleName) {
  console.log('\n📦  Building Sardegna VP package proposal…');
  const salePrefix = saleName ? `${saleName} — ` : '';

  // For Sardinia, source sheet not yet available at the time of writing.
  // We use hardcoded 2026 VP actuals and emit a note that 2027 rates need the source sheet.
  // Once the source sheet is available, this can be enhanced to read netto rates.

  const pkgDefs   = {};
  const monthData = {};

  // Sardinia active months (from contract): Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov
  const sardMonths = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];

  for (const [pkgKey, pkg] of Object.entries(SARDEGNA_PACKAGES)) {
    pkgDefs[pkgKey] = { label: pkg.label, expTotal: pkg.expTotal };
    monthData[pkgKey] = {};

    for (const month of sardMonths) {
      // 2026 VP actual
      const vp26 = VP2026.sardegna[pkgKey]?.[month] ?? null;

      // 2027 VP: not yet available without source sheet
      // Placeholder — will be populated when scrape completes
      const vp27    = null;
      const minSell = null;
      const blended = null;

      monthData[pkgKey][month] = { min: minSell, blended, vp27, vp26 };
    }
  }

  const sheetTitle = `${salePrefix}VP 2027 — Sardegna — Package Proposal — ${runDate}`;
  return buildProposalSheet({
    title:        sheetTitle,
    pkgDefs,
    monthData,
    folderId:     proposalFolderId,
    runDate,
    tier:         '',
    variantLabel: 'Standard (4★)',
    notes:        'MIN/Blended/VP 2027: awaiting scraped source sheet  |  ' +
                  'VP 2026 from Drive VP contract PDFs (Aug 2026 version)  |  ' +
                  'Experience costs: 7nts €80pp (boat+wine), 10/12nts €170pp (+cooking class)',
  });
}

// ─── TOSCANA builder ──────────────────────────────────────────────────────────

async function buildToscanaProposal(sourceSheetId, proposalFolderId, runDate, saleName) {
  console.log('\n📦  Building Toscana VP package proposal…');
  const salePrefix = saleName ? `${saleName} — ` : '';

  // Tuscany months (from contract): Oct, Nov, Dec, Jan, Feb, Mar, Apr, May, Jun
  const toscanaMonths = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

  const pkgDefs   = {};
  const monthData = {};

  for (const [pkgKey, pkg] of Object.entries(TOSCANA_PACKAGES)) {
    pkgDefs[pkgKey]   = { label: pkg.label, expTotal: pkg.expTotal };
    monthData[pkgKey] = {};

    for (const month of toscanaMonths) {
      const vp26 = VP2026.toscana[pkgKey]?.[month] ?? null;

      monthData[pkgKey][month] = {
        min:     null,   // awaiting source sheet
        blended: null,
        vp27:    null,
        vp26,
      };
    }
  }

  const sheetTitle = `${salePrefix}VP 2027 — Toscana — Package Proposal — ${runDate}`;
  return buildProposalSheet({
    title:        sheetTitle,
    pkgDefs,
    monthData,
    folderId:     proposalFolderId,
    runDate,
    tier:         '',
    variantLabel: 'Standard (4★)',
    notes:        'MIN/Blended/VP 2027: awaiting scraped source sheet  |  ' +
                  'VP 2026 from Drive VP contract PDFs (Sept 2026 v2)  |  ' +
                  'Experience costs: 5nts €35pp (wine tasting), 7nts €45pp (wine tasting)',
  });
}

// ─── LIGURIA builder ──────────────────────────────────────────────────────────

async function buildLiguriaProposal(sourceSheetId, proposalFolderId, runDate, saleName) {
  console.log('\n📦  Building Liguria VP package proposal…');
  const salePrefix = saleName ? `${saleName} — ` : '';

  // Liguria months (from contract): Jun, Jul, Aug, Sep, Oct
  const liguriaMonths = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

  const pkgDefs   = {};
  const monthData = {};

  for (const [pkgKey, pkg] of Object.entries(LIGURIA_PACKAGES)) {
    pkgDefs[pkgKey]   = { label: pkg.label, expTotal: pkg.expTotal };
    monthData[pkgKey] = {};

    for (const month of liguriaMonths) {
      const vp26 = VP2026.liguria[pkgKey]?.[month] ?? null;

      monthData[pkgKey][month] = {
        min:     null,
        blended: null,
        vp27:    null,
        vp26,
      };
    }
  }

  const sheetTitle = `${salePrefix}VP 2027 — Liguria — Package Proposal — ${runDate}`;
  return buildProposalSheet({
    title:        sheetTitle,
    pkgDefs,
    monthData,
    folderId:     proposalFolderId,
    runDate,
    tier:         '',
    variantLabel: 'Standard (4★)',
    notes:        'MIN/Blended/VP 2027: awaiting scraped source sheet  |  ' +
                  'VP 2026 from Drive VP contract PDFs (June 2026 version)  |  ' +
                  'Experience costs: 5nts €45pp (CT boat + pesto), 7nts €60pp (CT boat + pesto)',
  });
}

// ─── PUGLIA packages ──────────────────────────────────────────────────────────
// Puglia: 7nts and 10nts packages.
// Experiences (TBD — placeholders until VP contract is confirmed):
//   7nts:  Alberobello trulli tour €40 + olive oil tasting €25 = €65
//   10nts: 7nts experiences + Lecce walking tour €30 + masseria dinner €45 = €140
const PUGLIA_PACKAGES = {
  nts7:  { nts: 7,  label: '7 Nights', expTotal: 65  },
  nts10: { nts: 10, label: '10 Nights', expTotal: 140 },
};

// ─── PUGLIA 2026 VP actuals ───────────────────────────────────────────────────
// No 2026 VP Puglia contract exists yet — set to null until confirmed.
const VP2026_PUGLIA = {
  nts7:  { Apr: null, May: null, Jun: null, Jul: null, Aug: null, Sep: null, Oct: null },
  nts10: { Apr: null, May: null, Jun: null, Jul: null, Aug: null, Sep: null, Oct: null },
};

// ─── PUGLIA builder ───────────────────────────────────────────────────────────

async function buildPugliaProposal(sourceSheetId, proposalFolderId, runDate, saleName) {
  console.log('\n📦  Building Puglia VP package proposal…');
  const salePrefix = saleName ? `${saleName} — ` : '';

  // Puglia active months (assumed): Apr, May, Jun, Jul, Aug, Sep, Oct
  const pugliaMonths = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

  const pkgDefs   = {};
  const monthData = {};

  for (const [pkgKey, pkg] of Object.entries(PUGLIA_PACKAGES)) {
    pkgDefs[pkgKey]   = { label: pkg.label, expTotal: pkg.expTotal };
    monthData[pkgKey] = {};

    for (const month of pugliaMonths) {
      const vp26 = VP2026_PUGLIA[pkgKey]?.[month] ?? null;

      monthData[pkgKey][month] = {
        min:     null,   // awaiting scraped source sheet
        blended: null,
        vp27:    null,
        vp26,
      };
    }
  }

  const sheetTitle = `${salePrefix}VP 2027 — Puglia — Package Proposal — ${runDate}`;
  return buildProposalSheet({
    title:        sheetTitle,
    pkgDefs,
    monthData,
    folderId:     proposalFolderId,
    runDate,
    tier:         '',
    variantLabel: 'Standard (4★)',
    notes:        'SCAFFOLD — VP 2026 contract not yet finalised  |  ' +
                  'MIN/Blended/VP 2027: awaiting scrape + source sheet  |  ' +
                  'Experience costs: 7nts €65pp (trulli tour + olive oil), 10nts €140pp (+Lecce tour + masseria dinner)',
  });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Build VP package proposals for the given destination.
 *
 * @param {string}   destination           — 'laghi' | 'toscana' | 'sardegna' | 'liguria' | 'puglia'
 * @param {string[]} driveSpreadsheetIds   — scraped source sheet IDs (from scraper.js)
 * @param {string}   proposalFolderId      — Drive folder for output sheets
 * @param {string}   runDate               — YYYY-MM-DD
 * @param {string}   [saleName]            — Optional VP flash sale name for file labelling
 */
async function buildPackageProposal(destination, driveSpreadsheetIds, proposalFolderId, runDate, saleName) {
  const sourceSheetId = Array.isArray(driveSpreadsheetIds) ? driveSpreadsheetIds[0] : null;

  switch (destination) {
    case 'laghi':
      return buildLaghiProposal(proposalFolderId, runDate, saleName);

    case 'sardegna':
      return buildSardegnaProposal(sourceSheetId, proposalFolderId, runDate, saleName);

    case 'toscana':
      return buildToscanaProposal(sourceSheetId, proposalFolderId, runDate, saleName);

    case 'liguria':
      return buildLiguriaProposal(sourceSheetId, proposalFolderId, runDate, saleName);

    case 'puglia':
      return buildPugliaProposal(sourceSheetId, proposalFolderId, runDate, saleName);

    default:
      console.log(`  ℹ  Package proposal not implemented for '${destination}' — skipping.`);
      return null;
  }
}

module.exports = {
  buildPackageProposal,
  VP2026,
  LAGHI_VARIANTS,
  SARDEGNA_PACKAGES,
  TOSCANA_PACKAGES,
  LIGURIA_PACKAGES,
  PUGLIA_PACKAGES,
  TOTAL_MARKUP,
};

// ─── Standalone CLI ───────────────────────────────────────────────────────────
// Usage: node package-proposal.js <destination>
// e.g.:  node package-proposal.js laghi
//        node package-proposal.js sardegna
//        node package-proposal.js toscana
//        node package-proposal.js liguria
if (require.main === module) {
  const dest    = process.argv[2] || 'laghi';
  const runDate = new Date().toISOString().slice(0, 10);

  // Folder IDs per destination (env vars or fallbacks)
  const FOLDER_IDS = {
    laghi:    process.env.VP_2027_FOLDER_LAGHI    || '1KQNpmHcVW0nTbcztgUophIM100PvlLL1',
    toscana:  process.env.VP_2027_FOLDER_TOSCANA  || '',
    sardegna: process.env.VP_2027_FOLDER_SARDEGNA || '',
    liguria:  process.env.VP_2027_FOLDER_LIGURIA  || '',
  };

  const folderId = FOLDER_IDS[dest];
  if (!folderId) {
    console.error(`\n❌  No folder ID configured for '${dest}'. Set VP_2027_FOLDER_${dest.toUpperCase()} env var.`);
    process.exit(1);
  }

  buildPackageProposal(dest, [], folderId, runDate)
    .then(files => {
      const fileList = Array.isArray(files) ? files : [files].filter(Boolean);
      if (fileList.length) {
        console.log(`\n✅  ${fileList.length} proposal(s) created:`);
        fileList.forEach(f => f && console.log(`    ${f.webViewLink}`));
      } else {
        console.log('\nℹ  No proposals created.');
      }
    })
    .catch(err => {
      console.error('\n❌  Error:', err.message);
      process.exit(1);
    });
}
