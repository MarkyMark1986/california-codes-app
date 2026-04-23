'use strict';

// ── State ────────────────────────────────────────────────
const State = {
  allSections:      [],   // flat array of all section objects
  filteredSections: [],   // current search/filter result
  activeCode:       'ALL',
  searchQuery:      '',
  isOnline:         navigator.onLine,
  searchIndex:      null, // Map: keyword -> Set<sectionIndex>
  pendingSub:       null, // subsection qualifier (e.g. 'f') to highlight on next openDetail
  activeCategory:   null  // { id, label } of the currently active browse category
};

const MAX_RENDER = 200; // cap DOM nodes; prompt user to refine past this

// Code mappings
const CODE_TO_UI   = { PEN: 'PC', VEH: 'VC', HSC: 'H&S', BPC: 'B&P', EMC: 'EMC', WIC: 'WI' };
const CLASS_LABEL  = {
  'felony':             'Felony',
  'misdemeanor':        'Misd.',
  'infraction':         'Infraction',
  'felony/misdemeanor': 'Wobbler',
  'unknown':            ''
};

// ── Browse categories ─────────────────────────────────────
// Each category has section-number ranges per code.
// Ranges are inclusive: parseFloat(sectionNumber) >= min && <= max.
const CATEGORIES = [
  {
    id: 'persons', label: 'Crimes Against Persons',
    sub: 'homicide · assault · battery · robbery · kidnapping',
    accent: '#B91C1C',
    ranges: [
      { code: 'PEN', min: 187,   max: 199.9  },  // murder, manslaughter
      { code: 'PEN', min: 203,   max: 206.9  },  // mayhem
      { code: 'PEN', min: 207,   max: 210.9  },  // kidnapping
      { code: 'PEN', min: 211,   max: 215.9  },  // robbery, carjacking
      { code: 'PEN', min: 217.1, max: 225.9  },  // assault on officials
      { code: 'PEN', min: 240,   max: 248.9  },  // assault & battery
      { code: 'PEN', min: 422,   max: 422.9  },  // criminal threats
      { code: 'PEN', min: 646.9, max: 647    },  // stalking
    ]
  },
  {
    id: 'sex', label: 'Sex Crimes',
    sub: 'rape · lewd acts · sex offender registration',
    accent: '#C2410C',
    ranges: [
      { code: 'PEN', min: 261,   max: 269.9  },  // rape, sexual assault
      { code: 'PEN', min: 286,   max: 290.9  },  // sodomy, oral copulation, registration
      { code: 'PEN', min: 311,   max: 313.9  },  // obscene material
      { code: 'PEN', min: 647.6, max: 647.69 },  // annoying/molesting child
    ]
  },
  {
    id: 'property', label: 'Property Crimes',
    sub: 'burglary · theft · arson · vandalism · graffiti',
    accent: '#B45309',
    ranges: [
      { code: 'PEN', min: 451,   max: 457.9  },  // arson
      { code: 'PEN', min: 459,   max: 470.9  },  // burglary
      { code: 'PEN', min: 484,   max: 502.9  },  // theft (petty & grand), embezzlement
      { code: 'PEN', min: 594,   max: 598.9  },  // vandalism, malicious mischief
      { code: 'PEN', min: 666,   max: 666.9  },  // petty theft with prior
      { code: 'EMC', min: 131.1, max: 131.29 },  // graffiti
    ]
  },
  {
    id: 'drugs', label: 'Drug Offenses',
    sub: 'possession · sale · manufacturing · paraphernalia',
    accent: '#065F46',
    ranges: [
      { code: 'HSC', min: 11053, max: 11058.9 },  // controlled substance schedules
      { code: 'HSC', min: 11150, max: 11165.9 },  // prescriptions
      { code: 'HSC', min: 11350, max: 11395.9 },  // narcotics - possession & sale
      { code: 'HSC', min: 11364, max: 11382.9 },  // paraphernalia, stimulants
      { code: 'HSC', min: 11550, max: 11552.9 },  // under influence
      { code: 'BPC', min: 4060,  max: 4068.9  },  // prescription regulations
      { code: 'BPC', min: 4140,  max: 4145.9  },  // hypodermic devices
      { code: 'EMC', min: 94.53, max: 94.54   },  // syringes / sharps
    ]
  },
  {
    id: 'weapons', label: 'Weapons Offenses',
    sub: 'firearms · brandishing · prohibited persons · illegal weapons',
    accent: '#374151',
    ranges: [
      { code: 'PEN', min: 245,   max: 247.9   },  // assault with deadly weapon / shooting
      { code: 'PEN', min: 417,   max: 418.9   },  // brandishing
      { code: 'PEN', min: 25100, max: 26915.9 },  // carry, possession, dealer regs
      { code: 'PEN', min: 29800, max: 29830.9 },  // prohibited persons with firearms
      { code: 'PEN', min: 30305, max: 30306.9 },  // ammunition restrictions
      { code: 'PEN', min: 32625, max: 32625.9 },  // machine guns
      { code: 'PEN', min: 33215, max: 33215.9 },  // short-barreled rifles/shotguns
      { code: 'EMC', min: 133.0, max: 133.9999},  // municipal weapons regulations
    ]
  },
  {
    id: 'dui', label: 'DUI & Impaired Driving',
    sub: 'DUI · reckless driving · BAC · prior convictions',
    accent: '#1D4ED8',
    ranges: [
      { code: 'VEH', min: 23103, max: 23115.9 },  // reckless driving
      { code: 'VEH', min: 23136, max: 23249.9 },  // DUI - all provisions
      { code: 'VEH', min: 23550, max: 23566.9 },  // DUI priors / repeat offenders
      { code: 'VEH', min: 31301, max: 31305.9 },  // open container
    ]
  },
  {
    id: 'moving', label: 'Moving Violations',
    sub: 'speed · signals · right-of-way · hit & run · evading',
    accent: '#0369A1',
    ranges: [
      { code: 'VEH', min: 2800,  max: 2818.9  },  // evading officer
      { code: 'VEH', min: 20001, max: 20012.9 },  // hit and run
      { code: 'VEH', min: 21453, max: 21469.9 },  // traffic signals
      { code: 'VEH', min: 21650, max: 21720.9 },  // lanes, passing
      { code: 'VEH', min: 21800, max: 21812.9 },  // right of way
      { code: 'VEH', min: 21950, max: 21963.9 },  // pedestrian right of way
      { code: 'VEH', min: 22100, max: 22122.9 },  // turning & U-turns
      { code: 'VEH', min: 22349, max: 22413.9 },  // speed
    ]
  },
  {
    id: 'equipment', label: 'Equipment Violations',
    sub: 'lights · brakes · seatbelts · windows · exhaust',
    accent: '#0C4A6E',
    ranges: [
      { code: 'VEH', min: 24000, max: 24018.9 },  // general equipment
      { code: 'VEH', min: 24400, max: 24413.9 },  // lighting
      { code: 'VEH', min: 26300, max: 26311.9 },  // brakes
      { code: 'VEH', min: 26700, max: 26714.9 },  // windows / windshield
      { code: 'VEH', min: 27150, max: 27165.9 },  // muffler / exhaust
      { code: 'VEH', min: 27315, max: 27366.9 },  // seatbelts & child seats
      { code: 'VEH', min: 27800, max: 27804.9 },  // motorcycle equipment
    ]
  },
  {
    id: 'tow', label: 'Tow Authorities',
    sub: 'vehicle removal · impound · storage · lien sale',
    accent: '#1E3A5F',
    ranges: [
      { code: 'VEH', min: 10750, max: 10757.9 },  // vehicle identification
      { code: 'VEH', min: 14600, max: 14612.9 },  // suspended / unlicensed - impound
      { code: 'VEH', min: 22650, max: 22712.9 },  // vehicle removal from highway
      { code: 'VEH', min: 22850, max: 22856.9 },  // impound authority
      { code: 'EMC', min: 90.0,  max: 90.9999 },  // abandoned / stored vehicles
    ]
  },
  {
    id: 'fraud', label: 'Fraud & Financial Crimes',
    sub: 'forgery · identity theft · extortion · false pretenses',
    accent: '#6B21A8',
    ranges: [
      { code: 'PEN', min: 470,   max: 483.9   },  // forgery, counterfeiting
      { code: 'PEN', min: 484,   max: 502.9   },  // theft by fraud, embezzlement
      { code: 'PEN', min: 518,   max: 527.9   },  // extortion, blackmail
      { code: 'PEN', min: 530,   max: 538.9   },  // identity theft, impersonation
      { code: 'BPC', min: 17200, max: 17210.9 },  // unfair business practices
      { code: 'BPC', min: 17500, max: 17510.9 },  // false advertising
    ]
  },
  {
    id: 'public-order', label: 'Public Order & Nuisance',
    sub: 'disorderly conduct · trespass · riot · noise · disturbing peace',
    accent: '#0F766E',
    ranges: [
      { code: 'PEN', min: 370,   max: 375.9   },  // public nuisance
      { code: 'PEN', min: 404,   max: 420.9   },  // riot, unlawful assembly
      { code: 'PEN', min: 594,   max: 600.9   },  // vandalism / interference
      { code: 'PEN', min: 602,   max: 603.9   },  // trespass
      { code: 'PEN', min: 626,   max: 632.9   },  // schools, eavesdropping
      { code: 'PEN', min: 647,   max: 651.9   },  // disorderly conduct
      { code: 'EMC', min: 94.02, max: 94.03   },  // noise / sound amplification
      { code: 'EMC', min: 130.0, max: 130.9999},  // public peace / disturbance
      { code: 'EMC', min: 131.3, max: 131.9999},  // trespass / private property
      { code: 'EMC', min: 132.15,max: 132.9999},  // prohibited public conduct
      { code: 'EMC', min: 134.0, max: 134.9999},  // chronic nuisance
      { code: 'WIC', min: 625,   max: 625.9   },  // minor found in public - curfew
      { code: 'WIC', min: 628,   max: 628.9   },  // minor - peace officer contact
      { code: 'WIC', min: 777,   max: 777.9   },  // minor - violation of court order
    ]
  },
  {
    id: 'dv', label: 'Domestic Violence',
    sub: 'corporal injury · protective orders · stalking',
    accent: '#BE123C',
    ranges: [
      { code: 'PEN', min: 136.1, max: 136.99 },  // dissuading a witness / victim
      { code: 'PEN', min: 243,   max: 243.9  },  // battery (includes 243(e) domestic)
      { code: 'PEN', min: 273.5, max: 273.79 },  // corporal injury to spouse / cohabitant
      { code: 'PEN', min: 422,   max: 422.9  },  // criminal threats
      { code: 'PEN', min: 646.9, max: 647    },  // stalking
    ]
  },
  {
    id: 'children', label: 'Crimes Against Children',
    sub: 'abuse · neglect · lewd acts · child abduction · dependency',
    accent: '#7C3AED',
    ranges: [
      { code: 'PEN', min: 270,   max: 273.4  },  // child neglect, contributing
      { code: 'PEN', min: 273.4, max: 273.9  },  // child abuse / endangerment
      { code: 'PEN', min: 278,   max: 280.9  },  // child abduction / custody
      { code: 'PEN', min: 288,   max: 289.9  },  // lewd acts, sexual abuse of child
      { code: 'PEN', min: 311,   max: 313.9  },  // obscene material - minors
      { code: 'PEN', min: 647.6, max: 647.69 },  // annoying / molesting child
      { code: 'WIC', min: 300,   max: 308.9  },  // dependency - abuse & neglect
    ]
  },
  {
    id: 'mental-health', label: 'Mental Health Holds',
    sub: 'WIC 5150 · 72-hour hold · 14-day hold · conservatorship',
    accent: '#0D9488',
    ranges: [
      { code: 'WIC', min: 5150,  max: 5152.9 },  // 5150-5152: 72-hour evaluation & treatment
      { code: 'WIC', min: 5250,  max: 5259.9 },  // 5250: 14-day intensive treatment hold
      { code: 'WIC', min: 5300,  max: 5309.9 },  // 5300: 180-day post-cert treatment
    ]
  },
  {
    id: 'juvenile', label: 'Juvenile Offenses',
    sub: 'delinquency · status offenses · probation violations · fitness',
    accent: '#7E22CE',
    ranges: [
      { code: 'WIC', min: 601,   max: 602.9  },  // 601 status offenses; 602 delinquency
      { code: 'WIC', min: 707,   max: 707.9  },  // fitness hearing - adult prosecution
      { code: 'EMC', min: 130.04,max: 130.08 },  // curfew / youth in public
    ]
  },
  {
    id: 'animal', label: 'Animal Control',
    sub: 'licensing · dangerous animals · cruelty · at-large',
    accent: '#92400E',
    ranges: [
      { code: 'EMC', min: 91.0,  max: 91.9999},  // animal control ordinances
    ]
  },
];

