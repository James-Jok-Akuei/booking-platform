import { useMutation, useQueryClient } from '@tanstack/react-query';
import { publishShop } from '../api/business';
import { confirmDialog } from '../ui/Dialog';

/**
 * "Post my shop" (§268): an approved shop showing itself to customers, asked
 * first, because from that moment strangers can find it and book. One hook
 * for the Overview's card and the Shopfront page, so both ask the same way.
 */
export function usePostShop(name: string) {
  const queryClient = useQueryClient();
  const post = useMutation({
    mutationFn: publishShop,
    onSuccess: (next) => {
      queryClient.setQueryData(['readiness'], next);
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const ask = async () => {
    const yes = await confirmDialog({
      title: `Post ${name} for customers?`,
      body: (
        <>
          <p>
            From now on customers can find it in the app, see your services, prices and opening times, and book — paying
            their deposit as they do.
          </p>
          <p>Need a break later? Pause it on your Shopfront page. Bookings already made still happen.</p>
        </>
      ),
      tone: 'ok',
      icon: 'send',
      confirmLabel: 'Post my shop',
      cancelLabel: 'Not yet',
    });
    if (yes) post.mutate();
  };

  return { ask, post };
}
