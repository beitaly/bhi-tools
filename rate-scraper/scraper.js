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
  // ── LAGHI ───────────────────────────────────────────────────────────────────
  // 104 Maggiore + 133 Como/Lecco/Cantu + 126 Garda SW shore
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 1',
    hotels: ['AL CENTRO - LAKE MAGGIORE', 'ALBERGO MIRALAGO - LAKE MAGGIORE', 'ALBERGO PARADISO - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 2',
    hotels: ['ALBERGO PESCE D\'ORO - LAKE MAGGIORE', 'ALBERGO RISTORANTE LA RIPA - LAKE MAGGIORE', 'ALBERGO VERBANO - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 3',
    hotels: ['ALPI - LAKE MAGGIORE', 'ANCORA - LAKE MAGGIORE', 'ANTICA STALLERA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 4',
    hotels: ['APARTHOTEL ARONA - LAKE MAGGIORE', 'AQUADOLCE - LAKE MAGGIORE', 'ARANCIOAMARO - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 5',
    hotels: ['ARIES - LAKE MAGGIORE', 'ASTORIA - LAKE MAGGIORE', 'ATLANTIC - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 6',
    hotels: ['AZALEA - LAKE MAGGIORE', 'BEAU RIVAGE - LAKE MAGGIORE', 'BEL SIT - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 7',
    hotels: ['BELVEDERE - LAKE MAGGIORE', 'BLUE RELAIS MALPENSA LAGO MAGGIORE - LAKE MAGGIORE', 'BOUTIQUE HOTEL STRESA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 8',
    hotels: ['BRISINO - LAKE MAGGIORE', 'CAMPAGNA - LAKE MAGGIORE', 'CANNOBIO - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 9',
    hotels: ['CAPRI - LAKE MAGGIORE', 'CARILLON - LAKE MAGGIORE', 'CARL & DO - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 10',
    hotels: ['CASA ARIZZOLI - LAKE MAGGIORE', 'CASTELLO DAL POZZO - LAKE MAGGIORE', 'CONCORDE - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 11',
    hotels: ['DE CHARME LAVENO - LAKE MAGGIORE', 'DEL FIUME - LAKE MAGGIORE', 'DEL LAGO - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 12',
    hotels: ['DELLA TORRE - LAKE MAGGIORE', 'DU PARC - LAKE MAGGIORE', 'EDEN - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 13',
    hotels: ['EUROPA - LAKE MAGGIORE', 'EUROPALACE - LAKE MAGGIORE', 'FLORA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 14',
    hotels: ['GHIFFA - LAKE MAGGIORE', 'GIARDINETTO - LAKE MAGGIORE', 'GIARDINO - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 15',
    hotels: ['GRAND HOTEL BRISTOL - LAKE MAGGIORE', 'GRAND HOTEL DES ILES BORROMEES - LAKE MAGGIORE', 'GRAND HOTEL DINO - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 16',
    hotels: ['GRAND HOTEL MAJESTIC - LAKE MAGGIORE', 'HOTEL BOSTON STRESA - LAKE MAGGIORE', 'HOTEL CANNERO LAKESIDE RESORT - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 17',
    hotels: ['HOTEL DEL PARCO - LAKE MAGGIORE', 'HOTEL IL CHIOSTRO - LAKE MAGGIORE', 'HOTEL LA FONTANA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 18',
    hotels: ['HOTEL LE PALME - LAKE MAGGIORE', 'HOTEL LUNA - LAKE MAGGIORE', 'HOTEL MEETING - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 19',
    hotels: ['HOTEL MODERNO - LAKE MAGGIORE', 'HOTEL PRIMAVERA - LAKE MAGGIORE', 'I GELSI - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 20',
    hotels: ['IL CORTILE - LAKE MAGGIORE', 'IL PORTICO - LAKE MAGGIORE', 'IL SOLE DI RANCO - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 21',
    hotels: ['ILES BORROMEES - LAKE MAGGIORE', 'INTERNATIONAL CAMPING ISPRA - LAKE MAGGIORE', 'INTRA HOTEL - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 22',
    hotels: ['ITALIE ET SUISSE - LAKE MAGGIORE', 'LA CONTRADA - LAKE MAGGIORE', 'LA PALMA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 23',
    hotels: ['LAGO MAGGIORE - LAKE MAGGIORE', 'LE TERRAZZE - LAKE MAGGIORE', 'LIDO LA PERLA NERA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 24',
    hotels: ['LUNA HOTEL MOTEL AIRPORT - LAKE MAGGIORE', 'MICHELANGELO - LAKE MAGGIORE', 'MILAN SPERANZA AU LAC - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 25',
    hotels: ['MILANO - LAKE MAGGIORE', 'MODERNO - LAKE MAGGIORE', 'NOVARA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 26',
    hotels: ['NOVESSENTIA MEDICAL SPA - LAKE MAGGIORE', 'PALAZZO - LAKE MAGGIORE', 'PALLANZA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 27',
    hotels: ['PIRONI - LAKE MAGGIORE', 'REGINA PALACE - LAKE MAGGIORE', 'RELAIS VILLA PORTA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 28',
    hotels: ['RESIDENCE ANTICO VERBANO - LAKE MAGGIORE', 'RESIDENCE DEI FIORI - LAKE MAGGIORE', 'RESIDENCE ITALIA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 29',
    hotels: ['RESIDENCE LA LUNA NEL PORTO - LAKE MAGGIORE', 'RESIDENCE ZUST - LAKE MAGGIORE', 'RISTORANTE SAN CARLO - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 30',
    hotels: ['ROMAGNA - LAKE MAGGIORE', 'ROYAL HOTEL - LAKE MAGGIORE', 'SAINI - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 31',
    hotels: ['SAN GOTTARDO - LAKE MAGGIORE', 'SANTANNA - LAKE MAGGIORE', 'SERENELLA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 32',
    hotels: ['SHG HOTEL VILLA CARLOTTA - LAKE MAGGIORE', 'SIMPLON - LAKE MAGGIORE', 'SIRIOHOTEL - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 33',
    hotels: ['SPLENDID - LAKE MAGGIORE', 'VALGRANDE - LAKE MAGGIORE', 'VILLA  E PALAZZO AMINTA HOTEL BEAUTY & SPA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 34',
    hotels: ['VILLA AURORA - LAKE MAGGIORE', 'VILLA CRESPI - LAKE MAGGIORE', 'VILLA PALMIRA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Maggiore — batch 35',
    hotels: ['VILLA PARADISO - LAKE MAGGIORE', 'WELLNESS & BEAUTY HOTEL CONCA AZZURRA - LAKE MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 1',
    hotels: ['1711 CONTRADA RESORT & SPA - LECCO', '73 BOUTIQUE HOTEL - COMO', 'AGRITURISMO CA\' DEL LAGO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 2',
    hotels: ['ALBERGO CENTRALE - LAKE COMO', 'ALBERGO DEL CACCIATORE - LECCO', 'ALBERGO FIRENZE - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 3',
    hotels: ['ALBERGO LENNO - LAKE COMO', 'ALBERGO MILANO - LAKE COMO', 'ALBERGO NICOLIN - LECCO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 4',
    hotels: ['ALBERGO RISTORANTE CONCA AZZURRA - LAKE COMO', 'ALBERGO RISTORANTE SILVIO - LAKE COMO', 'ALBERGO RISTORANTE TRE RE - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 5',
    hotels: ['ALBERGO VILLA EDY - LAKE COMO', 'ALBERGO VISTA LAGO - LAKE COMO', 'ALTIDO COMO - SAN MARTINO OPEN SPACE - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 6',
    hotels: ['ANTON&ART - COMO', 'ASNIGO - LAKE COMO', 'AVENUE HOTEL - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 7',
    hotels: ['B&B HOTEL COMO CITY CENTER - LAKE COMO', 'B&B LOCALITA¬† MANZONIANE - LECCO', 'BARCHETTA EXCELSIOR - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 8',
    hotels: ['BELLAGIO - LAKE COMO', 'BELLAVISTA - LAKE COMO', 'BELVEDERE - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 9',
    hotels: ['BEST WESTERN ALBAVILLA HOTEL & CO - COMO', 'BORGO ANTICO - COMO', 'BORGO LE TERRAZZE - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 10',
    hotels: ['BREGLIA - LAKE COMO', 'BRITANNIA EXCELSIOR - LAKE COMO', 'CASTELLO DI CARIMATE HOTEL & SPA - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 11',
    hotels: ['CASTELLO DI CASIGLIO - COMO', 'CENTRALE - LAKE COMO', 'CENTRALE BELLAGIO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 12',
    hotels: ['CLARION COLLECTION HOTEL GRISO LECCO - LECCO', 'COMO - LAKE COMO', 'DBH DUOMO BOUTIQUE HOTEL LAKE COMO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 13',
    hotels: ['DBH ‚Äì BOUTIQUE HOTEL LAKE COMO - COMO', 'DEI LAGHI - COMO', 'DOMUS BELLAGIO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 14',
    hotels: ['DON ABBONDIO - LECCO', 'DREAMHOTEL - COMO', 'DU LAC - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 15',
    hotels: ['FIORONI - LAKE COMO', 'GIRA MEGARIDE - COMO', 'GRAND HOTEL CADENABBIA - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 16',
    hotels: ['GRAND HOTEL IMPERIALE RESORT&SPA - LAKE COMO', 'GRAND HOTEL MENAGGIO - LAKE COMO', 'GRAND HOTEL TREMEZZO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 17',
    hotels: ['GRAND HOTEL VICTORIA CONCEPT & SPA - LAKE COMO', 'GRAND HOTEL VILLA SERBELLONI - LAKE COMO', 'HILTON LAKE COMO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 18',
    hotels: ['HOTEL ADLER - LAKE COMO', 'HOTEL ALBERI - LECCO', 'HOTEL BAZZONI - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 19',
    hotels: ['HOTEL BORGOVICO - COMO', 'HOTEL COMO - COMO', 'HOTEL DEL SOLE - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 20',
    hotels: ['HOTEL DU LAC - LAKE COMO', 'HOTEL DU LAC MENAGGIO - LAKE COMO', 'HOTEL ENGADINA - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 21',
    hotels: ['HOTEL EXCELSIOR SPLENDIDE - LAKE COMO', 'HOTEL GARNI CORONA - LAKE COMO', 'HOTEL LA PERLA - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 22',
    hotels: ['HOTEL LA VILLA - LAKE COMO', 'HOTEL LARIO - LAKE COMO', 'HOTEL LUMIN - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 23',
    hotels: ['HOTEL MARCO\'S - COMO', 'HOTEL METROPOLE SUISSE - COMO', 'HOTEL POSTA - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 24',
    hotels: ['HOTEL QUARCINO - COMO', 'HOTEL REGINA - LAKE COMO', 'HOTEL RISI - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 25',
    hotels: ['HOTEL RISTORANTE GLAVJC - LAKE COMO', 'HOTEL ROSSOVINO COMO - COMO', 'HOTEL ROYAL - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 26',
    hotels: ['HOTEL TULLIO - LAKE COMO', 'HOTEL VILLA BELVEDERE - LAKE COMO', 'HOTEL VILLA CIPRESSI - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 27',
    hotels: ['HOTEL VILLA COLICO - LAKE COMO', 'IBIS COMO - COMO', 'IL LOGGIATO DEI SERVITI - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 28',
    hotels: ['IL SERENO - LAKE COMO', 'JUST HOTEL LOMAZZO - COMO', 'LA DARSENA - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 29',
    hotels: ['LAGO DI COMO - LAKE COMO', 'LAKE COMO GOLF HOTEL - COMO', 'LE DUE CORTI - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 30',
    hotels: ['LE DUE CORTI - LAKE COMO', 'LEONARDO DA VINCI - COMO', 'LINDA E TONIN - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 31',
    hotels: ['LIZARD - LAKE COMO', 'LOCANDA DELL\'OCA BIANCA - COMO', 'MANDARIN ORIENTAL, LAGO DI COMO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 32',
    hotels: ['MARINONI - COMO', 'MERLONI - LAKE COMO', 'METROPOLE BELLAGIO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 33',
    hotels: ['METROPOLE SUISSE - LAKE COMO', 'MINI BARADELLO - COMO', 'MINI HOTEL BARADELLO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 34',
    hotels: ['MIRABEAU - LAKE COMO', 'MODERNO - LECCO', 'MONTECODENO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 35',
    hotels: ['NH LECCO PONTEVECCHIO - LECCO', 'OLIVEDO - LAKE COMO', 'PALACE - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 36',
    hotels: ['PALAZZO DEL VICE RE - LAKE COMO', 'PARK HOTEL ABBADIA - LAKE COMO', 'PARK HOTEL ABBADIA - LECCO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 37',
    hotels: ['PARK HOTEL MEUBLE\' - LAKE COMO', 'PLINIO AU LAC - LAKE COMO', 'PLINIUS - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 38',
    hotels: ['POSTA DESIGN HOTEL - LAKE COMO', 'QUALITY HOTEL SAN MARTINO - LECCO', 'RED\'S RADAELLI - LECCO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 39',
    hotels: ['REGINA OLGA - LAKE COMO', 'REGOLO HOUSE - LAKE COMO', 'RISTORANTE HOTEL FALCHETTO - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 40',
    hotels: ['ROYAL VICTORIA - LAKE COMO', 'SHERATON LAKE COMO - LAKE COMO', 'SONENGA - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 41',
    hotels: ['TERMINUS - LAKE COMO', 'TRE RE - LAKE COMO', 'VILLA ALBONICO - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 42',
    hotels: ['VILLA BELVEDERE COMO LAKE RELAIS - LAKE COMO', 'VILLA D\'ESTE - LAKE COMO', 'VILLA FLORI - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 43',
    hotels: ['VILLA HADEEL - LAKE COMO', 'VILLA MARIA LAKE COMO - COMO', 'VILLA REGINA TEODOLINDA - LAKE COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Como / Lecco — batch 44',
    hotels: ['VISTA  PALAZZO, LAGO DI COMO - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Cantu / Montano Lucino',
    hotels: ['ALBERGO LA SCALETTA - CANTU - COMO', 'HOTEL CANTURIO - CANTU - COMO', 'HOTEL CRUISE - MONTANO LUCINO - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 1',
    hotels: ['ABACUS - LAKE GARDA', 'ACQUAVIVA DEL GARDA - LAKE GARDA', 'ADMIRAL HOTEL VILLA ERME - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 2',
    hotels: ['AHG DONNA SILVIA HOTEL WELLNESS & SPA - LAKE GARDA', 'AL FIORE - LAKE GARDA', 'ALBERGO AL CACCIATORE - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 3',
    hotels: ['ALBERGO GIARDINO - LAKE GARDA', 'ALBERGO MOLINO - APPARTAMENTI - LAKE GARDA', 'ALBERGO RISTORANTE OLIOSO - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 4',
    hotels: ['ALEVIC HOTEL SIRMIONE - LAKE GARDA', 'ALFIERI - LAKE GARDA', 'ALSAZIA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 5',
    hotels: ['ARENA - LAKE GARDA', 'ASTORIA LIDO - LAKE GARDA', 'ASTRA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 6',
    hotels: ['AURORA - LAKE GARDA', 'AZZURRA - LAKE GARDA', 'BELL\'ARRIVO - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 7',
    hotels: ['BELLA PESCHIERA - LAKE GARDA', 'BELVEDERE - LAKE GARDA', 'BENACO - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 8',
    hotels: ['BOLERO - LAKE GARDA', 'BONOTTO - LAKE GARDA', 'BORGO DEI POETI WELLNESS RESORT & SPA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 9',
    hotels: ['BROGLIA - LAKE GARDA', 'BUTTERFLY CAMPING VILLAGE - LAKE GARDA', 'CAESIUS THERMAE & SPA RESORT - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 10',
    hotels: ['CAMPING BELLA ITALIA - LAKE GARDA', 'CAMPING BUNGALOW WIEN - LAKE GARDA', 'CAMPING CISANO SAN VITO - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 11',
    hotels: ['CAMPING LIDO - LAKE GARDA', 'CAMPING SAN BENEDETTO - LAKE GARDA', 'CHIARA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 12',
    hotels: ['CITY - LAKE GARDA', 'CLARIN 14 BY DORI - LAKE GARDA', 'CLODIA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 13',
    hotels: ['CORTE REGINA - LAKE GARDA', 'CRISTAL - LAKE GARDA', 'C√Ä SERENA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 14',
    hotels: ['DEGLI OLEANDRI - LAKE GARDA', 'DERBY - LAKE GARDA', 'DESENZANO - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 15',
    hotels: ['DOGANA - LAKE GARDA', 'DOLCI COLLI - LAKE GARDA', 'DU LAC - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 16',
    hotels: ['DU PARC - LAKE GARDA', 'EDEN - LAKE GARDA', 'ENJOY GARDA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 17',
    hotels: ['ENRICHETTA - LAKE GARDA', 'EST√âE - LAKE GARDA', 'EUROPA HOTEL SIRMIONE - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 18',
    hotels: ['FIORELLA - LAKE GARDA', 'FLAMINIA - LAKE GARDA', 'FONTE BOIOLA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 19',
    hotels: ['GARDEN - LAKE GARDA', 'GARDENIA - LAKE GARDA', 'GARTEN LIDO - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 20',
    hotels: ['GIARDINETTO - LAKE GARDA', 'GRAND HOTEL TERME - LAKE GARDA', 'GREEN PARK - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 21',
    hotels: ['HAPPY CAMP IN CAMPING CISANO SAN VITO - LAKE GARDA', 'HOTEL BEL SITO BARDOLINO - LAKE GARDA', 'HOTEL BENACO - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 22',
    hotels: ['HOTEL CONTINENTAL WELLNESS & SPA - LAKE GARDA', 'HOTEL D√âSIR√âE - LAKE GARDA', 'HOTEL EUROPA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 23',
    hotels: ['HOTEL MARASCHINA - LAKE GARDA', 'HOTEL MIRAMAR - LAKE GARDA', 'HOTEL PALAZZO DEL GARDA & SPA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 24',
    hotels: ['HOTEL RIVUS - LAKE GARDA', 'HOTEL SIRMIONE E PROMESSI SPOSI - LAKE GARDA', 'HOTEL VILLA MARIA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 25',
    hotels: ['IDEAL - LAKE GARDA', 'IL MELOGRANO - LAKE GARDA', 'INTERNATIONAL HOTEL SIRMIONE - SIRMIONE - BRESCIA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 26',
    hotels: ['LA PASSEGGIATA - LAKE GARDA', 'LA QUIETE PARK - LAKE GARDA', 'LIDO INTERNATIONAL - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 27',
    hotels: ['LUGANA PARCO AL LAGO - LAKE GARDA', 'MARCONI - LAKE GARDA', 'MAROLDA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 28',
    hotels: ['MAURO - LAKE GARDA', 'MAVINO - LAKE GARDA', 'MERIDIANA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 29',
    hotels: ['MIRALAGO - LAKE GARDA', 'MIRAMAR - LAKE GARDA', 'MON REPOS - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 30',
    hotels: ['NAZIONALE - LAKE GARDA', 'NUOVA BARCACCIA - LAKE GARDA', 'OLIVETO - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 31',
    hotels: ['OLIVI THERMAE & NATURAL SPA - LAKE GARDA', 'PACE - LAKE GARDA', 'PALACE - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 32',
    hotels: ['PALACE HOTEL VILLA CORTINE - LAKE GARDA', 'PALAZZO AI CAPITANI - LAKE GARDA', 'PARC HOTEL - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 33',
    hotels: ['PARK HOTEL - LAKE GARDA', 'PICCOLA VELA - LAKE GARDA', 'PIROSCAFO - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 34',
    hotels: ['PLAZA - LAKE GARDA', 'PORTO AZZURRO - LAKE GARDA', 'PUCCINI - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 35',
    hotels: ['RELAIS CORTE CAVALLI - LAKE GARDA', 'RELAIS DU LAC - LAKE GARDA', 'RESIDENCE ONDA BLU - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 36',
    hotels: ['RIEL - LAKE GARDA', 'RIVIERA - LAKE GARDA', 'SAN MARCO - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 37',
    hotels: ['SAN VITO - LAKE GARDA', 'SAVIOLA - LAKE GARDA', 'SERENELLA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 38',
    hotels: ['SMERALDO - LAKE GARDA', 'SPERANZA - LAKE GARDA', 'SPLENDID SOLE - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 39',
    hotels: ['SUISSE - LAKE GARDA', 'THE GARDA VILLAGE - LAKE GARDA', 'TRIPOLI - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 40',
    hotels: ['VICTORIA MOBILEHOME BELLA ITALIA - LAKE GARDA', 'VILLA LILLA - LAKE GARDA', 'VILLA MARIA - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 41',
    hotels: ['VILLA ROSA - LAKE GARDA', 'VILLAGGIO DESENZANO GLAM - LAKE GARDA', 'VILLAGGIO HELIOPOLIS - LAKE GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda SW shore — batch 42',
    hotels: ['VITTORIO - LAKE GARDA', 'YACHTING HOTEL MISTRAL - LAKE GARDA', 'ZIBA HOTEL AND SPA - LAKE GARDA'],
  },

  // ── TOSCANA ──────────────────────────────────────────────────────────────────
  // 692 total Toscana hotels
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 1',
    hotels: ['1865 RESIDENZA D\'EPOCA - FLORENCE', '25HOURS HOTEL FLORENCE PIAZZA SAN PAOLINO - FLORENCE', '3110 ARTHOTEL - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 2',
    hotels: ['4F BOUTIQUE HOTEL FLORENCE - FLORENCE', 'AC FIRENZE - FLORENCE', 'ADASTRA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 3',
    hotels: ['ADLER CAVALIERI - FLORENCE', 'AFFITTACAMERE IMPERIALE - FLORENCE', 'AFFITTACAMERE NEL CUORE DI FIRENZE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 4',
    hotels: ['AIRONE - FLORENCE', 'AIRPORT - FLORENCE', 'ALBA PALACE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 5',
    hotels: ['ALBANI FIRENZE - FLORENCE', 'ALBERGO FIRENZE - FLORENCE', 'ALEX - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 6',
    hotels: ['ALFIERI9 - FLORENCE', 'ALINARI - FLORENCE', 'ALL SUITES PALAZZO MAGNANI FERONI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 7',
    hotels: ['ANDREA - FLORENCE', 'ANGLO AMERICAN HOTEL FLORENCE, CURIO COLLECTION BY HILTON - FLORENCE', 'ANNABELLA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 8',
    hotels: ['ANNALENA - FLORENCE', 'ANTICA TORRE DI VIA TORNABUONI - FLORENCE', 'APARTMENTS LA BORSA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 9',
    hotels: ['APPARTAMENTO PUCCINI (ADULTS ONLY) - FLORENCE', 'ARCADIA - FLORENCE', 'ARGENTINA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 10',
    hotels: ['ARIELE - FLORENCE', 'ARIZONA - FLORENCE', 'ART ATELIER - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 11',
    hotels: ['ARTE\' BOUTIQUE HOTEL - FLORENCE', 'ARTI & HOTEL - FLORENCE', 'ART√® BOUTIQUE HOTEL - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 12',
    hotels: ['ASCOT - FLORENCE', 'ASTOR - FLORENCE', 'ASTRID - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 13',
    hotels: ['ATHENAEUM PERSONAL HOTEL - FLORENCE', 'ATLANTIC PALACE - FLORENCE', 'AURORA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 14',
    hotels: ['AURUM FIRENZE - FLORENCE', 'AURUM UFFIZI - FLORENCE', 'AUTO PARK - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 15',
    hotels: ['AXIAL - FLORENCE', 'AZZI - FLORENCE', 'B&B DOLCE LUNA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 16',
    hotels: ['B&B HOTEL FIRENZE CITY CENTER - FLORENCE', 'B&B HOTEL FIRENZE LAURUS AL DUOMO - FLORENCE', 'B&B HOTEL FIRENZE NOVOLI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 17',
    hotels: ['B&B HOTEL FIRENZE NUOVO PALAZZO DI GIUSTIZIA - FLORENCE', 'B&B HOTEL FIRENZE PITTI PALACE AL PONTE VECCHIO - FLORENCE', 'B&B IL POGGIOLO DELLE ROSE - IMPRUNETA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 18',
    hotels: ['B&B RELAIS DANTE E BEATRICE - FLORENCE', 'B&B RESIDENZA LA MONGOLFIERA - FLORENCE', 'B&B ROVEZZANO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 19',
    hotels: ['B&B VILLA LE PIAZZOLE - FLORENCE', 'BALESTRI - FLORENCE', 'BASILEA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 20',
    hotels: ['BE ONE ART AND LUXURY HOME - FLORENCE', 'BEATRICE - FLORENCE', 'BELLA FIRENZE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 21',
    hotels: ['BELMOND VILLA SAN MICHELE - FIESOLE - FLORENCE', 'BENIVIENI - FLORENCE', 'BERCHIELLI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 22',
    hotels: ['BERNINI PALACE - FLORENCE', 'BEST WESTERN PLUS CHC FLORENCE - FLORENCE', 'BIGALLO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 23',
    hotels: ['BLACK 5 RESIDENZA D\'EPOCA - FLORENCE', 'BOCCACCIO - FLORENCE', 'BONCIANI PALAZZO PITTI BROCCARDI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 24',
    hotels: ['BONIFACIO - FLORENCE', 'BORGHESE PALACE ART HOTEL - FLORENCE', 'BORGO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 25',
    hotels: ['BORGO DI VILLA CASTELLETTI - FLORENCE', 'BOSCOLO ASTORIA FIRENZE HOTEL - FLORENCE', 'BOSTON - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 26',
    hotels: ['BOTTICELLI - FLORENCE', 'BOUTIQUE HOTEL DEL CORSO - FLORENCE', 'BRUNELLESCHI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 27',
    hotels: ['BURCHIANTI - FLORENCE', 'C-HOTELS AMBASCIATORI - FLORENCE', 'C-HOTELS CLUB - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 28',
    hotels: ['C-HOTELS DE ROSE PALACE - FLORENCE', 'C-HOTELS DIPLOMAT - FLORENCE', 'C-HOTELS JOY FIRENZE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 29',
    hotels: ['C-HOTELS THE STYLE FLORENCE - FLORENCE', 'CALIFORNIA - FLORENCE', 'CAMPING VILLAGE INTERNAZIONALE FIRENZE - IMPRUNETA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 30',
    hotels: ['CAMPING VILLAGE NORCENNI GIRASOLE CLUB - FLORENCE', 'CAMPING VILLAGE PANORAMICO FIESOLE - FIESOLE - FLORENCE', 'CARAVAGGIO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 31',
    hotels: ['CARDINAL - FLORENCE', 'CASUAL RINASCIMENTO FIRENZE - FLORENCE', 'CAVALIERE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 32',
    hotels: ['CELLAI BOUTIQUE HOTEL - FLORENCE', 'CERRETANI 4 DUOMO GUESTHOUSE - MY EXTRA HOME - FLORENCE', 'CERRETANI FIRENZE - MGALLERY BY SOFITEL - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 33',
    hotels: ['CHEZ MOI - FLORENCE', 'CIMABUE - FLORENCE', 'CITY - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 34',
    hotels: ['CLARIDGE - FLORENCE', 'CLASSIC HOTEL - FIRENZE - FLORENCE', 'COLOMBA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 35',
    hotels: ['COLUMBUS - FLORENCE', 'COMO CASTELLO DEL NERO - FLORENCE', 'CONCORDE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 36',
    hotels: ['CONFERENCE FLORENTIA - FLORENCE', 'CONFERENCE FLORENTIA HOTEL - FLORENCE', 'CONTINENTALE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 37',
    hotels: ['COROLLE - FLORENCE', 'CORONA D\'ITALIA - FLORENCE', 'CORSO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 38',
    hotels: ['CORTE DEI MEDICI - FLORENCE', 'COSMOPOLITAN - FLORENCE', 'CROCE DI MALTA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 39',
    hotels: ['CURTATONE - FLORENCE', 'DA VERRAZZANO - FLORENCE', 'DANTE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 40',
    hotels: ['DAVANZATI - FLORENCE', 'DAVID - FLORENCE', 'DE LA PACE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 41',
    hotels: ['DE LA VILLE - FLORENCE', 'DE LANZI - FLORENCE', 'DEDO BOUTIQUE HOTEL - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 42',
    hotels: ['DEGLI ORAFI - FLORENCE', 'DEI MACCHIAIOLI - FLORENCE', 'DEI MORI FIRENZE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 43',
    hotels: ['DELFINA - FLORENCE', 'DELLA ROBBIA - FLORENCE', 'DELLA SIGNORIA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 44',
    hotels: ['DELLE NAZIONI - FLORENCE', 'DELLE TELE - FLORENCE', 'DEMIDOFF COUNTRY RESORT - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 45',
    hotels: ['DESIREE - FLORENCE', 'DIANA PARK - FLORENCE', 'DIMORA PALANCA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 46',
    hotels: ['DIVA - FLORENCE', 'DOMUS FLORENTIAE - FLORENCE', 'DONATELLO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 47',
    hotels: ['DONATI LUXURY TOWER - FLORENCE', 'DUOMO - FLORENCE', 'DUOMO STUDIO & DANTE APARTMENT - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 48',
    hotels: ['EDEN - FLORENCE', 'EMBASSY - FLORENCE', 'ESTER - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 49',
    hotels: ['EURHOTEL - FLORENCE', 'EUROPA SIGNA - FLORENCE', 'EXECUTIVE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 50',
    hotels: ['FERRUCCI FIRENZE - FLORENCE', 'FH55 GRAND HOTEL MEDITERRANEO - FLORENCE', 'FH55 HOTEL CALZAIUOLI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 51',
    hotels: ['FH55 HOTEL VILLA FIESOLE - FIESOLE - FLORENCE', 'FIRENZE NOVA - FLORENCE', 'FIRENZE NUMBER NINE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 52',
    hotels: ['FLOM BOUTIQUE HOTEL - FLORENCE', 'FLORENCE APARTMENTS DANTE & BEATRICE - FLORENCE', 'FLORENCE DECAMERONE B&B - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 53',
    hotels: ['FLORENCE DOMEHOTEL - FLORENCE', 'FORTE16 APARTMENTS - VIEW & SPA - FLORENCE', 'FOUR SEASONS HOTEL FIRENZE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 54',
    hotels: ['FRANCHI - FLORENCE', 'GALILEO - FLORENCE', 'GALLERY HOTEL ART - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 55',
    hotels: ['GARIBALDI BLU - FLORENCE', 'GARIBALDI RELAIS ET IMMOS - FLORENCE', 'GEMINI ALL SUITES - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 56',
    hotels: ['GIALLO E ROSSO APARTMENTS - FLORENCE', 'GIGLIO - FLORENCE', 'GINORI AL DUOMO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 57',
    hotels: ['GIOIA - FLORENCE', 'GLANCE HOTEL IN FLORENCE - FLORENCE', 'GLOBUS - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 58',
    hotels: ['GOLDEN TOWER HOTEL & SPA - FLORENCE', 'GOLDONI - FLORENCE', 'GOLF - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 59',
    hotels: ['GRAND AMORE HOTEL AND SPA - FLORENCE', 'GRAND HOTEL ADRIATICO - FLORENCE', 'GRAND HOTEL BAGLIONI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 60',
    hotels: ['GRAND HOTEL CAVOUR - FLORENCE', 'GRAND HOTEL MINERVA - FLORENCE', 'GRANDUOMO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 61',
    hotels: ['GRIFONE - FLORENCE', 'HELVETIA&BRISTOL FIRENZE - STARHOTELS COLLEZIONE - FLORENCE', 'HERMITAGE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 62',
    hotels: ['HILTON FLORENCE METROPOLE - FLORENCE', 'HILTON GARDEN INN FLORENCE NOVOLI - FLORENCE', 'HOME FLORENCE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 63',
    hotels: ['HOTEL ALBION - FLORENCE', 'HOTEL AMBASCIATORI - FLORENCE', 'HOTEL ARGENTINA CURTATONE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 64',
    hotels: ['HOTEL BELLAVISTA IMPRUNETA - IMPRUNETA - FLORENCE', 'HOTEL BEST WESTERN DE LA PACE - FLORENCE', 'HOTEL BRETAGNA HERITAGE - ALFIERI COLLEZIONE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 65',
    hotels: ['HOTEL CALIMALA - FLORENCE', 'HOTEL CAMILLA FIRENZE - FLORENCE', 'HOTEL CANTORIA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 66',
    hotels: ['HOTEL DIPLOMAT - FLORENCE', 'HOTEL FIRENZE CAPITALE - FLORENCE', 'HOTEL I CEDRI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 67',
    hotels: ['HOTEL I FIORINO - FLORENCE', 'HOTEL INDIGO FLORENCE, AN IHG HOTEL - FLORENCE', 'HOTEL LA CASA DI MORFEO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 68',
    hotels: ['HOTEL LA GEMMA - FLORENCE', 'HOTEL LA SCALA - FLORENCE', 'HOTEL LAURUS AL DUOMO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 69',
    hotels: ['HOTEL MIRAGE FLORENCE - FLORENCE', 'HOTEL PAGANINI - FLORENCE', 'HOTEL PALAZZO RICASOLI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 70',
    hotels: ['HOTEL PANORAMA - FLORENCE', 'HOTEL PERLAGE FLORENCE - FLORENCE', 'HOTEL REAL - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 71',
    hotels: ['HOTEL REGENCY - FLORENCE', 'HOTEL TORRE GUELFA - FLORENCE', 'HOTEL VILLA CESI - IMPRUNETA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 72',
    hotels: ['HOTEL VILLA FIESOLE - FIESOLE - FLORENCE', 'IH HOTELS FIRENZE BUSINESS - FLORENCE', 'IH HOTELS FIRENZE SELECT - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 73',
    hotels: ['IH HOTELS FIRENZE SELECT EXECUTIVE - RESIDENCE - FLORENCE', 'IL DUCA - FLORENCE', 'IL GRANDUCA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 74',
    hotels: ['IL GUELFO BIANCO - FLORENCE', 'IL SALVIATINO - FLORENCE', 'IL TORNABUONI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 75',
    hotels: ['IQ HOTEL FIRENZE - FLORENCE', 'ITALIANA HOTELS FIRENZE - FLORENCE', 'J AND J HISTORIC HOUSE HOTEL - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 76',
    hotels: ['JANE - FLORENCE', 'KRAFT - FLORENCE', 'KURSAAL & AUSONIA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 77',
    hotels: ['KURSAAL AND AUSONIA HOTEL - FLORENCE', 'L\'OROLOGIO - FLORENCE', 'LA CROCE D\'ORO SANTA CROCE SUITE APARTMENTS - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 78',
    hotels: ['LA FORTEZZA - FLORENCE', 'LA PERGOLA - FLORENCE', 'LA RESIDENZA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 79',
    hotels: ['LA SCALETTA - FLORENCE', 'LA VENERE - FLORENCE', 'LE DUE FONTANE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 80',
    hotels: ['LE STANZE DI CARLA! BAGNO PRIVATO, CUCINA IN COMUN - FLORENCE', 'LEONARDO DA VINCI - FLORENCE', 'LEOPOLDA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 81',
    hotels: ['LHP HOTEL RIVER & SPA - FLORENCE', 'LIDO - FLORENCE', 'LOCANDE DEGLI ARTISTI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 82',
    hotels: ['LOGGIATO DEI SERVITI - FLORENCE', 'LOMBARDIA - FLORENCE', 'LUNGARNO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 83',
    hotels: ['LUNGARNO VESPUCCI 50 - FLORENCE', 'LUXOR FLORENCE - FLORENCE', 'MABELLE FIRENZE RESIDENZA SASSETTI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 84',
    hotels: ['MACHIAVELLI PALACE - FLORENCE', 'MAGENTA - FLORENCE', 'MALASPINA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 85',
    hotels: ['MARIGNOLLE RELAIS & CHARME - FLORENCE', 'MARINE - FLORENCE', 'MARIO\'S - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 86',
    hotels: ['MARTELLI - FLORENCE', 'MARZIA - FLORENCE', 'MAX APARTMENTS - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 87',
    hotels: ['MERCURE FIRENZE CENTRO - FLORENCE', 'MERIDIANA - FLORENCE', 'MERIDIANA COUNTRY - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 88',
    hotels: ['MH FLORENCE HOTEL & SPA - FLORENCE', 'MIA CARA - FLORENCE', 'MONNA CLARA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 89',
    hotels: ['MONNA LISA - FLORENCE', 'MORANDI ALLA CROCETTA - FLORENCE', 'MSNSUITES PALAZZO DEI CIOMPI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 90',
    hotels: ['MULINO DI FIRENZE - FLORENCE', 'NH COLLECTION FIRENZE PALAZZO GADDI - FLORENCE', 'NH COLLECTION FIRENZE PORTA ROSSA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 91',
    hotels: ['NH FIRENZE - FLORENCE', 'NILHOTEL - FLORENCE', 'NOVELLA E GIOTTO APARTMENTS - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 92',
    hotels: ['NOVOTEL FIRENZE NORD AEROPORTO - FLORENCE', 'OLIMPIA - FLORENCE', 'ORTO DE MEDICI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 93',
    hotels: ['PALAZZO BENCI - FLORENCE', 'PALAZZO CASTRI 1874 - FLORENCE', 'PALAZZO DAL BORGO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 94',
    hotels: ['PALAZZO DEI CIOMPI - FLORENCE', 'PALAZZO GAMBA - FLORENCE', 'PALAZZO GUADAGNI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 95',
    hotels: ['PALAZZO LORENZO HOTEL BOUTIQUE - FLORENCE', 'PALAZZO MANNAIONI SUITES - FLORENCE', 'PALAZZO MONTEBELLO FIRENZE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 96',
    hotels: ['PALAZZO NICCOLINI AL DUOMO - FLORENCE', 'PALAZZO OGNISSANTI - FLORENCE', 'PALAZZO RUSPOLI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 97',
    hotels: ['PALAZZO VECCHIETTI SUITES AND STUDIOS - FLORENCE', 'PALAZZO VECCHIO - FLORENCE', 'PANAMA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 98',
    hotels: ['PANORAMA - FLORENCE', 'PARIS - FLORENCE', 'PARK PALACE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 99',
    hotels: ['PENDINI - FLORENCE', 'PENSIONE BENCIST√Ä - FIESOLE - FLORENCE', 'PERSEO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 100',
    hotels: ['PICTURESQUE APARTMENT IN FLORENCE TOWN CENTRE - FLORENCE', 'PIERRE - FLORENCE', 'PITTI PALACE AL PONTE VECCHIO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 101',
    hotels: ['PLAZA HOTEL LUCCHESI - FLORENCE', 'POGGIO DEL GOLF - IMPRUNETA - FLORENCE', 'PORTA FAENZA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 102',
    hotels: ['PORTRAIT FIRENZE - FLORENCE', 'PRESIDENT - FLORENCE', 'PRIME HOTEL MAJESTIC - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 103',
    hotels: ['PRINCIPE - FLORENCE', 'PRIVILEGE - FLORENCE', 'QUADRA KEY RESIDENCE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 104',
    hotels: ['RADISSON BLU HOTEL, FLORENCE - FLORENCE', 'RAFFAELLO - FLORENCE', 'RAPALLO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 105',
    hotels: ['RELAIS CERTOSA - FLORENCE', 'RELAIS HOTEL CENTRALE FIRENZE - FLORENCE', 'RELAIS IL CESTELLO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 106',
    hotels: ['RELAIS SANTA CROCE - FLORENCE', 'RELAIS UFFIZI - FLORENCE', 'RELAIS UGOLINI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 107',
    hotels: ['RELAIS VILLA ANTEA - FLORENCE', 'RELAIS VILLA DELL OLMO - FLORENCE', 'RELAIS VILLA IL SASSO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 108',
    hotels: ['RENAISSANCE - FLORENCE', 'RESIDENCE DAL BORGO - FLORENCE', 'RESIDENCE I COLLI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 109',
    hotels: ['RESIDENCE LA CONTESSINA - FLORENCE', 'RESIDENCE LA MEDICEA - FLORENCE', 'RESIDENCE PALAZZO BELFIORE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 110',
    hotels: ['RESIDENCE PORTA AL PRATO - FLORENCE', 'RESIDENCE SAN NICCOLO - FLORENCE', 'RESIDENCE SAN NICCOL√í - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 111',
    hotels: ['RESIDENCE SAN NICCOL√≤ - FLORENCE', 'RESIDENZA D\'EPOCA PALAZZO GALLETTI - FLORENCE', 'RESIDENZA DEI PUCCI - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 112',
    hotels: ['RESIDENZA FIORENTINA - FLORENCE', 'RESIDENZA GIULIA - FLORENCE', 'REX - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 113',
    hotels: ['RITZ - FLORENCE', 'RIVA LOFTS FLORENCE - FLORENCE', 'RIVOLI BOUTIQUE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 114',
    hotels: ['ROCCA PALAZZACCIO - IMPRUNETA - FLORENCE', 'ROMA - FLORENCE', 'ROOM MATE ISABELLA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 115',
    hotels: ['ROOM MATE LUCA - FLORENCE', 'ROSARY GARDEN - FLORENCE', 'ROSSO 23 - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 116',
    hotels: ['RUBY BEA HOTEL FLORENCE - FLORENCE', 'SAN FREDIANO - FLORENCE APPARTMENTS - FLORENCE', 'SAN GALLO PALACE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 117',
    hotels: ['SAN GIORGIO & OLIMPIC - FLORENCE', 'SAN LORENZO APARTMENT - FLORENCE', 'SANTA MARIA NOVELLA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 118',
    hotels: ['SAVONAROLA - FLORENCE', 'SAVOY - FLORENCE', 'SEMPIONE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 119',
    hotels: ['SILLA - FLORENCE', 'SINA VILLA MEDICI, AUTOGRAPH COLLECTION - FLORENCE', 'SOLO EXPERIENCE HOTEL - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 120',
    hotels: ['SPADAI - FLORENCE', 'STARHOTEL TUSCANY - FLORENCE', 'STARHOTELS MICHELANGELO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 121',
    hotels: ['STILHOTEL - FLORENCE', 'STROZZI PALACE - FLORENCE', 'SURPRISE HOTELS IN HISTORICAL CENTRE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 122',
    hotels: ['SURPRISE HOTELS WELL CONNECTED - FLORENCE', 'THE FRAME - FLORENCE', 'THE J & J HISTORIC HOUSE HOTEL - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 123',
    hotels: ['THE MOON BOUTIQUE - FLORENCE', 'THE PLACE FIRENZE - FLORENCE', 'THE SOCIAL HUB FLORENCE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 124',
    hotels: ['THE ST. REGIS FIRENZE - FLORENCE', 'THE STUDENT HOTEL FLORENCE - FLORENCE', 'THE WESTIN EXCELSIOR, FLORENCE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 125',
    hotels: ['TOGETHER FLORENCE INN - FLORENCE', 'TORNABUONI BEACCI - FLORENCE', 'TORRE A CONA WINE ESTATE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 126',
    hotels: ['TORRE DI BELLOSGUARDO - FLORENCE', 'TORRE GUELFA PALAZZO ACCIAIUOLI - FLORENCE', 'TRINITY APARTMENTS - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 127',
    hotels: ['TSH FLORENCE LAVAGNINI - FLORENCE', 'UNA VITTORIA - FLORENCE', 'UNAHOTELS VITTORIA FIRENZE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 128',
    hotels: ['UNICORNO - FLORENCE', 'UNIVERSO - FLORENCE', 'VASARI PALACE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 129',
    hotels: ['VEDUTE GREEN RESORT - FLORENCE', 'VICTORIA - FLORENCE', 'VILLA AURORA - FIESOLE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 130',
    hotels: ['VILLA BELVEDERE - FLORENCE', 'VILLA BETANIA - FLORENCE', 'VILLA BONELLI - FIESOLE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 131',
    hotels: ['VILLA CARLOTTA - FLORENCE', 'VILLA CASTIGLIONE - IMPRUNETA - FLORENCE', 'VILLA CORA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 132',
    hotels: ['VILLA DEI BOSCONI - FIESOLE - FLORENCE', 'VILLA DI CAMPOLUNGO AGRITURISMO - FIESOLE - FLORENCE', 'VILLA IL MOSAICO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 133',
    hotels: ['VILLA LA MASSA - FLORENCE', 'VILLA LE RONDINI - FLORENCE', 'VILLA LIANA - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 134',
    hotels: ['VILLA LIBERTY - FLORENCE', 'VILLA NEROLI - FLORENCE', 'VILLA OLMI FIRENZE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 135',
    hotels: ['VILLA ROYAL - FLORENCE', 'VILLA STANLEY - FLORENCE', 'VILLA TOLOMEI HOTEL AND RESORT - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Florence / Fiesole / Impruneta — batch 136',
    hotels: ['VILLE SULL\'ARNO - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Reggello / Rignano / Fiesole — batch 1',
    hotels: ['BELMOND VILLA SAN MICHELE - FIESOLE - FLORENCE', 'CAMPING VILLAGE IL POGGETTO - RIGNANO SULL\'ARNO - FIRENZE', 'CAMPING VILLAGE PANORAMICO FIESOLE - FIESOLE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Reggello / Rignano / Fiesole — batch 2',
    hotels: ['FH55 HOTEL VILLA FIESOLE - FIESOLE - FLORENCE', 'HOTEL VILLA FIESOLE - FIESOLE - FLORENCE', 'PENSIONE BENCIST√Ä - FIESOLE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Reggello / Rignano / Fiesole — batch 3',
    hotels: ['RESIDENCE VILLA PITIANA - DONNINI-REGGELLO - FIRENZE', 'RESORT 37 - RIGNANO SULL\'ARNO - FIRENZE', 'VILLA AURORA - FIESOLE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Reggello / Rignano / Fiesole — batch 4',
    hotels: ['VILLA BONELLI - FIESOLE - FLORENCE', 'VILLA DEI BOSCONI - FIESOLE - FLORENCE', 'VILLA DI CAMPOLUNGO AGRITURISMO - FIESOLE - FLORENCE'],
  },
  {
    destination: 'toscana',
    label: 'Reggello / Rignano / Fiesole — batch 5',
    hotels: ['VILLA PITIANA - DONNINI-REGGELLO - FIRENZE'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 1',
    hotels: ['A POINT AREZZO PARK - AREZZO', 'AFFITTACAMERE LUCE - LUCCA', 'AGGRAVI HOTEL - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 2',
    hotels: ['AGRITURISMO IL CASALE - AREZZO', 'AGRITURISMO IL CASTELLUCCIO - AREZZO', 'AGRITURISMO LE VALLILUNGHE - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 3',
    hotels: ['AL PODERE DI ROSA - LUCCA', 'ALBA - CHIANCIANO TERME - SIENA', 'ALBERGO ANGIOLINO - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 4',
    hotels: ['ALBERGO ASTORIA - CHIANCIANO TERME - SIENA', 'ALBERGO CELIDE - LUCCA', 'ALBERGO ELENA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 5',
    hotels: ['ALBERGO GIGLIO - CHIANCIANO TERME - SIENA', 'ALBERGO HOTEL MONICA - CHIANCIANO TERME - SIENA', 'ALBERGO LA PRIMULA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 6',
    hotels: ['ALBERGO LE SORGENTI - CHIANCIANO TERME - SIENA', 'ALBERGO ROSSANA - CHIANCIANO TERME - SIENA', 'ALBERGO SAN MARTINO - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 7',
    hotels: ['ALBERGO SAVOIA PALACE - CHIANCIANO TERME - SIENA', 'ALBERGO VILLA GAIA - CHIANCIANO TERME - SIENA', 'ALBERGO VILLA MARINA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 8',
    hotels: ['ALBERGO VILLA MARTA - LUCCA', 'ALEXANDER PALME - CHIANCIANO TERME - SIENA', 'ALLA CORTE DEGLI ANGELI - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 9',
    hotels: ['AMBASCIATORI - CHIANCIANO TERME - SIENA', 'ANTICA RESIDENZA DEL GALLO - LUCCA', 'ARTS CLUB BOUTIQUE HOTEL & SPA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 10',
    hotels: ['ATLANTICO PALACE HOTEL - CHIANCIANO TERME - SIENA', 'ATTICO - CHIANCIANO TERME - SIENA', 'AVE - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 11',
    hotels: ['B B ARENA DI LUCCA - LUCCA', 'B&B CASA SAN JACOPO AL GIARDINO - LUCCA', 'B&B CENTO PASSI DALLE MURA - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 12',
    hotels: ['B&B CORTE TORO - LUCCA', 'B&B HOTEL AREZZO - AREZZO', 'B&B LA CHIUSA DELLE MONACHE - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 13',
    hotels: ['B&B LA MUSA - AREZZO', 'BADIA DI POMAIO - AREZZO', 'BED & BREAKFAST AI CIPRESSI - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 14',
    hotels: ['BED & BREAKFAST CORTE DEI FOLLETTI - LUCCA', 'BED & BREAKFAST LEONE DI SANT\'ANNA - LUCCA', 'BELLARIA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 15',
    hotels: ['BERNARDINO - LUCCA', 'BEST WESTERN GRAND HOTEL GUINIGI - LUCCA', 'BORGO D\'USCIANO - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 16',
    hotels: ['CASA BELLAVISTA BED AND BREAKFAST - AREZZO', 'CASA DIOCESANA DI LUCCA - LUCCA', 'CASA VOLPI - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 17',
    hotels: ['CAVALIERI DEL MARE - LUCCA', 'CAVALIERI PARK HOTEL - LUCCA', 'CHIANCIANO ALBERGO TRIESTE - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 18',
    hotels: ['COLUMBIA - CHIANCIANO TERME - SIENA', 'CRISTALLO - CHIANCIANO TERME - SIENA', 'DA CARLOS - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 19',
    hotels: ['DIMORA DEI GUELFI - LUCCA', 'ECO HOTEL EDY - CHIANCIANO TERME - SIENA', 'ESPERIA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 20',
    hotels: ['ETRUSCO AREZZO HOTEL - AREZZO', 'EUROSTARS TOSCANA - LUCCA', 'FALTERONA - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 21',
    hotels: ['FATTORIA DI GRAGNONE - AREZZO', 'FATTORIA MONTELUCCI - AREZZO', 'FOX\'S INN DI CAPPELLETTI ROBERTO - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 22',
    hotels: ['GABRINI - LUCCA', 'GALILEO PALACE - AREZZO', 'GARDEN HOTEL - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 23',
    hotels: ['GESSY\'S - LUCCA', 'GLORIA - CHIANCIANO TERME - SIENA', 'GOLF - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 24',
    hotels: ['GRAND HOTEL ADMIRAL PALACE - CHIANCIANO TERME - SIENA', 'GRAND HOTEL BOSTON - CHIANCIANO TERME - SIENA', 'GRAND HOTEL CAPITOL - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 25',
    hotels: ['GRAND HOTEL EXCELSIOR - CHIANCIANO TERME - SIENA', 'GRAND HOTEL LE FONTI - CHIANCIANO TERME - SIENA', 'GRAND HOTEL MILANO - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 26',
    hotels: ['GRAND HOTEL PLAZA - CHIANCIANO TERME - SIENA', 'GRAND UNIVERSE LA RESIDENZA - LUCCA', 'GRAND UNIVERSE LUCCA, AUTOGRAPH COLLECTION - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 27',
    hotels: ['GRANDE ALBERGO FORTUNA - CHIANCIANO TERME - SIENA', 'GRAZIELLA PATIO HOTEL - AREZZO', 'HERMITAGE HOTEL - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 28',
    hotels: ['HOTEL ARNO - CHIANCIANO TERME - SIENA', 'HOTEL ASTRA - CHIANCIANO TERME - SIENA', 'HOTEL CARIGNANO - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 29',
    hotels: ['HOTEL CONTINENTALE - AREZZO', 'HOTEL CRISTINA - CHIANCIANO TERME - SIENA', 'HOTEL DEL BUONO CENTRO BENESSERE - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 30',
    hotels: ['HOTEL EDEN - CHIANCIANO TERME - SIENA', 'HOTEL GARDEN - CHIANCIANO TERME - SIENA', 'HOTEL LA LUCCIOLA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 31',
    hotels: ['HOTEL LORY - CHIANCIANO TERME - SIENA', 'HOTEL MARTINI - CHIANCIANO TERME - SIENA', 'HOTEL MARYSTELLA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 32',
    hotels: ['HOTEL MEDITERRANEO - CHIANCIANO TERME - SIENA', 'HOTEL MIZAR - CHIANCIANO TERME - SIENA', 'HOTEL NANDA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 33',
    hotels: ['HOTEL PATRIA - CHIANCIANO TERME - SIENA', 'HOTEL PERUGINA - CHIANCIANO TERME - SIENA', 'HOTEL PRESIDENT - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 34',
    hotels: ['HOTEL REALI - CHIANCIANO TERME - SIENA', 'HOTEL RINASCENTE - CHIANCIANO TERME - SIENA', 'HOTEL RISORGIMENTO - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 35',
    hotels: ['HOTEL ROSATI - CHIANCIANO TERME - SIENA', 'HOTEL SAN MARCO - LUCCA', 'HOTEL SESTRIERE - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 36',
    hotels: ['HOTEL SOLE & ESPERIA - CHIANCIANO TERME - SIENA', 'HOTEL TRIESTE - CHIANCIANO TERME - SIENA', 'HOTEL VILLA CASANOVA - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 37',
    hotels: ['HOTEL VILLA EDELWEISS - CHIANCIANO TERME - SIENA', 'HOTEL VILLA LUCA - CHIANCIANO TERME - SIENA', 'HOTEL VILLA RICCI - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 38',
    hotels: ['HOTEL VITTORIA - CHIANCIANO TERME - SIENA', 'I GRANDI DI TOSCANA - AREZZO', 'I PORTICI HOTEL - RESIDENZA D\'EPOCA - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 39',
    hotels: ['IL CORTILE DI ELISA - LUCCA', 'IL GENTILUOMO - AREZZO', 'IL NIDO DELLA RONDINE - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 40',
    hotels: ['IL PALAZZACCIO - AREZZO', 'ILARIA - LUCCA', 'IRIS - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 41',
    hotels: ['L\'ARETINO - AREZZO', 'LA LUNA - LUCCA', 'LE CAPANNE - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 42',
    hotels: ['LE VILLE - LUCCA', 'LOCANDA L\'ELISA - LUCCA', 'LUCCA IN AZZURRO - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 43',
    hotels: ['LUCCA IN CHIC - LUCCA', 'MAJESTIC - CHIANCIANO TERME - SIENA', 'MASSARELLI - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 44',
    hotels: ['MICHELANGELO - CHIANCIANO TERME - SIENA', 'MINERVA - AREZZO', 'MIRALAGHI - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 45',
    hotels: ['MONTECARLO - CHIANCIANO TERME - SIENA', 'N.15 SANTORI LUXURY HOME - LUCCA', 'NAPOLEON - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 46',
    hotels: ['NOBILE - CHIANCIANO TERME - SIENA', 'NUOVO HOTEL SESTRIERE - CHIANCIANO TERME - SIENA', 'PALAZZO ALEXANDER - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 47',
    hotels: ['PALAZZO BANDINO - CHIANCIANO TERME - SIENA', 'PALAZZO DIPINTO - LUCCA', 'PANORAMA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 48',
    hotels: ['PARK HOTEL - CHIANCIANO TERME - SIENA', 'PICCOLO HOTEL PUCCINI - LUCCA', 'PIERO DELLA FRANCESCA - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 49',
    hotels: ['PLANET - AREZZO', 'POSTA - CHIANCIANO TERME - SIENA', 'QUISISANA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 50',
    hotels: ['RAFFAELLO - CHIANCIANO TERME - SIENA', 'RELAIS BADIA DI CAMPOLEONE - AREZZO', 'RELAIS LA TORRE - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 51',
    hotels: ['RELAIS VILLA PETRISCHIO - AREZZO', 'RESIDENCE LE CORNIOLE - AREZZO', 'RESORT DEI LIMONI - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 52',
    hotels: ['REX - LUCCA', 'ROMA - CHIANCIANO TERME - SIENA', 'SAN LUCA PALACE - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 53',
    hotels: ['SAN PAOLO - CHIANCIANO TERME - SIENA', 'SANTA CATERINA - CHIANCIANO TERME - SIENA', 'SANTA CHIARA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 54',
    hotels: ['SANTA LUCIA - CHIANCIANO TERME - SIENA', 'SATURNO - CHIANCIANO TERME - SIENA', 'SOLE - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 55',
    hotels: ['SUISSE - CHIANCIANO TERME - SIENA', 'THE TUSCANIAN - LUCCA', 'TIRRENIA - CHIANCIANO TERME - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 56',
    hotels: ['VICOLO DEL GEPPONE - LUCCA', 'VICUS MAJOR - AREZZO', 'VILLA ALBERGOTTI - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 57',
    hotels: ['VILLA CASSIA DI BACCANO - AREZZO', 'VILLA CHELI - LUCCA', 'VILLA CORTE DEGLI DEI - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 58',
    hotels: ['VILLA GUINIGI - LUCCA', 'VILLA LA GROTTA - AREZZO', 'VILLA LA PRINCIPESSA - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 59',
    hotels: ['VILLA MARIA - CHIANCIANO TERME - SIENA', 'VILLA PARDI - LUCCA', 'VILLA VOLPI - LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano / Lucca — batch 60',
    hotels: ['VOGUE HOTEL AREZZO - AREZZO'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 1',
    hotels: ['1000 MIGLIA - SIENA', 'ADLER THERMAE SPA & RESORT TOSCANA - SIENA', 'AGRITURISMO LA SELVA - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 2',
    hotels: ['AI TUFI - SIENA', 'ALBERGO CHIUSARELLI - SIENA', 'ALEX - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 3',
    hotels: ['ANNA SIENA NORD - SIENA', 'ANTICA TORRE - SIENA', 'ARCOBALENO - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 4',
    hotels: ['ATHENA - SIENA', 'BEST WESTERN HOTEL SAN MARCO - SIENA', 'BORGO ANTICO - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 5',
    hotels: ['BORGO DI FILETTA - SIENA', 'BORGO GRONDAIE - SIENA', 'BORGO PRETALE - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 6',
    hotels: ['BORGO SCOPETO RELAIS - SIENA', 'CA\' BIANCA - SIENA', 'CAMPING SIENA COLLEVERDE - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 7',
    hotels: ['CASA CECCHI - SIENA', 'CASAFRASSI HOTEL AGRITURISMO - SIENA', 'CASALBERGO - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 8',
    hotels: ['CASTEL MONASTERO - SIENA', 'CASTELLARE DI TONDA RESORT & SPA - SIENA', 'CASTELLO DI LEONINA RELAIS - ASCIANO - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 9',
    hotels: ['CERTOSA DI MAGGIANO - SIENA', 'DUOMO - SIENA', 'FONTE DEI TUFI - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 10',
    hotels: ['FOUR POINTS BY SHERATON SIENA - SIENA', 'FULLINO NERO RTA - RESIDENZA TURISTICO ALBERGHIERA - SIENA', 'GARDEN - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 11',
    hotels: ['GRAND HOTEL CONTINENTAL SIENA - STARHOTELS COLLEZIONE - SIENA', 'GRAND HOTEL VILLA PATRIZIA - SIENA', 'HOTEL EXECUTIVE - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 12',
    hotels: ['HOTEL ITALIA - SIENA', 'HOTEL NH SIENA - SIENA', 'HOTEL PALAZZETTO ROSSO - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 13',
    hotels: ['HOTEL RISTORANTE PICCOLO CHIANTI - SIENA', 'IL CHIOSTRO DEL CARMINE - SIENA', 'IL MOLINELLO - ASCIANO - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 14',
    hotels: ['LA BAGNAIA GOLF & SPA RESORT SIENA CURIO A COLLECTION BY HILTON - SIENA', 'LA COLONNA - SIENA', 'LA PACE - ASCIANO - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 15',
    hotels: ['LA SUVERA (SCUDERIE) - SIENA', 'LA VILLA DI STR - SIENA', 'LE VALLINE COUNTRY RESORT - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 16',
    hotels: ['LOCANDA DI SAN MARTINO - SIENA', 'MINERVA - SIENA', 'MODERNO - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 17',
    hotels: ['PALACE DUE PONTI - SIENA', 'PALAZZO DEI PRIORI - SIENA', 'PALAZZO DI VALLI - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 18',
    hotels: ['PALAZZO FANI MIGNANELLI - SIENA', 'PALAZZO RAVIZZA - SIENA', 'PARK HOTEL - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 19',
    hotels: ['PENSIONE PALAZZO RAVIZZA - SIENA', 'PORTA ROMANA - SIENA', 'PRECISE HOUSE MONTAPERTI SIENA - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 20',
    hotels: ['RESIDENCE BORGO IL POGGIACCIO - SIENA', 'RESIDENZA D\'EPOCA IL CASATO - SIENA', 'RESIDENZA D\'EPOCA LE AQUILE - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 21',
    hotels: ['SANGALLO PARK HOTEL - SIENA', 'SANTA CATERINA - SIENA', 'VESTA - ASCIANO - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 22',
    hotels: ['VICO ALTO - SIENA', 'VILLA DIEVOLE - SIENA', 'VILLA ELDA - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 23',
    hotels: ['VILLA PICCOLA SIENA - SIENA', 'VILLA SANT ANDREA - SIENA', 'VILLA SCACCIAPENSIERI - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena — batch 24',
    hotels: ['VILLA TUSCANY SIENA - SIENA', 'VILLA VERONICA - SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Volterra — batch 1',
    hotels: ['AGRITURISMO PANIERACCI - VOLTERRA - PISA', 'AGRITURISMO PODERE CORTILLA - VOLTERRA - PISA', 'AGRITURISMO POMPILIA - VOLTERRA - PISA'],
  },
  {
    destination: 'toscana',
    label: 'Volterra — batch 2',
    hotels: ['ALBERGO AFRICA - VOLTERRA - PISA', 'ALBERGO ETRURIA - VOLTERRA - PISA', 'ALBERGO VILLA RIODDI - VOLTERRA - PISA'],
  },
  {
    destination: 'toscana',
    label: 'Volterra — batch 3',
    hotels: ['ALLEGROITALIA NAZIONALE VOLTERRA - VOLTERRA - PISA', 'ANTICA BADIA - VOLTERRA - PISA', 'CASALE GIULIA - VOLTERRA - PISA'],
  },
  {
    destination: 'toscana',
    label: 'Volterra — batch 4',
    hotels: ['CAVALLINO BLU - VOLTERRA - PISA', 'CHIOSTRO DELLE MONACHE - HOSTEL VOLTERRA - VOLTERRA - PISA', 'HOTEL FORESTERIA VOLTERRA - VOLTERRA - PISA'],
  },
  {
    destination: 'toscana',
    label: 'Volterra — batch 5',
    hotels: ['HOTEL RISTORANTE MOLINO D\'ERA - VOLTERRA - PISA', 'HOTEL SAN LINO - VOLTERRA - PISA', 'IL PALAGETTO - VOLTERRA - PISA'],
  },
  {
    destination: 'toscana',
    label: 'Volterra — batch 6',
    hotels: ['IL VECCHIO MULINO - VOLTERRA - PISA', 'LA LOCANDA - VOLTERRA - PISA', 'L‚ÄôAGRITURISMO FONTESETTIMENA - VOLTERRA - PISA'],
  },
  {
    destination: 'toscana',
    label: 'Volterra — batch 7',
    hotels: ['PARK HOTEL LE FONTI - VOLTERRA - PISA', 'PODERE ETRUSCO - VOLTERRA - PISA', 'VILLA NENCINI - VOLTERRA - PISA'],
  },
  {
    destination: 'toscana',
    label: 'Volterra — batch 8',
    hotels: ['VILLA PORTA ALL\'ARCO - VOLTERRA - PISA'],
  },
  {
    destination: 'toscana',
    label: 'Val di Cecina / Montecatini',
    hotels: ['HOTEL DEI CONTI - CASTELNUOVO DI VAL DI CECINA - PISA', 'RELAIS FATTORIA BELVEDERE - MONTECATINI VAL DI CECINA - PISA'],
  },

  // ── SARDEGNA ─────────────────────────────────────────────────────────────────
  // 231 total Sardegna hotels
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 1',
    hotels: ['4 MORI - CAGLIARI', 'AFFITTACAMERE MARISTELLA - CAGLIARI', 'BEST WESTERN HOTEL RESIDENCE ITALIA - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 2',
    hotels: ['CAESAR\'S - CAGLIARI', 'CALAMOSCA - CAGLIARI', 'CASA CLAT - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 3',
    hotels: ['CENTRUM ROOMS - CAGLIARI', 'DEDONI - CAGLIARI', 'DUE COLONNE - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 4',
    hotels: ['FLORA - CAGLIARI', 'HOLIDAY INN CAGLIARI - CAGLIARI', 'HOTEL BAYLLE - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 5',
    hotels: ['HOTEL CALIFFO - CAGLIARI', 'HOTEL REGINA MARGHERITA - CAGLIARI', 'HOTEL VILLA FANNY - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 6',
    hotels: ['ITALIA - CAGLIARI', 'IZZHOME BAYLLE - CAGLIARI', 'IZZHOME CITY CENTER COZY - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 7',
    hotels: ['IZZHOME DSIGN - CAGLIARI', 'IZZHOME FULL CENTER GRAND - CAGLIARI', 'IZZHOME LIGHT APARTMENT - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 8',
    hotels: ['IZZHOME LOFT 84 - CAGLIARI', 'IZZHOME MILLE GRAND - CAGLIARI', 'L\'AMBASCIATA HOTEL DE CHARME - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 9',
    hotels: ['LE SPIAGGE DI SAN PIETRO RESORT - CAGLIARI', 'MAISON MIRAMARE BOUTIQUE - CAGLIARI', 'MEDITERRANEO - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 10',
    hotels: ['MEDITUR HOTEL CAGLIARI SANTA MARIA - CAGLIARI', 'NAUTILUS - CAGLIARI', 'NUE ROOMS - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 11',
    hotels: ['PALAZZO TIRSO CAGLIARI MGALLERY - CAGLIARI', 'PANORAMA - CAGLIARI', 'PLEY II CAGLIARI BOUTIQUE SUITES II - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 12',
    hotels: ['QT HOTEL - CAGLIARI', 'QUADRIFOGLIO - CAGLIARI', 'SARDEGNA - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 13',
    hotels: ['SARDINIA DOMUS CAGLIARI NOVECENTO HOTEL - CAGLIARI', 'SETAR - CAGLIARI', 'SU MERIAGU - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari — batch 14',
    hotels: ['T HOTEL - CAGLIARI', 'ULIVI E PALME - CAGLIARI'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 1',
    hotels: ['ABI D\'ORU - PORTO ROTONDO - OLBIA-TEMPIO', 'AETHOS SARDINIA - ARZACHENA - OLBIA-TEMPIO', 'AFFITTACAMERE ARCIPELAGO - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 2',
    hotels: ['ALBATROS CLUB - ARZACHENA - OLBIA-TEMPIO', 'ALDIOLA COUNTRY RESORT - ARZACHENA - OLBIA-TEMPIO', 'ALTREGUESTHOUSE - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 3',
    hotels: ['AMBROSIO LA CORTE - OLBIA', 'B&B KENZIA - OLBIA', 'BORGO DI CAMPAGNA - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 4',
    hotels: ['BORGO SMERALDO HOTEL - ARZACHENA - OLBIA-TEMPIO', 'CALA CUNCHEDDI - VRETREATS - OLBIA', 'CASCIONI ECO RETREAT - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 5',
    hotels: ['CAVOUR - OLBIA', 'CENTRALE - OLBIA', 'CITTI - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 6',
    hotels: ['COLONNA DU GOLF - OLBIA', 'COLONNA HOTEL DU GOLF - PORTO ROTONDO - OLBIA-TEMPIO', 'COLONNA PALACE HOTEL MEDITERRANEO - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 7',
    hotels: ['COLONNA SAN MARCO - PORTO ROTONDO - OLBIA-TEMPIO', 'COUNTRY RESORT & RESTAURANT PARCO DEGLI ULIVI - ARZACHENA - OLBIA-TEMPIO', 'DANIEL - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 8',
    hotels: ['DE PLAM - OLBIA', 'DELTA INN - OLBIA', 'DOLCE VITA - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 9',
    hotels: ['DOMUS REGIA - OLBIA', 'DOUBLETREE BY HILTON OLBIA - OLBIA', 'DP OLBIA - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 10',
    hotels: ['ESSENZA - OLBIA', 'ESSENZA HOTEL - OLBIA - OLBIA', 'FAMILY HOTEL SPORTING TANCA MANNA - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 11',
    hotels: ['FOR YOU - OLBIA', 'FUNTANA ABBAS - ARZACHENA - OLBIA-TEMPIO', 'GEOVILLAGE OLBIA SPORT & CONVENTION RESORT - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 12',
    hotels: ['GEOVILLAGE SPORT WELLNESS & CONVENTION RESORT - OLBIA', 'GOLFO DI ARZACHENA CAMPING VILLAGE - ARZACHENA - OLBIA-TEMPIO', 'GRAND RELAIS DEI NURAGHI - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 13',
    hotels: ['GUEST HOUSE SUITE OLBIA - OLBIA', 'HOTEL ABBARUJA - OLBIA', 'HOTEL CAVOUR - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 14',
    hotels: ['HOTEL DELFINO - ARZACHENA - OLBIA-TEMPIO', 'HOTEL DEMAR - OLBIA', 'HOTEL DP OLBIA - SARDINIA - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 15',
    hotels: ['HOTEL FELIX OLBIA - OLBIA', 'HOTEL GRAZIA DELEDDA - ARZACHENA - OLBIA-TEMPIO', 'HOTEL IL TIMONE - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 16',
    hotels: ['HOTEL MARE BLUE - OLBIA', 'HOTEL MAXIM - OLBIA', 'HOTEL PALUMBALZA - PORTO ROTONDO - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 17',
    hotels: ['HOTEL PANORAMA - OLBIA', 'HOTEL PEDRA SANTA - ARZACHENA - OLBIA-TEMPIO', 'HOTEL RELAIS VALKARANA - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 18',
    hotels: ['HOTEL SESTANTE - PORTO ROTONDO - OLBIA-TEMPIO', 'HOTEL SPORTING PORTO ROTONDO - PORTO ROTONDO - OLBIA-TEMPIO', 'HOTEL STEFANIA BOUTIQUE HOTEL BY THE BEACH - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 19',
    hotels: ['HOTEL STELLA 2000 - OLBIA', 'IL SALICE B&B - OLBIA', 'ISULEDDA HOLIDAY CENTRE - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 20',
    hotels: ['JAZZ - OLBIA', 'KKULT BOUTIQUE HOTEL - OLBIA', 'LA BISACCIA - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 21',
    hotels: ['LA BORGATA - ARZACHENA - OLBIA-TEMPIO', 'LA LOCANDA DEL CONTE MAMELI - OLBIA', 'LE PALME - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 22',
    hotels: ['LI FINISTREDDI - ARZACHENA - OLBIA-TEMPIO', 'LI NEULI COUNTRY CLUB - ARZACHENA - OLBIA-TEMPIO', 'LOCANDA MURALES - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 23',
    hotels: ['LUNA LUGHENTE - OLBIA', 'MARTINI - OLBIA', 'MERCURE OLBIA - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 24',
    hotels: ['MICALOSU - ARZACHENA - OLBIA-TEMPIO', 'MODERNO - OLBIA', 'MOMA HOTEL CANNIGIONE - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 25',
    hotels: ['NG GUEST HOUSE OLBIA - OLBIA', 'NIBARU - ARZACHENA - OLBIA-TEMPIO', 'OLLASTU - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 26',
    hotels: ['OSPITALIT√Ä DEL CONTE HOTEL & SPA - OLBIA', 'PAPILLO & RESORT BORGO ANTICO - PORTO ROTONDO - OLBIA-TEMPIO', 'PARK HOTEL PORTO ISTANA - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 27',
    hotels: ['PAUSANIA INN - OLBIA', 'PETRA SEGRETA RESORT & SPA - OLBIA', 'PICCOLO PEVERO - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 28',
    hotels: ['POZZO SACRO - OLBIA', 'PUNTA D\'ACU COUNTRY RESORT - ARZACHENA - OLBIA-TEMPIO', 'RELAIS DU SILENCE ALDIOLA COUNTRY RESORT - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 29',
    hotels: ['RESIDENCE COSTA RUJA - OLBIA', 'RESIDENCE LA COSTA - ARZACHENA - OLBIA-TEMPIO', 'RESIDENCE LA COSTA VIEW - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 30',
    hotels: ['RESIDENCE ROCCE SARDE - OLBIA', 'RESIDENZA CAPRICCIOLI - ARZACHENA - OLBIA-TEMPIO', 'RESORT CALA DI FALCO - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 31',
    hotels: ['S\'ALZOLA - OLBIA', 'S\'ASTORE - OLBIA', 'SA PEDRA - OLBIA'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 32',
    hotels: ['SAN PANTALEO - OLBIA', 'SAN TRANO - ARZACHENA - OLBIA-TEMPIO', 'STAZZO LU CIACCARU - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 33',
    hotels: ['SULIA HOUSE PORTO ROTONDO, CURIO COLLECTION BY HILTON - OLBIA', 'SURRAU TURISMO RURALE - ARZACHENA - OLBIA-TEMPIO', 'SWADESHI GREEN PARK HOTEL - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 34',
    hotels: ['TERRANOVA - OLBIA', 'THE PELICAN BEACH RESORT & SPA - ADULTS ONLY - OLBIA', 'THE RESERVE POLTU QUATU - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo — batch 35',
    hotels: ['TRE MONTI - ARZACHENA - OLBIA-TEMPIO'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 1',
    hotels: ['ABBAIDDA - CASTELSARDO - SASSARI', 'AFFITTIMODERNI CASTELSARDO MIRAMARE - CSMI19 - CASTELSARDO - SASSARI', 'AGRITURISMO BARATZ - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 2',
    hotels: ['AL SARACENO - STINTINO - SASSARI', 'ALGHERO RESORT COUNTRY - ALGHERO - SASSARI', 'ALGHERO VACANZE HOTEL - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 3',
    hotels: ['ALGUER - ALGHERO - SASSARI', 'ALMA DI ALGHERO - ALGHERO - SASSARI', 'ANGEDRAS - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 4',
    hotels: ['BAGA BAGA - CASTELSARDO - SASSARI', 'BAJALOGLIA RESORT - CASTELSARDO - SASSARI', 'BELLAVISTA - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 5',
    hotels: ['BEST WESTERN HOTEL BLUMAREA - CASTELSARDO - SASSARI', 'BRAVO CLUB STINTINO - STINTINO - SASSARI', 'CALA ROSA CLUB HOTEL - STINTINO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 6',
    hotels: ['CALABONA - ALGHERO - SASSARI', 'CAMPING VILLAGE LAGUNA BLU - ALGHERO - SASSARI', 'CASTELSARDO RESORT VILLAGE - CASTELSARDO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 7',
    hotels: ['CLUB ESSE LE TONNARE - STINTINO - SASSARI', 'CLUB ESSE ROCCARUJA - STINTINO - SASSARI', 'CLUB ESSE SPORTING - STINTINO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 8',
    hotels: ['CORTE ROSADA - ALGHERO - SASSARI', 'CORTE ROSADA RESORT & SPA - ADULT ONLY - ALGHERO - SASSARI', 'COUNTRY HOTEL VESSUS - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 9',
    hotels: ['DOMOMEA - ALGHERO - SASSARI', 'DOMOMINORE - ALGHERO - SASSARI', 'EL BALEAR - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 10',
    hotels: ['EL FARO - ALGHERO - SASSARI', 'F53 KEVIN\'S CHARMING HOUSES - ALGHERO - SASSARI', 'FLORIDA - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 11',
    hotels: ['FLOWERY INN VILLA - ALGHERO - SASSARI', 'FUTURA CLUB BAIA DI CONTE - ALGHERO - SASSARI', 'GARDENIA CASA VACANZE - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 12',
    hotels: ['GERANIO ROSSO - STINTINO - SASSARI', 'GREEN SPORTING CLUB - ALGHERO - SASSARI', 'HOTEL & SPA RIVIERA CASTELSARDO - CASTELSARDO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 13',
    hotels: ['HOTEL CALA REALE - STINTINO - SASSARI', 'HOTEL CATALUNYA - ALGHERO - SASSARI', 'HOTEL COSTA DORIA - CASTELSARDO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 14',
    hotels: ['HOTEL DEI PINI - ALGHERO - SASSARI', 'HOTEL FERTILIA - ALGHERO - SASSARI', 'HOTEL OASIS - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 15',
    hotels: ['HOTEL PORTOCONTE - ALGHERO - SASSARI', 'HOTEL PUNTA NEGRA - ALGHERO - SASSARI', 'HOTEL RESIDENCE AMPURIAS - CASTELSARDO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 16',
    hotels: ['HOTEL RESIDENCE LA BAIA - CASTELSARDO - SASSARI', 'IL BARONE GUILLOT RESIDENZE MARICHARME - ALGHERO - SASSARI', 'IL GABBIANO - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 17',
    hotels: ['JANUS HOTEL - CASTELSARDO - SASSARI', 'LA FATTORIA - CASTELSARDO - SASSARI', 'LA MAISON - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 18',
    hotels: ['LA MARGHERITA & SPA - ALGHERO - SASSARI', 'LA PLAYA - ALGHERO - SASSARI', 'LE TONNARE FAMILY CLUB - STINTINO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 19',
    hotels: ['MELI - CASTELSARDO - SASSARI', 'MISTRAL - ALGHERO - SASSARI', 'NANTIS HOTEL - CASTELSARDO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 20',
    hotels: ['OASIS ALGHERO - ALGHERO - SASSARI', 'PARK HOTEL ASINARA - STINTINO - SASSARI', 'PEDRALADDA - CASTELSARDO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 21',
    hotels: ['RELAIS HOTEL SA CHEYA - ALGHERO - SASSARI', 'RESIDENCE EUROPA - ALGHERO - SASSARI', 'RESIDENCE HOTEL LA PELOSETTA - STINTINO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 22',
    hotels: ['RESIDENCE HOTEL MONTE RICCIU - ALGHERO - SASSARI', 'RESIDENCE LE VELE - STINTINO - SASSARI', 'RESIDENCE PICAL√à - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 23',
    hotels: ['RESIDENCE RINA - ALGHERO - SASSARI', 'RESIDENZE DI CAMPAGNA ‚Äì PODERE MONTE SIXERI ALGHERO - ALGHERO - SASSARI', 'RESORT CAPO CACCIA - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 24',
    hotels: ['RINA HOTEL - ALGHERO - SASSARI', 'RISTORANTE SILVESTRINO - STINTINO - SASSARI', 'RIVIERA - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 25',
    hotels: ['ROSA DEI VENTI - CASTELSARDO - SASSARI', 'ROSSOCORALLO ROOMS - ALGHERO - SASSARI', 'SAN FRANCESCO - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 26',
    hotels: ['SAN GIUAN - ALGHERO - SASSARI', 'SAN MARCO - ALGHERO - SASSARI', 'SMY CARLOS V WELLNESS & SPA ALGHERO - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 27',
    hotels: ['SOLEADO - ALGHERO - SASSARI', 'STINTINO CALAS - STINTINO - SASSARI', 'TORRE DEL PORTICCIOLO VILLAGGIO CAMPING - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 28',
    hotels: ['UNAHOTELS CLUB HOTEL ANCORA - STINTINO - SASSARI', 'VILLA BARBARINA NATURE RESORT - ALGHERO - SASSARI', 'VILLA LAS TRONAS - ALGHERO - SASSARI'],
  },
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino — batch 29',
    hotels: ['VILLA LORETO - ALGHERO - SASSARI', 'VILLA PIRAS - ALGHERO - SASSARI', 'VILLAGGIO TORRE DEL PORTICCIOLO - CAMPGROUND - ALGHERO - SASSARI'],
  },

  // ── LIGURIA ──────────────────────────────────────────────────────────────────
  // 222 total Liguria hotels
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 1',
    hotels: ['ASTORIA - RAPALLO - GENUA', 'BEST WESTERN PLUS TIGULLIO ROYAL - RAPALLO - GENUA', 'BEST WESTERN REGINA ELENA - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 2',
    hotels: ['BEST WESTERN REGINA ELENA DEPENDANCE (5KM FROM PORTOFINO) - SANTA MARGHERITA LIGURE - GENOA', 'BLU DI TE - SANTA MARGHERITA LIGURE - GENOA', 'CANALI - RAPALLO - GENUA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 3',
    hotels: ['CAVOUR - RAPALLO - GENUA', 'CONTE VERDE - SANTA MARGHERITA LIGURE - GENOA', 'EIGHT PARAGGI - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 4',
    hotels: ['EUROPA HOTEL DESIGN SPA 1877 - RAPALLO - GENUA', 'EXCELSIOR PALACE - RAPALLO - GENUA', 'FERRARI - CHIAVARI - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 5',
    hotels: ['GIULIO CESARE - RAPALLO - GENUA', 'GRAND HOTEL BRISTOL RESORT & SPA - RAPALLO - GENUA', 'GRAND HOTEL MIRAMARE - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 6',
    hotels: ['GRAND HOTEL TORRE FARA - CHIAVARI - GENOA', 'HOTEL APPRODO - RAPALLO - GENUA', 'HOTEL CONTINENTAL - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 7',
    hotels: ['HOTEL DELL\'ORTO - CHIAVARI - GENOA', 'HOTEL DELLE ROSE - RAPALLO - GENUA', 'HOTEL IL GATTO - RAPALLO - GENUA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 8',
    hotels: ['HOTEL LA VELA-CASTELLO IL RIFUGIO - SANTA MARGHERITA LIGURE - GENOA', 'HOTEL MIRO\' - RAPALLO - GENUA', 'HOTEL MIR√≤ - RAPALLO - GENUA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 9',
    hotels: ['HOTEL MONTE ROSA - CHIAVARI - GENOA', 'HOTEL ROSABIANCA - RAPALLO - GENUA', 'HOTEL SANTA MARIA - CHIAVARI - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 10',
    hotels: ['HOTEL VILLA ANITA - SANTA MARGHERITA LIGURE - GENOA', 'HOTIDAY HOTEL RAPALLO - RAPALLO - GENUA', 'IL CONVENTO - RAPALLO - GENUA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 11',
    hotels: ['IMPERIALE PALACE - SANTA MARGHERITA LIGURE - GENOA', 'ITALIA E LIDO - RAPALLO - GENUA', 'JOLANDA - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 12',
    hotels: ['LA LOCANDA DI COLOMBO - SANTA MARGHERITA LIGURE - GENOA', 'LAURIN - SANTA MARGHERITA LIGURE - GENOA', 'LHP SANTA MARGHERITA PALACE & SPA - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 13',
    hotels: ['LIDO PALACE - SANTA MARGHERITA LIGURE - GENOA', 'MA HOTEL - SANTA MARGHERITA LIGURE - GENOA', 'MEDITERRANEO EMOTIONAL HOTEL & SPA - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 14',
    hotels: ['METROPOLE - SANTA MARGHERITA LIGURE - GENOA', 'MINERVA - SANTA MARGHERITA LIGURE - GENOA', 'MIRAMARE HOTEL - RAPALLO - GENUA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 15',
    hotels: ['MONDIAL - RAPALLO - GENUA', 'MONTALLEGRO - RAPALLO - GENUA', 'PARK HOTEL SUISSE - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 16',
    hotels: ['REGINA ELENA DEPENDANCE - SANTA MARGHERITA LIGURE - GENOA', 'RIVIERA - RAPALLO - GENUA', 'SANT\'ANDREA - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 17',
    hotels: ['SANTA MARGHERITA PALACE DEPENDANCE - SANTA MARGHERITA LIGURE - GENOA', 'STELLA - RAPALLO - GENUA', 'STELLA DEL MARE - CHIAVARI - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 18',
    hotels: ['TIGULLIO ET DE MILAN - SANTA MARGHERITA LIGURE - GENOA', 'VESUVIO - RAPALLO - GENUA', 'VILLA 1900 - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita — batch 19',
    hotels: ['VILLA ALBERTI - SANTA MARGHERITA LIGURE - GENOA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 1',
    hotels: ['AFFITTACAMERE BELLAVISTA 2 - LA SPEZIA', 'ALBERGO DELLE SPEZIE - LA SPEZIA', 'ALBERGO RISTORANTE PARADISO - PORTOVENERE - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 2',
    hotels: ['ALLEGROITALIA LA SPEZIA - LA SPEZIA', 'B&B CINQUE TERRE GATEWAY - LA SPEZIA', 'B&B VIA DELLE 5 TERRE - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 3',
    hotels: ['B&B VILLA AMARANTA - CINQUE TERRE - LA SPEZIA', 'BELVEDERE - PORTOVENERE - LA SPEZIA', 'BYRON - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 4',
    hotels: ['CAMPING VILLAGE RIVER - AMEGLIA - LA SPEZIA', 'CDH HOTEL LA SPEZIA - LA SPEZIA', 'COMFORTABLE APARTMENT WITH GARDEN IN AMEGLIA, CLOSE TO THE HISTORICAL CENTRE! - AMEGLIA - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 5',
    hotels: ['CORALLO - LA SPEZIA', 'CRISTALLO - LA SPEZIA', 'DEL GOLFO - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 6',
    hotels: ['DORIA PARK HOTEL - LA SPEZIA', 'FIRENZE E CONTINENTALE - LA SPEZIA', 'FLORIDA LERICI - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 7',
    hotels: ['GARIBALDI23 - LA SPEZIA', 'GHIRONI - LA SPEZIA', 'GOLFO DEI POETI RELAIS & SPA - AMEGLIA - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 8',
    hotels: ['GRAND HOTEL EUROPA - LA SPEZIA', 'GRAND HOTEL PORTOVENERE - PORTOVENERE - LA SPEZIA', 'HOTEL CRISTALLO PARK - PORTOVENERE - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 9',
    hotels: ['HOTEL DELLA BAIA - PORTOVENERE - LA SPEZIA', 'HOTEL GARDEN BOCCA DI MAGRA - AMEGLIA - LA SPEZIA', 'HOTEL GENOVA - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 10',
    hotels: ['HOTEL LA LOCANDA DELL‚ÄôANGELO - AMEGLIA - LA SPEZIA', 'HOTEL LE GRAZIE - PORTOVENERE - LA SPEZIA', 'HOTEL RIVER PARK - AMEGLIA - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 11',
    hotels: ['HOTEL SETTE ARCHI - AMEGLIA - LA SPEZIA', 'LA CASA AL MARE - LA SPEZIA', 'LA CASA DEI TRENI AFFITTACAMERE - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 12',
    hotels: ['LA SPEZIA BY THE FIRST - LUXURY ROOMS SUITES & APARTMENTS - LA SPEZIA', 'LE COCCOLE - LA SPEZIA', 'LE FIGAROLE PESCARINO - AMEGLIA - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 13',
    hotels: ['LE PINETTE BED AND BREAKFAST - AMEGLIA - LA SPEZIA', 'LOCANDA DELL\'ANGELO PARACUCCHI - AMEGLIA - LA SPEZIA', 'LOCANDA LA TRIGOLA - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 14',
    hotels: ['MAELI ROOMS - LA SPEZIA', 'MARY - LA SPEZIA', 'NELLA - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 15',
    hotels: ['NH LA SPEZIA - LA SPEZIA', 'RACCONTI DI MARE - 5 TERRE - LA SPEZIA', 'RESIDENCE LE TERRAZZE - PORTOVENERE - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 16',
    hotels: ['RESIDENCE PAX - AMEGLIA - LA SPEZIA', 'ROSA DEI VENTI - LA SPEZIA', 'ROYAL SPORTING - PORTOVENERE - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 17',
    hotels: ['SAN TERENZO - LA SPEZIA', 'SETTE ARCHI - AMEGLIA - LA SPEZIA', 'SHELLEY E DELLE PALME - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 18',
    hotels: ['THE POET HOTEL - LA SPEZIA', 'URBAN CHIC HOUSE - BED & BREAKFAST - LA SPEZIA', 'VENEZIA - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere — batch 19',
    hotels: ['VILLA C√† MEA - LA SPEZIA', 'VILLA SOFIA - LA SPEZIA', 'WELCOMING HOUSE - LA SPEZIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 1',
    hotels: ['AFFITTACAMERE ROMA - SANREMO - IMPERIA', 'AL SARACENO - ALASSIO - SAVONA', 'ARISTON MONTECARLO - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 2',
    hotels: ['ATTRACTIVE APARTMENT IN SANREMO WITH TERRACE - SANREMO - IMPERIA', 'B&B H68 - ALASSIO - SAVONA', 'B&B HOTEL SAVONA - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 3',
    hotels: ['B&B VERDE MARE - ALASSIO - SAVONA', 'BAIA BLU - ALASSIO - SAVONA', 'BEAU RIVAGE - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 4',
    hotels: ['BED & BREAKFAST ALASSIO - ALASSIO - SAVONA', 'BELLE EPOQUE - SANREMO - IMPERIA', 'BELSOGGIORNO - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 5',
    hotels: ['BELVEDERE - SANREMO - IMPERIA', 'BOBBY EXECUTIVE - SANREMO - IMPERIA', 'BUNGALOWS VILLAGE IL PAESE DI CIRIBI - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 6',
    hotels: ['CAMPING VILLAGE IL PAESE DI CIRIBI - SAVONA', 'CORTESE DEPENDANCE - SANREMO - IMPERIA', 'COSY APARTMENT IN SANREMO WITH BALCONY - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 7',
    hotels: ['CUTESY HOLIDAY HOME IN SANREMO WITH BALCONY - SANREMO - IMPERIA', 'DE PARIS SANREMO - SANREMO - IMPERIA', 'DIANA GRAND HOTEL - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 8',
    hotels: ['EDEN - SANREMO - IMPERIA', 'EMILY ROOMS - SANREMO - IMPERIA', 'EUROPA - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 9',
    hotels: ['EVELINE 2 - PISCINA PRIVATA - JACUZZI - SANREMO - IMPERIA', 'EVELINE PORTOSOLE - SANREMO - IMPERIA', 'FESTIVAL - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 10',
    hotels: ['GLOBO - SANREMO - IMPERIA', 'GRAND HOTEL ALASSIO BEACH & SPA RESORT - ALASSIO - SAVONA', 'GRAND HOTEL DES ANGLAIS - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 11',
    hotels: ['GRAND HOTEL LONDRA - SANREMO - IMPERIA', 'GRAND HOTEL MEDITERRAN√âE - ALASSIO - SAVONA', 'GRAND HOTEL SPIAGGIA - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 12',
    hotels: ['HOTEL ADLER - ALASSIO - SAVONA', 'HOTEL AIDA - ALASSIO - SAVONA', 'HOTEL ALEXANDER - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 13',
    hotels: ['HOTEL ALFIERI - ALASSIO - SAVONA', 'HOTEL BADANO SUL MARE - ALASSIO - SAVONA', 'HOTEL BEAU SEJOUR - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 14',
    hotels: ['HOTEL BEL SIT - ALASSIO - SAVONA', 'HOTEL CORSO - ALASSIO - SAVONA', 'HOTEL CURTIS CENTRALE - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 15',
    hotels: ['HOTEL DANIO LUNGOMARE - ALASSIO - SAVONA', 'HOTEL DEI FIORI - ALASSIO - SAVONA', 'HOTEL EDEN ALAXI HOTELS - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 16',
    hotels: ['HOTEL ELETTO - SANREMO - IMPERIA', 'HOTEL ENRICO - ALASSIO - SAVONA', 'HOTEL ESPERIA - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 17',
    hotels: ['HOTEL EUROPA & CONCORDIA - ALASSIO - SAVONA', 'HOTEL FLORA - ALASSIO - SAVONA', 'HOTEL FLORIDA - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 18',
    hotels: ['HOTEL GARDEN - ALASSIO - SAVONA', 'HOTEL LA BALNEARIA - ALASSIO - SAVONA', 'HOTEL LAMBERTI - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 19',
    hotels: ['HOTEL LIDO - ALASSIO - SAVONA', 'HOTEL LIGURE - ALASSIO - SAVONA', 'HOTEL MARINELLA - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 20',
    hotels: ['HOTEL MILANO - ALASSIO - SAVONA', 'HOTEL NUOVO AL MARE - ALASSIO - SAVONA', 'HOTEL NUOVO BRISTOL - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 21',
    hotels: ['HOTEL PARADISO - SANREMO - IMPERIA', 'HOTEL PRINCIPE - SANREMO - IMPERIA', 'HOTEL REGINA - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 22',
    hotels: ['HOTEL RISTORANTE TOSCANA - ALASSIO - SAVONA', 'HOTEL SAN MARCO - SAVONA', 'HOTEL SAVOIA - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 23',
    hotels: ['HOTEL SOLE MARE - SANREMO - IMPERIA', 'HOTEL SORRISO - SANREMO - IMPERIA', 'HOTEL VILLA IGEA - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 24',
    hotels: ['IDEA HOTEL PLUS SAVONA - SAVONA', 'LA ROSA DEI VENTI - SANREMO - IMPERIA', 'LE CAMERE DI NANA - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 25',
    hotels: ['LE CAMERE DI NAN√† - SANREMO - IMPERIA', 'LOLLI PALACE HOTEL SANREMO - SANREMO - IMPERIA', 'MAJESTIC - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 26',
    hotels: ['MARE - SAVONA', 'MILANO - SANREMO - IMPERIA', 'MIRAMARE CONTINENTAL PALACE - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 27',
    hotels: ['MIRAMARE LUXURY DEPENDANCE - SANREMO - IMPERIA', 'MIRAMARE THE PALACE HOTEL - SANREMO - IMPERIA', 'MODUS VIVENDI - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 28',
    hotels: ['MORANDI - SANREMO - IMPERIA', 'NAPOLEON - SANREMO - IMPERIA', 'NAZIONALE - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 29',
    hotels: ['NH SAVONA DARSENA - SAVONA', 'NUOVO SUISSE - ALASSIO - SAVONA', 'NYALA SUITE - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 30',
    hotels: ['PARCO VACANZE MONTI E MARE - ALASSIO - SAVONA', 'PARK HOTEL - SAVONA', 'POLLON INN - AFFITTACAMERE - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 31',
    hotels: ['RELAIS VIRGINIA HOME - SANREMO - IMPERIA', 'RESIDENCE ATLANTIC - ALASSIO - SAVONA', 'RESIDENCE BARUSSO - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 32',
    hotels: ['RESIDENCE CORALLO - ALASSIO - SAVONA', 'RESIDENCE DEI DUE PORTI - SANREMO - IMPERIA', 'RESIDENCE EUROPA UNITA - ALASSIO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 33',
    hotels: ['RESIDENCE PANAMA - ALASSIO - SAVONA', 'RESIDENCE SAN MARCO - ALASSIO - SAVONA', 'RIO SAN REMO - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 34',
    hotels: ['RIVIERA SUISSE - SAVONA', 'ROSA - ALASSIO - SAVONA', 'ROYAL HOTEL SANREMO - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 35',
    hotels: ['SAN NICOLA - ALASSIO - SAVONA', 'SAUNA JUNIOR SUITE & SPA BY DES ANGLAIS - SANREMO - IMPERIA', 'TIRRENO - SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 36',
    hotels: ['VIA MARSAGLIA ROOMS - SANREMO - IMPERIA', 'VILLA IMPERIALE - SAVONA', 'VILLA LA BRISE - SANREMO - IMPERIA'],
  },
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona — batch 37',
    hotels: ['VILLA SOPHIA - SANREMO - IMPERIA', 'VILLA SYLVA - SANREMO - IMPERIA'],
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