// User-typed code aliases → internal JSON code value
const CODE_ALIASES = {
  'pc': 'PEN', 'pen': 'PEN', 'penal': 'PEN',
  'vc': 'VEH', 'veh': 'VEH', 'vehicle': 'VEH',
  'hs': 'HSC', 'h&s': 'HSC', 'hsc': 'HSC', 'health': 'HSC', 'has': 'HSC',
  'bp': 'BPC', 'b&p': 'BPC', 'bpc': 'BPC', 'business': 'BPC',
  'wi': 'WIC', 'wic': 'WIC', 'welfare': 'WIC'
};

// ── Bootstrap ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupOfflineListeners();
  setupSearchListeners();
  setupFilterListeners();
  setupDetailListeners();
  setupCategoryListeners();
  buildCategoriesOverlay();
  loadData();
});

// ── Service worker ───────────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.warn('SW registration failed:', err));
  }
}

// ── Data loading ─────────────────────────────────────────
async function loadData() {
  try {
    const response = await fetch('./ca_codes.json?v=6');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();

    // Flatten nested structure: { codes: { PEN: { sections: [] }, ... } }
    State.allSections = Object.values(raw.codes).flatMap(c => c.sections);

    // Precompute index and lowercase fields for fast search
    State.allSections.forEach((s, idx) => {
      s._idx       = idx;
      s._textLower = (s.text     || '').toLowerCase();
      s._kwLower   = (s.keywords || '').toLowerCase();
    });

    buildSearchIndex(State.allSections);

    document.getElementById('loading').hidden = true;
    document.getElementById('results-count').hidden = false;

    State.filteredSections = State.allSections;
    renderResults([]);
    updateCount(State.allSections.length, State.allSections.length);

  } catch (err) {
    console.error('Failed to load ca_codes.json:', err);
    document.getElementById('loading').innerHTML =
      '<p>Failed to load code database. Please refresh.</p>';
  }
}

