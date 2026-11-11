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
const { buildPackageProposal } = require('./package-proposal');
const { buildStopSaleReport }  = require('./stop-sale');

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
  puglia:   process.env.DRIVE_FOLDER_PUGLIA   || '',
};

// VP 2027 output folder IDs (proposal sheets + stop sale reports land here)
const VP_FOLDERS = {
  laghi:    process.env.VP_2027_FOLDER_LAGHI    || '1KQNpmHcVW0nTbcztgUophIM100PvlLL1',
  toscana:  process.env.VP_2027_FOLDER_TOSCANA  || '',
  sardegna: process.env.VP_2027_FOLDER_SARDEGNA || '',
  liguria:  process.env.VP_2027_FOLDER_LIGURIA  || '',
  puglia:   process.env.VP_2027_FOLDER_PUGLIA   || '',
};

// Source spreadsheet IDs used by the proposal builder (populated after each scrape)
const PROPOSAL_SS_IDS = {
  laghi: [
    '1QT9lNez2q8gDBN_XbLw4X666lGhvE_W0z0a1DKoaF0s',  // search_236 Como
    '1kmfhfwYbYPrIz4g74W4LGrwvd3m3ouCJcB-UUvxrqbU',  // search_237 Maggiore
    '1DtFDRZUNPFYcOnfDh3CEzXKVU5tk2cpUy2A8AAVdOBA',  // search_240 Garda
  ],
  // For other destinations the XLS files in Drive are the source — IDs added post-scrape
  toscana: [
    '1sp-JbqP3q7Z9tqf4P_UCi_m0m-tYZFRj',
    '1_GlMnU4s3LyrnPtlSRhIXZgYkooXt_V_',
    '1tSufTGLhoAalAIzf3uIlK5-ukFCkCDzB',
    '1SFsm9eMx2efEhqYe6OzGnGJThW838nNv',
    '1UPz6lixHN1oaO7TYG0yZl8vk9ceXyK2g',
    '1avuEyyNELbLnDblmgpe5AeutI2q3v2oK',
    '1p5bpF2HI8HBf3vpLCCxO-eQE536fgqeS',
    '1_IgBgmJOeSbK-jyu4teW1KnioT5G85td',
    '1RPCuOtUMUz4cHItNn73zceqB84Ulmwfv',
    '1JNCO0kcleybjzvmY0iW5zXWsU2cxblDk',
    '1HceiQm-nNtnmN9Sdwxd5aYRFxOjNEPh0',
    '1a5zvDpE01FaFQ8zt8vHS4H8GHmu4qA6Y',
    '1_c1ZD_fEjnBBHoN42AyCuVMse0CUlzvz',
    '1w3JG0vApwIwrk1rRcTMPHRxEoFuX26LE',
    '1bkbS_ybmQBalktQu6kgAtzTpmqh3_Ebi',
    '1ePLjC8SOAlqg1c5bV8mTuBX-jkMxKWir',
    '1C2FwgnA5UwcEtq7fS9JEXtLa2R55eLKW',
    '1Wxtm0MZfT_7v8BWBPU9gXqaie0d-wJ2P',
    '1PEvfgE1CcrHgtEKdzIQfnPLTWo_yXm91',
    '1HXLp8puosnaZQyvR69dpfBRq9eBWO8lv',
    '1KqCeK3uLXKOZpkPXfzLNVTkj6sz9KuwV',
    '1vFl-1tRrQTNq8laynmboiH10_7fwfTZF',
    '1XRaovyMEt7cxj7PIRLdbFN-eI_pV36JE',
    '1KXy9mGVjF9li0IHrnPwfo8AyYVK_wycX',
    '1mJjWjysUOb-2JZms-rtE3uaU5OAH-CgQ',
    '1OIGmQTzjU1LDCxibyPOb_yiXGdfyqwYE',
    '17jnDrFKIBzEeRz9My8G1jULUj2G1tax4',
    '1Qi3Q2KWQ1IYxl5RomgvP-1LgDkNeXtoK',
    '13KDmHgwPbjknhkyGc_dN1YTFHoaVaBh1',
    '1ZC8H51KvlPAAeAOhf3_JP-OTC5REp-pn',
    '18sRYU_SBtSxtNnuJveFyRMt1CtPKmVTt',
    '1bduRTegsh7Ed8Pn3yIeUTCQdEI9yMotI',
    '1iq-rDCtrgdCRb_pmMdaGQKXbiwPFeMqX',
    '17XxD2D3VIjjQRJEPctvO_ILQJ0Cp8GnJ',
    '1qvgE2UA7fMDieOxXLRH7kwK8ou5GQkis',
    '1Ixpg6CIdVNcmutzQz6AEWzQZmpB1Jw2h',
    '1npWqo4gDUFboz27Y7t1EgQgUHJx4EbZy',
    '1ycp2-2PMDqlrP-moxpNlUY6G5tWU_RBe',
    '1DO9JGAYyvEA050g3b0wiJqbA7uHywLHN',
    '1oXslm93vWrlozHwuWc5piPghIPCTmcqL',
    '1w446BX2V3NJCKanMKBrXn3y-4-n27aB9',
    '1W8Z2tmA9uZbBMU5DagPpTZDObF0_mchE',
    '10GE32AZsxw0X6DgD-_c_18oFAQxh1-f3',
    '1QxyTIvXF_0Xq8Vwugmgcn_-iCD55MJF_',
    '1MlfVRonjutj5Yagx-WB_fKGVZX6l1bcI',
    '10qHwL-yiK6mATF2UPx_yGDwzY6XAhpiz',
    '15M7jtdJl57uoKEu3w4W6hbyCozhcPUA7',
    '1YHAKKiB9eIlUAyWxjio6rMJs72g6n1Yl',
    '1Uq3mNEowz-tBLRjIsqH1rsUid1zYED0w',
    '128BBQWlLf6vMibvPK0UNcy0IlikrIwYF',
    '1rvM2Y_59-xi7-WT-UJeZ3ZTWR7m5G_cQ',
    '1RimL1-FRWBnm77em25o3sQpsvmDHVYLi',
    '13A2syV1J8yqzqMJ9Rn3jAg261hJsMkO_',
    '1SMjgVOWkn9yQV6WXX5g0s4YbAui51hEL',
    '1POkQWWIastiK85Psw7c-3kY7SmHC2ZmO',
    '1y-UoNshWhadr7aiDyW-Cm4xfYXf4fCN9',
    '15_Qt_Z3iCjs0GNCMYsQOiTw8kf34LThc',
    '1wXDI9wqZGsMgjE2XomJYFDICeRJ5PtKW',
    '1scdMMcNQpNPb83BE_Qovdu3C0d4VDppF',
    '1Q7jdpXqymTZIqz3S07sRc-BmEJSwgU_8',
    '1nU3gTxNYXeOiIZmKoJtE6KlaEBuMeOKi',
    '1W4H7QSFfdCgKsmnkOk1KetcphIvsL0Xw',
    '1zrr0B295sxfF3pnhKUjrryDPLO4mf1Jb',
    '11r_YhIXzAsCwOikYs28OxiEPl8RC9wbc',
    '16SZuSGAcsoghwGUa_lAqxEalcPZ1CA-E',
    '10QaaJzNaKTN9hneLD6x-BE3M7kbl4vDp',
    '1gpC5yyrmGFvCkz6qwbrGnTvtM8o5dSxD',
    '1r8zbSrklCavI2iAwQKT8T0T5Jynth_dQ',
    '1vUvDKEDiPZ3Nh5vHXDlp44I8xErrHtWI',
    '1cQ8nClwCEMhghBukpmgaPfsJSwLtmAbb',
    '1XNNc0BfTco8PJE5CuL_08bMl_dWT28-4',
    '1iLDiUSqLs0NGlPkA0CC5H414sD-SQrYT',
    '1D0c_FttRfoDW6PLuPCMetokGs5lQXaCB',
    '1hPsFzDfK4oyUooe942DnmUDCa0F26r8Z',
    '1B0U7c8bSlo59L-B552fTLagp0NOXPcI3',
    '1rDeMEmom-2-obg_f6tWuSV4czjOmBjqZ',
    '1h46H4RwxYqml_0bZ-cWkflZgCpbrdkw7',
    '1LDuXeLaXLVH0_Ra33apVKA6RklOmF1cf',
    '1poIyf0x1Ep8N3Q03VdmSghkLAvXF1vOx',
    '163DGyWRAAm4Pe1xerPhtE6SMdnzf0h5Z',
    '1VtyRCU3tF6EoqbNAZ1ZuT0sgVWF-f_Xx',
    '10-k3NDbkFUxzMjfKtFo1Z2goyfCMIix8',
    '1-AYXAFVm2DSRLt-geSFnKnrGgcz6g9sT',
    '1CdAlipH9R8nA-MjKa27qMYtQJFRgBkhZ',
    '1QmEbh6g3KphYKd9uWChsEkUiloLrHcDD',
    '1IjQIwHtlox9pVjwt-gtYwCLkThirvG4z',
    '1n8O7x1RKqYPIvCID0tt9D7sFWNYx_ei7',
    '175S1tbZ-TZlk99eIe_WiDwAaXw_adwnK',
    '1VfqTG_epS2grV4VNj2sFqWUmRXZu0OR-',
  ],
  sardegna: [
    '1BjdXGjDGaMWoiH4p5Cm0oXxX5sw6cPkC',
    '1nl6jGtRSTcjVv75x9SAk-MRvruHpeZxQ',
    '1bMoYG5K2jHwTlT5GHY9hFI-fT8DIGGBU',
    '1dDyPwIeOwnHObDSit8lI4MEbSiGfqtHf',
    '18OtJvCnxawDkmFW94i2oyRelrCjyG0Dl',
    '1TzmTH8PKzJ8JQTNnhbblfaBAulPhBEd1',
    '1bzISGIJAHVrXCDFQmG7GBAG2MW2ZibMt',
    '19OMq93du3D3PZUOmzmTpyZW-6d1V81sv',
    '18zKauGAcckDAqKQ4MYF3PiWZ-4iCELri',
    '1B_TWeI80LrGUy9TM1TGkX51svHAeN9tm',
    '16h3XOjiT6l3bgQggBNwRE1fMWRiY6Lxe',
    '18aCFRJgqG_moh1S_BqZibwHRNtglFL-Q',
    '10GUUQR57dbCjx5AgMICT00w31FtORJ7Z',
    '1HPmTZJ5kIujWyG9gRfZOEFiSUpTvl-LH',
    '1r5qyPcM5i-bfEnd4yeiFZ6OuwECAoUq9',
    '1W1a9V4HEc2WiaGa_6puoLtEQJy65ycbY',
    '1gta8c7bV3IqK8K9LwDqfIxOx-CqNQF4s',
    '1aq_7zznj_kAq7rjZV3WSwr7OEPbMEa08',
    '1OjqictVznbV-6HuSVRPE4hGwTtirl4MT',
    '1zBmVeYbmvH8WyB3tmM7-E8JDsFOvlnAq',
    '110R4HX2ozkBUMvto-__vgIM8s7eVs8Ap',
    '17eKODL_PD38pcN1BOaPMWPQwMLaQEvue',
    '1sqcXBZ0QIBVIkNeGaLLVtSQxV6kQUzKO',
    '1Z41vTdEZ-xLK7Ra5OfFQiM-YB4awpPbq',
    '1H2GBQQgpxZm4FteCPvf1IRPJUQcZdIcF',
    '12fV11v4SovKslJGCS6tZxMPCEJneJejU',
    '1kF3OzIh6-ez6iBU6By6WeWd6kuYcKfit',
    '1lEjlop2pmAXswXO5F96p_JMKZuyYEq_t',
    '1eKEg5iO0X_PmuWlzHQQEBmx8rvop14xi',
    '14HtHs6RblYhsp-t66fRWHI3qYNse8iui',
    '1odPhQp0fuT8Me5iBBj95famdGJOYzHyb',
    '1b8Tp8XshyeU_iAFXvTtKrBPFKPlx9fDn',
    '1vZqLuVdWCOcUFKXpA_Re7Ofs6Np9tlfw',
    '1kZ7a3h2S_MKMwRCOn4I1XW904Ztk--ja',
    '19gfIOM_q0idUpCPn1Cwe1PFYfUZjxT-X',
    '1DzZJArUv42Y2-mvUv2DLe3l2U0d3lwW1',
    '11ZOFXFwYRMJlR5l2xZpmihmn40NG4QuX',
    '1v6TOOJTYsqd_yaY_WHtl5pKrpL1FeoMZ',
    '1KZjXqNP7sER4SmJVQr6-1zp4X-9fyszZ',
    '1p7a3ZwmQHh_shzQ1gC3_R3ovnIX86th9',
    '15tlXXL1SqoN7no83-luZUKUiq6NAImRC',
    '1iqvG7u7stlGH-5r3eYtt5Hnqz-4Zm2Xj',
    '16mF5aq71mOka4vbYe5YNtgKRTTlfSBYb',
    '1Vltb7ykAxGiKx9xj1h8cu8EeKoP16LPW',
    '1DE01fuZFUN9nXSJGijdrPMCrjpD-smZb',
    '1dNyDiCRtxaXmlEDShRa5CmIt1VAKydvu',
    '1CdOCzGbJG2qUBMbLIPoN82w387EQqCJd',
    '12CstZxT6N1RcWEiQILr19GaPLjUCaqQ5',
    '1FD4-0kioReJVYXCTVHI-v9_GiRpt3XhL',
    '1NIFdqKRmYP2MIXRhMpPpYBTF1g5N2l8d',
    '1SML_d7h8ZXLmA5EuJQFY0dS7R00IVIAp',
    '1ZqhGVXtgXJDX83vJxFo1SVAbrOfHAgoS',
    '1VxlRO_tePfAT6IJO5N7Uvp4autgzV8x9',
    '1f9bWjXnmhWOlOPjDneFKNNG2BySlp_cB',
    '1EIBQoOQGoApU5YrtzR0BKQKuPsXf19Ua',
    '1lorYtb4OEOIOotwrY0Hzk5XDweGn6D8o',
    '1mqausZxorMU1o3ddtvZkX34Kx4RQmz7T',
    '1vckiJIyld6sZONQj96GHmEpO0U_DgHSb',
    '10guHqtn-x8I_sWzDCtfxFuFzmhIlaX7o',
    '1WQQYDPQJCH7DNYvpHvZDPFsDKvexrxIY',
    '1B7LFpVbJgGNySegZnhGBEvhSZLd7iKXP',
    '1s79WJtqfBsRsJEVn8yCqWl0xB02YFmdA',
    '168UeebtofhthAOqTVLiGH-ewcRaqNBfP',
    '1d_QL4V5IdUivPaySDZ6Uz6w2MJzlh-_-',
    '1xHhqeQ5TSLmBVBbRnYEEPZpMwXlJ2eTn',
    '17TwCRCAN92xgr7O8gfrTqpKCgsRS3rtn',
    '11mC4u6YL7DoAnmjWo8mYSIziNOdUnMff',
    '1AzPoorXnyXizJecp03oXeK1qKJhlDtZ8',
    '1jyz1w-0PsW5zkHUX9VRZ7dYui9VPa8h_',
    '1LlUiMoh_OhLjDzOvEUk7oe3JWICvYP_0',
    '1KAQq98h-Neavbl2NWIiLTwsL9_9-7vPu',
    '1mj755zgqJMUkf64IUx9u75Re30GgonXi',
    '1SRv3hryvNmUAW4JL8mk9pSyHNQmAe1dy',
    '16dChUyFI3CaS9ELyJSnTs22JCpqWXpDM',
    '1FZHS-McLtcKtVRQv1t3SNVPOPNZ_8Owz',
    '10N6Tmr5v3kEJwhzi5LOUUhSq89vbMKGc',
    '1C9c1g3wImlx8oxJEPqhtynenSLtomKaB',
    '1gab8q9Y4kJ4a_ebOZtmgX2p-JsDRTlMC',
  ],
  liguria: [
    '1_n4BuLjMm3dH3YOGe4jzGlwuWVLwL4Yz',
    '16MrxhGYZEV4HqD9Vqkt62ygsxUTs4mU1',
    '1gLXiz0csWzdPxhdhjDMABlip-9YUA83V',
    '1s4nx4UhOP79KXkhRnIpElL-Fwz6FWjaE',
    '1VxLI4BM-QIRoedwsHZBehS__WxGZ32xx',
    '12rk_JUEsaTfWejyAfSegnTPSKC44KDgc',
    '14-D-dVPoRmwnezB8qWNc7GjkxgsXx2_w',
    '1JWQeYtwIViNZoSvbW_7-3FDWi2wWgtD3',
    '1pUoa7BhUYjegbvU1J3dSZlwtxHPQgaK4',
    '1etROfBIPLu2sH0dRH278zPYRuRwqdr8T',
    '1fsopmQHT1NbHRWKi1lt3WUQf1PhBcUpa',
    '1sL2VFKqdh4gVgciJ2lstvEOt7NJBcnnz',
    '1lY1vo4IWs5Dvp9QhY2wkl4EmJi0LpNvM',
    '1ClOzil_VRNBDwtoo9vUPsyBFsxKNgxEF',
    '18PnG25LnGLYoPJhj_mYgovcBC7J71ZAD',
    '1S2OyPFldCyfu8pohMtZ4MsxSnMOwHW6O',
    '1l_dmo_78w2p7HmAs6OS5t-RI06-Rs4Dx',
    '1FtVKdN36eqa-fW6dH3LUUw39rLPPq07I',
    '1zFm42Z7Syu-JlpUx9425js_xjDrE8syQ',
    '1vvLcbydYzJIhyyPoqabvbaukkZROLmDS',
    '1-qGuBPfefEtVtO7owAUK6Zz1AE4AD0tm',
    '1H-gseAMM7PI-iBGO4MSt0UQ5iKP6sJlt',
    '11Y3lrhZ9DtgaHnQpw-1I2ahkN8jKOCkz',
    '1bl0BTGjajZ9ueUavaTWkeriXogMHJcZX',
    '1Le5ETRqxYpb_uVUPhyHSB0if_DeacKRm',
    '1l3RREIReuuSUde1dYXPFS45Vlzpi5isG',
    '12ZY57j_paVCptgJVtt3bv6npKInnujsK',
    '16gjY4mqqtJCybE3gMaCvhAo-GTt3_CB4',
    '1ikLLURrYIIW7YXpRq0PLp9PBrnTQ3eau',
    '1UjrNgEbIWIXo7j_Ep761jH6w7nDLBAVq',
    '10o58v7i70lAoi32S2rBvXyvESs51BTKL',
    '1nbVtZKGFGY72fA5NuGtjG5Ie5VtU0Hh4',
    '1R9n5BlJiT2DWqoxUOkqBMBiW0IKZpeGp',
    '1OrSTAc8mvtMojlhhr7qDC80IdUbQUfbo',
    '126r-VS-gSjd-34_Ul6_lagBaWd9PxA2y',
    '1Y4-a2-FbDFKjqKp_faO2van_ovOPh4WO',
    '1XLxMHhkTZJA14TtcQRtx5Qb3Q7-66hlD',
    '1wUFHUebtVeLkYiPIqXZ4l2yFBzZR9i7u',
    '19-QEi-Qq-6KHNCS1F8PEnX-wEv6q9B-2',
    '1Q662sS1tDuLkVel_cT61W61950eU9rhu',
    '14ZKnw9xJkshA_MRMUACUpzBLHcChRl9W',
    '1-3yRKm_4fopnBqMscRLAmzBGIQZK_BW5',
    '1swAtFBOygZy3ms0ySZ7yvDpm1Xn5G7na',
    '1ydiHw-YJpAp-JNaZcr5G-YQc-x5_XoDD',
    '1YUAEkB2FzhW4CPbvQR2c5Z2R-zDDX7lN',
    '1iZCcWN-98WDqeW_YgSQZwoxhYE4Ga8fg',
    '1ZXUNvRZa0f_kV7dI6fDnGPYcolutYAgj',
    '1D3ee9iQ3T4SkirN5htN9NaXe0CAUTej4',
    '1K3Sb_R7x422997RfklIaXB2ZLlf8G1os',
    '1oQ8dolALeXtMA4fQPBbhi21KR9TOZpVm',
    '1o-0xrrJAvEdGapAPIA4Irq3Rxc0dppV1',
    '15R0BgWXF9b4bOkG-aqDHfYqzY74WCT72',
    '18dAbGKW2TtyFpYFennpcz_e-DcIQ2tmr',
    '1ImGTCZ9F6VBXUeRbEQAw2O4XHZ8yuNte',
    '1aAZV3uYgdl0w1-oz3Vh2gC_JKdSxKktO',
    '1saZMh2z9o9hxyJ76UgZmJ811wkaIafHs',
    '1lBR3xaa95Swan3stkscAgfW5YoyzGRmE',
    '18NR0PqNhYxUeVoqA9-XhycxjGjoZ-pIc',
    '1GmKkRgFFsDicC-O9Lq7bQ-E2VK1HqCbh',
    '1UWmnxyzUCCpjqFBSzyZgXV3uQbsXan_7',
    '1QfvA-nAlZzjop9bWKyZwQCEf-1qhaRXx',
    '1ytIzLY2Zdqny2gxTJPnQ5oqK9H5dANNF',
    '1o1dosQer6lbprdNPkYjIrSW-B3tOk1_J',
    '1OXoXh0v78AN0OsINeAiTDBu9RDa-QkUD',
    '1TmlLmqfUEM-ugDh48nhizzVZTS4CDnuk',
    '1cEJxuAlMy_89ofKwbJ6W29-REy8H6RRp',
    '1s1yAuTEHJiCCUMB4T_Z51iT59gJECLo1',
    '17DYEt06VxH40akfHn4fe3489pX3tnpUJ',
    '18U1bcd4bxviIgqOPYhlq7viEQcmRJa7e',
    '12Xt7UI-p_SurHS3uikyOw3wvp1c_-UUV',
    '1iwq_IWWHy6Y6qiHfZgJdX6Pz-PHNbgk5',
    '1nIcbYbe3GwIe-MvoBK5xlamxu4_hrlre',
    '1DeJP4cSQ95Vn-oAgpKZh2rVhWsNDcymd',
    '1IYZ8XT_T8zJ2CUA95dHPa_1yndA3eKNW',
    '1Ruog76PpZRVZZ9xv7_myz3lmnRl6505a',
  ],
  puglia:   [],
};

