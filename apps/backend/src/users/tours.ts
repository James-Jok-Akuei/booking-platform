/**
 * The welcome tours (§307): the customer app's "how booking works" and the
 * business app's welcome and look around. One name each, due from the moment
 * an account of that kind is created until it is finished or skipped.
 */
export const TOURS = { customer: 'customer', seller: 'seller' } as const;
export type TourName = (typeof TOURS)[keyof typeof TOURS];
export const TOUR_NAMES = Object.values(TOURS) as TourName[];