// ── Search index ─────────────────────────────────────────
function buildSearchIndex(sections) {
  const index = new Map();
  sections.forEach((s, idx) => {
    if (!s.keywords) return;
    s.keywords.split(',').forEach(kw => {
      kw = kw.trim().toLowerCase();
      if (!kw) return;
      if (!index.has(kw)) index.set(kw, new Set());
      index.get(kw).add(idx);
    });
  });
  State.searchIndex = index;
}

// ── Query parser ─────────────────────────────────────────
/**
 * Parses raw user input into a typed query object.
 *
 * Section lookups:  "187"  "PC 187"  "PC647"  "vc 23152"  "23152 vc"
 *                   "11350 h&s"  "647(f)"  "PC 647(f)"  "PC 647(b)(2)(A)"
 * Keyword lookups:  "murder"  "DUI"  "receiving stolen"
 *
 * Returns: { type: 'section', num, code, sub } | { type: 'keyword', query }
 *   sub: array of lowercase subsection levels e.g. ['b','2','a'] or null
 */
function parseQuery(input) {
  const s = input.trim();
  if (!s) return null;

  // Extract all subsection qualifiers in order — "(b)(2)(A)" → ['b','2','a']
  const subMatches = [...s.matchAll(/\(([a-z0-9]+)\)/gi)];
  const sub = subMatches.length > 0 ? subMatches.map(m => m[1].toLowerCase()) : null;

  // Strip all parenthesised qualifiers so the number patterns stay simple
  const bare = s.replace(/\s*\([^)]*\).*/i, '').trim();

  let m;

  // [code][space][number]  e.g. "PC 647", "H&S 11550"
  m = /^([a-z][a-z&]*)\s+(\d[\d.]*)$/i.exec(bare);
  if (m) {
    const code = CODE_ALIASES[m[1].toLowerCase()];
    if (code) return { type: 'section', num: m[2].replace(/\.$/, ''), code, sub };
  }

  // [code][number] no space  e.g. "vc23152", "PC647"
  m = /^([a-z][a-z&]*)(\d[\d.]*)$/i.exec(bare);
  if (m) {
    const code = CODE_ALIASES[m[1].toLowerCase()];
    if (code) return { type: 'section', num: m[2].replace(/\.$/, ''), code, sub };
  }

  // [number][space][code]  e.g. "23152 vc", "11350 h&s"
  m = /^(\d[\d.]*)\s+([a-z][a-z&]*)$/i.exec(bare);
  if (m) {
    const code = CODE_ALIASES[m[2].toLowerCase()];
    if (code) return { type: 'section', num: m[1].replace(/\.$/, ''), code, sub };
  }

  // Bare number  e.g. "187", "647"
  m = /^(\d[\d.]*)$/.exec(bare);
  if (m) return { type: 'section', num: m[1].replace(/\.$/, ''), code: null, sub };

  // Everything else — use original s (not bare) to preserve the full keyword
  return { type: 'keyword', query: s.toLowerCase() };
}

