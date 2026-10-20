import { ChoiceKind, SupportActionKind, UserRole } from '@prisma/client';
import { TestingModule } from '@nestjs/testing';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { HealthChoicesSweep } from '../src/appointments/health-choices.sweep';
import { AccountService } from '../src/users/account.service';
import { StorageService } from '../src/storage/storage.service';
import { AvailabilityService } from '../src/availability/availability.service';
import { BusinessAccessService } from '../src/business/business-access.service';
import { LocationsService } from '../src/business/locations.service';
import { ServiceDraftsService } from '../src/business/service-drafts.service';
import { ServicesService } from '../src/business/services.service';
import {
  ChoiceGroup,
  ChoiceGroupInput,
  assertFitsInADay,
  isWish,
  maxExtraMinutes,
  planChoiceGroups,
  resolvePicks,
  startingPriceMinor,
  tidyNote,
} from '../src/business/service-choices';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CATALOGUED,
  ChoiceSuggestion,
  DEFAULT_NOTE_PROMPT,
  everySuggestion,
  notePromptFor,
  priceAtShopFor,
  suggestionsFor,
} from '../src/business/choice-suggestions';
import { seal, unseal } from '../src/common/seal';
import { openSecret, sealSecret } from '../src/auth/totp';
import { DiscoveryService } from '../src/discovery/discovery.service';
import { FavouritesService } from '../src/favourites/favourites.service';
import { LegalService } from '../src/legal/legal.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PlatformSettingsService } from '../src/settings/platform-settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { commonStubs, createTestModule, resetDatabase } from './setup/test-module';
import { TestBusiness, createAdmin, createBusiness, createCustomer, futureSlot } from './setup/factories';

/**
 * Service choices (§300): the questions a customer answers while booking,
 * and what each answer adds.
 *
 * What matters: a shop can only save questions that make sense; a customer
 * can only book answers that are offered, with every required one answered;
 * the price is the service's (after any sale) times the people, plus the
 * answers once; the deposit is on that total; the times offered fit the
 * answers' minutes; the booking keeps its own copy; health answers are
 * sealed, opened only for the customer and the shop, and never move money;
 * and wishes — but nothing that changed the price — can change until two
 * hours before.
 */

// ---------- Small builders ----------

let ids = 0;
const fakeId = () => `id-${++ids}`;

const option = (label: string, priceMinor = 0, extraMinutes = 0, available = true) => ({
  label,
  priceMinor,
  extraMinutes,
  available,
});

const group = (
  name: string,
  options: ReturnType<typeof option>[],
  more: Partial<ChoiceGroupInput> = {},
): ChoiceGroupInput => ({
  name,
  kind: ChoiceKind.ONE,
  required: false,
  healthRelated: false,
  options,
  ...more,
});

const planned = (...input: ChoiceGroupInput[]) => planChoiceGroups(input, [], fakeId);

const idOf = (groups: ChoiceGroup[], groupName: string, label: string) =>
  groups.find((g) => g.name === groupName)!.options.find((o) => o.label === label)!.id;

