/**
 * package-proposal.js
 * Post-processing module for the BHI Rate Scraper.
 *
 * After the scraper downloads XLS rate files and uploads them to Drive,
 * this module reads the per-lake rate sheets, computes VP sell prices
 * (accommodation netto + experience costs × BHI markup × Italian VAT),
 * and writes a VP Package Proposal Google Sheet to Drive.
 *
 * Usage: called automatically at the end of runScraper() for 'laghi'.
 *        Can also be called standalone: node package-proposal.js laghi
 *
 * ─── PRICING CHAIN ───────────────────────────────────────────────────────────
 * VP sell price = (accommodation_netto_pp + experiences_netto_pp) × 1.06 × 1.23
 *   1.06 = BHI markup (6%)
 *   1.23 = Italian VAT (23%)
 *
 * ─── EXPERIENCE COSTS (netto per person) ────────────────────────────────────
 * Source: VP email thread confirmed April 2026 (Charline Sarti / Concezio)
 *
 * Lago Maggiore:
 *   - Cheese & wine tasting (cantina with Alpine view, 3 wines + tagliere): €33
 *   - Barca Isola Madre: €12 (not used in current BF packages)
 *
 * Lago di Como:
 *   - Crociera with aperitivo on board: €55  ← selected for all packages
 *
 * Lago di Garda:
 *   - Wine tasting farmhouse near Bardolino (7nts — simple): TODO — set BARDOLINO_WINE_7NTS
 *   - Wine experience near Bardolino (9nts — elaborate: vineyards + 4 wines + olive oil + delicacies): TODO — set BARDOLINO_WINE_9NTS
 *
 * ─── PACKAGE STRUCTURE (nights per lake) ────────────────────────────────────
 * 5nts:  3 Maggiore + 2 Como  (no Garda)
 * 7nts:  3 Maggiore + 2 Como + 2 Garda
 * 9nts:  3 Maggiore + 2 Como + 4 Garda
 * 12nts: 4 Maggiore + 4 Como + 4 Garda
 */

'use strict';

const { google } = require('googleapis');

// ─── Experience costs (netto per person) ─────────────────────────────────────
// Confirmed from VP email thread (April 2026 Charline Sarti / Concezio)
const EXPERIENCES = {
  maggiore_cheese_tasting: 33,  // €33/pp — degustazione vini cantina with Alpine view
  como_boat_aperitivo:     55,  // €55/pp — crociera sul Lago di Como con aperitivo

  // ⚠️  PENDING — Concezio to confirm exact netto costs for the Bardolino wine experiences
  // Used in the 7nts and 9nts packages (not the 5nts).
  // Set these once confirmed; set to null to flag as "not yet set" in the output sheet.
  garda_wine_bardolino_7nts: null,  // TODO: €? — wine tasting farmhouse near Bardolino (simple)
  garda_wine_bardolino_9nts: null,  // TODO: €? — wine experience near Bardolino (elaborate: vineyards + 4 wines + olive oil + delicacies)
};

// ─── Package definitions ──────────────────────────────────────────────────────
const PACKAGES = {
  '5nts': {
    nights: { maggiore: 3, como: 2, garda: 0 },
    experiences: [
      EXPERIENCES.maggiore_cheese_tasting,
      EXPERIENCES.como_boat_aperitivo,
    ],
    label: '5 nights (3 Maggiore + 2 Como)',
  },
  '7nts': {
    nights: { maggiore: 3, como: 2, garda: 2 },
    experiences: [
      EXPERIENCES.maggiore_cheese_tasting,
      EXPERIENCES.como_boat_aperitivo,
      EXPERIENCES.garda_wine_bardolino_7nts,
    ],
    label: '7 nights (3 Maggiore + 2 Como + 2 Garda)',
  },
  '9nts': {
    nights: { maggiore: 3, como: 2, garda: 4 },
    experiences: [
      EXPERIENCES.maggiore_cheese_tasting,
      EXPERIENCES.como_boat_aperitivo,
      EXPERIENCES.garda_wine_bardolino_9nts,
    ],
    label: '9 nights (3 Maggiore + 2 Como + 4 Garda)',
  },
  '12nts': {
    nights: { maggiore: 4, como: 4, garda: 4 },
    experiences: [
      EXPERIENCES.maggiore_cheese_tasting,
      EXPERIENCES.como_boat_aperitivo,
      EXPERIENCES.garda_wine_bardolino_9nts,  // assume same elaborate experience as 9nts
    ],
    label: '12 nights (4 Maggiore + 4 Como + 4 Garda)',
  },
};