// ── Search execution ─────────────────────────────────────
function runSearch() {
  const query = State.searchQuery.trim();
  const code  = State.activeCode;

  // Typing a new query clears any active browse category
  if (query && State.activeCategory) {
    State.activeCategory = null;
    updateCategoryBar();
  }

  const pool = code === 'ALL'
    ? State.allSections
    : State.allSections.filter(s => s.code === code);

  if (!query) {
    // If a category is active, show its sections (still filtered by code tab)
    if (State.activeCategory) {
      const catSections = getCategorySections(State.activeCategory.id, pool);
      State.filteredSections = catSections;
      hideNoResults();
      renderResults(catSections);
      updateCount(catSections.length, pool.length);
      return;
    }
    State.filteredSections = pool;
    renderResults([]);
    updateCount(pool.length, pool.length);
    hideNoResults();
    return;
  }

  const parsed = parseQuery(query);
  let results  = [];

  State.pendingSub = null;

  if (parsed.type === 'section') {
    // When the query names a specific code, search that code regardless of the
    // active tab filter so "PC 647(f)" always finds PC even on the VC tab.
    const searchPool = parsed.code
      ? State.allSections.filter(s => s.code === parsed.code)
      : pool;

    const exact   = searchPool.filter(s => s.sectionNumber === parsed.num);
    const partial = exact.length === 0
      ? searchPool.filter(s => s.sectionNumber.startsWith(parsed.num))
      : [];

    results = exact.length ? exact : partial;
    if (results.length > 0) State.pendingSub = parsed.sub;

  } else {
    results = keywordSearch(parsed.query, pool);
  }

  State.filteredSections = results;

  if (results.length === 0) {
    renderResults([]);
    showNoResults(query, parsed);
    updateCount(0, pool.length);
  } else {
    hideNoResults();
    renderResults(results);
    updateCount(results.length, pool.length);
  }
}

