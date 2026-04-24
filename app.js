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
const CODE_TO_UI   = { PEN: 'PC', VEH: 'VC', HSC: 'H&S', BPC: 'B&P', EMC: 'EMC', WIC: 'WI', CCR: 'CALCRIM' };
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
  'wi': 'WIC', 'wic': 'WIC', 'welfare': 'WIC',
  'ccr': 'CCR', 'calcrim': 'CCR', 'jury': 'CCR'
};

// CalCrim instruction number lookup: "CODE-section" → CalCrim instruction number
// Auto-generated from CALCRIM 2026 title citations + manual additions
const CALCRIM_MAP = {
  'BPC-25662': '2960', 'BPC-4326': '2412',
  'HSC-11350': '2304', 'HSC-11350.5': '2306', 'HSC-11352': '2300',
  'HSC-11353': '2380', 'HSC-11355': '2315', 'HSC-11357': '2375',
  'HSC-11358': '2370', 'HSC-11359': '2352', 'HSC-11360': '2351',
  'HSC-11361': '2390', 'HSC-11362.1': '3415', 'HSC-11362.5': '3412',
  'HSC-11364': '2410', 'HSC-11365': '2401', 'HSC-11366': '2440',
  'HSC-11368': '2320', 'HSC-11379.6': '2330', 'HSC-11379.8': '3201',
  'HSC-11380': '2383', 'HSC-11383.5': '2337', 'HSC-11395': '2307',
  'HSC-11550': '2400',
  'PEN-118': '2640', 'PEN-136.1': '2622', 'PEN-137': '2610',
  'PEN-138': '2611', 'PEN-140': '2624', 'PEN-141': '2630',
  'PEN-148': '2656', 'PEN-149': '908', 'PEN-166': '2700',
  'PEN-169': '2680', 'PEN-182': '415', 'PEN-186.10': '2997',
  'PEN-186.22': '1400', 'PEN-187': '520', 'PEN-189': '521',
  'PEN-190': '524', 'PEN-190.03': '523', 'PEN-190.2': '700',
  'PEN-191.5': '590', 'PEN-192': '572', 'PEN-203': '801',
  'PEN-205': '800', 'PEN-206': '810', 'PEN-207': '1200',
  'PEN-209': '1203', 'PEN-21': '460', 'PEN-210.5': '1241',
  'PEN-211': '1600', 'PEN-212.5': '1602', 'PEN-213': '1601',
  'PEN-215': '1650', 'PEN-220': '891', 'PEN-236': '1240',
  'PEN-236.1': '1243', 'PEN-240': '861', 'PEN-242': '925',
  'PEN-243.4': '938', 'PEN-244': '877', 'PEN-245': '875',
  'PEN-246': '965', 'PEN-25': '3450', 'PEN-261': '1000',
  'PEN-261.5': '1070', 'PEN-264.1': '1001', 'PEN-266': '1150',
  'PEN-269': '1123', 'PEN-270': '2981', 'PEN-272': '2980',
  'PEN-273': '820', 'PEN-273.5': '840', 'PEN-277': '1250',
  'PEN-285': '1180', 'PEN-286': '1030', 'PEN-287': '1015',
  'PEN-288': '1060', 'PEN-288.3': '1124', 'PEN-288.4': '1125',
  'PEN-288.5': '1120', 'PEN-289': '1045', 'PEN-290': '1170',
  'PEN-311.4': '1144', 'PEN-311.6': '1143', 'PEN-314': '1160',
  'PEN-32': '440', 'PEN-337': '2990', 'PEN-368': '831',
  'PEN-399': '2950', 'PEN-403': '2681', 'PEN-404': '2683',
  'PEN-404.6': '2682', 'PEN-406': '2684', 'PEN-407': '2685',
  'PEN-415': '2689', 'PEN-416': '2687', 'PEN-417': '981',
  'PEN-417.4': '985', 'PEN-417.8': '982', 'PEN-422': '1300',
  'PEN-422.7': '1355', 'PEN-451': '1501', 'PEN-451.5': '1500',
  'PEN-452': '1530', 'PEN-453': '1550', 'PEN-455': '1520',
  'PEN-459': '1700', 'PEN-459.5': '1703', 'PEN-460': '1701',
  'PEN-465': '1705', 'PEN-466': '1704', 'PEN-470': '1900',
  'PEN-475': '1930', 'PEN-476': '1970', 'PEN-480': '1933',
  'PEN-484': '1800', 'PEN-486': '1801', 'PEN-487': '1803',
  'PEN-490.4': '1808', 'PEN-496': '1750', 'PEN-499': '1822',
  'PEN-511': '1863', 'PEN-518': '1830', 'PEN-522': '1832',
  'PEN-523': '1831', 'PEN-529': '2044', 'PEN-530': '2045',
  'PEN-530.5': '2041', 'PEN-550': '2000', 'PEN-591': '2902',
  'PEN-594': '2900', 'PEN-597': '2953', 'PEN-601': '2929',
  'PEN-602': '2930', 'PEN-602.5': '2932', 'PEN-632': '3010',
  'PEN-646.9': '1301', 'PEN-647': '1153', 'PEN-647.6': '1121',
  'PEN-66': '2600', 'PEN-67': '2600', 'PEN-67.5': '2601',
  'PEN-68': '2603', 'PEN-69': '2652', 'PEN-76': '2650',
  'PEN-666': '1850', 'PEN-12022': '3115', 'PEN-12022.5': '3147',
  'PEN-12022.53': '1402', 'PEN-12022.7': '3161',
  'PEN-1025': '3100', 'PEN-1026.2': '3452', 'PEN-1026.5': '3453',
  'PEN-1320': '3002', 'PEN-1320.5': '3001', 'PEN-4502': '2745',
  'PEN-25400': '2520', 'PEN-25800': '2590', 'PEN-25850': '2530',
  'VEH-10801': '1752', 'VEH-10851': '1820', 'VEH-12500': '2221',
  'VEH-12951': '2222', 'VEH-20001': '2141', 'VEH-23103': '2200',
  'VEH-23105': '3223', 'VEH-23109': '2201', 'VEH-23140': '2113',
  'VEH-23152': '2110', 'VEH-23153': '2100', 'VEH-2800.1': '2181',
  'WIC-1800': '3458', 'WIC-6605': '3454A',
};