// ─── Search batches (max 3 cities OR 3 hotels per search) ────────────────────
// Each entry has either:
//   cities: [...] — searches by area/city name via the cityNames[] Select2
//   hotels: [...] — searches by specific hotel name via the hotels[] Select2
// The portal enforces a max of 3 items per search submission.

const SEARCH_BATCHES = [
  // ── LAGHI ───────────────────────────────────────────────────────────────────
  {
    destination: 'laghi',
    label: 'Lake Maggiore',
    cities: ['LAGO MAGGIORE'],
  },
  {
    destination: 'laghi',
    label: 'Como / Lake Como / Lecco',
    cities: ['COMO', 'LAGO DI COMO', 'LECCO'],
  },
  {
    destination: 'laghi',
    label: 'Lake Garda (full lake — post-process for SW shore)',
    cities: ['LAGO DI GARDA'],
  },
  {
    destination: 'laghi',
    label: 'Cantù / Montano Lucino hotels',
    hotels: ['COMO HILLS HOTEL - COMO', 'HOTEL CANTURIO - CANTU - COMO', 'HOTEL CRUISE - MONTANO LUCINO - COMO'],
  },
  {
    destination: 'laghi',
    label: 'Como area specific hotels',
    hotels: ['AXOLUTE COMFORT - LAKE COMO', 'INVERIGO HOTEL - INVERIGO - COMO', 'REDS RADAELLI - LECCO'],
  },

  // ── TOSCANA ─────────────────────────────────────────────────────────────────
  {
    destination: 'toscana',
    label: 'Firenze / Fiesole / Impruneta',
    cities: ['FIRENZE', 'FIESOLE', 'IMPRUNETA'],
  },
  {
    destination: 'toscana',
    label: 'Arezzo / Chianciano Terme / Lucca',
    cities: ['AREZZO', 'CHIANCIANO TERME', 'LUCCA'],
  },
  {
    destination: 'toscana',
    label: 'Asciano / Siena',
    cities: ['ASCIANO', 'SIENA'],
  },
  {
    destination: 'toscana',
    label: 'Reggello / Rignano sull\'Arno',
    cities: ['REGGELLO', 'RIGNANO SULL\'ARNO'],
  },
  {
    destination: 'toscana',
    label: 'Val di Cecina / Montecatini Terme',
    cities: ['MONTECATINI VAL DI CECINA', 'MONTECATINI TERME'],
  },
  {
    destination: 'toscana',
    label: 'Volterra',
    cities: ['VOLTERRA'],
  },

  // ── SARDEGNA ────────────────────────────────────────────────────────────────
  {
    destination: 'sardegna',
    label: 'Alghero / Castelsardo / Stintino',
    cities: ['ALGHERO', 'CASTELSARDO', 'STINTINO'],
  },
  {
    destination: 'sardegna',
    label: 'Arzachena / Olbia / Porto Rotondo',
    cities: ['ARZACHENA', 'OLBIA', 'PORTO ROTONDO'],
  },
  {
    destination: 'sardegna',
    label: 'Cagliari',
    cities: ['CAGLIARI'],
  },

  // ── LIGURIA ─────────────────────────────────────────────────────────────────
  {
    destination: 'liguria',
    label: 'Alassio / Sanremo / Savona',
    cities: ['ALASSIO', 'SANREMO', 'SAVONA'],
  },
  {
    destination: 'liguria',
    label: 'Ameglia / La Spezia / Portovenere',
    cities: ['AMEGLIA', 'LA SPEZIA', 'PORTOVENERE'],
  },
  {
    destination: 'liguria',
    label: 'Chiavari / Rapallo / Santa Margherita Ligure',
    cities: ['CHIAVARI', 'RAPALLO', 'SANTA MARGHERITA LIGURE'],
  },
];