function keywordSearch(query, pool) {
  const terms = query.split(/\s+/).filter(Boolean);

  // Build a set of matching section indices for each term, then AND them
  let candidateIndices = null;

  terms.forEach(term => {
    const hits = new Set();

    // 1. Inverted index: exact and prefix key matches
    for (const [key, idxSet] of State.searchIndex) {
      if (key.includes(term)) idxSet.forEach(i => hits.add(i));
    }

    // 2. Substring match on full text and keywords (catches things not in index)
    pool.forEach(s => {
      if (s._textLower.includes(term) || s._kwLower.includes(term)) {
        hits.add(s._idx);
      }
    });

    if (candidateIndices === null) {
      candidateIndices = hits;
    } else {
      // AND: keep only sections matching all terms so far
      candidateIndices = new Set([...candidateIndices].filter(i => hits.has(i)));
    }
  });

  if (!candidateIndices || candidateIndices.size === 0) return [];

  // Preserve original pool order; restrict to pool if a code filter is active
  const poolSet = new Set(pool.map(s => State.allSections.indexOf(s)));
  return [...candidateIndices]
    .filter(i => poolSet.has(i))
    .sort((a, b) => a - b)
    .map(i => State.allSections[i]);
}

// ── Rendering ─────────────────────────────────────────────
function renderResults(sections) {
  const list = document.getElementById('results-list');

  const overflow = sections.length > MAX_RENDER;
  const visible  = overflow ? sections.slice(0, MAX_RENDER) : sections;

  const frag = document.createDocumentFragment();

  visible.forEach(s => {
    const art = document.createElement('article');
    art.className = 'section-card';
    art.dataset.id = s.id;
    art.setAttribute('role', 'listitem');
    art.setAttribute('tabindex', '0');
    art.setAttribute('aria-label', `${CODE_TO_UI[s.code] || s.code} section ${s.sectionNumber}`);

    const uiCode  = CODE_TO_UI[s.code] || s.code;
    const label   = CLASS_LABEL[s.offenseClass] || '';
    const preview = escapeHtml((s.text || '').substring(0, 140));
    const hasChapter = s.chapterInfo && s.chapterInfo.trim();

    art.innerHTML = `
      <div class="card-top">
        <span class="section-ref">${uiCode}&nbsp;§${s.sectionNumber}</span>
        <span class="offense-badge badge-${s.offenseClass.replace('/', '-')}">${label}</span>
      </div>
      ${hasChapter ? `<p class="chapter-tag">${escapeHtml(s.chapterInfo)}</p>` : ''}
      <p class="preview">${preview}${s.text.length > 140 ? '…' : ''}</p>
    `;

    frag.appendChild(art);
  });

  list.innerHTML = '';
  list.appendChild(frag);

  if (overflow) {
    const tip = document.createElement('p');
    tip.className = 'refine-tip';
    tip.textContent = `Showing first ${MAX_RENDER} of ${sections.length.toLocaleString()} results — refine your search to narrow down.`;
    list.appendChild(tip);
  }
}