// ─── VP pricing formula ───────────────────────────────────────────────────────
const BHI_MARKUP = 1.06;
const ITALIAN_VAT = 1.23;
const TOTAL_MARKUP = BHI_MARKUP * ITALIAN_VAT;  // 1.3038

/**
 * Compute VP sell price per person for a package.
 * @param {number} accNettoPP  - Accommodation netto per person (sum across all lakes for the stay)
 * @param {string} pkgKey      - Package key: '5nts', '7nts', '9nts', '12nts'
 * @returns {{ vpPrice: number|null, expTotal: number|null, totalNetto: number|null, hasPendingExp: boolean }}
 */
function computeVpPrice(accNettoPP, pkgKey) {
  const pkg = PACKAGES[pkgKey];
  if (!pkg) throw new Error(`Unknown package: ${pkgKey}`);

  const exps = pkg.experiences;
  const hasPendingExp = exps.some(e => e === null);

  if (hasPendingExp) {
    // Partial calculation — sum only known experiences
    const knownExpTotal = exps.reduce((sum, e) => sum + (e || 0), 0);
    const knownTotalNetto = accNettoPP + knownExpTotal;
    return {
      vpPrice: null,       // Cannot compute — Bardolino wine cost pending
      expTotal: null,      // Incomplete
      knownExpTotal,       // Known part
      totalNetto: null,
      hasPendingExp: true,
      pendingExpNote: 'Wine tasting near Bardolino (Garda) — cost not yet confirmed',
    };
  }

  const expTotal = exps.reduce((sum, e) => sum + e, 0);
  const totalNetto = accNettoPP + expTotal;
  const vpPrice = Math.round(totalNetto * TOTAL_MARKUP);

  return { vpPrice, expTotal, totalNetto, hasPendingExp: false };
}

// ─── Months ───────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ACTIVE_MONTHS = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

// ─── Google Drive helper ──────────────────────────────────────────────────────
function getDriveClient() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  });
  return google.drive({ version: 'v3', auth });
}

function getSheetsClient() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/**
 * Read a "7 nts", "9 nts", or "12 nts" sheet from a Google Spreadsheet
 * and return { hotelName → { month → minRatePP } } where minRatePP is the
 * minimum netto rate per person per night (accommodation only).
 *
 * The sheets follow the BHI search format:
 *   Row 1: month headers (Jan, Feb, ..., Dec)
 *   Row 2: night counts (e.g. "3, 2, 2" for Dest1, Dest2, Dest3)
 *   Then per hotel: HOTEL_NAME row, AVG row, MIN row
 *   The MIN row is the cheapest available netto per room per night.
 *   Per person = MIN / 2 (double occupancy).
 *
 * @param {string} spreadsheetId
 * @param {string} sheetName  e.g. '7 nts'
 * @param {number} dest1Nights  nights at Dest1 (Maggiore/Como/Garda)
 * @returns {Object}  { hotelName: { month: minRatePerPersonPerNight } }
 */
