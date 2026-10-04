import { Prisma } from '@prisma/client';
import { NoExtraFields, Serialised } from '../../common/serialised';

/** One select, shared with the DTO describing its result (§128.5). */
export const PUBLIC_PROVINCE_SELECT = {
  id: true,
  code: true,
  name: true,
  isCity: true,
  districts: {
    where: { isLive: true },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true },
  },
} as const satisfies Prisma.ProvinceSelect;

type PublicProvinceRow = Serialised<
  Prisma.ProvinceGetPayload<{ select: typeof PUBLIC_PROVINCE_SELECT }>
>;

export class DistrictDto {
  id!: string;
  /** A stable handle, so a seed or a support query need not carry a UUID. */
  code!: string;
  name!: string;
}

/**
 * One of Rwanda's five provinces, with the districts the platform is open in.
 *
 * A province with no live district is left out entirely, so an address picker
 * never offers a province that then has nothing under it.
 */
export class ProvinceDto implements PublicProvinceRow {
  id!: string;
  code!: string;
  name!: string;
  /** Kigali is both a province and a city, and addresses there read differently. */
  isCity!: boolean;
  districts!: DistrictDto[];
}

export const __provinceDtoIsExact: NoExtraFields<ProvinceDto, PublicProvinceRow> = true;

export class AdminDistrictDto {
  id!: string;
  code!: string;
  name!: string;
  isLive!: boolean;
  /** Branches already there. Shown before anything is retired. */
  branchCount!: number;
}

/** Every province and district, live or not — the administrator's own view. */
export class AdminProvinceDto {
  id!: string;
  code!: string;
  name!: string;
  districts!: AdminDistrictDto[];
}

/** The bare row, as creating or renaming a district answers. */
export class DistrictRecordDto {
  id!: string;
  code!: string;
  name!: string;
  provinceId!: string;
  isLive!: boolean;
}