// ── Detail view ───────────────────────────────────────────
function openDetail(sectionId) {
  const s = State.allSections.find(sec => sec.id === sectionId);
  if (!s) return;

  const uiCode = CODE_TO_UI[s.code] || s.code;
  const label  = CLASS_LABEL[s.offenseClass] || '';

  document.getElementById('detail-title').textContent = `${uiCode} §${s.sectionNumber}`;

  const badge = document.getElementById('detail-badge');
  badge.textContent = label;
  badge.className = `offense-badge badge-${s.offenseClass.replace('/', '-')}`;

  // Breadcrumb: Part › Chapter
  const crumbParts = [s.partInfo, s.chapterInfo].filter(Boolean);
  document.getElementById('detail-breadcrumb').textContent = crumbParts.join(' › ');

  const sub = State.pendingSub;   // array of levels like ['b','2','a'], or null
  State.pendingSub = null;

  // Split text into paragraphs, find the target paragraph, then render.
  const paras   = splitSectionText(s.text);
  const hilite  = (sub && sub.length) ? findSubParagraph(paras, sub) : -1;
  document.getElementById('detail-text').innerHTML = renderParas(paras, hilite);

  const link = document.getElementById('source-link');
  if (s.code === 'EMC') {
    link.href = s.sourceUrl || 'https://codelibrary.amlegal.com/codes/eureka/latest/overview';
    link.textContent = 'View on codelibrary.amlegal.com ↗';
  } else {
    link.href = s.sourceUrl || '#';
    link.textContent = 'View on leginfo.legislature.ca.gov ↗';
  }

  const overlay = document.getElementById('detail-overlay');
  overlay.hidden = false;
  overlay.focus();

  // Always reset scroll first; then scroll highlighted paragraph into view.
  const body = overlay.querySelector('.detail-body');
  body.scrollTop = 0;
  if (hilite >= 0) {
    // Double rAF: first frame lets the browser calculate layout after un-hiding
    // the overlay; second frame fires once layout is stable and scroll is reliable.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById('detail-text').querySelector('.sub-highlight');
        if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      });
    });
  }
  document.body.style.overflow = 'hidden';

  history.pushState({ detail: sectionId }, '', `#${encodeURIComponent(sectionId)}`);
}

function closeDetail() {
  document.getElementById('detail-overlay').hidden = true;
  document.body.style.overflow = '';
  document.getElementById('search-input').focus();
}

/**
 * Splits raw section text into an array of escaped, normalized paragraphs.
 * Inserts paragraph breaks before subsection markers (a), (b), (1) etc.
 * that follow sentence-ending punctuation, avoiding false-splits on
 * mid-sentence references like "subdivision (a) of this section".
 */