describe('Service choices (§300)', () => {
  describe('what a shop may save', () => {
    it('tidies words, keeps order, and gives every question and answer an id', () => {
      const groups = planned(
        group('  Hair   length ', [option(' Short '), option('Long', 5000, 30)], {
          question: '  How long is your hair? ',
          required: true,
        }),
        group('Extras', [option('Beard trim', 2000, 15)], { kind: ChoiceKind.MANY }),
      );
      expect(groups.map((g) => g.name)).toEqual(['Hair length', 'Extras']);
      expect(groups[0].question).toBe('How long is your hair?');
      expect(groups[0].options.map((o) => o.label)).toEqual(['Short', 'Long']);
      expect(groups.flatMap((g) => [g.id, ...g.options.map((o) => o.id)]).every(Boolean)).toBe(true);
      expect(groups[1].question).toBeNull();
    });

    it('keeps the ids of questions and answers that already exist, and refuses ones that do not', () => {
      const first = planned(group('Size', [option('Saloon'), option('SUV', 3000)]));
      const again = planChoiceGroups(
        [
          {
            ...group('Car size', [
              { ...option('Saloon'), id: first[0].options[0].id } as never,
              option('Pick-up', 4000),
            ]),
            id: first[0].id,
          },
        ],
        first,
        fakeId,
      );
      expect(again[0].id).toBe(first[0].id);
      expect(again[0].options[0].id).toBe(first[0].options[0].id);
      expect(again[0].options[1].id).not.toBe(first[0].options[1].id);

      expect(() => planChoiceGroups([{ ...group('Size', [option('A')]), id: 'not-there' }], first, fakeId)).toThrow(
        /changed somewhere else/,
      );
      // An answer cannot move to another question.
      const two = planned(group('A', [option('One')]), group('B', [option('Two')]));
      expect(() =>
        planChoiceGroups(
          [{ ...group('A', [{ ...option('Two'), id: two[1].options[0].id } as never]), id: two[0].id }],
          two,
          fakeId,
        ),
      ).toThrow(/changed somewhere else/);
    });

    it('holds the limits: six questions, twelve answers, names given and not repeated', () => {
      expect(() => planned(...Array.from({ length: 7 }, (_, i) => group(`Q${i}`, [option('Yes')])))).toThrow(
        /up to 6 questions/,
      );
      expect(() =>
        planned(
          group(
            'Q',
            Array.from({ length: 13 }, (_, i) => option(`O${i}`)),
          ),
        ),
      ).toThrow(/up to 12 answers/);
      expect(() => planned(group('  ', [option('A')]))).toThrow(/needs a name/);
      expect(() => planned(group('Q', []))).toThrow(/at least one answer/);
      expect(() => planned(group('Q', [option('Long'), option(' long ')]))).toThrow(/twice/);
      expect(() => planned(group('Q', [option('A')]), group('q', [option('B')]))).toThrow(/two questions called/);
      expect(() => planned(group('Q', [option('A', 0, 481)]))).toThrow(/between 0 and 480/);
      expect(() => planned(group('Q', [option('A', 10.5)]))).toThrow(/whole amount/);
    });

    it('needs something available to pick when a question must be answered', () => {
      expect(() => planned(group('Size', [option('Saloon', 0, 0, false)], { required: true }))).toThrow(
        /at least one answer has to be available/,
      );
      expect(() => planned(group('Size', [option('Saloon', 0, 0, false)]))).not.toThrow();
    });

    it('keeps health-related answers free, so they never reach a receipt', () => {
      expect(() =>
        planned(group('Allergies', [option('Nuts', 500)], { healthRelated: true, kind: ChoiceKind.MANY })),
      ).toThrow(/can't change the price or the time/);
      expect(() => planned(group('Allergies', [option('Nuts', 0, 10)], { healthRelated: true }))).toThrow(
        /can't change the price or the time/,
      );
      expect(planned(group('Allergies', [option('Nuts')], { healthRelated: true }))[0].healthRelated).toBe(true);
    });

    it('lets a question show only after an answer above it — one step, never a chain', () => {
      const groups = planned(
        group('Wig', [option('No'), option('Yes, a wig')]),
        group('Wig type', [option('Lace', 20000), option('Closure', 15000)], { showIf: { group: 0, option: 1 } }),
      );
      expect(groups[1].showIfOptionId).toBe(groups[0].options[1].id);

      expect(() => planned(group('A', [option('x')], { showIf: { group: 0, option: 0 } }))).toThrow(/above it/);
      expect(() =>
        planned(group('A', [option('x')]), group('B', [option('y')], { showIf: { group: 1, option: 0 } })),
      ).toThrow(/above it/);
      expect(() =>
        planned(
          group('A', [option('x')]),
          group('B', [option('y')], { showIf: { group: 0, option: 0 } }),
          group('C', [option('z')], { showIf: { group: 1, option: 0 } }),
        ),
      ).toThrow(/one step/);
      expect(() =>
        planned(group('A', [option('x')]), group('B', [option('y')], { showIf: { group: 0, option: 3 } })),
      ).toThrow(/isn't there/);
      // A question shown only after a health answer would give that answer away.
      expect(() =>
        planned(
          group('Pregnant?', [option('No'), option('Yes')], { healthRelated: true }),
          group('Trimester', [option('First')], { showIf: { group: 0, option: 1 } }),
        ),
      ).toThrow(/must be health-related too/);
    });

    it('stores "as many as there are" as no limit, and ignores a limit on pick-one', () => {
      const [many, one] = planned(
        group('Extras', [option('A'), option('B')], { kind: ChoiceKind.MANY, maxPicks: 2 }),
        group('Size', [option('A'), option('B')], { maxPicks: 1 }),
      );
      expect(many.maxPicks).toBeNull();
      expect(one.maxPicks).toBeNull();
      expect(
        planned(group('Extras', [option('A'), option('B'), option('C')], { kind: ChoiceKind.MANY, maxPicks: 2 }))[0]
          .maxPicks,
      ).toBe(2);
    });

    it('never lets the longest answers make a booking longer than a day', () => {
      const groups = planned(
        group('Length', [option('Short'), option('Long', 0, 120)]),
        group('Extras', [option('A', 0, 300), option('B', 0, 200), option('C', 0, 100)], {
          kind: ChoiceKind.MANY,
          maxPicks: 2,
        }),
      );
      expect(maxExtraMinutes(groups)).toBe(120 + 300 + 200);
      expect(() => assertFitsInADay(820, groups)).not.toThrow();
      expect(() => assertFitsInADay(821, groups)).toThrow(/more than a day/);
    });
  });

  describe('what a customer may book', () => {
    const groups = planned(
      group('Hair length', [option('Short'), option('Long', 5000, 30), option('Extra long', 9000, 60, false)], {
        question: 'How long is your hair?',
        required: true,
      }),
      group('Extras', [option('Wash', 1000, 10), option('Beard trim', 2000, 15), option('Hot towel', 500)], {
        kind: ChoiceKind.MANY,
        maxPicks: 2,
      }),
      group('Wig', [option('No'), option('Yes')]),
      group('Wig type', [option('Lace', 20000)], { showIf: { group: 2, option: 1 }, required: true }),
      group('Allergies', [option('Nuts'), option('Latex')], { healthRelated: true, kind: ChoiceKind.MANY }),
    );
    const id = (g: string, o: string) => idOf(groups, g, o);

    it('adds the answers once, in the order the shop asks, with health answers apart and free', () => {
      const result = resolvePicks(groups, [id('Allergies', 'Nuts'), id('Extras', 'Wash'), id('Hair length', 'Long')]);
      expect(result.priceMinor).toBe(6000);
      expect(result.minutes).toBe(40);
      expect(result.picks.map((p) => `${p.group}: ${p.option}`)).toEqual(['Hair length: Long', 'Extras: Wash']);
      expect(result.healthPicks).toEqual([
        expect.objectContaining({ group: 'Allergies', option: 'Nuts', priceMinor: 0, extraMinutes: 0 }),
      ]);
    });

    it('asks for every required question that shows, unless only some have been picked yet', () => {
      expect(() => resolvePicks(groups, [])).toThrow(/Please answer “How long is your hair\?”/);
      expect(resolvePicks(groups, [], { partial: true }).minutes).toBe(0);
      // Wig type is required only once "Yes" is picked.
      expect(() => resolvePicks(groups, [id('Hair length', 'Short'), id('Wig', 'Yes')])).toThrow(
        /Please answer “Wig type”/,
      );
      expect(
        resolvePicks(groups, [id('Hair length', 'Short'), id('Wig', 'Yes'), id('Wig type', 'Lace')]).priceMinor,
      ).toBe(20000);
    });

    it('refuses what cannot go together, is not offered, or is not available now', () => {
      const short = id('Hair length', 'Short');
      expect(() => resolvePicks(groups, [short, id('Hair length', 'Long')])).toThrow(/Pick one answer/);
      expect(() =>
        resolvePicks(groups, [short, id('Extras', 'Wash'), id('Extras', 'Beard trim'), id('Extras', 'Hot towel')]),
      ).toThrow(/Pick up to 2/);
      expect(() => resolvePicks(groups, [short, id('Wig type', 'Lace')])).toThrow(/doesn't go with/);
      expect(() => resolvePicks(groups, [id('Hair length', 'Extra long')])).toThrow(/isn't available right now/);
      expect(() => resolvePicks(groups, [short, 'elsewhere'])).toThrow(/has changed since you picked it/);
      expect(() => resolvePicks(groups, [short, short])).toThrow(/sent twice/);
    });

    it('tells wishes — which change neither price nor time — from the rest', () => {
      expect(groups.map((g) => isWish(g))).toEqual([false, false, true, false, true]);
    });
  });

  describe('the price on a card', () => {
    it('is the plain price unless a required question changes it, or the shop prices at the visit', () => {
      const plain = planned(group('Extras', [option('Wash', 1000)], { kind: ChoiceKind.MANY }));
      expect(startingPriceMinor(plain, 7000, false)).toBeNull();
      expect(startingPriceMinor(plain, 7000, true)).toBe(7000);

      const size = planned(group('Car size', [option('Saloon'), option('SUV', 3000)], { required: true }));
      expect(startingPriceMinor(size, 7000, false)).toBe(7000);

      const allExtra = planned(group('Car size', [option('SUV', 3000), option('Pick-up', 4000)], { required: true }));
      expect(startingPriceMinor(allExtra, 7000, false)).toBe(10000);

      const washed = planned(
        group('Hair', [option('Washed already', -2000), option('Wash it here')], { required: true }),
      );
      expect(startingPriceMinor(washed, 1500, false)).toBe(0);

      // Only answers that can be picked, and only questions that always show.
      const unavailable = planned(
        group('Car size', [option('SUV', 3000, 0, false), option('Pick-up', 4000)], { required: true }),
        group('Trailer', [option('No'), option('Yes')]),
        group('Trailer size', [option('Big', 9000), option('Small', 1000)], {
          required: true,
          showIf: { group: 1, option: 1 },
        }),
      );
      expect(startingPriceMinor(unavailable, 7000, false)).toBe(11000);
    });
  });

  describe('the note', () => {
    it('is tidied, at most 250 letters, and nothing is null', () => {
      expect(tidyNote('  Please   use the side door  ')).toBe('Please use the side door');
      expect(tidyNote('   ')).toBeNull();
      expect(tidyNote(undefined)).toBeNull();
      expect(() => tidyNote('x'.repeat(251))).toThrow(/250 letters/);
    });
  });

  describe('sealing', () => {
    it('opens only with the same key and the same purpose, and still opens authenticator secrets', () => {
      const sealed = seal('nuts', 'key', 'health-choices');
      expect(sealed).not.toContain('nuts');
      expect(unseal(sealed, 'key', 'health-choices')).toBe('nuts');
      expect(() => unseal(sealed, 'other key', 'health-choices')).toThrow();
      expect(() => unseal(sealed, 'key', 'authenticator-secret')).toThrow();
      // The authenticator's sealing is the same as it always was (§298).
      expect(openSecret(sealSecret('JBSWY3DPEHPK3PXP', 'key'), 'key')).toBe('JBSWY3DPEHPK3PXP');
      expect(unseal(sealSecret('JBSWY3DPEHPK3PXP', 'key'), 'key', 'authenticator-secret')).toBe('JBSWY3DPEHPK3PXP');
    });
  });

  describe('ready-made suggestions (§300.2)', () => {
    /** The taxonomy as the seed writes it (§266) — read from the file, which runs itself when imported. */
    const seeded = (() => {
      const text = readFileSync(join(process.cwd(), 'prisma/seed.ts'), 'utf8');
      const out: Record<string, string[]> = {};
      for (const match of text.matchAll(/name: '([^']+)',\s*icon:[\s\S]*?subcategories: \[([\s\S]*?)\]/g)) {
        out[match[1]] = [...match[2].matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
      }
      return out;
    })();

    /** As the service form turns a suggestion into a question, with its parent first when it has one. */
    const asInput = (s: ChoiceSuggestion, showIf?: { group: number; option: number }): ChoiceGroupInput => ({
      name: s.name,
      question: s.question,
      kind: s.kind,
      required: s.required,
      maxPicks: s.maxPicks ?? null,
      healthRelated: s.healthRelated ?? false,
      suggestionKey: s.key,
      showIf: showIf ?? null,
      options: s.options.map((option) => ({
        label: option.label,
        description: option.description ?? null,
        priceMinor: 0,
        extraMinutes: option.extraMinutes ?? 0,
        available: true,
      })),
    });

    it('covers every category, and names only categories and types that exist', () => {
      expect(Object.keys(seeded)).toHaveLength(16);
      expect(Object.keys(CATALOGUED).sort()).toEqual(Object.keys(seeded).sort());
      for (const [category, types] of Object.entries(CATALOGUED)) {
        for (const type of types) expect(seeded[category]).toContain(type);
      }
    });

    it('offers only questions a shop could save as they are', () => {
      for (const { suggestions } of everySuggestion()) {
        suggestions.forEach((s, index) => {
          if (!s.showIf) {
            expect(() => planChoiceGroups([asInput(s)], [])).not.toThrow();
            return;
          }
          // Its parent is offered with it, above it, and has the answer it names.
          const parentAt = suggestions.findIndex((p) => p.key === s.showIf!.key);
          expect(parentAt).toBeGreaterThanOrEqual(0);
          expect(parentAt).toBeLessThan(index);
          const parent = suggestions[parentAt];
          const option = parent.options.findIndex((o) => o.label === s.showIf!.option);
          expect(option).toBeGreaterThanOrEqual(0);
          expect(() => planChoiceGroups([asInput(parent), asInput(s, { group: 0, option })], [])).not.toThrow();
        });
      }
    });

    it('keeps one meaning for one key, and private answers free', () => {
      const byKey = new Map<string, string>();
      for (const { suggestions } of everySuggestion()) {
        for (const s of suggestions) {
          const seen = byKey.get(s.key);
          expect(seen === undefined || seen === JSON.stringify(s)).toBe(true);
          byKey.set(s.key, JSON.stringify(s));
          expect(s.key).toMatch(/^[a-z0-9.-]+$/);
          if (s.healthRelated) expect(s.options.every((o) => !o.paid && !o.extraMinutes)).toBe(true);
        }
      }
      expect(byKey.size).toBeGreaterThan(150);
    });

    it('lists a shop’s main kind first, its type’s own questions before the category’s, each once', () => {
      const kind = (category: string, subcategory: string) => ({
        category: { name: category },
        subcategory: { name: subcategory },
      });
      const sections = suggestionsFor([
        kind('Dining', 'Pick-up'),
        kind('Dining', 'Dine-in'),
        kind('Hotels & Stays', 'Hotel Rooms'),
      ]);
      expect(sections.map((s) => s.subcategory)).toEqual(['Pick-up', 'Dine-in', 'Hotel Rooms']);
      expect(sections[0].suggestions.map((s) => s.key).slice(0, 3)).toEqual([
        'dining.packaging',
        'dining.cutlery',
        'dining.chilli',
      ]);
      expect(sections[0].suggestions.map((s) => s.key)).not.toContain('dining.seating');
      // Allergies were already listed under Pick-up.
      expect(sections[1].suggestions.map((s) => s.key)).toContain('dining.seating');
      expect(sections[1].suggestions.map((s) => s.key)).not.toContain('food.allergies');

      expect(notePromptFor([kind('Beauty & Spa', 'Barbershop')])).toBe('Your clipper number, or the look you want.');
      expect(notePromptFor([kind('Beauty & Spa', 'Hair')])).toMatch(/hair or style/);
      expect(notePromptFor([])).toBe(DEFAULT_NOTE_PROMPT);
      expect(priceAtShopFor([kind('Automotive', 'Car Repair & Mechanic')])).toBe(true);
      expect(priceAtShopFor([kind('Automotive', 'Car Wash & Detailing')])).toBe(false);
      expect(priceAtShopFor([kind('Event Services', 'Venue Booking')])).toBe(true);
    });
  });

  // ---------- Through the services, against the database ----------

  describe('end to end', () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let services: ServicesService;
    let drafts: ServiceDraftsService;
    let discovery: DiscoveryService;
    let availability: AvailabilityService;
    let appointments: AppointmentsService;
    let account: AccountService;
    let sweep: HealthChoicesSweep;
    let notifyBusiness: jest.Mock;

    beforeAll(async () => {
      moduleRef = await createTestModule([
        ServicesService,
        ServiceDraftsService,
        LegalService,
        LocationsService,
        BusinessAccessService,
        DiscoveryService,
        FavouritesService,
        AppointmentsService,
        AvailabilityService,
        PlatformSettingsService,
        AccountService,
        StorageService,
        HealthChoicesSweep,
        commonStubs.mail(),
        commonStubs.notifications(),
        commonStubs.payments(),
        commonStubs.chat(),
      ]);
      prisma = moduleRef.get(PrismaService);
      account = moduleRef.get(AccountService);
      sweep = moduleRef.get(HealthChoicesSweep);
      services = moduleRef.get(ServicesService);
      drafts = moduleRef.get(ServiceDraftsService);
      discovery = moduleRef.get(DiscoveryService);
      availability = moduleRef.get(AvailabilityService);
      appointments = moduleRef.get(AppointmentsService);
      notifyBusiness = (moduleRef.get(NotificationsService) as unknown as { notifyBusiness: jest.Mock }).notifyBusiness;
      await resetDatabase(prisma);
      await moduleRef.get(PlatformSettingsService).setPlatformFeePercentage(10, { role: 'ADMIN' });
    });

    afterAll(async () => {
      await resetDatabase(prisma);
      await moduleRef.close();
    });

    /** A barber's: 7,000 a cut, 20% deposit, 60 minutes, open 09:00–17:00, two chairs. */
    const shop = () =>
      createBusiness(prisma, { priceMinor: 7000, depositPercentage: 20, durationMinutes: 60, capacity: 2 });

    const HAIRCUT_QUESTIONS: ChoiceGroupInput[] = [
      group('Hair length', [option('Short'), option('Long', 5000, 30)], {
        question: 'How long is your hair?',
        required: true,
      }),
      group('Extras', [option('Wash', 1000, 15), option('Hot towel', 500)], { kind: ChoiceKind.MANY }),
      group('Music', [option('Quiet, please'), option('Music is fine')]),
      group('Allergies', [option('Nuts'), option('Latex')], { kind: ChoiceKind.MANY, healthRelated: true }),
    ];

    const withQuestions = async (business: TestBusiness, input = HAIRCUT_QUESTIONS) =>
      services.update(business.userId, business.serviceId, { choiceGroups: input as never });

    const picks = (service: { choiceGroups: ChoiceGroup[] }, ...wanted: Array<[string, string]>) =>
      wanted.map(([g, o]) => idOf(service.choiceGroups, g, o));

    const slot = () => futureSlot(7, 8); // 10:00 local, a week out
    const day = () => {
      const d = slot();
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    };

    it('saves the questions with the service, in order, and keeps ids through an edit', async () => {
      const business = await shop();
      const saved = await withQuestions(business);
      expect(saved.choiceGroups.map((g) => g.name)).toEqual(['Hair length', 'Extras', 'Music', 'Allergies']);
      expect(saved.choiceGroups[0].options.map((o) => [o.label, o.priceMinor, o.extraMinutes])).toEqual([
        ['Short', 0, 0],
        ['Long', 5000, 30],
      ]);

      // Edit: rename one answer, drop a question, add one.
      const [length, extras] = saved.choiceGroups;
      const edited = await services.update(business.userId, business.serviceId, {
        choiceGroups: [
          {
            ...group(
              'Hair length',
              [
                { ...option('Short hair'), id: length.options[0].id } as never,
                { ...option('Long', 6000, 30), id: length.options[1].id } as never,
              ],
              { required: true },
            ),
            id: length.id,
          },
          {
            ...group('Extras', [{ ...option('Wash', 1000, 15), id: extras.options[0].id } as never], {
              kind: ChoiceKind.MANY,
            }),
            id: extras.id,
          },
          group('Products', [option('Bring my own', -500)]),
        ] as never,
      });
      expect(edited.choiceGroups.map((g) => g.name)).toEqual(['Hair length', 'Extras', 'Products']);
      expect(edited.choiceGroups[0].id).toBe(length.id);
      expect(edited.choiceGroups[0].options.map((o) => [o.id, o.label, o.priceMinor])).toEqual([
        [length.options[0].id, 'Short hair', 0],
        [length.options[1].id, 'Long', 6000],
      ]);
      expect(edited.choiceGroups[1].options).toHaveLength(1);
      expect(await prisma.serviceChoiceGroup.count({ where: { serviceId: business.serviceId } })).toBe(3);

      // Left out of an edit, they stay as they are.
      const renamed = await services.update(business.userId, business.serviceId, { name: 'Haircut' });
      expect(renamed.choiceGroups.map((g) => g.id)).toEqual(edited.choiceGroups.map((g) => g.id));

      // A longer service is checked against the questions that stay.
      await expect(services.update(business.userId, business.serviceId, { durationMinutes: 1420 })).rejects.toThrow(
        /more than a day/,
      );
    });

    it('creates a service with questions, "show only if" pointing at the right answer', async () => {
      const business = await shop();
      const created = await services.create(business.userId, {
        name: 'Braids',
        durationMinutes: 180,
        offers: [{ locationId: business.locationId, priceMinor: 20000 }],
        choiceGroups: [
          group('Wig', [option('No'), option('Yes')]),
          group('Wig type', [option('Lace', 20000)], { showIf: { group: 0, option: 1 } }),
        ] as never,
      });
      expect(created.choiceGroups[1].showIfOptionId).toBe(created.choiceGroups[0].options[1].id);
    });

    it('keeps questions in a draft as they were written, unchecked', async () => {
      const business = await shop();
      const draft = await drafts.create(business.userId);
      const written = await drafts.update(business.userId, draft.id, {
        choices: [{ name: 'Half-written', options: [{ label: '' }] }],
        noteEnabled: false,
        notePrompt: 'Tell us about the car',
        priceConfirmedAtShop: true,
      });
      expect(written.choices).toEqual([{ name: 'Half-written', options: [{ label: '' }] }]);
      expect([written.noteEnabled, written.notePrompt, written.priceConfirmedAtShop]).toEqual([
        false,
        'Tell us about the car',
        true,
      ]);
    });

    it('shows the customer the questions, a "from" price, and the note box words', async () => {
      const business = await shop();
      await prisma.serviceChoiceGroup.deleteMany({});
      await services.update(business.userId, business.serviceId, {
        choiceGroups: [group('Car size', [option('SUV', 3000), option('Pick-up', 4000)], { required: true })] as never,
      });

      const shopfront = (await discovery.findOne(business.locationId)) as unknown as {
        services: Array<{
          choiceGroups: ChoiceGroup[];
          startingPriceMinor: number | null;
          notePrompt: string;
          noteEnabled: boolean;
        }>;
      };
      const [service] = shopfront.services;
      expect(service.choiceGroups[0].options.map((o) => o.label)).toEqual(['SUV', 'Pick-up']);
      expect(service.startingPriceMinor).toBe(10000);
      expect(service.noteEnabled).toBe(true);
      expect(service.notePrompt).toBe(DEFAULT_NOTE_PROMPT);

      const found = await discovery.searchServices({});
      expect(found.services.find((s) => s.id === business.serviceId)?.startingPriceMinor).toBe(10000);

      // And the branch's headline price is what it can actually be booked for.
      const branch = await prisma.location.findUniqueOrThrow({ where: { id: business.locationId } });
      expect(branch.fromPriceMinor).toBe(10000);
    });

    it('offers only times that fit the answers', async () => {
      const business = await shop();
      const service = await withQuestions(business);
      const plain = await availability.getAvailabilityForService(business.locationId, day(), business.serviceId, 1);
      const long = await availability.getAvailabilityForService(
        business.locationId,
        day(),
        business.serviceId,
        1,
        undefined,
        picks(service, ['Hair length', 'Long'], ['Extras', 'Wash']),
      );
      // 60 minutes ends by 17:00 from 16:00; 60 + 30 + 15 only from 15:15.
      expect(plain.slots[plain.slots.length - 1]).toBe('16:00');
      expect(long.slots[long.slots.length - 1]).toBe('15:15');

      await expect(
        availability.getAvailabilityForService(business.locationId, day(), business.serviceId, 1, undefined, [
          '00000000-0000-0000-0000-000000000000',
        ]),
      ).rejects.toThrow(/has changed since you picked it/);
    });

    it('books the answers: price once on top, deposit on the total, longer, its own copy, health sealed', async () => {
      const business = await shop();
      const service = await withQuestions(business);
      const customer = await createCustomer(prisma);

      const booked = await appointments.create(customer.userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: slot().toISOString(),
        quantity: 2,
        optionIds: picks(
          service,
          ['Hair length', 'Long'],
          ['Extras', 'Wash'],
          ['Music', 'Quiet, please'],
          ['Allergies', 'Nuts'],
        ),
        note: '  Side door, please ',
      });

      // 7,000 × 2 people, plus 5,000 + 1,000 once.
      expect(booked.servicePriceMinor).toBe(20000);
      expect(booked.unitPriceMinor).toBe(7000);
      expect(booked.choicesPriceMinor).toBe(6000);
      expect(booked.depositAmountMinor).toBe(4000);
      expect(booked.platformFeeAmountMinor + booked.businessAmountMinor).toBe(4000);
      // 60 + 30 + 15 minutes.
      expect((new Date(booked.endTime).getTime() - new Date(booked.startTime).getTime()) / 60_000).toBe(105);
      expect(booked.choicesMinutes).toBe(45);
      expect(booked.customerNote).toBe('Side door, please');
      expect(
        (booked.choices as Array<{ group: string; option: string }>).map((p) => `${p.group}: ${p.option}`),
      ).toEqual(['Hair length: Long', 'Extras: Wash', 'Music: Quiet, please']);
      // The answers the action returns never include health ones.
      expect('healthChoices' in booked).toBe(false);

      // Sealed in the database: the word is not there to read.
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.id } });
      expect(row.healthChoicesSealed).toBeTruthy();
      expect(row.healthChoicesSealed).not.toContain('Nuts');
      expect(JSON.stringify(row.choices)).not.toContain('Nuts');

      // Opened for the customer and for the shop.
      const mine = await appointments.findOne(customer.userId, booked.id);
      expect(mine.healthChoices?.map((p) => p.option)).toEqual(['Nuts']);
      expect('healthChoicesSealed' in mine).toBe(false);
      const theirs = await appointments.findOne(business.userId, booked.id);
      expect(theirs.healthChoices?.map((p) => p.option)).toEqual(['Nuts']);
      const list = await appointments.findAll(business.userId, 'BUSINESS' as never, {} as never);
      expect(list.appointments.find((a) => a.id === booked.id)?.healthChoices?.map((p) => p.option)).toEqual(['Nuts']);

      // A change to the questions later never rewrites the booking.
      await services.update(business.userId, business.serviceId, { choiceGroups: [] });
      const later = await appointments.findOne(customer.userId, booked.id);
      expect(later.servicePriceMinor).toBe(20000);
      expect((later.choices as unknown[]).length).toBe(3);
    });

    it('takes a sale off the service only, never off the answers', async () => {
      const business = await shop();
      const service = await withQuestions(business);
      await prisma.service.update({ where: { id: business.serviceId }, data: { discountPercent: 50 } });
      const booked = await appointments.create((await createCustomer(prisma)).userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: slot().toISOString(),
        optionIds: picks(service, ['Hair length', 'Long']),
      });
      expect(booked.unitPriceMinor).toBe(3500);
      expect(booked.servicePriceMinor).toBe(8500);
      // What it would have been without the sale, answers included.
      expect(booked.listPriceMinor).toBe(12000);
    });

    it('refuses a booking that leaves a required question unanswered, or a note the service does not take', async () => {
      const business = await shop();
      const service = await withQuestions(business);
      const customer = await createCustomer(prisma);
      const base = { locationId: business.locationId, serviceId: business.serviceId, startTime: slot().toISOString() };

      await expect(appointments.create(customer.userId, base)).rejects.toThrow(
        /Please answer “How long is your hair\?”/,
      );

      await prisma.service.update({ where: { id: business.serviceId }, data: { noteEnabled: false } });
      await expect(
        appointments.create(customer.userId, {
          ...base,
          optionIds: picks(service, ['Hair length', 'Short']),
          note: 'Hi',
        }),
      ).rejects.toThrow(/no longer takes a note/);
    });

    it('lets wishes and the note change until two hours before, never what changed the price', async () => {
      const business = await shop();
      const service = await withQuestions(business);
      const customer = await createCustomer(prisma);
      const booked = await appointments.create(customer.userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: slot().toISOString(),
        optionIds: picks(service, ['Hair length', 'Long'], ['Music', 'Quiet, please']),
      });
      notifyBusiness.mockClear();

      const changed = await appointments.changeChoices(customer.userId, booked.id, {
        optionIds: picks(service, ['Music', 'Music is fine'], ['Allergies', 'Latex']),
        note: 'Running five minutes late',
      });
      expect((changed.choices as Array<{ option: string }>).map((p) => p.option)).toEqual(['Long', 'Music is fine']);
      expect(changed.healthChoices?.map((p) => p.option)).toEqual(['Latex']);
      expect(changed.customerNote).toBe('Running five minutes late');
      expect(changed.choicesChangedAt).not.toBeNull();
      // Nothing about the money or the time moved.
      expect([changed.servicePriceMinor, changed.depositAmountMinor, changed.endTime]).toEqual([
        booked.servicePriceMinor,
        booked.depositAmountMinor,
        booked.endTime,
      ]);
      // The shop is told — that it changed, not what.
      expect(notifyBusiness).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'BOOKING_CHOICES_CHANGED', appointmentId: booked.id }),
      );

      // Answers that change the price or the time stay as booked.
      await expect(
        appointments.changeChoices(customer.userId, booked.id, { optionIds: picks(service, ['Hair length', 'Short']) }),
      ).rejects.toThrow(/can’t be changed after booking/);

      // Sending the same again changes nothing and tells nobody.
      notifyBusiness.mockClear();
      await appointments.changeChoices(customer.userId, booked.id, {
        optionIds: picks(service, ['Music', 'Music is fine'], ['Allergies', 'Latex']),
      });
      expect(notifyBusiness).not.toHaveBeenCalled();

      // Two hours before, it is too late.
      await prisma.appointment.update({
        where: { id: booked.id },
        data: { startTime: new Date(Date.now() + 90 * 60_000), endTime: new Date(Date.now() + 180 * 60_000) },
      });
      await expect(
        appointments.changeChoices(customer.userId, booked.id, { optionIds: [], note: null }),
      ).rejects.toThrow(/until 2 hours before/);

      // Someone else's booking is not found.
      const stranger = await createCustomer(prisma);
      await expect(appointments.changeChoices(stranger.userId, booked.id, { optionIds: [] })).rejects.toThrow(
        /not found/,
      );
    });
    it('lets support read private answers only with a reason — written down, and said on the booking', async () => {
      const business = await shop();
      const service = await withQuestions(business);
      const customer = await createCustomer(prisma);
      const booked = await appointments.create(customer.userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: slot().toISOString(),
        optionIds: picks(service, ['Hair length', 'Short'], ['Allergies', 'Nuts']),
      });
      const admin = { userId: (await createAdmin(prisma)).userId, role: UserRole.ADMIN };

      // The console's read says there is something private — never what.
      const detail = await appointments.findOneForAdmin(admin, booked.id);
      expect(detail.hasHealthChoices).toBe(true);
      expect(JSON.stringify(detail)).not.toContain('Nuts');
      expect(JSON.stringify(detail)).not.toContain('v1.');

      await expect(appointments.supportReadHealthChoices(admin, booked.id, { reason: '  ' })).rejects.toThrow();
      const read = await appointments.supportReadHealthChoices(admin, booked.id, {
        reason: 'The shop asks which allergy the customer gave',
      });
      expect(read.answers).toEqual([{ group: 'Allergies', option: 'Nuts' }]);
      const logged = await prisma.supportAction.findFirstOrThrow({ where: { appointmentId: booked.id } });
      expect(logged).toMatchObject({ kind: SupportActionKind.READ_HEALTH_CHOICES, actorId: admin.userId });
      const asCustomer = await appointments.findOne(customer.userId, booked.id);
      expect(asCustomer.supportActions.map((step) => step.kind)).toEqual([SupportActionKind.READ_HEALTH_CHOICES]);
    });

    it('removes private answers 30 days after the visit — those alone, and says when', async () => {
      const business = await shop();
      const service = await withQuestions(business);
      const customer = await createCustomer(prisma);
      const book = () =>
        appointments.create(customer.userId, {
          locationId: business.locationId,
          serviceId: business.serviceId,
          startTime: slot().toISOString(),
          optionIds: picks(service, ['Hair length', 'Short'], ['Music', 'Quiet, please'], ['Allergies', 'Latex']),
          note: 'Side door',
        });
      // Two places at the branch: both fit the same time.
      const old = await book();
      const recent = await book();
      // Cancelled or not, the answers go after 30 days.
      await prisma.appointment.update({ where: { id: old.id }, data: { status: 'CANCELLED' } });
      const day = 24 * 60 * 60 * 1000;
      await prisma.appointment.update({
        where: { id: old.id },
        data: { startTime: new Date(Date.now() - 31 * day), endTime: new Date(Date.now() - 31 * day + 3600_000) },
      });
      await prisma.appointment.update({
        where: { id: recent.id },
        data: { startTime: new Date(Date.now() - 29 * day), endTime: new Date(Date.now() - 29 * day + 3600_000) },
      });

      expect(await sweep.removeOld()).toBe(1);
      const gone = await prisma.appointment.findUniqueOrThrow({ where: { id: old.id } });
      expect(gone.healthChoicesSealed).toBeNull();
      expect(gone.healthChoicesRemovedAt).not.toBeNull();
      // Everything else stays.
      expect(gone.customerNote).toBe('Side door');
      expect((gone.choices as unknown[]).length).toBe(2);
      expect(
        (await prisma.appointment.findUniqueOrThrow({ where: { id: recent.id } })).healthChoicesSealed,
      ).not.toBeNull();

      const asCustomer = await appointments.findOne(customer.userId, old.id);
      expect(asCustomer.healthChoices).toBeNull();
      expect(asCustomer.healthChoicesRemovedAt).not.toBeNull();
      // Run again: nothing more to do.
      expect(await sweep.removeOld()).toBe(0);
    });

    it('puts the answers, the note and the private answers in the person’s copy of their data', async () => {
      const business = await shop();
      const service = await withQuestions(business);
      const customer = await createCustomer(prisma);
      await appointments.create(customer.userId, {
        locationId: business.locationId,
        serviceId: business.serviceId,
        startTime: slot().toISOString(),
        optionIds: picks(service, ['Hair length', 'Long'], ['Allergies', 'Nuts']),
        note: 'Running late maybe',
      });
      const copy = await account.exportFor(customer.userId);
      const [booking] = copy.bookings;
      expect((booking.choices as Array<{ option: string }>).map((pick) => pick.option)).toEqual(['Long']);
      expect(booking.customerNote).toBe('Running late maybe');
      expect(booking.privateAnswers).toEqual([{ group: 'Allergies', option: 'Nuts', priceMinor: 0, extraMinutes: 0 }]);
      expect('healthChoicesSealed' in booking).toBe(false);
    });
  });
});