// ── Commonly encountered codes ────────────────────────────
const QUICK_CODES = [
  { label: 'Crimes Against Persons', accent: '#B91C1C', items: [
    { code: 'PEN', num: '187',   display: 'PC 187',        desc: 'Murder' },
    { code: 'PEN', num: '211',   display: 'PC 211',        desc: 'Robbery' },
    { code: 'PEN', num: '240',   display: 'PC 240/241',    desc: 'Assault' },
    { code: 'PEN', num: '242',   display: 'PC 242/243',    desc: 'Battery' },
    { code: 'PEN', num: '245',   display: 'PC 245',        desc: 'Assault with a deadly weapon' },
    { code: 'PEN', num: '69',    display: 'PC 69',         desc: 'Obstruction / resisting executive officer' },
    { code: 'PEN', num: '243',   display: 'PC 243(e)(1)',  desc: 'Domestic battery',                          sub: ['e','1'] },
    { code: 'PEN', num: '273.5', display: 'PC 273.5',      desc: 'Corporal injury to spouse / cohabitant' },
  ]},
  { label: 'Theft & Property', accent: '#B45309', items: [
    { code: 'PEN', num: '459',   display: 'PC 459',        desc: 'Burglary' },
    { code: 'PEN', num: '484',   display: 'PC 484/488',    desc: 'Petty theft' },
    { code: 'PEN', num: '487',   display: 'PC 487',        desc: 'Grand theft' },
    { code: 'PEN', num: '594',   display: 'PC 594',        desc: 'Vandalism' },
    { code: 'PEN', num: '666.1', display: 'PC 666.1',      desc: 'Shoplifting with prior' },
  ]},
  { label: 'Weapons', accent: '#374151', items: [
    { code: 'PEN', num: '21310', display: 'PC 21310',      desc: 'Concealed dirk or dagger' },
    { code: 'PEN', num: '25400', display: 'PC 25400',      desc: 'Concealed firearm' },
    { code: 'PEN', num: '29800', display: 'PC 29800',      desc: 'Felon in possession of firearm' },
    { code: 'PEN', num: '30305', display: 'PC 30305',      desc: 'Felon in possession of ammunition' },
  ]},
  { label: 'Drugs', accent: '#065F46', items: [
    { code: 'HSC', num: '11350', display: 'H&S 11350',     desc: 'Possession of controlled substance' },
    { code: 'HSC', num: '11377', display: 'H&S 11377',     desc: 'Possession of methamphetamine' },
    { code: 'HSC', num: '11364', display: 'H&S 11364',     desc: 'Possession of drug paraphernalia' },
    { code: 'HSC', num: '11395', display: 'H&S 11395(b)(1)', desc: 'Possession of hard drugs with prior', sub: ['b','1'] },
  ]},
  { label: 'Public Order', accent: '#0F766E', items: [
    { code: 'PEN', num: '647',   display: 'PC 647(f)',     desc: 'Drunk in public',                           sub: ['f'] },
    { code: 'PEN', num: '148',   display: 'PC 148',        desc: 'Resisting arrest' },
  ]},
  { label: 'Probation & Parole', accent: '#6B21A8', items: [
    { code: 'PEN', num: '1203.2', display: 'PC 1203.2',   desc: 'Probation violation' },
    { code: 'PEN', num: '3056',   display: 'PC 3056',      desc: 'Parole violation' },
  ]},
  { label: 'Mental Health', accent: '#0D9488', items: [
    { code: 'WIC', num: '5150',  display: 'WIC 5150',      desc: 'Mental health hold' },
  ]},
  { label: 'Vehicle Offenses', accent: '#0369A1', items: [
    { code: 'VEH', num: '23152', display: 'VC 23152',      desc: 'DUI' },
    { code: 'VEH', num: '14601', display: 'VC 14601',      desc: 'Suspended license' },
    { code: 'VEH', num: '22450', display: 'VC 22450',      desc: 'Stop sign violation' },
    { code: 'VEH', num: '21453', display: 'VC 21453',      desc: 'Red light violation' },
    { code: 'VEH', num: '22350', display: 'VC 22350',      desc: 'Speeding (unsafe speed)' },
    { code: 'VEH', num: '22349', display: 'VC 22349',      desc: 'Speeding (maximum speed)' },
    { code: 'VEH', num: '26710', display: 'VC 26710',      desc: 'Damaged windshield' },
    { code: 'VEH', num: '26708', display: 'VC 26708',      desc: 'Tinted windows' },
    { code: 'VEH', num: '21461', display: 'VC 21461',      desc: 'Disobeying traffic sign' },
    { code: 'VEH', num: '16028', display: 'VC 16028',      desc: 'No proof of insurance' },
    { code: 'VEH', num: '4000',  display: 'VC 4000',       desc: 'Unregistered vehicle' },
    { code: 'VEH', num: '12500', display: 'VC 12500',      desc: 'Unlicensed driver' },
  ]},
];

