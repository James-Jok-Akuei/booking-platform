import { ChoiceKind, Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CHOICE_LIMITS, LOWEST_CHOICE_PRICE_MINOR } from '../service-choices';

/**
 * Service choices (§300) on the wire: the questions a customer answers while
 * booking, as a shop sends them and as everyone reads them back.
 *
 * The limits here bound the types; the rules — names unique, "show only if"
 * one step up, health answers free — are in `service-choices.ts`, with
 * messages a person can act on.
 */

/** One select for every read of a service's questions, so all of them read the same order. */
export const CHOICE_GROUPS_SELECT = {
  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  select: {
    id: true,
    name: true,
    question: true,
    kind: true,
    required: true,
    maxPicks: true,
    healthRelated: true,
    showIfOptionId: true,
    suggestionKey: true,
    options: {
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        label: true,
        description: true,
        priceMinor: true,
        extraMinutes: true,
        available: true,
      },
    },
  },
} as const satisfies Exclude<Prisma.ServiceInclude['choiceGroups'], boolean | undefined>;

/**
 * Just what a "from" price needs (§300.3) — the questions that must be
 * answered and always show, with their available answers' prices — for
 * lists of many services.
 */
export const STARTING_PRICE_GROUPS_SELECT = {
  where: { required: true, showIfOptionId: null },
  select: {
    required: true,
    showIfOptionId: true,
    options: { where: { available: true }, select: { priceMinor: true, available: true } },
  },
} as const satisfies Exclude<Prisma.ServiceInclude['choiceGroups'], boolean | undefined>;

// ---------- Read ----------

/** One answer to a question. */
export class ServiceChoiceOptionDto {
  id!: string;
  label!: string;
  /** A line about it, under the name. */
  description!: string | null;
  /**
   * Added to the booking's price, in minor units — once per booking, not per
   * person; negative takes money off. Never discounted by a sale (§300.3).
   */
  priceMinor!: number;
  /** Added to the booking's length, so the times offered fit (§300.4). */
  extraMinutes!: number;
  /** False: "not available now" — shown greyed, and cannot be picked. */
  available!: boolean;
}

/** One question a customer answers while booking (§300). */
export class ServiceChoiceGroupDto {
  id!: string;
  /** The shop's short name for it — "Hair length". Used on the booking. */
  name!: string;
  /** What the customer is asked — "How long is your hair?". Null: ask the name. */
  question!: string | null;
  /** Pick one answer, or several. */
  kind!: ChoiceKind;
  /** Must be answered before a time can be chosen. */
  required!: boolean;
  /** Pick-several only: the most that may be picked. Null: any number. */
  maxPicks!: number | null;
  /**
   * Allergies, pregnancy, an injury (§300.6): tap to pick, never typed; the
   * answers are sealed, shown to the shop in red, never in an email or a
   * phone alert, and removed 30 days after the visit. Always free.
   */
  healthRelated!: boolean;
  /** Shows only when this answer to an earlier question is picked. Null: always. */
  showIfOptionId!: string | null;
  /** The ready-made suggestion it began as (§300.2). Null for the shop's own. */
  suggestionKey!: string | null;
  options!: ServiceChoiceOptionDto[];
}

// ---------- Write ----------

/**
 * "Show only if" in the questions being SENT: the `option`-th answer of the
 * `group`-th question, both counted from 0, in the list as sent. A position
 * rather than an id, because the answer may be new in the same save.
 */
export class ChoiceShowIfDto {
  @IsInt()
  @Min(0)
  @Max(CHOICE_LIMITS.groups - 1)
  group!: number;

  @IsInt()
  @Min(0)
  @Max(CHOICE_LIMITS.options - 1)
  option!: number;
}

const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class ServiceChoiceOptionInputDto {
  /** Keeps an answer that already exists. Left out: a new one. */
  @IsOptional()
  @IsUUID()
  id?: string | null;

  @IsString()
  @MaxLength(CHOICE_LIMITS.label)
  label!: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(CHOICE_LIMITS.description)
  description?: string | null;

  @IsInt({ message: 'priceMinor must be a whole number of minor units' })
  @Min(LOWEST_CHOICE_PRICE_MINOR)
  @Max(CHOICE_LIMITS.priceMinor)
  priceMinor!: number;

  @IsInt()
  @Min(0)
  @Max(CHOICE_LIMITS.extraMinutes)
  extraMinutes!: number;

  @IsBoolean()
  available!: boolean;
}

export class ServiceChoiceGroupInputDto {
  /** Keeps a question that already exists. Left out: a new one. */
  @IsOptional()
  @IsUUID()
  id?: string | null;

  @IsString()
  @MaxLength(CHOICE_LIMITS.name)
  name!: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(CHOICE_LIMITS.question)
  question?: string | null;

  @IsEnum(ChoiceKind)
  kind!: ChoiceKind;

  @IsBoolean()
  required!: boolean;

  /** Pick-several only. Left out or null: any number. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CHOICE_LIMITS.options)
  maxPicks?: number | null;

  @IsBoolean()
  healthRelated!: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChoiceShowIfDto)
  showIf?: ChoiceShowIfDto | null;

  /** The ready-made suggestion it began as (§300.2). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9.-]+$/)
  suggestionKey?: string | null;

  @IsArray()
  @ArrayMinSize(1, { message: 'A question needs at least one answer.' })
  @ArrayMaxSize(CHOICE_LIMITS.options)
  @ValidateNested({ each: true })
  @Type(() => ServiceChoiceOptionInputDto)
  options!: ServiceChoiceOptionInputDto[];
}

// ---------- Suggestions (§300.2) ----------

export class SuggestedOptionDto {
  label!: string;
  description?: string;
  /** A typical extra time, to be checked by the shop. */
  extraMinutes?: number;
  /** Shops usually charge for this: ask for a price. Prices are never suggested. */
  paid?: boolean;
}

export class SuggestionShowIfDto {
  /** The suggestion it depends on — add that one first. */
  key!: string;
  /** Its answer, by name. */
  option!: string;
}

/** A ready-made question a shop can switch on for a service, then change. */
export class ChoiceSuggestionDto {
  /** Stable: saved on the question as `suggestionKey`, so the list can say "added". */
  key!: string;
  name!: string;
  question!: string;
  kind!: ChoiceKind;
  required!: boolean;
  maxPicks?: number;
  /** Health and other private answers — sealed, never emailed, always free (§300.6). */
  healthRelated?: boolean;
  showIf?: SuggestionShowIfDto;
  /** A word to the shop about using it. */
  hint?: string;
  options!: SuggestedOptionDto[];
}

/** The suggestions for one of the shop's kinds (§265). */
export class ChoiceSuggestionSectionDto {
  category!: string;
  subcategory!: string;
  suggestions!: ChoiceSuggestionDto[];
}

export class ChoiceSuggestionsDto {
  /** The shop's kinds, its main one first; a question suggested for two is listed once. */
  sections!: ChoiceSuggestionSectionDto[];
  /** The words above the customer's note box unless the shop writes its own (§300.5). */
  notePrompt!: string;
  /** Shops of this kind usually confirm the price after seeing the job (§300.3). */
  priceAtShop!: boolean;
}
