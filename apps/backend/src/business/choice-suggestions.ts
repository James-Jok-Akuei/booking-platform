import { ChoiceKind } from '@prisma/client';

/**
 * Ready-made questions for every kind of shop (§300.2), and the words above
 * the customer's note box — from the research recorded in the "Service
 * choices — research and design" document (19–20 October 2026).
 *
 * A shop switches a suggestion on for a service, changes the words, sets
 * its own prices, and adds questions of its own. Nothing here is ever
 * applied by itself: a suggestion becomes a question only when the shop
 * presses Save (§281).
 *
 * Prices are never suggested — what something costs is the shop's to say.
 * `paid` marks an answer shops usually charge for, so the form can ask for
 * a price; `extraMinutes` is a typical time, to be checked.
 *
 * Health and other private answers (`healthRelated`) — allergies, diet,
 * religion, a body area, a legal matter — are never priced or timed, which
 * is what keeps them off receipts (§300.6).
 *
 * Keyed by the category and type NAMES the seed uses (§266). A rename is a
 * migration there, and the test beside this file fails until the names
 * here follow.
 */

export interface SuggestedOption {
  label: string;
  description?: string;
  /** A typical extra time; the shop checks it. */
  extraMinutes?: number;
  /** Shops usually charge for this: the form asks for a price. */
  paid?: boolean;
}

export interface ChoiceSuggestion {
  /** Stable, so a service's question can say which suggestion it began as. */
  key: string;
  /** The shop's short name for it. */
  name: string;
  /** What the customer is asked. */
  question: string;
  kind: ChoiceKind;
  required: boolean;
  maxPicks?: number;
  healthRelated?: boolean;
  /** Shown only when this answer to an earlier suggestion is picked. */
  showIf?: { key: string; option: string };
  /** A word to the shop about using it. */
  hint?: string;
  options: SuggestedOption[];
}

/** A kind of shop, as `KINDS_SELECT` reads it: the category and the type, by name. */
export interface ShopKind {
  category: { name: string };
  subcategory: { name: string };
}

interface TypeCatalog {
  /** Questions for this type, shown before the category's own. */
  add?: ChoiceSuggestion[];
  /** Category questions that do not fit this type. */
  skip?: string[];
  notePrompt?: string;
  priceAtShop?: boolean;
}

interface CategoryCatalog {
  notePrompt: string;
  /** Usually priced after seeing the job: suggest "price confirmed at the shop" (§300.3). */
  priceAtShop?: boolean;
  common: ChoiceSuggestion[];
  types?: Record<string, TypeCatalog>;
}

/** The words above the note box when nothing better is known. */
export const DEFAULT_NOTE_PROMPT = 'Anything the shop should know?';

// ---------- Builders ----------

const o = (label: string, more: Omit<SuggestedOption, 'label'> = {}): SuggestedOption => ({ label, ...more });
/** Usually costs more; `minutes` when it also takes longer. */
const paid = (label: string, minutes = 0, description?: string): SuggestedOption =>
  o(label, { paid: true, ...(minutes ? { extraMinutes: minutes } : {}), ...(description ? { description } : {}) });
/** Takes longer, at no extra price by default. */
const longer = (label: string, minutes: number, description?: string): SuggestedOption =>
  o(label, { extraMinutes: minutes, ...(description ? { description } : {}) });
const plain = (...labels: string[]) => labels.map((label) => o(label));

type More = Partial<Pick<ChoiceSuggestion, 'required' | 'maxPicks' | 'healthRelated' | 'showIf' | 'hint'>>;

const one = (
  key: string,
  name: string,
  question: string,
  options: SuggestedOption[],
  more: More = {},
): ChoiceSuggestion => ({
  key,
  name,
  question,
  kind: ChoiceKind.ONE,
  required: false,
  options,
  ...more,
});

const several = (
  key: string,
  name: string,
  question: string,
  options: SuggestedOption[],
  more: More = {},
): ChoiceSuggestion => ({ key, name, question, kind: ChoiceKind.MANY, required: false, options, ...more });

const REQUIRED: More = { required: true };
const PRIVATE: More = { healthRelated: true };
const WISH = 'A wish: the shop will try, but cannot promise.';

// ---------- Shared between categories ----------

const LANGUAGES = plain('Kinyarwanda', 'English', 'French', 'Swahili');

const DIET = several(
  'food.diet',
  'Diet',
  'Any food needs?',
  plain('Vegetarian', 'Vegan', 'Halal', 'No pork', 'No alcohol in food', 'Low salt', 'Low sugar'),
  { ...PRIVATE, hint: 'Private: diet can say someone’s religion or health, so it is sealed and never emailed.' },
);

const FOOD_ALLERGIES = several(
  'food.allergies',
  'Allergies',
  'Does anyone have a food allergy?',
  [
    ...plain('Peanuts', 'Tree nuts', 'Milk', 'Eggs', 'Fish', 'Shellfish', 'Gluten', 'Soy', 'Sesame'),
    o('Another allergy', { description: 'Tell the staff when you arrive.' }),
  ],
  { ...PRIVATE, hint: 'Shown to you in red. People with serious allergies should still call you.' },
);

const ALLERGY_LEVEL = one(
  'food.allergy-level',
  'How serious',
  'If there is an allergy, how serious is it?',
  plain('Prefer to avoid it', 'Serious, even traces'),
  PRIVATE,
);

const BEFORE_EXERCISE = several(
  'fitness.before-start',
  'Before you start',
  'Anything the coach should know before you start?',
  plain(
    'Recent injury or pain',
    'Pregnant or recently gave birth',
    'Heart, breathing or blood-pressure condition',
    'None of these',
  ),
  PRIVATE,
);

const PRACTITIONER = one('people.practitioner', 'Practitioner preference', 'Would you prefer a woman or a man?', [
  o('No preference'),
  o('A woman', { description: WISH }),
  o('A man', { description: WISH }),
]);

// ---------- The catalogue ----------

