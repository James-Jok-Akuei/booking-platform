import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { saveService, unsaveService } from './api/discovery';
import { ApiError, tokens } from './api/client';

type Keyed = { id: string; location?: { id: string }; saved?: boolean };

/**
 * Saving a service at a branch (§158) — the twin of `useSaved` for places.
 *
 * Optimistic: the heart fills before the request leaves, and is put back if
 * the request fails. Every list that can show this service is patched —
 * the home shelves, the shop page, the saved list — so a heart filled on one
 * screen is filled on the next.
 */
export function useSavedService() {
  const queryClient = useQueryClient();
  const router = useRouter();

  const patch = (serviceId: string, locationId: string, saved: boolean) => {
    const mark = (s: Keyed) =>
      s.id === serviceId && (s.location?.id ?? locationId) === locationId ? { ...s, saved } : s;
    queryClient.setQueriesData<{ services?: Keyed[] }>(
      { queryKey: ['discover-services'] },
      (page) => (page?.services ? { ...page, services: page.services.map(mark) } : page),
    );
    queryClient.setQueriesData<{ services?: Keyed[] }>(
      { queryKey: ['discover-services-near'] },
      (page) => (page?.services ? { ...page, services: page.services.map(mark) } : page),
    );
    queryClient.setQueryData<{ services?: Keyed[] }>(['shop', locationId], (shop) =>
      shop?.services ? { ...shop, services: shop.services.map(mark) } : shop,
    );
  };

  const toggle = useMutation({
    mutationFn: ({ serviceId, locationId, saved }: { serviceId: string; locationId: string; saved: boolean }) =>
      saved ? unsaveService(serviceId, locationId) : saveService(serviceId, locationId),
    onMutate: ({ serviceId, locationId, saved }) => {
      patch(serviceId, locationId, !saved);
      return { serviceId, locationId, saved };
    },
    onError: (error, _variables, context) => {
      if (context) patch(context.serviceId, context.locationId, context.saved);
      Alert.alert('Not saved', error instanceof ApiError ? error.message : 'Please try again.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['saved-services'] }),
  });

  return {
    pending: toggle.isPending,
    toggle: (serviceId: string, locationId: string, saved: boolean, next?: string) => {
      if (!tokens.access) {
        router.push(`/sign-in?next=${next ?? '/'}`);
        return;
      }
      toggle.mutate({ serviceId, locationId, saved });
    },
  };
}