// ── Bootstrap ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupOfflineListeners();
  setupSearchListeners();
  setupFilterListeners();
  setupDetailListeners();
  setupCategoryListeners();
  buildCategoriesOverlay();
  setupQuickCodesListeners();
  buildQuickCodesOverlay();
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
    const response = await fetch('./ca_codes.json?v=7');
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
    document.getElementById('welcome-panel').hidden = false;

  } catch (err) {
    console.error('Failed to load ca_codes.json:', err);
    const loadEl = document.getElementById('loading');
    loadEl.querySelector('.spinner').hidden = true;
    loadEl.querySelector('span').textContent = 'Failed to load code database. Please refresh.';
    document.getElementById('results-count').hidden = true;
    document.getElementById('welcome-panel').hidden = true;
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
      document.getElementById('welcome-panel').hidden = true;
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
    // Show welcome panel when idle (no query, no category)
    if (State.allSections.length > 0) {
      document.getElementById('welcome-panel').hidden = false;
    }
    return;
  }

  document.getElementById('welcome-panel').hidden = true;

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
  const poolSet = new Set(pool.map(s => s._idx));
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
    const sectionRef = s.code === 'CCR'
      ? `CALCRIM&nbsp;${s.sectionNumber}`
      : `${uiCode}&nbsp;§${s.sectionNumber}`;

    art.innerHTML = `
      <div class="card-top">
        <span class="section-ref">${sectionRef}</span>
        <span class="offense-badge badge-${(s.offenseClass || 'unknown').replace('/', '-')}">${label}</span>
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
function openDetail(sectionId, noHistory = false) {
  const s = State.allSections.find(sec => sec.id === sectionId);
  if (!s) return;

  const uiCode = CODE_TO_UI[s.code] || s.code;
  const label  = CLASS_LABEL[s.offenseClass] || '';

  if (s.code === 'CCR') {
    document.getElementById('detail-title').textContent = `CALCRIM ${s.sectionNumber}`;
  } else {
    document.getElementById('detail-title').textContent = `${uiCode} §${s.sectionNumber}`;
  }

  const badge = document.getElementById('detail-badge');
  badge.textContent = label;
  badge.className = `offense-badge badge-${(s.offenseClass || 'unknown').replace('/', '-')}`;

  // Breadcrumb: Part › Chapter  (for CCR show code citation instead)
  if (s.code === 'CCR' && s.codeCitation) {
    document.getElementById('detail-breadcrumb').textContent = s.codeCitation;
  } else {
    const crumbParts = [s.partInfo, s.chapterInfo].filter(Boolean);
    document.getElementById('detail-breadcrumb').textContent = crumbParts.join(' › ');
  }

  const sub = State.pendingSub;
  State.pendingSub = null;

  // CalCrim panel: shown for non-CCR sections that have a CalCrim mapping
  const cPanel = document.getElementById('calcrim-panel');
  const cViewBtn = document.getElementById('calcrim-view-btn');
  if (s.code !== 'CCR') {
    const mapKey   = `${s.code}-${s.sectionNumber}`;
    const ccrNum   = CALCRIM_MAP[mapKey];
    const ccrSec   = ccrNum ? State.allSections.find(sec => sec.code === 'CCR' && sec.sectionNumber === ccrNum) : null;
    if (ccrSec) {
      document.getElementById('calcrim-num').textContent   = `No. ${ccrSec.sectionNumber}`;
      document.getElementById('calcrim-title').textContent = ccrSec.title.replace(/\s*\(.*?\)\s*$/, '');
      // Show a formatted preview of the first elements from the instruction
      const previewParas = splitCalcrimText(ccrSec.text).slice(0, 5);
      document.getElementById('calcrim-elements').innerHTML = renderCalcrimParas(previewParas);
      cViewBtn.dataset.ccrId = ccrSec.id;
      cPanel.hidden = false;
    } else {
      cPanel.hidden = true;
    }
  } else {
    cPanel.hidden = true;
  }

  // Split text into paragraphs and render — CalCrim uses its own formatter.
  let hilite = -1;
  if (s.code === 'CCR') {
    document.getElementById('detail-text').innerHTML = renderCalcrimParas(splitCalcrimText(s.text));
  } else {
    const paras = splitSectionText(s.text);
    hilite = (sub && sub.length) ? findSubParagraph(paras, sub) : -1;
    document.getElementById('detail-text').innerHTML = renderParas(paras, hilite);
  }

  const link = document.getElementById('source-link');
  if (s.code === 'CCR') {
    link.href = 'https://courts.ca.gov/system/files/file/calcrim-2026.pdf';
    link.textContent = 'View CALCRIM 2026 (Judicial Council PDF) ↗';
  } else if (s.code === 'EMC') {
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

  if (!noHistory) {
    history.pushState({ detail: sectionId }, '', `#${encodeURIComponent(sectionId)}`);
  }
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
  t = t.replace(/([.!;:])\s+(\([a-zA-Z]{1,2}\)|\(\d{1,3}\))[\s\u00a0]?/g, '$1\n$2 ');
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