function splitSectionText(text) {
  if (!text) return ['(No text available)'];
  let t = escapeHtml(text);
  // Normalize non-breaking spaces — leginfo uses U+00A0 after subdivision markers.
  t = t.replace(/\u00a0/g, ' ');
  // Insert newline before subsection markers following sentence-end punctuation.
  t = t.replace(/([.!;:])\s+(\([a-zA-Z]{1,2}\)|\(\d{1,3}\))[\s\u00a0]/g, '$1\n$2 ');
  return t.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

/**
 * Finds the paragraph index for a nested subsection path.
 *
 * CA legal code text doesn't repeat parent markers — "(b)(2)(A)" appears as
 * separate "(2)" and "(A)" paragraphs following a "(b)" paragraph, not as
 * the literal string "(b)(2)(A)".
 *
 * Algorithm: walk each level sequentially — find "(b)", then find the next
 * "(2)" after it, then find the next "(A)" after that.  A scope fence prevents
 * the search from drifting past sibling sections: when looking for "(2)" inside
 * "(b)", the search stops if it encounters another same-type marker (e.g. "(c)")
 * before finding "(2)".  When the target level isn't found (or is out of scope),
 * the function returns the index of the deepest level that was successfully
 * reached, so "(b)(1)" falls back to highlighting "(b)" when a standalone "(1)"
 * paragraph isn't found under (b) (e.g. because "(b) (1) text" is one paragraph).
 *
 * @param {string[]} paras  - paragraph array from splitSectionText
 * @param {string[]} levels - e.g. ['b','2','a'] from "(b)(2)(A)"
 * @returns {number} paragraph index to highlight, or -1 if nothing found
 */
function findSubParagraph(paras, levels) {
  let start  = 0;
  let target = -1;

  for (let lvlIdx = 0; lvlIdx < levels.length; lvlIdx++) {
    const lvl = levels[lvlIdx];
    const re  = new RegExp('^\\(' + lvl + '\\)', 'i');

    // Build a scope fence from the parent paragraph's leading marker type.
    // When searching for a child level, stop if we hit a paragraph that starts
    // with a same-type marker as the parent (i.e. we've left the parent's scope).
    let fence = null;
    if (lvlIdx > 0 && target >= 0) {
      const p = paras[target];
      if      (/^\([a-z]\)/ .test(p)) fence = /^\([a-z]{1,2}\)/;   // lowercase parent → stop at next lowercase
      else if (/^\(\d/      .test(p)) fence = /^\(\d{1,3}\)/;       // number parent    → stop at next number
      else if (/^\([A-Z]\)/ .test(p)) fence = /^\([A-Z]{1,2}\)/;    // uppercase parent → stop at next uppercase
    }

    let found = false;
    for (let i = start; i < paras.length; i++) {
      // If this paragraph starts with a same-type sibling of the parent, we've
      // left the parent's scope — stop searching (don't break outer loop yet,
      // just fail this level so we fall back to the previous target).
      if (fence && fence.test(paras[i]) && !re.test(paras[i])) break;
      if (re.test(paras[i])) {
        target = i;
        start  = i + 1;
        found  = true;
        break;
      }
    }
    if (!found) break;  // keep target at deepest level found so far
  }

  return target;
}

/** Renders a paragraph array as HTML, highlighting one paragraph by index. */
function renderParas(paras, hiliteIdx) {
  return paras.map((p, i) =>
    i === hiliteIdx ? `<p class="sub-highlight">${p}</p>` : `<p>${p}</p>`
  ).join('');
}

// ── No-results / live lookup ──────────────────────────────
function showNoResults(query, parsed) {
  const el = document.getElementById('no-results');
  let html = `<p>No results for <strong>${escapeHtml(query)}</strong>.</p>`;

  if (State.isOnline && parsed.type === 'section') {
    const lawCode = parsed.code || inferCode(parsed.num);
    if (lawCode && lawCode !== 'EMC' && lawCode !== 'WIC') {
      const url = `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml`
        + `?sectionNum=${encodeURIComponent(parsed.num)}.&lawCode=${lawCode}`;
      const display = `${CODE_TO_UI[lawCode] || lawCode} §${parsed.num}`;
      html += `<p style="font-size:.85rem;color:var(--text-3);margin-bottom:8px">
                 Not in local database — look up on the official source:
               </p>
               <a href="${url}" target="_blank" rel="noopener noreferrer" class="leginfo-btn">
                 Look up ${escapeHtml(display)} on leginfo
               </a>`;
    }
  } else if (!State.isOnline && parsed.type === 'section') {
    html += `<p style="margin-top:12px;font-size:.85rem;color:var(--text-3)">
               Go online to look up sections not in the local database.
             </p>`;
  }

  el.innerHTML = html;
  el.hidden = false;
}

function hideNoResults() {
  document.getElementById('no-results').hidden = true;
  document.getElementById('no-results').innerHTML = '';
}

/**
 * Best-effort code inference from a bare section number, used only for
 * constructing the leginfo fallback URL.
 */
function inferCode(numStr) {
  if (State.activeCode !== 'ALL') return State.activeCode;
  const n = parseInt(numStr, 10);
  if (isNaN(n)) return 'PEN';
  if (n >= 2800  && n <= 31305) return 'VEH';
  if (n >= 11000 && n <= 25195) return 'HSC';
  if (n >= 4060  && n <= 25668) return 'BPC';
  return 'PEN';
}

// ── Browse categories ─────────────────────────────────────

function buildCategoriesOverlay() {
  const list = document.getElementById('cat-list');
  list.innerHTML = CATEGORIES.map(cat => `
    <button class="cat-item" data-cat-id="${cat.id}"
            style="--cat-accent:${cat.accent}">
      <span class="cat-dot" aria-hidden="true"></span>
      <span class="cat-item-body">
        <span class="cat-item-label">${cat.label}</span>
        <span class="cat-item-sub">${cat.sub}</span>
      </span>
      <span class="cat-arrow" aria-hidden="true">›</span>
    </button>
  `).join('');
}

function setupCategoryListeners() {
  document.getElementById('browse-btn').addEventListener('click', openCategories);
  document.getElementById('cat-back-btn').addEventListener('click', closeCategories);
  document.getElementById('cat-list').addEventListener('click', e => {
    const btn = e.target.closest('.cat-item');
    if (btn) selectCategory(btn.dataset.catId);
  });
  document.getElementById('clear-cat-btn').addEventListener('click', clearCategory);
}

function openCategories() {
  const overlay = document.getElementById('cat-overlay');
  overlay.hidden = false;
  overlay.focus();
  document.body.style.overflow = 'hidden';
}

function closeCategories() {
  document.getElementById('cat-overlay').hidden = true;
  document.body.style.overflow = '';
}

function selectCategory(id) {
  const cat = CATEGORIES.find(c => c.id === id);
  if (!cat) return;
  closeCategories();

  // Clear search input so the category drives results
  const input = document.getElementById('search-input');
  input.value = '';
  State.searchQuery = '';
  document.getElementById('clear-btn').hidden = true;

  State.activeCategory = { id: cat.id, label: cat.label };
  updateCategoryBar();
  runSearch();
}

function clearCategory() {
  State.activeCategory = null;
  updateCategoryBar();
  runSearch();
}

function updateCategoryBar() {
  const bar   = document.getElementById('cat-bar');
  const label = document.getElementById('cat-bar-label');
  if (State.activeCategory) {
    label.textContent = State.activeCategory.label;
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
}

function getCategorySections(catId, pool) {
  const cat = CATEGORIES.find(c => c.id === catId);
  if (!cat) return [];
  return pool.filter(s => {
    const n = parseFloat(s.sectionNumber);
    return cat.ranges.some(r => s.code === r.code && n >= r.min && n <= r.max);
  });
}

// ── Event listeners ───────────────────────────────────────
function setupSearchListeners() {
  const input    = document.getElementById('search-input');
  const clearBtn = document.getElementById('clear-btn');

  const debouncedSearch = debounce(runSearch, 150);

  input.addEventListener('input', () => {
    State.searchQuery = input.value;
    clearBtn.hidden = !input.value;
    debouncedSearch();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    State.searchQuery = '';
    clearBtn.hidden = true;
    input.focus();
    runSearch();
  });
}

function setupFilterListeners() {
  document.querySelector('.filter-row').addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;

    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    State.activeCode = pill.dataset.code;
    runSearch();
  });
}

function setupDetailListeners() {
  // Open detail on card click or Enter key
  document.getElementById('results-list').addEventListener('click', e => {
    const card = e.target.closest('.section-card');
    if (card) openDetail(card.dataset.id);
  });

  document.getElementById('results-list').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('.section-card');
      if (card) { e.preventDefault(); openDetail(card.dataset.id); }
    }
  });

  document.getElementById('back-btn').addEventListener('click', () => {
    history.back();
  });

  // Back button / Android back gesture
  window.addEventListener('popstate', e => {
    if (!e.state?.detail) closeDetail();
  });

  // Swipe right to close on mobile
  setupSwipeToClose();
}

function setupOfflineListeners() {
  const update = () => {
    State.isOnline = navigator.onLine;
    document.getElementById('offline-banner').hidden = State.isOnline;
    const dot = document.getElementById('status-dot');
    dot.className = `status-dot ${State.isOnline ? 'online' : 'offline'}`;
    dot.title = State.isOnline ? 'Online' : 'Offline';
  };
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

// Swipe right on detail overlay to go back (mobile UX)
function setupSwipeToClose() {
  const overlay = document.getElementById('detail-overlay');
  let startX = 0;

  overlay.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
  }, { passive: true });

  overlay.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (dx > 80 && startX < 60) history.back(); // swipe right from left edge
  }, { passive: true });
}

// ── Helpers ───────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateCount(showing, total) {
  const el = document.getElementById('results-count');
  if (State.allSections.length === 0) { el.textContent = ''; return; }
  if (!State.searchQuery) {
    el.textContent = `${total.toLocaleString()} sections loaded — search by number or keyword`;
    return;
  }
  el.textContent = showing === total
    ? `${showing.toLocaleString()} result${showing === 1 ? '' : 's'}`
    : `${showing.toLocaleString()} of ${total.toLocaleString()} sections`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