const CATALOG: Record<string, CategoryCatalog> = {
  Dining: {
    notePrompt: 'Anything else the restaurant should know? For example, a surprise you’re planning.',
    common: [
      one(
        'dining.occasion',
        'Occasion',
        'Are you celebrating anything?',
        plain('Nothing special', 'Birthday', 'Anniversary', 'Date night', 'Business meal', 'Graduation', 'Farewell'),
      ),
      several('dining.celebration', 'Celebration extras', 'Would you like anything for the celebration?', [
        o('Candle and a song'),
        paid('A cake from us'),
        paid('We’re bringing a cake', 0, 'A small fee for plates and serving.'),
        paid('Flowers'),
        paid('Drinks on arrival'),
      ]),
      one(
        'dining.seating',
        'Seating wish',
        'Where would you like to sit?',
        [o('No preference'), ...plain('Inside', 'Terrace', 'A quiet corner', 'By a window or the view')],
        { hint: 'A wish: say so to customers, and seat them there when you can.' },
      ),
      DIET,
      FOOD_ALLERGIES,
      ALLERGY_LEVEL,
      several(
        'dining.little-ones',
        'Little ones',
        'Coming with children?',
        plain('A high chair', 'Space for a pram', 'Kids’ portions'),
      ),
    ],
    types: {
      'Pick-up': {
        add: [
          one('dining.packaging', 'Packaging', 'How should we pack it?', plain('Your packaging', 'My own container')),
          one('dining.cutlery', 'Cutlery', 'Would you like cutlery?', plain('Yes, please', 'No, thank you')),
          one('dining.chilli', 'Chilli', 'How much chilli?', plain('No chilli', 'On the side', 'Hot')),
        ],
        skip: ['dining.occasion', 'dining.celebration', 'dining.seating', 'dining.little-ones'],
        notePrompt: 'Anything about your order? For example, when you will come for it.',
      },
      'Private Dining': {
        add: [
          one(
            'dining.event-type',
            'Event type',
            'What is the occasion?',
            plain(
              'Birthday',
              'Anniversary',
              'Business dinner',
              'Engagement',
              'Graduation',
              'Family gathering',
              'Something else',
            ),
            REQUIRED,
          ),
          one('dining.drinks', 'Drinks', 'What would you like to drink?', [
            o('No drinks package'),
            paid('Soft drinks'),
            paid('Beer'),
            paid('Wine'),
            paid('We’ll bring our own', 0, 'A corkage fee applies.'),
          ]),
          one(
            'dining.table-setup',
            'Table set-up',
            'How should the tables be set?',
            plain('One long table', 'Round tables', 'Standing, cocktail style'),
          ),
          one('dining.extra-hour', 'Extra hour', 'Would you like the room for longer?', [paid('One more hour', 60)]),
        ],
        skip: ['dining.seating'],
      },
    },
  },

  'Hotels & Stays': {
    notePrompt: 'Anything that would make your stay better? Your flight number, if you would like a ride.',
    common: [
      one(
        'stays.arrival',
        'Arrival time',
        'When will you arrive?',
        plain('Before 12:00', '12:00 to 18:00', '18:00 to 22:00', 'After 22:00'),
        REQUIRED,
      ),
      one('stays.bed', 'Bed', 'Which beds would you like?', [
        o('No preference'),
        o('One large bed', { description: WISH }),
        o('Two beds', { description: WISH }),
      ]),
      several('stays.early-late', 'Early or late', 'Arriving early or leaving late?', [
        paid('Early check-in'),
        paid('Late check-out'),
      ]),
      one(
        'stays.transfer',
        'Airport transfer',
        'Would you like a ride to or from the airport?',
        [o('No, thank you'), paid('Pick-up'), paid('Drop-off'), paid('Both')],
        { hint: 'Customers put their flight number in the note.' },
      ),
      several('stays.extra-sleeping', 'Extra sleeping', 'Need an extra bed?', [o('A baby cot'), paid('An extra bed')]),
      several('stays.meals', 'Meals', 'Would you like meals?', [
        paid('Breakfast'),
        paid('Dinner'),
        paid('A packed lunch'),
      ]),
      several(
        'stays.access',
        'Access',
        'Anything that would help your stay?',
        plain('A step-free room', 'An accessible bathroom', 'Near the lift'),
        PRIVATE,
      ),
    ],
    types: {
      'Day Passes & Pools': {
        add: [
          one(
            'stays.pass',
            'Pass',
            'Which pass?',
            [o('Pool only'), paid('A reserved lounger'), paid('A cabana')],
            REQUIRED,
          ),
          several('stays.day-extras', 'Extras', 'Anything to add?', [
            paid('A towel'),
            paid('Lunch'),
            paid('A massage', 60),
          ]),
        ],
        skip: [
          'stays.arrival',
          'stays.bed',
          'stays.early-late',
          'stays.transfer',
          'stays.extra-sleeping',
          'stays.meals',
        ],
        notePrompt: 'Anything we should know before you come?',
      },
      'Meeting & Conference Rooms': {
        add: [
          one(
            'stays.layout',
            'Layout',
            'How should the room be set out?',
            plain('Theatre', 'Classroom', 'Boardroom', 'U-shape', 'Banquet'),
            REQUIRED,
          ),
          several(
            'stays.equipment',
            'Equipment',
            'What equipment do you need?',
            [paid('A projector'), paid('Microphones'), paid('A video-call kit')],
            { hint: 'Wi-Fi and water are free in most rooms — keep them free.' },
          ),
          several('stays.refreshments', 'Refreshments', 'Would you like refreshments?', [
            paid('A tea break'),
            paid('Lunch'),
          ]),
          one('stays.interpretation', 'Interpretation', 'Do you need interpreters?', [paid('Yes, interpretation')]),
          one('stays.room-time', 'Extra time', 'Need the room longer, to set up or clear away?', [
            paid('30 more minutes', 30),
            paid('One more hour', 60),
          ]),
        ],
        skip: ['stays.arrival', 'stays.bed', 'stays.early-late', 'stays.extra-sleeping', 'stays.meals'],
        notePrompt: 'Tell us about the meeting: the programme, and anything to prepare.',
      },
    },
  },

  'Events, Tickets & Movies': {
    notePrompt: 'Anything the organisers should know?',
    common: [
      several(
        'events.access',
        'Access needs',
        'Anything that would help you at the event?',
        plain('Wheelchair space', 'A step-free route', 'A seat near the front', 'A companion seat beside me'),
        PRIVATE,
      ),
      several('events.extras', 'Extras', 'Anything to add?', [
        paid('Parking'),
        paid('A drink voucher'),
        paid('An event T-shirt'),
      ]),
      one('events.tshirt-size', 'T-shirt size', 'Which T-shirt size?', plain('S', 'M', 'L', 'XL', 'XXL'), {
        ...REQUIRED,
        showIf: { key: 'events.extras', option: 'An event T-shirt' },
      }),
    ],
    types: {
      Movies: {
        add: [
          several('events.snacks', 'Snacks', 'Would you like snacks?', [
            paid('Popcorn'),
            paid('A soft drink'),
            paid('A combo'),
          ]),
          one(
            'events.snacks-when',
            'Snacks when',
            'When would you like them?',
            plain('Ready when I arrive', 'Brought to my seat'),
          ),
        ],
        skip: ['events.tshirt-size'],
      },
      'Art Exhibits': {
        add: [
          one('events.visit', 'Visit', 'How would you like to visit?', [o('On my own'), paid('A guided tour', 30)]),
          one(
            'events.tour-language',
            'Tour language',
            'In which language?',
            plain('Kinyarwanda', 'English', 'French'),
            {
              showIf: { key: 'events.visit', option: 'A guided tour' },
            },
          ),
        ],
      },
    },
  },

  'Event Services': {
    notePrompt:
      'Tell us about the day: where it is, the order and times (gusaba 10:00, reception 16:00), colours or theme.',
    priceAtShop: true,
    common: [
      one(
        'event-services.event-type',
        'Event type',
        'What is the event?',
        plain(
          'Gusaba (introduction)',
          'Gukwa (dowry)',
          'Civil wedding',
          'Church wedding and reception',
          'Birthday',
          'Baby shower',
          'Graduation',
          'Corporate',
          'Memorial',
          'Something else',
        ),
        REQUIRED,
      ),
      one(
        'event-services.guests',
        'Guests',
        'How many guests?',
        [o('Under 50'), paid('50 to 100'), paid('100 to 200'), paid('200 to 400'), paid('More than 400')],
        REQUIRED,
      ),
      one(
        'event-services.setting',
        'Setting',
        'Indoors or outdoors?',
        plain('Indoors', 'Outdoors', 'Not sure yet'),
        REQUIRED,
      ),
    ],
    types: {
      'Venue Booking': {
        add: [
          one(
            'event-services.venue-layout',
            'Layout',
            'How should the room be set out?',
            plain('Banquet', 'Theatre', 'Cocktail', 'Gusaba style: two facing tables'),
          ),
          one('event-services.catering', 'Catering and drinks', 'Whose food and drinks?', [
            paid('The venue’s'),
            o('We bring our own'),
          ]),
          several('event-services.venue-extras', 'Extras', 'Anything to add?', [
            paid('Decorate the day before'),
            paid('One more hour', 60),
          ]),
        ],
      },
      'DJ & Live Music': {
        add: [
          several('event-services.sound', 'Sound and lights', 'What do you need?', [
            o('Microphones for speeches'),
            o('Sound for the ceremony'),
            paid('Dance lights'),
            paid('A generator'),
          ]),
          several(
            'event-services.music',
            'Music styles',
            'What music would you like?',
            plain('Gospel', 'Afrobeat', 'Rwandan traditional', 'Hip-hop and R&B', 'Old school', 'A bit of everything'),
          ),
        ],
      },
      'Event Decor & Styling': {
        add: [
          several('event-services.decor', 'Decor', 'What would you like?', [
            paid('A backdrop'),
            paid('Centrepieces'),
            paid('Chair covers'),
            paid('Flowers'),
            paid('Traditional decor'),
          ]),
        ],
      },
      'MC & Hosting': {
        add: [
          several(
            'event-services.mc-languages',
            'Languages',
            'Which languages should the MC speak?',
            LANGUAGES,
            REQUIRED,
          ),
          several('event-services.mc-extras', 'Extras', 'Anything to add?', [
            paid('A rehearsal'),
            paid('A family spokesperson for the gusaba'),
          ]),
        ],
      },
      'Equipment Rental': {
        add: [
          one('event-services.chairs', 'Chairs', 'How many chairs?', [
            paid('50 chairs'),
            paid('100 chairs'),
            paid('200 chairs'),
          ]),
          several('event-services.equipment', 'Equipment', 'What else do you need?', [
            paid('Tents'),
            paid('Tables'),
            paid('A sound system'),
            paid('A stage'),
            paid('A generator'),
          ]),
          one('event-services.delivery', 'Delivery', 'Delivery and set-up?', [
            o('I’ll collect it'),
            paid('Deliver and set up'),
          ]),
        ],
      },
    },
  },

  'Beauty & Spa': {
    notePrompt: 'Anything about your hair or style we should know? Describe the look you want.',
    common: [],
    types: {
      'Braiding & Locs': {
        add: [
          one(
            'beauty.braid-size',
            'Braid size',
            'How big would you like the braids?',
            [o('Jumbo'), paid('Large', 30), paid('Medium', 60), paid('Small', 120), paid('Extra small', 180)],
            { ...REQUIRED, hint: 'Smaller braids take much longer: check the times against your own.' },
          ),
          one(
            'beauty.braid-length',
            'Length',
            'How long would you like them?',
            [
              o('Shoulder'),
              paid('Bra strap', 30),
              paid('Mid-back', 60),
              paid('Waist', 90),
              paid('Below the waist', 120),
            ],
            REQUIRED,
          ),
          one(
            'beauty.braiding-hair',
            'Braiding hair',
            'Who brings the braiding hair?',
            [o('I bring my own'), paid('The salon: synthetic'), paid('The salon: human hair')],
            REQUIRED,
          ),
          one(
            'beauty.braid-colour',
            'Colour',
            'What colour?',
            plain('Natural black', 'Brown', 'Blonde', 'Burgundy', 'Mixed'),
          ),
          several('beauty.before-braids', 'Before we start', 'Anything to do first?', [
            paid('Take down old braids', 60),
            paid('Wash and stretch', 30),
            o('I’ll come washed'),
          ]),
          one(
            'beauty.cornrow-lines',
            'Cornrow lines',
            'How many lines?',
            [o('2 lines'), paid('3 to 4', 30), paid('5 to 8', 60), paid('9 to 12', 90), paid('A design', 60)],
            { ...REQUIRED, hint: 'For a cornrows service.' },
          ),
          one(
            'beauty.locs',
            'Locs',
            'What do your locs need?',
            plain('Retwist', 'Interlock', 'Starter locs', 'Repair', 'Loc extensions'),
            { ...REQUIRED, hint: 'For a locs service.' },
          ),
        ],
      },
      Hair: {
        add: [
          one(
            'beauty.hair-length',
            'Hair length',
            'How long is your hair?',
            [o('Short'), paid('Medium', 15), paid('Long', 30), paid('Extra long', 45)],
            REQUIRED,
          ),
          one('beauty.wash', 'Wash', 'Shall we wash it?', [paid('Wash and blow-dry', 30), o('I’ll come washed')]),
          several('beauty.treatments', 'Treatments', 'Any treatment?', [
            paid('Deep conditioning', 20),
            paid('Scalp treatment', 20),
            paid('A trim', 15),
          ]),
          one('beauty.wig', 'Wig', 'Are you getting a wig?', plain('No wig', 'Yes, a wig')),
          one(
            'beauty.wig-type',
            'Wig type',
            'Which kind of wig?',
            plain('Closure', 'Frontal', 'Full lace', 'Glueless'),
            {
              ...REQUIRED,
              showIf: { key: 'beauty.wig', option: 'Yes, a wig' },
            },
          ),
          several(
            'beauty.wig-extras',
            'Wig extras',
            'Anything for the wig?',
            [paid('Buy the wig here'), paid('A cornrow base', 30)],
            {
              showIf: { key: 'beauty.wig', option: 'Yes, a wig' },
            },
          ),
        ],
      },
      Barbershop: {
        add: [
          one(
            'beauty.cut',
            'Cut',
            'Which cut?',
            [o('Clipper cut'), longer('Fade', 15), longer('Scissor cut', 15), o('Shave'), o('Kids’ cut')],
            REQUIRED,
          ),
          several('beauty.barber-extras', 'Extras', 'Anything to add?', [
            paid('Beard trim and line-up', 10),
            paid('Hot-towel shave', 15),
            paid('A design', 15),
            paid('Black dye', 20),
          ]),
        ],
        notePrompt: 'Your clipper number, or the look you want.',
      },
      Nails: {
        add: [
          one('beauty.nail-removal', 'Removal', 'Anything to take off first?', [
            o('Nothing'),
            longer('Gel', 15),
            longer('Acrylic', 30),
          ]),
          one(
            'beauty.nail-finish',
            'Finish',
            'Which finish?',
            [o('Polish'), paid('Gel'), paid('Builder gel'), paid('Acrylic', 30)],
            REQUIRED,
          ),
          one('beauty.nail-length', 'Length', 'How long?', [o('Short'), o('Medium'), paid('Long')]),
          one('beauty.nail-shape', 'Shape', 'Which shape?', plain('Round', 'Square', 'Almond', 'Coffin', 'Stiletto')),
          one('beauty.nail-art', 'Nail art', 'Any nail art?', [
            o('None'),
            paid('A little', 15),
            paid('Every nail', 30),
          ]),
        ],
        notePrompt: 'Describe the look you want, or the colour.',
      },
      'Eyebrows & Lashes': {
        add: [
          one(
            'beauty.lash-service',
            'Lashes',
            'What would you like?',
            plain('A full set', 'A fill', 'Removal'),
            REQUIRED,
          ),
          one('beauty.lash-style', 'Style', 'Which style?', [
            o('Classic'),
            paid('Hybrid'),
            paid('Volume'),
            paid('Mega volume'),
          ]),
          one('beauty.lash-look', 'Look', 'Which look?', plain('Natural', 'Cat eye', 'Wispy')),
          one('beauty.other-salon', 'Another salon’s lashes', 'Are you wearing lashes from another salon?', [
            longer('Yes, please remove them', 15),
          ]),
          several(
            'beauty.eyes',
            'Eyes',
            'Anything about your eyes?',
            plain('I wear contact lenses', 'Sensitive eyes'),
            PRIVATE,
          ),
        ],
      },
      Massage: {
        add: [
          one(
            'beauty.massage-length',
            'Length',
            'How long?',
            [o('30 minutes'), paid('60 minutes', 30), paid('90 minutes', 60), paid('120 minutes', 90)],
            { ...REQUIRED, hint: 'Set the service’s own length to 30 minutes when using this.' },
          ),
          one('beauty.pressure', 'Pressure', 'How firm?', plain('Light', 'Medium', 'Firm', 'Deep')),
          several(
            'beauty.focus',
            'Focus on',
            'Where should we focus?',
            plain('Back', 'Neck and shoulders', 'Legs', 'Feet', 'Head'),
          ),
          several(
            'beauty.avoid',
            'Areas to avoid',
            'Anywhere to avoid?',
            plain('Back', 'Neck and shoulders', 'Legs', 'Feet', 'Head'),
          ),
          several('beauty.massage-extras', 'Extras', 'Anything to add?', [
            paid('Hot stones'),
            paid('Aromatherapy'),
            paid('A scrub', 15),
          ]),
          PRACTITIONER,
          several(
            'beauty.tell-therapist',
            'Tell your therapist',
            'Anything your therapist should know?',
            plain(
              'Pregnant',
              'A recent injury',
              'High blood pressure',
              'Oil or nut allergy',
              'I’d rather say in person',
            ),
            PRIVATE,
          ),
        ],
        notePrompt: 'Anything that would make it better for you?',
      },
      'Make-up': {
        add: [
          one(
            'beauty.makeup-occasion',
            'Occasion',
            'What is it for?',
            [o('Everyday'), o('An event'), paid('Bridal', 30), o('A photoshoot')],
            REQUIRED,
          ),
          one('beauty.makeup-look', 'Look', 'Which look?', plain('Natural', 'Soft glam', 'Full glam')),
          one('beauty.makeup-lashes', 'Lashes', 'Add false lashes?', [paid('Yes, add lashes')]),
          one('beauty.makeup-people', 'People', 'Who is getting make-up?', [
            o('Just me'),
            paid('Me and 1 more', 45),
            paid('Me and 2 more', 90),
            paid('Me and 3 more', 135),
          ]),
        ],
        notePrompt: 'Describe the look you want, or send a picture in the booking’s messages.',
      },
      'Hair Removal': {
        add: [
          several(
            'beauty.areas',
            'Areas',
            'Which areas?',
            [
              o('Eyebrows'),
              o('Upper lip'),
              o('Underarms'),
              paid('Arms', 15),
              paid('Half legs', 20),
              paid('Full legs', 40),
              paid('Bikini', 20),
              paid('Back', 20),
            ],
            REQUIRED,
          ),
          one('beauty.removal-method', 'Method', 'Which method?', plain('Wax', 'Sugaring', 'Threading')),
        ],
      },
      Facials: {
        add: [
          several(
            'beauty.skin-goal',
            'Skin goal',
            'What would you like for your skin?',
            plain('Glow', 'Clearer skin', 'Calm and soothe', 'Anti-ageing', 'An even tone'),
          ),
          several('beauty.facial-extras', 'Extras', 'Anything to add?', [
            paid('Extractions', 15),
            paid('LED light', 15),
            paid('Eye treatment', 10),
          ]),
        ],
      },
      'Skin & Body Treatments': {
        add: [
          several(
            'beauty.skin-goal',
            'Skin goal',
            'What would you like for your skin?',
            plain('Glow', 'Clearer skin', 'Calm and soothe', 'Anti-ageing', 'An even tone'),
          ),
        ],
      },
      'Spa & Sauna': {
        add: [
          one(
            'beauty.session-length',
            'Session',
            'How long?',
            [o('1 hour'), paid('2 hours', 60), paid('Half a day', 180)],
            REQUIRED,
          ),
          one('beauty.spa-room', 'Private or shared', 'Private or shared?', [o('Shared'), paid('Private')]),
          one(
            'beauty.robe',
            'Robe and towel',
            'Would you like a robe and towel?',
            plain('Yes, please', 'I’ll bring my own'),
          ),
          one('beauty.add-massage', 'Add a massage', 'Add a massage?', [paid('A 30-minute massage', 30)]),
        ],
      },
      'Tattoo & Piercing': {
        add: [
          one('beauty.tattoo-size', 'Size', 'How big?', [
            o('Small, palm-sized'),
            paid('Medium', 60),
            paid('Large', 120),
          ]),
          one('beauty.tattoo-design', 'Design', 'Which design?', [
            o('One of yours'),
            paid('A custom design'),
            paid('A cover-up', 30),
          ]),
          one('beauty.ink', 'Ink', 'Which ink?', [o('Black and grey'), paid('Colour', 30)]),
          one(
            'beauty.piercing',
            'Piercing',
            'Where?',
            plain('Ear lobe', 'Ear cartilage', 'Nose', 'Eyebrow', 'Lip', 'Navel'),
          ),
          one('beauty.jewellery', 'Jewellery', 'Which jewellery?', [
            o('A simple stud'),
            paid('Titanium'),
            paid('Gold'),
          ]),
        ],
      },
      'Med Spa': {
        add: [
          one(
            'beauty.medspa-visit',
            'Visit',
            'Is this your first visit?',
            [longer('First time', 15), o('Returning')],
            REQUIRED,
          ),
          one('beauty.medspa-area', 'Area', 'Which area?', plain('Face', 'Neck', 'Body')),
          one(
            'beauty.consult-only',
            'Consultation only',
            'Just a consultation this time?',
            plain('Yes, consultation only'),
          ),
        ],
      },
    },
  },

  Wellness: {
    notePrompt: 'Anything you would like your practitioner to know before the first visit? Only they will see it.',
    common: [
      one(
        'wellness.visit',
        'Visit',
        'Is this your first visit?',
        [longer('First visit', 30, 'Time to get to know you.'), o('Follow-up')],
        REQUIRED,
      ),
      one(
        'wellness.meet',
        'How we meet',
        'How would you like to meet?',
        [o('In person'), o('Video call'), paid('A home visit')],
        {
          ...REQUIRED,
          hint: 'Remove the ways you do not offer.',
        },
      ),
      PRACTITIONER,
      one('wellness.language', 'Language', 'Which language?', LANGUAGES),
    ],
    types: {
      Acupuncture: {
        add: [one('wellness.cupping', 'Cupping', 'Add cupping?', [paid('Yes, add cupping', 15)])],
      },
      Chiropractic: {
        add: [
          several(
            'wellness.body-area',
            'Body area',
            'Where does it bother you?',
            plain('Neck', 'Shoulder', 'Back', 'Hip', 'Knee', 'Ankle or foot', 'Wrist or hand'),
            PRIVATE,
          ),
          one('wellness.referral', 'Referral', 'Do you have a doctor’s referral?', plain('Yes, I have one', 'No')),
        ],
      },
      'Physiotherapy & Rehab': {
        add: [
          several(
            'wellness.body-area',
            'Body area',
            'Where does it bother you?',
            plain('Neck', 'Shoulder', 'Back', 'Hip', 'Knee', 'Ankle or foot', 'Wrist or hand'),
            PRIVATE,
          ),
          one('wellness.referral', 'Referral', 'Do you have a doctor’s referral?', plain('Yes, I have one', 'No')),
        ],
      },
      'Meditation & Yoga': {
        add: [
          one(
            'wellness.yoga-level',
            'Level',
            'How much have you practised?',
            plain('Beginner', 'Some practice', 'Experienced'),
          ),
          one('wellness.yoga-format', 'Group or private', 'Group or private?', [o('Group'), paid('Private')]),
          one('wellness.mat', 'Mat', 'Do you need a mat?', [o('I’ll bring my own'), paid('Hire a mat')]),
        ],
        skip: ['people.practitioner'],
      },
      Therapy: {
        add: [
          one(
            'wellness.therapy-for',
            'Who for',
            'Who are the sessions for?',
            plain('Just me', 'A couple', 'A family', 'A child or teenager'),
            { ...REQUIRED, hint: 'Never ask the reason here: that is for the first session.' },
          ),
        ],
      },
    },
  },

  'Health & Medical': {
    notePrompt:
      'Anything the clinic should know before you arrive? Please don’t write medical history here; the clinic will ask in private.',
    common: [
      one('health.patient', 'Patient', 'Who is the patient?', plain('Me', 'My child', 'Someone else'), REQUIRED),
      one(
        'health.new',
        'New or returning',
        'Have you been here before?',
        [longer('New patient', 15), o('Returning')],
        REQUIRED,
      ),
      one(
        'health.payment',
        'Payment',
        'How will you pay?',
        [
          o('Myself (MoMo or cash)'),
          o('RSSB', { description: 'Bring your insurance card.' }),
          o('MMI', { description: 'Bring your insurance card.' }),
          o('Mutuelle de Santé', { description: 'Bring your insurance card.' }),
          o('A private insurer', { description: 'Bring your insurance card.' }),
          o('Another way'),
        ],
        { ...REQUIRED, hint: 'Remove the insurers you do not accept.' },
      ),
      one('health.referral', 'Referral', 'Do you have a referral?', plain('I have a referral', 'No referral')),
    ],
    types: {
      Dental: {
        add: [
          one(
            'health.dental-visit',
            'Visit',
            'What is the visit for?',
            [
              o('Check-up and cleaning'),
              o('Toothache or urgent'),
              longer('A filling', 15),
              longer('An extraction', 15),
              longer('Whitening', 30),
              o('A braces consultation'),
              o('A child’s check-up'),
            ],
            REQUIRED,
          ),
          one('health.nervous', 'Nervous', 'Do you feel nervous at the dentist?', plain('Yes, a little care, please')),
        ],
      },
      'Eye Care': {
        add: [
          one(
            'health.eye-visit',
            'Visit',
            'What is the visit for?',
            [o('An eye test'), longer('A contact-lens fitting', 15), o('Collecting glasses'), o('An eye problem')],
            REQUIRED,
          ),
        ],
      },
      'Lab Tests': {
        add: [
          several(
            'health.tests',
            'Tests',
            'Which tests?',
            plain(
              'Blood count',
              'Blood sugar',
              'Cholesterol',
              'Malaria',
              'Urine test',
              'Pregnancy test',
              'Other tests',
            ),
            { ...REQUIRED, ...PRIVATE, hint: 'Private: the name of a test can say a lot about someone’s health.' },
          ),
          one('health.home-sample', 'Home collection', 'Shall we take the sample at your home?', [
            paid('Yes, at my home'),
          ]),
        ],
      },
      Vaccinations: {
        add: [
          one(
            'health.vaccine',
            'Vaccine',
            'Which vaccine?',
            plain('Yellow fever', 'Hepatitis B', 'Typhoid', 'Rabies', 'HPV', 'Flu', 'Another vaccine'),
            { ...REQUIRED, ...PRIVATE },
          ),
          one('health.dose', 'Dose', 'Which dose?', plain('First dose', 'Second dose', 'A booster'), PRIVATE),
        ],
      },
      'Specialist Consultation': {
        add: [
          one('health.past-results', 'Past results', 'Will you bring past results?', plain('Yes, I’ll bring them')),
        ],
      },
    },
  },

  Automotive: {
    notePrompt: 'Make, model and year, and what you notice: when it happens, any sounds or dashboard lights.',
    common: [
      one(
        'auto.vehicle',
        'Vehicle',
        'What are you bringing?',
        [
          o('Saloon or hatchback'),
          paid('SUV or 4x4', 15, 'Like a RAV4.'),
          paid('Pick-up or van', 15),
          paid('Minibus'),
          o('Motorcycle'),
        ],
        REQUIRED,
      ),
      one('auto.wait', 'Wait or leave', 'Will you wait?', [
        o('I’ll wait'),
        o('I’ll leave it with you'),
        paid('Pick it up and bring it back'),
      ]),
    ],
    types: {
      'Car Wash & Detailing': {
        add: [
          one(
            'auto.wash',
            'Wash',
            'Which wash?',
            [o('Outside only'), paid('Plus inside: vacuum and windows'), paid('Full valet', 90)],
            REQUIRED,
          ),
          several('auto.wash-extras', 'Extras', 'Anything to add?', [
            paid('Engine wash', 20),
            paid('Wax or polish', 30),
            paid('Seat and carpet shampoo', 60),
            paid('Pet hair', 30),
            paid('Very muddy', 15),
          ]),
        ],
      },
      'Car Repair & Mechanic': {
        add: [
          one(
            'auto.repair',
            'What you need',
            'What do you need?',
            plain(
              'Find a problem',
              'A routine service',
              'Brakes',
              'Suspension',
              'Air conditioning',
              'Battery, or it won’t start',
              'Lights and wiring',
            ),
            REQUIRED,
          ),
          several(
            'auto.signs',
            'Signs',
            'What have you noticed?',
            plain('A warning light', 'A noise', 'Overheating', 'A leak', 'Shaking'),
          ),
        ],
        priceAtShop: true,
      },
      'Auto Electrical': {
        add: [
          one(
            'auto.repair',
            'What you need',
            'What do you need?',
            plain(
              'Find a problem',
              'A routine service',
              'Brakes',
              'Suspension',
              'Air conditioning',
              'Battery, or it won’t start',
              'Lights and wiring',
            ),
            REQUIRED,
          ),
          several(
            'auto.signs',
            'Signs',
            'What have you noticed?',
            plain('A warning light', 'A noise', 'Overheating', 'A leak', 'Shaking'),
          ),
        ],
        priceAtShop: true,
      },
      'Tyre & Wheel Services': {
        add: [
          one(
            'auto.tyre-job',
            'The job',
            'What do you need?',
            plain('A puncture', 'Fit new tyres', 'Balancing', 'Alignment', 'Rotation'),
            REQUIRED,
          ),
          one('auto.wheels', 'Wheels', 'How many wheels?', [o('1'), paid('2', 15), paid('4', 30)], REQUIRED),
          one('auto.tyres-from', 'Tyres', 'Where are the tyres from?', [paid('Buy them here'), o('I’ll bring them')]),
        ],
      },
      'Driving School': {
        add: [
          one(
            'auto.licence',
            'Category',
            'Which licence?',
            plain('A: motorcycle', 'B: car', 'C: truck', 'D: bus'),
            REQUIRED,
          ),
          one(
            'auto.gearbox',
            'Gearbox',
            'Manual or automatic?',
            [o('Manual'), o('Automatic', { description: 'A test in an automatic lets you drive automatics only.' })],
            REQUIRED,
          ),
          one(
            'auto.lesson',
            'Lesson',
            'Which lesson?',
            [o('Theory'), o('Driving'), paid('Test day: the car and a warm-up')],
            REQUIRED,
          ),
        ],
        skip: ['auto.vehicle', 'auto.wait'],
        notePrompt: 'How much have you driven before?',
      },
      'Vehicle Inspection': {
        add: [],
        notePrompt: 'Make, model and year of the vehicle.',
      },
    },
  },

  'Home Services': {
    notePrompt: 'What’s the problem, where in the house, and since when? Gate, parking or rooms to skip?',
    common: [
      one(
        'home.access',
        'Who lets you in',
        'Who will let us in?',
        [o('Me'), o('A house helper or guard'), o('A key arrangement', { description: 'Shown to the shop only.' })],
        REQUIRED,
      ),
      several('home.pets', 'Pets at home', 'Any pets at home?', plain('A dog', 'A cat')),
      several(
        'home.health',
        'At home',
        'Anyone at home we should take care around?',
        plain('A baby or someone pregnant', 'Allergies or asthma: mild products, please', 'Children under 5'),
        PRIVATE,
      ),
    ],
    types: {
      'Cleaning Services': {
        add: [
          one(
            'home.bedrooms',
            'Bedrooms',
            'How many bedrooms?',
            [o('1'), paid('2', 30), paid('3', 60), paid('4 or more', 90)],
            REQUIRED,
          ),
          one(
            'home.bathrooms',
            'Bathrooms',
            'How many bathrooms?',
            [o('1'), paid('2', 20), paid('3 or more', 40)],
            REQUIRED,
          ),
          one(
            'home.clean',
            'Type of clean',
            'Which clean?',
            [o('Regular'), paid('Deep', 120), paid('Moving in or out', 120), paid('After building work')],
            REQUIRED,
          ),
          several('home.clean-extras', 'Extras', 'Anything to add?', [
            paid('Inside the fridge', 30),
            paid('Inside the oven', 30),
            paid('Inside cupboards', 30),
            paid('Inside windows', 30),
            paid('Laundry', 60),
            paid('Ironing', 60),
            paid('Sofa or mattress shampoo'),
          ]),
          one(
            'home.supplies',
            'Cleaning supplies',
            'Who brings the cleaning supplies?',
            [o('I have them'), paid('Please bring them')],
            REQUIRED,
          ),
        ],
      },
      Plumbing: {
        add: [
          one(
            'home.plumbing',
            'The problem',
            'What is the problem?',
            plain(
              'A leak',
              'A blocked drain or toilet',
              'No water, or low pressure',
              'The tank or pump',
              'The water heater',
              'A new fitting',
            ),
            REQUIRED,
          ),
          one('home.urgent', 'Urgent', 'Is it urgent?', [paid('Yes, as soon as possible')]),
        ],
        priceAtShop: true,
      },
      Electrical: {
        add: [
          one(
            'home.electrical',
            'The problem',
            'What is the problem?',
            [
              ...plain('No power in part of the house', 'Sockets or switches', 'Lights', 'New wiring or a fitting'),
              o('A burning smell or sparks', { description: 'Urgent: switch off at the main switch now.' }),
            ],
            { ...REQUIRED, hint: 'Power cuts and Cash Power tokens are for EUCL, on 2727.' },
          ),
          one('home.urgent', 'Urgent', 'Is it urgent?', [paid('Yes, as soon as possible')]),
        ],
        priceAtShop: true,
      },
      'Painting & Decorating': {
        add: [
          one('home.paint-where', 'Where', 'Inside or outside?', plain('Inside', 'Outside', 'Both'), REQUIRED),
          one('home.rooms', 'Rooms', 'How many rooms?', [o('1 room'), paid('2 to 3 rooms'), paid('4 or more')]),
          one('home.paint', 'Paint', 'Who brings the paint?', [paid('The painter'), o('I have the paint')], REQUIRED),
        ],
        priceAtShop: true,
      },
      'Carpentry & Furniture Repair': {
        priceAtShop: true,
      },
      'Pest Control': {
        add: [
          several(
            'home.pests',
            'Pests',
            'Which pests?',
            plain('Cockroaches', 'Bedbugs', 'Termites', 'Rats or mice', 'Mosquitoes', 'Ants'),
            REQUIRED,
          ),
          one(
            'home.area',
            'Area',
            'How big an area?',
            [o('Kitchen and bathroom'), paid('An apartment'), paid('A house'), paid('A compound')],
            REQUIRED,
          ),
          one('home.kitchen-prep', 'Kitchen', 'Shall we empty the kitchen cupboards for you?', [
            paid('Yes, please', 30),
          ]),
        ],
      },
    },
  },

  'Pet Services': {
    notePrompt: 'Anything about your pet’s health, habits or handling: allergies, medicines, fears, feeding times?',
    common: [
      one('pets.pet', 'Pet', 'Which pet?', plain('Dog', 'Cat', 'Another pet'), REQUIRED),
      one(
        'pets.size',
        'Dog size',
        'How big is your dog?',
        [
          o('Small, under 7 kg'),
          o('Medium, 7 to 18 kg'),
          paid('Large, 18 to 45 kg', 15),
          paid('Giant, over 45 kg', 30),
        ],
        { ...REQUIRED, showIf: { key: 'pets.pet', option: 'Dog' } },
      ),
      one('pets.how-many', 'How many', 'How many pets?', [o('1'), paid('2'), paid('3 or more')]),
      one(
        'pets.rabies',
        'Rabies vaccine',
        'A rabies vaccine in the last 12 months?',
        plain('Yes, I’ll bring the card', 'No, or not sure'),
        REQUIRED,
      ),
      several(
        'pets.temperament',
        'Temperament',
        'How is your pet with people and other animals?',
        plain('Friendly', 'Nervous', 'Not good with other dogs', 'May bite: needs a muzzle'),
        REQUIRED,
      ),
    ],
    types: {
      'Pet Grooming': {
        add: [
          one(
            'pets.groom',
            'Groom',
            'Which groom?',
            [
              o('Bath and brush'),
              longer('Bath and tidy', 15),
              paid('Full cut', 30),
              paid('Shave down', 30),
              o('Same as last time'),
            ],
            REQUIRED,
          ),
          one(
            'pets.coat',
            'Coat',
            'What is the coat like?',
            [o('Short'), longer('Long', 30), paid('Matted', 30)],
            REQUIRED,
          ),
          several('pets.groom-extras', 'Extras', 'Anything to add?', [
            ...plain('Nails', 'Ears', 'Teeth'),
            paid('De-shedding', 15),
            paid('Flea treatment'),
          ]),
        ],
      },
      'Dog Training': {
        add: [
          one(
            'pets.training',
            'Training',
            'What would you like to work on?',
            plain('Puppy basics', 'Obedience', 'Walking on a lead', 'Barking or biting', 'Guard-dog training'),
            REQUIRED,
          ),
          one('pets.training-where', 'Where', 'Where?', [o('At the school'), paid('At home')], REQUIRED),
        ],
      },
      'Pet Sitting & Boarding': {
        add: [
          one('pets.food', 'Food', 'Who brings the food?', [o('I’ll bring it'), paid('Please provide it')]),
          one('pets.medicine', 'Medicine', 'Does your pet take medicine?', plain('Yes: I’ll explain at drop-off')),
        ],
      },
      'Dog Walking': {
        add: [
          one(
            'pets.walk',
            'Walk',
            'How long a walk?',
            [o('20 minutes'), longer('30 minutes', 10), paid('60 minutes', 40)],
            REQUIRED,
          ),
          one(
            'pets.handover',
            'Handover',
            'How do we collect your dog?',
            plain('I’ll be home', 'A key arrangement', 'A house helper or guard'),
            REQUIRED,
          ),
        ],
      },
      'Veterinary Clinic': {
        add: [
          one(
            'pets.vet-reason',
            'Visit',
            'What is the visit for?',
            [
              o('Vaccination'),
              o('Check-up'),
              o('Sick or injured'),
              o('Skin or ears'),
              longer('Spay or neuter', 60),
              o('Travel papers'),
            ],
            { ...REQUIRED, hint: 'For an emergency, customers should call you — your number is on your page.' },
          ),
          one('pets.vet-where', 'Where', 'At the clinic or at home?', [o('At the clinic'), paid('A home visit')]),
        ],
      },
    },
  },

  'Fashion & Tailoring': {
    notePrompt: 'Describe the style or fit you want, and anything about the fabric: delicate, colours may run, stains.',
    common: [
      one('fashion.ready-by', 'Ready by', 'How soon do you need it?', [o('The usual time'), paid('Rush')], REQUIRED),
    ],
    types: {
      'Custom Clothing': {
        add: [
          one(
            'fashion.item',
            'Item',
            'What are we making?',
            plain('A dress', 'A shirt', 'A suit', 'A two-piece', 'Umushanana', 'A ceremony outfit', 'A uniform'),
            REQUIRED,
          ),
          one(
            'fashion.fabric',
            'Fabric',
            'Whose fabric?',
            [o('I bring my own (kitenge or other)'), paid('Choose at the shop'), o('Not sure yet')],
            REQUIRED,
          ),
          one(
            'fashion.fabric-amount',
            'Fabric amount',
            'How much fabric?',
            plain('Half a piece (6 yards)', 'A full piece (12 yards)', 'Not sure'),
          ),
          one(
            'fashion.measurements',
            'Measurements',
            'Measurements?',
            [longer('Measure me this visit', 15), o('Use the ones you have')],
            REQUIRED,
          ),
        ],
        notePrompt: 'Describe the style you want. The shop tells you the ready date.',
      },
      'Tailoring & Alterations': {
        add: [
          several(
            'fashion.alterations',
            'Alterations',
            'What needs doing?',
            [
              paid('Shorten'),
              paid('Take in'),
              paid('Let out'),
              paid('Taper'),
              paid('A zip'),
              paid('A tear'),
              paid('Sleeves'),
            ],
            REQUIRED,
          ),
        ],
      },
      'Fittings & Styling': {
        add: [
          one(
            'fashion.measurements',
            'Measurements',
            'Measurements?',
            [longer('Measure me this visit', 15), o('Use the ones you have')],
            REQUIRED,
          ),
        ],
      },
      'Shoe Repair': {
        add: [
          several(
            'fashion.shoe-repair',
            'Repair',
            'What needs doing?',
            [
              paid('Re-heel'),
              paid('Re-sole'),
              paid('Stitching'),
              paid('Cleaning'),
              paid('Stretching'),
              paid('Recolour'),
            ],
            REQUIRED,
          ),
          one('fashion.pairs', 'Pairs', 'How many pairs?', [o('1 pair'), paid('2 pairs'), paid('3 or more')]),
        ],
      },
      'Laundry & Dry Cleaning': {
        add: [
          one(
            'fashion.laundry',
            'Service',
            'Which service?',
            plain('Wash and fold, by the kilo', 'Wash and iron, by the item', 'Iron only', 'Dry cleaning'),
            REQUIRED,
          ),
          one(
            'fashion.laundry-amount',
            'Amount',
            'About how much?',
            [o('Up to 5 kg'), paid('5 to 10 kg'), paid('Over 10 kg')],
            REQUIRED,
          ),
          several('fashion.special-items', 'Special items', 'Any special items?', [
            paid('A suit'),
            paid('A wedding dress'),
            paid('Umushanana'),
            paid('A bedcover'),
            paid('Curtains'),
          ]),
          one('fashion.pickup', 'Pick-up', 'Shall we collect and deliver?', [
            o('I’ll drop off and collect'),
            paid('Collect and deliver'),
          ]),
          several(
            'fashion.laundry-care',
            'Care',
            'Any care wishes?',
            plain('Mild detergent', 'Hang to dry', 'No starch'),
          ),
        ],
        notePrompt:
          'Anything about the clothes: delicate, colours may run, stains? The shop tells you when it is ready.',
      },
    },
  },

  'Fitness & Sports': {
    notePrompt: 'Anything the team should know before you come?',
    common: [BEFORE_EXERCISE],
    types: {
      'Football Pitch': {
        add: [
          one('fitness.extra-time', 'Extra time', 'Play longer?', [
            paid('30 more minutes', 30),
            paid('60 more minutes', 60),
          ]),
          several('fitness.equipment', 'Equipment', 'Anything to hire?', [
            paid('A ball'),
            paid('Bibs for both teams'),
            paid('Water'),
          ]),
          one('fitness.referee', 'Referee', 'Would you like a referee?', [paid('Yes, a referee')]),
        ],
        skip: ['fitness.before-start'],
      },
      'Sports Courts': {
        add: [
          one('fitness.extra-time', 'Extra time', 'Play longer?', [
            paid('30 more minutes', 30),
            paid('60 more minutes', 60),
          ]),
          several('fitness.court-equipment', 'Equipment', 'Anything to hire?', [
            paid('Rackets for 2'),
            paid('Rackets for 4'),
            paid('Balls'),
            paid('Water'),
          ]),
          one('fitness.referee', 'Referee', 'Would you like a referee?', [paid('Yes, a referee')]),
        ],
        skip: ['fitness.before-start'],
      },
      Gym: {
        add: [
          one('fitness.gym-first', 'First visit', 'Is this your first visit?', [
            longer('Yes: show me around', 15),
            o('No'),
          ]),
          several('fitness.gym-extras', 'Extras', 'Anything to add?', [
            paid('A towel'),
            paid('A locker'),
            paid('The pool'),
            paid('The sauna'),
          ]),
          one('fitness.trainer-intro', 'Trainer', 'Would you like to meet a trainer?', plain('Yes, please')),
        ],
      },
      Swimming: {
        add: [
          one(
            'fitness.swimmer',
            'Swimmer',
            'Who is swimming?',
            plain('A child under 5, with a parent', 'A child, 5 to 15', 'An adult'),
            REQUIRED,
          ),
          one(
            'fitness.experience',
            'Experience',
            'How much have you done before?',
            plain('First time', 'Some', 'Regularly'),
            REQUIRED,
          ),
        ],
      },
      'Martial Arts': {
        add: [
          one(
            'fitness.experience',
            'Experience',
            'How much have you done before?',
            plain('First time', 'Some', 'Regularly'),
            REQUIRED,
          ),
        ],
      },
      'Dance Studio': {
        add: [
          one(
            'fitness.experience',
            'Experience',
            'How much have you done before?',
            plain('First time', 'Some', 'Regularly'),
            REQUIRED,
          ),
        ],
      },
      Pilates: {
        add: [
          one(
            'fitness.experience',
            'Experience',
            'How much have you done before?',
            plain('First time', 'Some', 'Regularly'),
            REQUIRED,
          ),
          one('fitness.pilates', 'Mat or reformer', 'Mat or reformer?', [o('Mat'), paid('Reformer')], REQUIRED),
        ],
      },
    },
  },

  'Group Classes & Activities': {
    notePrompt: 'Anything that would help the host prepare?',
    common: [
      one(
        'classes.level',
        'Level',
        'How much have you done before?',
        plain('First time', 'Some experience', 'Experienced'),
        REQUIRED,
      ),
      one(
        'classes.who',
        'Who is coming',
        'Who is coming?',
        plain('Adults only', 'Includes children under 12', 'Includes teenagers'),
        REQUIRED,
      ),
      one('classes.language', 'Language', 'Which language?', LANGUAGES),
    ],
    types: {
      'Art, Music & Culture': {
        add: [
          one('classes.materials', 'Materials', 'Materials?', [paid('Use yours'), o('I’ll bring my own')]),
          one('classes.frame', 'Frame', 'Take your work home in a frame?', [paid('Yes, a frame')]),
          one('classes.instrument', 'Instrument', 'Do you have an instrument?', [
            o('I’ll bring my own'),
            paid('Borrow one'),
          ]),
        ],
      },
      'Cooking Classes': {
        add: [
          DIET,
          several(
            'classes.allergies',
            'Allergies',
            'Any food allergies?',
            plain('Nuts', 'Gluten', 'Milk', 'Eggs', 'Seafood'),
            PRIVATE,
          ),
          one('classes.takehome', 'Take-home box', 'A box to take food home?', [paid('Yes, a box')]),
        ],
      },
      Recreational: {
        add: [
          one('classes.occasion', 'Occasion', 'Is it for an occasion?', plain('A birthday', 'A team outing', 'A date')),
          several('classes.party', 'Party extras', 'Anything for the occasion?', [paid('A cake'), paid('Decorations')]),
        ],
      },
      "Kids' Activities": {
        add: [
          one('classes.occasion', 'Occasion', 'Is it for an occasion?', plain('A birthday', 'A team outing', 'A date')),
          several('classes.party', 'Party extras', 'Anything for the occasion?', [paid('A cake'), paid('Decorations')]),
        ],
      },
      Professional: {
        add: [
          one('classes.laptop', 'Laptop', 'Do you have a laptop?', [o('I’ll bring mine'), paid('Borrow one')]),
          one('classes.certificate', 'Certificate', 'Would you like a certificate?', [paid('Yes, a certificate')]),
        ],
      },
      Educational: {
        add: [one('classes.laptop', 'Laptop', 'Do you have a laptop?', [o('I’ll bring mine'), paid('Borrow one')])],
      },
      'Sports & Fitness': {
        add: [BEFORE_EXERCISE],
      },
    },
  },

  'Photography & Creative Services': {
    notePrompt: 'Describe the look you want: a link you like, the key people to capture, or a shot list.',
    common: [],
    types: {
      'Portrait Photography': {
        add: [
          one(
            'photo.session',
            'Session',
            'Who is in the photos?',
            [o('Just me'), o('A couple'), longer('A family', 30), o('A graduation')],
            REQUIRED,
          ),
          one(
            'photo.where',
            'Where',
            'Where?',
            [o('In the studio'), paid('Outdoors in Kigali', 30), paid('At your place', 30)],
            REQUIRED,
          ),
          one('photo.edited', 'Edited photos', 'How many edited photos?', [o('5'), paid('15'), paid('30')], {
            ...REQUIRED,
            hint: 'Editing happens after the visit: it adds to the price, never to the time.',
          }),
          several('photo.extras', 'Extras', 'Anything to add?', [
            paid('All the unedited files'),
            paid('Prints'),
            paid('Ready in 24 hours'),
            paid('A make-up artist'),
            longer('An extra outfit', 15),
          ]),
        ],
      },
      'Event Photography': {
        add: [
          one(
            'photo.event-type',
            'Event type',
            'What is the event?',
            plain('A wedding', 'A traditional ceremony', 'A birthday', 'Corporate', 'Something else'),
            REQUIRED,
          ),
          one('photo.coverage', 'Extra coverage', 'Need more time?', [
            paid('1 more hour', 60),
            paid('2 more hours', 120),
          ]),
          several('photo.event-extras', 'Extras', 'Anything to add?', [
            paid('A second photographer'),
            paid('A highlight video'),
          ]),
          one('photo.edited', 'Edited photos', 'How many edited photos?', [o('5'), paid('15'), paid('30')], {
            ...REQUIRED,
            hint: 'Editing happens after the visit: it adds to the price, never to the time.',
          }),
        ],
      },
      'Product Photography': {
        add: [
          one('photo.items', 'Items', 'How many items?', [o('Up to 5'), paid('6 to 15'), paid('16 to 30')], REQUIRED),
          one('photo.background', 'Background', 'Which background?', [o('White'), paid('A styled scene')], REQUIRED),
          one('photo.model', 'Model', 'With a model?', [paid('Yes, with a model')]),
        ],
      },
      Videography: {
        add: [
          one(
            'photo.video-length',
            'Length',
            'How long a video?',
            [o('A 1-minute reel'), paid('3 to 5 minutes'), paid('The full event')],
            REQUIRED,
          ),
          several('photo.subtitles', 'Subtitles', 'Subtitles?', [paid('Kinyarwanda'), paid('English'), paid('French')]),
        ],
      },
      'Graphic Design': {
        add: [
          one(
            'photo.design',
            'Design',
            'What do you need?',
            plain('A logo', 'A flyer', 'A social media set', 'Business cards'),
            REQUIRED,
          ),
          several('photo.design-extras', 'Extras', 'Anything to add?', [paid('Extra rounds of changes'), paid('Rush')]),
        ],
      },
      'Studio Rental': {
        add: [
          one('photo.studio-use', 'Use', 'What is it for?', plain('Photos', 'Video', 'A podcast'), REQUIRED),
          one('photo.studio-people', 'People', 'How many people on set?', plain('1 or 2', '3 to 5', '6 or more')),
          several('photo.studio-extras', 'Extras', 'Anything to add?', [
            paid('Lights'),
            paid('A backdrop'),
            paid('Props'),
          ]),
        ],
      },
      'Recording Studio': {
        add: [
          one(
            'photo.engineer',
            'Engineer',
            'With an engineer?',
            [paid('With an engineer'), o('I’ll run it myself')],
            REQUIRED,
          ),
          several(
            'photo.recording-extras',
            'Extras',
            'Anything after the session?',
            [paid('Mixing'), paid('Mastering'), paid('Separate tracks')],
            { hint: 'Work after the visit: it adds to the price, never to the time.' },
          ),
        ],
      },
    },
  },

  'Tours & Experiences': {
    notePrompt:
      'Where are you staying, and anything we should plan around? (arrival time, a celebration, a slow walker)',
    common: [
      one(
        'tours.language',
        'Guide language',
        'Which language for your guide?',
        [...LANGUAGES, o('Another language')],
        REQUIRED,
      ),
      one('tours.group', 'Group', 'Shared or private?', [o('A shared group'), paid('Private')], REQUIRED),
      one(
        'tours.pickup',
        'Pick-up',
        'Where shall we meet?',
        [o('At the start'), paid('Pick me up in Kigali', 60), paid('Pick me up near the park')],
        REQUIRED,
      ),
      one(
        'tours.who',
        'Who is coming',
        'Who is coming?',
        plain('Adults only', 'Includes children 6 to 12', 'Includes children under 6'),
        {
          ...REQUIRED,
          hint: 'Say any age limits in the service’s description.',
        },
      ),
      one('tours.pace', 'Walking pace', 'What pace suits you?', plain('Easy', 'Moderate', 'Strong')),
      several(
        'tours.health',
        'Mobility and health',
        'Anything the guide should know?',
        plain('A walking aid', 'Knee or back trouble', 'Pregnant', 'A heart or breathing condition'),
        PRIVATE,
      ),
      DIET,
      FOOD_ALLERGIES,
      several('tours.extras', 'Extras', 'Anything to add?', [
        o('A porter', { description: 'Paid in cash on the day.' }),
        paid('A packed lunch'),
        paid('A sunset boat or night drive', 60),
      ]),
    ],
    types: {
      'Gorilla & Wildlife Trekking': {
        add: [
          one(
            'tours.fee',
            'Fee category',
            'Which park fees apply to you?',
            plain('International visitor', 'African resident or citizen', 'Rwandan or East African'),
            REQUIRED,
          ),
          one('tours.permit', 'Permit', 'Do you have your permit?', plain('I have mine', 'Please help me book it'), {
            ...REQUIRED,
            hint: 'Never sell permits: RDB issues them to named passport holders.',
          }),
        ],
      },
      'Safaris & Game Drives': {
        add: [
          one(
            'tours.fee',
            'Fee category',
            'Which park fees apply to you?',
            plain('International visitor', 'African resident or citizen', 'Rwandan or East African'),
            REQUIRED,
          ),
        ],
      },
    },
  },

  Services: {
    notePrompt: 'What would you like to get out of this session?',
    common: [
      one(
        'services.meet',
        'How we meet',
        'How would you like to meet?',
        [o('At the office'), o('A video call'), o('A phone call'), paid('At your place', 30)],
        { ...REQUIRED, hint: 'Remove the ways you do not offer.' },
      ),
      one('services.language', 'Language', 'Which language?', LANGUAGES, REQUIRED),
      one('services.visit', 'Visit', 'Is this your first session?', [longer('First session', 15), o('Follow-up')]),
    ],
    types: {
      'Personal Training': {
        add: [
          one(
            'services.goal',
            'Goal',
            'What is your goal?',
            plain('Lose weight', 'Build strength', 'A sport', 'Back to exercise after an injury'),
          ),
          one('services.where', 'Where', 'Where shall we train?', [o('At the gym'), o('At home'), paid('Outdoors')]),
          BEFORE_EXERCISE,
        ],
        skip: ['services.meet'],
      },
      Tutoring: {
        add: [
          one(
            'services.subject',
            'Subject',
            'Which subject?',
            plain('Maths', 'Sciences', 'English', 'French', 'Kinyarwanda', 'Another subject'),
            REQUIRED,
          ),
          one(
            'services.level',
            'Level',
            'Which level?',
            plain('Primary', 'S1 to S3', 'S4 to S6', 'University', 'Adult'),
            REQUIRED,
          ),
          one('services.aim', 'Aim', 'What is it for?', plain('Exam preparation', 'Homework', 'Catching up')),
          one('services.students', 'Students', 'How many students?', [o('1'), paid('2 or 3')]),
        ],
        notePrompt: 'What would the student like help with?',
      },
      'Legal Consultation': {
        add: [
          one(
            'services.law',
            'Area of law',
            'What is it about?',
            plain(
              'Family',
              'Land and property',
              'Employment',
              'Contracts',
              'Debt',
              'Immigration',
              'Criminal',
              'Something else',
            ),
            { ...REQUIRED, ...PRIVATE, hint: 'Private, and never more than this: the details are for the meeting.' },
          ),
        ],
        notePrompt: 'In one line, what is it about? Keep private details for the meeting.',
      },
      'Accounting & Tax': {
        add: [
          one(
            'services.tax',
            'Help with',
            'What do you need help with?',
            plain('A tax declaration', 'VAT', 'PAYE', 'Bookkeeping', 'Setting up a company'),
            REQUIRED,
          ),
          one(
            'services.client',
            'You are',
            'Who is it for?',
            plain('Me, personally', 'A small business', 'A company'),
            REQUIRED,
          ),
          several(
            'services.bring',
            'Bring',
            'What can you bring?',
            plain('Your TIN', 'Past declarations', 'Bank statements'),
          ),
        ],
      },
      'IT & Tech Support': {
        add: [
          one(
            'services.it-where',
            'Where',
            'How shall we help?',
            [o('Remotely'), o('I’ll bring it in'), paid('At my place', 30)],
            REQUIRED,
          ),
          one(
            'services.device',
            'Device',
            'Which device?',
            plain('A laptop', 'A desktop', 'A phone', 'A printer', 'Network or Wi-Fi', 'Something else'),
            REQUIRED,
          ),
        ],
        skip: ['services.meet'],
        notePrompt: 'What is happening, and since when? Never write a password here.',
      },
      'Translation Services': {
        add: [
          one(
            'services.languages',
            'Languages',
            'From and to which languages?',
            plain(
              'Kinyarwanda and English',
              'Kinyarwanda and French',
              'English and French',
              'Swahili and English',
              'Other languages',
            ),
            REQUIRED,
          ),
          one(
            'services.translation',
            'Type',
            'A document, or live?',
            [o('A document'), longer('Live interpreting', 30)],
            REQUIRED,
          ),
          one('services.pages', 'Pages', 'How many pages?', [o('1 to 5'), paid('6 to 20'), paid('More than 20')]),
          one('services.rush', 'Rush', 'Do you need it fast?', [paid('Yes, rush')]),
        ],
      },
    },
  },
};

