import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { listAdminCategories, setCategoryLive } from '../api/admin';

/**
 * Which categories a business may choose (§98).
 *
 * The platform ships the whole taxonomy and opens part of it — start with the
 * two or three there is someone to serve, add the rest as that changes.
 *
 * Switching one off gates the **picker only**. A business already in it keeps
 * its listing and stays in search, because it did not make this decision. The
 * count on each row is there so nobody switches one off without seeing who is
 * in it.
 */
export function CategoriesPage() {
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: listAdminCategories,
  });

  const toggle = useMutation({
    mutationFn: (input: { id: string; isLive: boolean }) =>
      setCategoryLive(input.id, input.isLive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-categories'] }),
  });

  const live = categories.data?.filter((category) => category.isLive).length ?? 0;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Categories</h1>
          <p className="muted">
            What a business can pick when it signs up. Switching one off never
            removes anyone already in it.
          </p>
        </div>
        {categories.data && (
          <span className="muted small">
            {live} of {categories.data.length} offered
          </span>
        )}
      </header>

      {toggle.error && (
        <p className="error" role="alert">
          {toggle.error instanceof ApiError ? toggle.error.message : 'That did not work.'}
        </p>
      )}

      {categories.isLoading && <p className="muted">Loading…</p>}

      {categories.data && (
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Businesses in it</th>
              <th>Types</th>
              <th>Offered to new businesses</th>
            </tr>
          </thead>
          <tbody>
            {categories.data.map((category) => (
              <tr key={category.id} className={category.isLive ? undefined : 'muted'}>
                <td>
                  <strong>{category.name}</strong>
                  {category.description && (
                    <div className="muted small">{category.description}</div>
                  )}
                </td>
                <td className="num">
                  {category.businessCount}
                  {category.businessCount > 0 && !category.isLive && (
                    // The reassurance that matters: they are still listed.
                    <div className="muted small">still listed</div>
                  )}
                </td>
                <td className="num">{category.subcategoryCount}</td>
                <td>
                  <label className="inline small">
                    <input
                      type="checkbox"
                      checked={category.isLive}
                      disabled={toggle.isPending}
                      onChange={(event) =>
                        toggle.mutate({ id: category.id, isLive: event.target.checked })
                      }
                    />
                    {category.isLive ? 'Offered' : 'Hidden'}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
