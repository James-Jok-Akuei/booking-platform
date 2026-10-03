import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { saveFavourite, unsaveFavourite } from './api/discovery';
import { ApiError, tokens } from './api/client';

/**
 * Saving and unsaving a place, with the heart filling before the request returns
 * (§120.2).
 *
 * Optimistic, which almost nothing else in this app is. A heart that waits for a
 * round trip feels broken on a slow connection, and the cost of being wrong is
 * nil — the worst case is a heart that fills and empties again, and the row the
 * list is built from is refetched either way.
 *
 * The update is written into EVERY cached discovery page and shop page at once,
 * because the same place appears on several: the search list, a filtered list,
 * and its own page. Patching one would leave the others disagreeing until they
 * happened to refetch.
 */
export function useSaved() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const patch = (locationId: string, saved: boolean) => {
    queryClient.setQueriesData<{ locations?: Array<{ id: string; saved?: boolean }> }>(
      { queryKey: ['discover'] },
      (page) =>
        page?.locations
          ? {
              ...page,
              locations: page.locations.map((l) =>
                l.id === locationId ? { ...l, saved } : l,
              ),
            }
          : page,
    );
    queryClient.setQueryData<{ id: string; saved?: boolean }>(
      ['shop', locationId],
      (shop) => (shop ? { ...shop, saved } : shop),
    );
  };

  const toggle = useMutation({
    mutationFn: ({ locationId, saved }: { locationId: string; saved: boolean }) =>
      saved ? unsaveFavourite(locationId) : saveFavourite(locationId),
    onMutate: ({ locationId, saved }) => {
      patch(locationId, !saved);
      return { locationId, saved };
    },
    onError: (error, _variables, context) => {
      // Put it back. A heart that stayed filled after a failure is a lie the
      // customer only discovers on the Saved screen.
      if (context) patch(context.locationId, context.saved);
      Alert.alert(
        'Not saved',
        error instanceof ApiError ? error.message : 'Please try again.',
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['favourites'] }),
  });

  return {
    pending: toggle.isPending,
    /** Signing in is required to save, and not to browse — so it is asked for here. */
    toggle: (locationId: string, saved: boolean, next?: string) => {
      if (!tokens.access) {
        router.push(`/sign-in?next=${next ?? '/'}`);
        return;
      }
      toggle.mutate({ locationId, saved });
    },
  };
}