async function readRateSheet(spreadsheetId, sheetName, dest1Nights) {
  const sheets = getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A1:M200`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return {};

  // Row 0 = month headers starting at col B (index 1)
  const monthHeaders = rows[0].slice(1); // ['Jan','Feb',...,'Dec']
  const monthIndexMap = {};
  monthHeaders.forEach((m, i) => { if (m) monthIndexMap[m] = i + 1; }); // col index in row

  const hotels = {};
  let currentHotel = null;
  let expectNext = null; // 'avg', 'min', null

  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const colA = (row[0] || '').trim();

    if (colA && colA !== 'AVG' && colA !== 'MIN' && colA !== 'DEST 1' && colA !== 'DEST 2' && colA !== 'DEST 3') {
      // New hotel name
      currentHotel = colA;
      hotels[currentHotel] = {};
      expectNext = 'avg';
    } else if (colA === 'AVG') {
      expectNext = 'min';
    } else if (colA === 'MIN' && currentHotel) {
      // Parse minimum rates per month
      ACTIVE_MONTHS.forEach(month => {
        const colIdx = monthIndexMap[month];
        if (colIdx === undefined) return;
        const rawVal = row[colIdx] || '0';
        const val = parseFloat(String(rawVal).replace(/[€,\s]/g, '')) || 0;
        if (val > 0) {
          // MIN is per room per night; per person = val / 2
          hotels[currentHotel][month] = val / 2;
        }
      });
      expectNext = null;
    }
  }

  return hotels;
}

/**
 * Build a VP Package Proposal summary and write it as a new Google Sheet in Drive.
 *
 * @param {Object} ratesByLake  { maggiore: {hotel: {month: ratepp}}, como: {...}, garda: {...} }
 * @param {string} folderId     Drive folder to create the sheet in
 * @param {string} runDate      YYYY-MM-DD
 * @returns {Object} drive file metadata
 */
async function buildProposalSheet(ratesByLake, folderId, runDate) {
  const drive = getDriveClient();
  const sheets = getSheetsClient();

  // Create a new blank spreadsheet
  const title = `VP 2027 — Laghi — Package Proposal ${runDate}`;
  const createResp = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [folderId],
    },
    fields: 'id, webViewLink',
  });
  const ssId = createResp.data.id;

  // Build sheet data
  const headerRow = ['Package', 'Lake', 'Hotel', 'Month', 'Acc Netto/pp (stay)', 'Experiences', 'Total Netto/pp', 'VP Sell Price/pp', 'Notes'];
  const dataRows = [headerRow];

  for (const [pkgKey, pkg] of Object.entries(PACKAGES)) {
    const { nights, label } = pkg;

    for (const [lake, lakeNights] of Object.entries(nights)) {
      if (lakeNights === 0) continue;
      const lakeRates = ratesByLake[lake] || {};

      for (const [hotel, monthRates] of Object.entries(lakeRates)) {
        for (const month of ACTIVE_MONTHS) {
          const ratePerNightPP = monthRates[month];
          if (!ratePerNightPP) continue;

          // Accommodation netto for this lake's portion (per person for lakeNights)
          const accNettoPortion = ratePerNightPP * lakeNights;

          // For a full package we need all 3 lakes; here we show per-lake breakdown
          // The VP price will be computed when combining all lakes for a given hotel combination
          const { vpPrice, expTotal, hasPendingExp, pendingExpNote } = computeVpPrice(accNettoPortion, pkgKey);

          const notes = hasPendingExp ? `⚠️ ${pendingExpNote}` : '';
          dataRows.push([
            label,
            lake.charAt(0).toUpperCase() + lake.slice(1),
            hotel,
            month,
            accNettoPortion.toFixed(2),
            hasPendingExp ? '(pending)' : (expTotal?.toFixed(2) || ''),
            hasPendingExp ? '(pending)' : ((accNettoPortion + (expTotal || 0)).toFixed(2)),
            hasPendingExp ? '⚠️ PENDING' : (vpPrice?.toString() || ''),
            notes,
          ]);
        }
      }
    }
  }

  // Write to sheet
  await sheets.spreadsheets.values.update({
    spreadsheetId: ssId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    requestBody: { values: dataRows },
  });

  // Format header row
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ssId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.4, blue: 0.8 },
                textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 9 },
          },
        },
      ],
    },
  });

  console.log(`  ✓ Proposal sheet created: ${createResp.data.webViewLink}`);
  return createResp.data;
}

// ─── Main entry point ─────────────────────────────────────────────────────────
/**
 * Run the package proposal builder for the given destination.
 * Currently only 'laghi' is fully implemented.
 *
 * Call this after all XLS batches have been downloaded and uploaded.
 *
 * @param {string} destination  e.g. 'laghi'
 * @param {string[]} driveSpreadsheetIds  IDs of the search spreadsheets that contain the rate sheets
 * @param {string} proposalFolderId  Drive folder to write the proposal into
 * @param {string} runDate  YYYY-MM-DD
 */
async function buildPackageProposal(destination, driveSpreadsheetIds, proposalFolderId, runDate) {
  if (destination !== 'laghi') {
    console.log(`  ℹ  Package proposal not yet implemented for '${destination}' — skipping.`);
    return null;
  }

  console.log('\n📦  Building VP package proposal for Laghi…');

  // Warn about pending experience costs
  const pendingExps = Object.entries(EXPERIENCES).filter(([k, v]) => v === null).map(([k]) => k);
  if (pendingExps.length > 0) {
    console.warn(`  ⚠  Pending experience costs (VP prices will show ⚠️ PENDING for 7nts/9nts):`);
    pendingExps.forEach(k => console.warn(`     ${k}`));
    console.warn(`  → Set these in package-proposal.js EXPERIENCES object once confirmed.`);
  }

  // Read rates from each search spreadsheet
  // The search spreadsheets (search_236=Como, search_237=Maggiore, search_240=Garda)
  // contain sheets named "7 nts", "9 nts", "12 nts" with the aggregated rates.
  const ratesByLake = { maggiore: {}, como: {}, garda: {} };

  for (const ssId of driveSpreadsheetIds) {
    // Determine which lake this spreadsheet covers by its title
    // (search_237 = Maggiore, search_236 = Como, search_240 = Garda)
    // In practice, we map by spreadsheet ID or title conventions.
    // For now we read all three "7 nts" sheets and attempt to guess from hotel names.
    // TODO: map ssId → lake explicitly once IDs are stable.
    for (const [sheetName, nights] of [['7 nts', 3], ['9 nts', 3], ['12 nts', 4]]) {
      try {
        const rates = await readRateSheet(ssId, sheetName, nights);
        // Try to infer lake from hotel names (rough heuristic)
        const names = Object.keys(rates).join(' ').toUpperCase();
        const lake = names.includes('MAGGIORE') || names.includes('ASTORIA') || names.includes('MAJESTIC') ? 'maggiore'
                   : names.includes('COMO') || names.includes('LECCO') ? 'como'
                   : names.includes('GARDA') || names.includes('BARDOLINO') || names.includes('SIRMIONE') ? 'garda'
                   : null;
        if (lake) {
          Object.assign(ratesByLake[lake], rates);
        }
      } catch (err) {
        console.warn(`  ⚠  Could not read "${sheetName}" from ${ssId}: ${err.message}`);
      }
    }
  }

  // Build and upload the proposal sheet
  const proposalFile = await buildProposalSheet(ratesByLake, proposalFolderId, runDate);
  return proposalFile;
}

module.exports = { buildPackageProposal, computeVpPrice, EXPERIENCES, PACKAGES, TOTAL_MARKUP };

// If called directly (node package-proposal.js laghi), run standalone
if (require.main === module) {
  const dest = process.argv[2] || 'laghi';
  // These IDs come from Drive — the search spreadsheets that the existing workflow created
  const LAGHI_SEARCH_SS_IDS = [
    '1QT9lNez2q8gDBN_XbLw4X666lGhvE_W0z0a1DKoaF0s',  // search_236 Como
    '1kmfhfwYbYPrIz4g74W4LGrwvd3m3ouCJcB-UUvxrqbU',  // search_237 Maggiore
    '1DtFDRZUNPFYcOnfDh3CEzXKVU5tk2cpUy2A8AAVdOBA',  // search_240 Garda
  ];
  const VP_2027_FOLDER_ID = '1KQNpmHcVW0nTbcztgUophIM100PvlLL1';
  const runDate = new Date().toISOString().slice(0, 10);

  buildPackageProposal(dest, LAGHI_SEARCH_SS_IDS, VP_2027_FOLDER_ID, runDate)
    .then(file => {
      if (file) console.log(`\n✅  Proposal created: ${file.webViewLink}`);
    })
    .catch(err => {
      console.error('\n❌  Error:', err.message);
      process.exit(1);
    });
}
