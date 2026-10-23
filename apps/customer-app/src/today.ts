import { useQuery } from '@tanstack/react-query';
import { t } from '@lingui/core/macro';
import { getToday } from './api/today';

/**
 * "Rwanda today" for a customer (§310): whether MTN MoMo is slow, whether a
 * day is Umuganda or a public holiday, and the week of Kwibuka, when the app
 * keeps quiet. Facts from the server; the words are said here. A failure is
 * no note, never an error.
 */
export function useRwandaToday(date?: string, { watchMomo = false }: { watchMomo?: boolean } = {}) {
  const query = useQuery({
    queryKey: ['today', date ?? 'now'],
    queryFn: () => getToday(date),
    staleTime: watchMomo ? 30_000 : 10 * 60_000,
    // On the payment screen, mobile money's health is worth asking again.
    refetchInterval: watchMomo ? 60_000 : false,
    retry: false,
  });
  return query.data ?? null;
}

/** The public holidays by the server's names for them. */
export function holidayName(key: string | null | undefined): string | null {
  switch (key) {
    case 'new-year': return t`New Year’s Day`;
    case 'new-year-2': return t`The day after New Year`;
    case 'heroes': return t`Heroes’ Day`;
    case 'memorial': return t`Genocide against the Tutsi Memorial Day`;
    case 'good-friday': return t`Good Friday`;
    case 'easter-monday': return t`Easter Monday`;
    case 'labour': return t`Labour Day`;
    case 'independence': return t`Independence Day`;
    case 'liberation': return t`Liberation Day`;
    case 'umuganura': return t`Umuganura`;
    case 'assumption': return t`Assumption Day`;
    case 'christmas': return t`Christmas Day`;
    case 'boxing': return t`Boxing Day`;
    case 'eid-al-fitr': return t`Eid al-Fitr`;
    case 'eid-al-adha': return t`Eid al-Adha`;
    default: return null;
  }
}
