import { IsBoolean } from 'class-validator';

/** Turning an administrator's money access on or off (§317). */
export class SetMoneyAccessDto {
  @IsBoolean()
  on!: boolean;
}

/** What the signed-in administrator may see (§317), for the console to draw itself by. */
export class AdminAccessDto {
  id!: string;
  email!: string;
  isPrimaryAdmin!: boolean;
  /** The primary administrator always; others once the primary turned it on. */
  moneyAccess!: boolean;
}

export class MoneyAccessDto {
  id!: string;
  moneyAccess!: boolean;
  moneyAccessAt!: string | null;
  /** The primary administrator's email, or "automatic". */
  moneyAccessBy!: string | null;
}