// ---------- Reading it ----------

export interface SuggestionSection {
  category: string;
  subcategory: string;
  suggestions: ChoiceSuggestion[];
}

/**
 * The suggestions for a shop's kinds (§265), its main kind first: that
 * type's own questions, then its category's. A question suggested for two
 * kinds is listed once, under the first.
 */
export function suggestionsFor(kinds: readonly ShopKind[]): SuggestionSection[] {
  const listed = new Set<string>();
  const sections: SuggestionSection[] = [];
  for (const kind of kinds) {
    const catalog = CATALOG[kind.category.name];
    if (!catalog) continue;
    const type = catalog.types?.[kind.subcategory.name];
    const skip = new Set(type?.skip ?? []);
    const suggestions = [...(type?.add ?? []), ...catalog.common.filter((s) => !skip.has(s.key))].filter((s) => {
      if (listed.has(s.key)) return false;
      listed.add(s.key);
      return true;
    });
    if (suggestions.length > 0) {
      sections.push({ category: kind.category.name, subcategory: kind.subcategory.name, suggestions });
    }
  }
  return sections;
}

/** The note box's words for a shop's MAIN kind — the first (§265). */
export function notePromptFor(kinds: readonly ShopKind[]): string {
  const main = kinds[0];
  if (!main) return DEFAULT_NOTE_PROMPT;
  const catalog = CATALOG[main.category.name];
  return catalog?.types?.[main.subcategory.name]?.notePrompt ?? catalog?.notePrompt ?? DEFAULT_NOTE_PROMPT;
}

/** Whether shops of this MAIN kind usually price after seeing the job (§300.3). */
export function priceAtShopFor(kinds: readonly ShopKind[]): boolean {
  const main = kinds[0];
  if (!main) return false;
  const catalog = CATALOG[main.category.name];
  return catalog?.types?.[main.subcategory.name]?.priceAtShop ?? catalog?.priceAtShop ?? false;
}

/** Every category and type named here — for the test that keeps them matching the seed. */
export const CATALOGUED = Object.fromEntries(
  Object.entries(CATALOG).map(([category, catalog]) => [category, Object.keys(catalog.types ?? {})]),
);

/** Every suggestion, once — for the test that checks each one could be saved. */
export function everySuggestion(): Array<{ suggestions: ChoiceSuggestion[] }> {
  return Object.values(CATALOG).flatMap((catalog) => [
    { suggestions: catalog.common },
    ...Object.values(catalog.types ?? {}).map((type) => ({
      suggestions: [...(type.add ?? []), ...catalog.common.filter((s) => !(type.skip ?? []).includes(s.key))],
    })),
  ]);
}