// ─── Google Drive helper ─────────────────────────────────────────────────────

function getDriveClient() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive'],
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
    supportsAllDrives: true,
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
  const _items = batch.cities || batch.hotels || [];
  console.log(`\n  🔍  ${batch.label} (${_items.length} ${batch.cities ? 'cit' + (_items.length > 1 ? 'ies' : 'y') : 'hotel' + (_items.length > 1 ? 's' : '')})`);

  // ── Step 1: record the existing XLS href on status.php so we can detect
  // when the portal has generated a NEW file for this batch. Without this,
  // we risk downloading a stale result from a previous search.
  let previousXlsHref = null;
  try {
    await page.goto(`${BASE_URL}/status.php`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const existingLink = page.locator('a[href$=".xls"], a[href$=".xlsx"]').first();
    if (await existingLink.count() > 0) {
      previousXlsHref = await existingLink.getAttribute('href').catch(() => null);
      if (previousXlsHref) console.log(`    ℹ Existing XLS on status page: ${previousXlsHref}`);
    }
  } catch (_) { /* status page may be empty on first run */ }

  // ── Step 2: fill the search form on index.php
  await page.goto(`${BASE_URL}/index.php`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // The "Select Hotels" field is a Select2 multi-select widget.
  // The underlying element is <select id="hotels-select">.
  await page.waitForSelector('#hotels-select', { timeout: 15000 });

  // ── Step 2a: set required form fields before hotel selection
  // rooms[0][type] = dbl (double room) — the native <select> is hidden by Select2,
  // so we set it via JavaScript directly instead of page.selectOption.
  await page.evaluate(() => {
    const sel = document.querySelector('select[name="rooms[0][type]"]');
    if (sel) {
      sel.value = 'dbl';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }).catch(e => console.warn('    ⚠ Could not set room type via JS:', e.message));
  console.log('    ✓ Set room type: dbl (via JS)');
  // rooms[0][count] = 5
  await page.fill('input[name="rooms[0][count]"]', '5').catch(e => console.warn('    ⚠ Could not set room count:', e.message));
  // treatments[] = breakfast included — open the Select2 dropdown and pick it
  try {
    const treatmentsSearchBox = page.locator('textarea.select2-search__field[aria-label="Search"]').nth(2);
    await treatmentsSearchBox.click();
    await treatmentsSearchBox.type('breakfast', { delay: 80 });
    await page.waitForFunction(() => {
      const opts = document.querySelectorAll('.select2-results__option');
      return opts.length > 0 && ![...opts].every(o => o.textContent.includes('Searching'));
    }, { timeout: 8000 }).catch(() => null);
    const treatmentOpts = await page.locator('.select2-results__option').all();
    for (const opt of treatmentOpts) {
      const text = (await opt.textContent() || '').toLowerCase();
      if (text.includes('breakfast')) { await opt.click(); break; }
    }
    console.log('    ✓ Set treatment: breakfast');
  } catch (e) { console.warn('    ⚠ Could not set treatment:', e.message); }
  // stars[] = 4
  await page.check('input[name="stars[]"][value="4"]').catch(e => console.warn('    ⚠ Could not set stars:', e.message));
  // checkin / checkout dates
  await page.fill('input[name="checkin"]', '2027-01-01').catch(e => console.warn('    ⚠ Could not set checkin:', e.message));
  await page.fill('input[name="checkout"]', '2027-12-31').catch(e => console.warn('    ⚠ Could not set checkout:', e.message));
  // contract = BESTPRICE
  await page.check('input[name="contract"][value="BESTPRICE"]').catch(e => console.warn('    ⚠ Could not set contract:', e.message));
  console.log('    ✓ Form fields set: rooms=5, type=dbl, board=breakfast, stars=4, contract=BESTPRICE, 2027-01-01→2027-12-31');

  // ── Step 2b: select cities OR hotels in the appropriate Select2 widget
  // city search  → cityNames[] Select2  (nth(0) = cities)
  // hotel search → hotels[]   Select2  (nth(1) = hotels)
  const isCitySearch = Array.isArray(batch.cities) && batch.cities.length > 0;
  const items = isCitySearch ? batch.cities : (batch.hotels || []);
  const widgetIndex = isCitySearch ? 0 : 1;
  const widgetLabel = isCitySearch ? 'city' : 'hotel';
  console.log(`    → Search mode: ${widgetLabel} (${items.length} item${items.length > 1 ? 's' : ''})`);

  let selectedCount = 0;
  for (const itemName of items) {
    console.log(`    → Selecting ${widgetLabel}: ${itemName}`);

    const searchBox = page.locator('textarea.select2-search__field[aria-label="Search"]').nth(widgetIndex);
    await searchBox.click();
    await searchBox.fill('');

    // For cities: search the full name; for hotels: use first word of the name before the dash
    const searchTerm = isCitySearch
      ? itemName.split(' ')[0].substring(0, 15)
      : itemName.split(' - ')[0].trim().split(' ')[0].substring(0, 10);
    console.log(`    → Search term: "${searchTerm}"`);
    await searchBox.type(searchTerm, { delay: 80 });

    await page.waitForFunction(() => {
      const opts = document.querySelectorAll('.select2-results__option');
      return opts.length > 0 && ![...opts].every(o => o.textContent.includes('Searching'));
    }, { timeout: 10000 }).catch(() => null);

    const options = await page.locator('.select2-results__option').all();
    const targetLower = itemName.toLowerCase();
    const targetParts = targetLower.split(' - ').map(s => s.trim());
    let matched = false;

    // Primary match: all parts of the name appear in the option text
    for (const opt of options) {
      const text = (await opt.textContent() || '').trim();
      const textLower = text.toLowerCase();
      if (targetParts.every(part => textLower.includes(part))) {
        await opt.click();
        matched = true;
        selectedCount++;
        console.log(`    ✓ Matched: "${text}"`);
        break;
      }
    }
    // Fallback: first part only
    if (!matched) {
      for (const opt of options) {
        const text = (await opt.textContent() || '').trim();
        const textLower = text.toLowerCase();
        if (textLower.includes(targetParts[0])) {
          await opt.click();
          matched = true;
          selectedCount++;
          console.log(`    ⚠ Partial match: "${text}"`);
          break;
        }
      }
    }
    if (!matched) {
      console.warn(`    ✗ No match for: ${itemName} — skipping`);
    }
    // Close the Select2 dropdown by clicking outside it (top-left corner of page,
    // away from any dropdown options). Escape alone is unreliable in headless mode.
    await page.evaluate(() => {
      const open = document.querySelector('.select2-container--open');
      if (open) {
        // Click the body at a safe coordinate to close the dropdown
        document.body.click();
        // Also dispatch a mousedown on body which Select2 listens to for close
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    });
    await page.waitForTimeout(500);
  }

  // If nothing was selected, skip submission
  if (selectedCount === 0) {
    console.warn(`    ⚠ Nothing selected for batch "${batch.label}" — skipping search submission`);
    return null;
  }

  // ── Step 3: submit and wait for a *new* XLS on status.php
  // The portal submits via AJAX (page does NOT navigate after clicking).
  // Intercept the outgoing request to log exactly what gets posted and what comes back.
  const interceptedRequests = [];
  const reqHandler = async (request) => {
    if (request.method() === 'POST') {
      interceptedRequests.push({ url: request.url(), postData: request.postData() });
    }
  };
  const respHandler = async (response) => {
    if (response.request().method() === 'POST') {
      const body = await response.text().catch(() => '(could not read body)');
      console.log(`    📡 POST response [${response.status()}] ${response.url()}: ${body.substring(0, 500)}`);
    }
  };
  page.on('request', reqHandler);
  page.on('response', respHandler);

  // Log the submit button's outer HTML so we can see exactly what element we're clicking
  const submitBtnHtml = await page.evaluate(() => {
    const btn = document.querySelector('button, input[type="submit"]');
    const allBtns = [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')];
    return allBtns.map(b => b.outerHTML).join('\n');
  });
  console.log(`    🔍 All submit-like elements on page:\n${submitBtnHtml}`);

  console.log('    → Clicking "Schedule search by year"…');
  await page.click('button:has-text("Schedule search by year"), input[value*="Schedule search by year"]');
  console.log('    → Waiting 10s for form POST to complete…');
  await page.waitForTimeout(10000);

  page.off('request', reqHandler);
  page.off('response', respHandler);
  for (const req of interceptedRequests) {
    console.log(`    📤 POST to ${req.url}: ${req.postData}`);
  }
  if (interceptedRequests.length === 0) {
    console.warn('    ⚠ No POST request detected after button click — button may not be submitting');
  }

  // Poll for an XLS link that is DIFFERENT from the one we recorded before the search.
  // This ensures we download the result of THIS search, not a previous one.
  // The portal takes ~2.5 hours to process, so we reload status.php every 30s
  // rather than relying on the page to auto-update, with a 4-hour total timeout.
  console.log('    → Waiting for new XLS download link on status page…');
  const POLL_INTERVAL_MS = 30000;   // reload status.php every 30 seconds
  const POLL_TIMEOUT_MS  = 14400000; // 4 hours total timeout
  const pollStart = Date.now();
  let newXlsHref = null;
  while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
    await page.goto(`${BASE_URL}/status.php`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const link = page.locator('a[href$=".xls"], a[href$=".xlsx"]').first();
    if (await link.count() > 0) {
      const href = await link.getAttribute('href').catch(() => null);
      if (href && href !== previousXlsHref) {
        newXlsHref = href;
        console.log(`    ✓ XLS found: ${href}`);
        break;
      }
    }
    const elapsed = Math.round((Date.now() - pollStart) / 60000);
    console.log(`    ⏳ No new XLS yet (${elapsed}m elapsed) — checking again in 30s…`);
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  if (!newXlsHref) {
    throw new Error(`Timeout waiting for new XLS after ${POLL_TIMEOUT_MS / 60000} minutes`);
  }

  // We're already on status.php (last reload in the poll loop) with the new XLS visible.
  const downloadLink = page.locator(`a[href="${newXlsHref}"]`).first();

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

async function runScraper(targetDestination = null, startFrom = 0, endAt = null) {
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

    let batches = targetDestination
      ? SEARCH_BATCHES.filter(b => b.destination === targetDestination)
      : SEARCH_BATCHES;

    // Apply from/to slice for splitting long runs
    const totalBatches = batches.length;
    batches = batches.slice(startFrom, endAt !== null ? endAt : undefined);

    console.log(`\n📋  Running ${batches.length} of ${totalBatches} batch(es) (from=${startFrom}, to=${endAt ?? totalBatches})…`);

    for (const batch of batches) {
      try {
        const batchResult = await runBatch(page, batch, DOWNLOAD_DIR);

        // If all hotels were skipped, runBatch returns null — nothing to upload
        if (!batchResult) {
          console.log(`  ⏭  Batch "${batch.label}" skipped — no hotels matched`);
          continue;
        }

        const { filePath, fileName } = batchResult;

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

// GET /proposal/:dest?sale=VP+Flash+Jan+2027  → build VP proposal only (no scrape, no stop sale)
app.get('/proposal/:destination?', async (req, res) => {
  const dest     = req.params.destination || 'laghi';
  const saleName = req.query.sale || null;
  const runDate  = new Date().toISOString().slice(0, 10);
  console.log(`\n📊  VP proposal triggered — destination: ${dest}, sale: ${saleName || '(none)'}`);
  res.json({ status: 'started', destination: dest, sale: saleName, ts: new Date().toISOString() });

  const vpFolder = VP_FOLDERS[dest];
  const ssIds    = PROPOSAL_SS_IDS[dest];

  if (!vpFolder) {
    console.log(`  ⚠  No VP folder configured for ${dest} — set VP_2027_FOLDER_${dest.toUpperCase()} env var`);
    return;
  }
  if (!ssIds || ssIds.length === 0) {
    console.log(`  ⚠  No source spreadsheet IDs for ${dest} — populate PROPOSAL_SS_IDS.${dest} in scraper.js`);
    return;
  }

  buildPackageProposal(dest, ssIds, vpFolder, runDate, saleName)
    .then(file => {
      if (file) console.log(`\n📋  VP proposal ready (${dest}): ${file.webViewLink}`);
    })
    .catch(err => console.error(`Package proposal error (${dest}):`, err.message));
});

// GET /stopsale/:dest?sale=VP+Flash+Jan+2027  → build stop sale report only (no scrape)
app.get('/stopsale/:destination?', async (req, res) => {
  const dest      = req.params.destination || 'laghi';
  const saleName  = req.query.sale || null;
  const runDate   = new Date().toISOString().slice(0, 10);
  const rateFolder = DRIVE_FOLDERS[dest];
  const vpFolder   = VP_FOLDERS[dest];
  console.log(`\n🛑  Stop sale triggered — destination: ${dest}, sale: ${saleName || '(none)'}`);
  res.json({ status: 'started', destination: dest, sale: saleName, ts: new Date().toISOString() });

  if (!rateFolder || !vpFolder) {
    console.log(`  ⚠  Drive folder IDs not configured for ${dest}`);
    return;
  }

  buildStopSaleReport(dest, rateFolder, vpFolder, runDate, saleName)
    .then(file => {
      if (file) console.log(`\n🛑  Stop sale report ready (${dest}): ${file.webViewLink}`);
    })
    .catch(err => console.error(`Stop sale report error (${dest}):`, err.message));
});

// Global lock — only one scrape (or stopsale/proposal) may use the browser at a time.
// If a second /run request arrives while one is in progress, it is queued and will
// start automatically once the current scrape finishes.
let scrapeQueue = Promise.resolve();

app.get('/run/:destination?', async (req, res) => {
  const dest = req.params.destination || null;
  const startFrom = parseInt(req.query.from || '0', 10) || 0;
  const endAt     = req.query.to !== undefined ? (parseInt(req.query.to, 10) || null) : null;
  const skipProposal = req.query.proposal === 'false';

  console.log(`\n🚀  Scrape triggered — destination: ${dest || 'ALL'}, from=${startFrom}, to=${endAt ?? 'end'}, proposal=${!skipProposal}`);
  res.json({ status: 'queued', destination: dest || 'all', from: startFrom, to: endAt, ts: new Date().toISOString() });

  // Chain onto the global queue so concurrent /run requests run sequentially
  scrapeQueue = scrapeQueue.then(() => runScraper(dest, startFrom, endAt))
    .then(async ({ results, errors }) => {
      console.log(`\n✅  Scrape complete. ${results.length} succeeded, ${errors.length} failed.`);
      if (errors.length) console.error('Errors:', errors);

      // Skip post-processing if ?proposal=false (not the final chunk of a split run)
      if (skipProposal) return;

      const runDate = new Date().toISOString().slice(0, 10);
      const saleName = req.query.sale || null;  // e.g. ?sale=VP+Flash+Jan+2027

      // Destinations to process (run for the requested dest, or all if unspecified)
      const destinations = dest ? [dest] : ['laghi','toscana','sardegna','liguria','puglia'];

      for (const d of destinations) {
        const vpFolder   = VP_FOLDERS[d];
        const rateFolder = DRIVE_FOLDERS[d];

        // 1. Build VP package proposal (uses Google Sheets as source for Laghi;
        //    XLS Drive files as source for other destinations when IDs are available)
        if (vpFolder && PROPOSAL_SS_IDS[d] && PROPOSAL_SS_IDS[d].length > 0) {
          console.log(`\n📊  Building VP 2027 package proposal — ${d}…`);
          try {
            const proposalFile = await buildPackageProposal(d, PROPOSAL_SS_IDS[d], vpFolder, runDate, saleName);
            if (proposalFile) console.log(`\n📋  VP proposal ready (${d}): ${proposalFile.webViewLink}`);
          } catch (err) {
            console.error(`Package proposal error (${d}):`, err.message);
          }
        } else {
          console.log(`\n📊  Skipping proposal for ${d} — no source spreadsheet IDs configured yet`);
        }

        // 2. Build stop sale report (reads XLS files from Drive rate folder)
        if (rateFolder && vpFolder) {
          console.log(`\n🛑  Building stop sale report — ${d}…`);
          try {
            const ssFile = await buildStopSaleReport(d, rateFolder, vpFolder, runDate, saleName);
            if (ssFile) console.log(`\n🛑  Stop sale report ready (${d}): ${ssFile.webViewLink}`);
          } catch (err) {
            console.error(`Stop sale report error (${d}):`, err.message);
          }
        } else {
          console.log(`\n🛑  Skipping stop sale for ${d} — Drive folder IDs not configured`);
        }
      }
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