/** Splits CalCrim instruction text into formatted paragraphs. */
function splitCalcrimText(text) {
  if (!text) return ['(No text available)'];
  let t = escapeHtml(text).replace(/\u00a0/g, ' ');
  // Break before numbered/lettered elements after : or ;
  t = t.replace(/([;:])\s+(\[?(?:\d{1,2}[A-Z]?)\.\s)/g, '$1\n$2');
  // Break before "AND N." or "OR N." connectors
  t = t.replace(/\s+((?:AND|OR)\s+\d{1,2}[A-Z]?\.\s)/g, '\n$1');
  // Break standalone [AND] / [OR] connectors onto their own lines
  t = t.replace(/\s+(\[(?:AND|OR)\])\s*/g, '\n$1\n');
  // Break before optional bracketed paragraphs after ] or .
  t = t.replace(/([.\]])\s+(\[[A-Z][a-z])/g, '$1\n$2');
  // Break before judge notes <...>
  t = t.replace(/\s+(&lt;[A-Z])/g, '\n$1');
  // Break before definition starters after a sentence end
  t = t.replace(/\.\s+([A-Z][a-z]{2,15} (?:means|is defined|refers to|includes)\b)/g, '.\n$1');
  return t.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

/** Renders CalCrim paragraphs with semantic classes. */
function renderCalcrimParas(paras) {
  return paras.map(p => {
    if (/^\[(?:AND|OR)\]$/.test(p))
      return `<p class="calcrim-connector">${p}</p>`;
    if (/^(?:(?:AND|OR)\s+)?\[?\d{1,2}[A-Z]?\./.test(p))
      return `<p class="calcrim-element">${p}</p>`;
    if (/^&lt;[A-Z]/.test(p))
      return `<p class="calcrim-note">${p}</p>`;
    return `<p>${p}</p>`;
  }).join('');
}

// ── No-results / live lookup ──────────────────────────────
function showNoResults(query, parsed) {
  const el = document.getElementById('no-results');
  let html = `<p>No results for <strong>${escapeHtml(query)}</strong>.</p>`;

  if (State.isOnline && parsed.type === 'section') {
    const lawCode = parsed.code || inferCode(parsed.num);
    if (lawCode && lawCode !== 'EMC' && lawCode !== 'WIC' && lawCode !== 'CCR') {
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
  if (n >= 11000 && n <= 25195) return 'HSC';  // check before VEH — overlapping range
  if (n >= 4060  && n <= 10999) return 'BPC';  // B&P below HSC range
  if (n >= 2800  && n <= 31305) return 'VEH';
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

// ── Common codes overlay ──────────────────────────────────
function buildQuickCodesOverlay() {
  const list = document.getElementById('quick-list');
  list.innerHTML = QUICK_CODES.map(group => `
    <div class="quick-group" style="--qaccent:${group.accent}">
      <div class="quick-group-header">${escapeHtml(group.label)}</div>
      ${group.items.map(item => `
        <div class="quick-item"
             data-code="${item.code}"
             data-num="${escapeHtml(item.num)}"
             data-sub="${item.sub ? escapeHtml(JSON.stringify(item.sub)) : ''}"
             role="button" tabindex="0"
             aria-label="${escapeHtml(item.display)} — ${escapeHtml(item.desc)}">
          <span class="quick-item-ref">${escapeHtml(item.display)}</span>
          <span class="quick-item-desc">${escapeHtml(item.desc)}</span>
          <span class="quick-item-arrow" aria-hidden="true">›</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function setupQuickCodesListeners() {
  document.getElementById('quick-btn').addEventListener('click', openQuickCodes);
  document.getElementById('quick-back-btn').addEventListener('click', () => history.back());

  const list = document.getElementById('quick-list');
  list.addEventListener('click', e => {
    const item = e.target.closest('.quick-item');
    if (item) handleQuickCodeTap(item);
  });
  list.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const item = e.target.closest('.quick-item');
      if (item) { e.preventDefault(); handleQuickCodeTap(item); }
    }
  });
}

function handleQuickCodeTap(el) {
  const code   = el.dataset.code;
  const num    = el.dataset.num;
  const subRaw = el.dataset.sub;
  const section = State.allSections.find(s => s.code === code && s.sectionNumber === num);
  if (!section) return;
  closeQuickCodes();
  State.pendingSub = subRaw ? JSON.parse(subRaw) : null;
  openDetail(section.id);
}

function openQuickCodes(noHistory = false) {
  const overlay = document.getElementById('quick-overlay');
  overlay.hidden = false;
  overlay.focus();
  document.body.style.overflow = 'hidden';
  if (!noHistory) history.pushState({ quick: true }, '');
}

function closeQuickCodes() {
  document.getElementById('quick-overlay').hidden = true;
  document.body.style.overflow = '';
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

  document.getElementById('calcrim-view-btn').addEventListener('click', e => {
    const ccrId = e.currentTarget.dataset.ccrId;
    if (ccrId) openDetail(ccrId);
  });

  // Handle browser/OS back navigation.
  window.addEventListener('popstate', e => {
    if (e.state?.detail) {
      // Restore a previous detail view without pushing new history.
      openDetail(e.state.detail, true);
    } else if (e.state?.quick) {
      // Navigated back to the Common Codes overlay — restore it.
      if (!document.getElementById('detail-overlay').hidden) closeDetail();
      openQuickCodes(true);
    } else {
      // Root state — close whichever overlay is open.
      if (!document.getElementById('detail-overlay').hidden) closeDetail();
      if (!document.getElementById('quick-overlay').hidden) closeQuickCodes();
    }
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
    if (dx > 80 && startX < 60) history.back();
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
    el.textContent = `${total.toLocaleString()} sections loaded`;
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
