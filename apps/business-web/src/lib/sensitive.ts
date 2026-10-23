/**
 * Words that ask a customer for something private (§312), so the service form
 * can say so while the seller types — in any of the three languages, whatever
 * the app is in, since a seller may write their questions in another.
 *
 * Two kinds:
 * - NEVER asked: an illness, a test or medicines; an ID, passport or
 *   insurance number; religion, ethnicity or politics; a PIN or a password.
 *   The seller agreement (9.3) forbids the first two outright.
 * - SAFETY: an allergy, a pregnancy, an injury — fine to ask when it changes
 *   how the service is done, but only as a private question (§300.6).
 *
 * A warning, not a wall: words are matched whole, after folding case and
 * accents, and the seller decides. The lists stay short and specific on
 * purpose — "ubwoko" (also "kind of") or "politique" (also "policy") would
 * flag half the shop's own words.
 */

export type SensitiveKind = 'medical' | 'id' | 'beliefs' | 'secrets' | 'safety';

const WORDS: Record<SensitiveKind, string[]> = {
  medical: [
    // English
    'hiv', 'diagnosis', 'diagnosed', 'illness', 'illnesses', 'disease', 'diseases', 'sickness',
    'medical history', 'medicine', 'medicines', 'medication', 'medications', 'prescription', 'test result',
    'test results', 'lab results', 'diabetes', 'diabetic', 'cancer', 'blood pressure', 'hypertension',
    'heart condition', 'epilepsy', 'mental health', 'depression', 'hepatitis', 'tuberculosis',
    'std', 'sti', 'sexually transmitted', 'surgery', 'operations you had',
    // Français
    'vih', 'sida', 'diagnostic', 'maladie', 'maladies', 'antecedents medicaux', 'medicament', 'medicaments',
    'ordonnance', 'resultats d analyse', 'resultat d analyse', 'resultats d examen', 'diabete',
    'tension arterielle', 'hypertension arterielle', 'sante mentale', 'chirurgie',
    // Ikinyarwanda
    'virusi itera sida', 'indwara', 'urarwaye', 'urwaye', 'imiti unywa', 'imiti ufata', 'diyabete', 'kanseri',
    'umuvuduko w amaraso', 'igituntu',
  ],
  id: [
    // The numbers, not the cards: "bring your passport" is how a permit is checked at the gate.
    'national id', 'id number', 'identity number', 'passport number', 'insurance number', 'policy number',
    'social security number',
    'numero d identite', 'numero de passeport', 'numero d assurance', 'numero de police',
    'nimero y indangamuntu', 'nimero ya pasiporo', 'nimero y ubwishingizi',
  ],
  beliefs: [
    // "Religion", not "religious": a church wedding is about the day, not the person.
    'religion', 'your church', 'ethnic', 'ethnicity', 'tribe', 'tribal', 'hutu', 'tutsi',
    'political party', 'political views', 'who you vote',
    'ethnie', 'ethnique', 'tribu', 'parti politique',
    'idini', 'ishyaka rya politiki',
  ],
  secrets: [
    'pin code', 'pin number', 'momo pin', 'mobile money pin', 'your pin', 'password', 'passcode',
    'code pin', 'code secret', 'mot de passe',
    'umubare w ibanga', 'ijambo ry ibanga', 'ijambobanga',
  ],
  safety: [
    'allergy', 'allergies', 'allergic', 'pregnant', 'pregnancy', 'injury', 'injuries', 'injured',
    'allergie', 'allergies', 'allergique', 'enceinte', 'grossesse', 'blessure', 'blesse',
    // Kinyarwanda builds a word from parts, so its common forms are listed whole.
    'aleriji', 'ubwivumbure', 'utwite', 'uratwite', 'atwite', 'aratwite', 'ndatwite', 'mutwite', 'muratwite',
    'batwite', 'baratwite', 'gutwita', 'imvune', 'igikomere', 'wakomeretse', 'warakomeretse',
    // Needs help moving or seeing: asked as "anything that would help you?", privately.
    'disability', 'disabilities', 'handicap', 'ubumuga',
  ],
};

/** An animal's medicine or injury is not a person's health: a vet or a groomer asks about it. */
const ANIMALS = [
  'pet', 'pets', 'your dog', 'your cat', 'animal', 'animals', 'vet',
  'votre animal', 'animal de compagnie', 'chien', 'chat', 'veterinaire',
  'itungo', 'amatungo', 'imbwa', 'injangwe',
];

/** Lower case, no accents, every run of other characters a single space. */
const fold = (text: string) =>
  ` ${text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

const FOLDED = Object.fromEntries(
  Object.entries(WORDS).map(([kind, words]) => [kind, words.map((w) => ` ${fold(w).trim()} `)]),
) as Record<SensitiveKind, string[]>;

const ANIMAL_WORDS = ANIMALS.map((w) => ` ${fold(w).trim()} `);

/** Words that tell customers NOT to share something — "never write a password here" — are the right thing to say. */
const TELLING_NOT_TO = ['don t write', 'do not write', 'never write', 'don t share', 'never share', 'n ecrivez', 'ne partagez', 'ntuzigere', 'ntukandike', 'ntimwandike']
  .map((w) => ` ${fold(w).trim()} `);

/** The most serious kind of private thing the text asks about, or null. Never-asked kinds come before safety. */
export function sensitiveIn(...texts: Array<string | null | undefined>): SensitiveKind | null {
  // "Indwara z'ubwivumbure" is how Kinyarwanda says "allergy": a safety question, not an illness.
  const all = fold(texts.filter(Boolean).join(' ')).replace(/ indwara [zy] ubwivumbure /g, ' ubwivumbure ');
  if (all.trim() === '' || TELLING_NOT_TO.some((words) => all.includes(words))) return null;
  const aboutAnimals = ANIMAL_WORDS.some((word) => all.includes(word));
  for (const kind of ['medical', 'id', 'beliefs', 'secrets', 'safety'] as const) {
    if (aboutAnimals && (kind === 'medical' || kind === 'safety')) continue;
    if (FOLDED[kind].some((word) => all.includes(word))) return kind;
  }
  return null;
}

export const NEVER: ReadonlySet<SensitiveKind> = new Set(['medical', 'id', 'beliefs', 'secrets']);
