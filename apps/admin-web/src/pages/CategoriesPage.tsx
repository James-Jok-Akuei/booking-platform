import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { Toggle } from '../components/Toggle';
import {
  createCategory,
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  listAdminCategories,
  setCategoryLive,
  setSubcategoryLive,
  updateCategory,
  updateSubcategory,
  type AdminCategory,
  type AdminSubcategory,
} from '../api/admin';

/**
 * The taxonomy: what exists, and what a business may choose.
 *
 * Switching something off gates the **picker** only. A business already in it
 * keeps its listing and stays in search — it did not make this decision (§98).
 * Deleting is refused the moment anything is using it, because the foreign key
 * is SetNull and a delete would strip the category from every business in it.
 *
 * Every switch confirms first. They take effect immediately and change what
 * thousands of future sign-ups can choose, which is not something to do by
 * brushing a control on the way past.
 */
export function CategoriesPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: listAdminCategories,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
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
        <div className="filters">
          {categories.data && (
            <span className="muted small">
              {live} of {categories.data.length} offered
            </span>
          )}
          <button type="button" className="primary" onClick={() => setAdding(true)}>
            Add a category
          </button>
        </div>
      </header>

      {adding && <NewCategory onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}

      {categories.isLoading && <p className="muted">Loading…</p>}

      <ul className="taxonomy">
        {categories.data?.map((category) => (
          <CategoryCard key={category.id} category={category} onChanged={refresh} />
        ))}
      </ul>
    </section>
  );
}

function NewCategory({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () =>
      createCategory({
        name: name.trim(),
        ...(icon.trim() ? { icon: icon.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: onDone,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <form className="card setting" onSubmit={submit}>
      <div className="setting-head">
        <h2>New category</h2>
        <p className="muted small">
          It is offered to businesses as soon as it exists. Add its types next.
        </p>
      </div>
      <div className="filters">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Dining"
          autoFocus
        />
        <input
          value={icon}
          onChange={(event) => setIcon(event.target.value)}
          placeholder="icon key or emoji"
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Restaurants, cafes and takeaways."
        />
      </div>
      {create.error && (
        <p className="error small" role="alert">
          {create.error instanceof ApiError ? create.error.message : 'That did not save.'}
        </p>
      )}
      <div className="row-end">
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={create.isPending || name.trim().length < 2}>
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}

function CategoryCard({
  category,
  onChanged,
}: {
  category: AdminCategory;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [newType, setNewType] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const fail = (error: unknown) =>
    setProblem(error instanceof ApiError ? error.message : 'That did not work.');
  const done = () => {
    setProblem(null);
    onChanged();
  };

  const toggle = useMutation({
    mutationFn: (isLive: boolean) => setCategoryLive(category.id, isLive),
    onSuccess: done,
    onError: fail,
  });
  const rename = useMutation({
    mutationFn: (name: string) => updateCategory(category.id, { name }),
    onSuccess: () => {
      setEditing(false);
      done();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deleteCategory(category.id),
    onSuccess: done,
    onError: fail,
  });
  const addType = useMutation({
    mutationFn: () => createSubcategory(category.id, newType.trim()),
    onSuccess: () => {
      setNewType('');
      done();
    },
    onError: fail,
  });

  const onToggle = (next: boolean) => {
    const inUse = category.businessCount;
    const message = next
      ? `Offer "${category.name}" to businesses again?\n\nNew sign-ups will be able to choose it.`
      : `Stop offering "${category.name}"?\n\n` +
        'New businesses will not be able to choose it.' +
        (inUse > 0
          ? `\n\nThe ${inUse} business${inUse === 1 ? '' : 'es'} already in it keep their listing and stay in search. Nothing is removed.`
          : '');
    if (window.confirm(message)) toggle.mutate(next);
  };

  return (
    <li className={category.isLive ? 'cat' : 'cat off'}>
      <div className="cat-head">
        <div>
          {editing ? (
            <form
              className="sub-add"
              onSubmit={(event) => {
                event.preventDefault();
                const input = (event.currentTarget.elements.namedItem('name') as HTMLInputElement);
                rename.mutate(input.value.trim());
              }}
            >
              <input name="name" defaultValue={category.name} autoFocus />
              <button type="submit" className="primary" disabled={rename.isPending}>
                Save
              </button>
              <button type="button" className="link" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <strong>
                {category.icon && <span className="cat-icon">{category.icon} </span>}
                {category.name}
              </strong>
              <div className="muted small">
                {category.businessCount} business{category.businessCount === 1 ? '' : 'es'}
                {category.description && ` · ${category.description}`}
              </div>
            </>
          )}
        </div>

        <div className="people-actions">
          <Toggle
            checked={category.isLive}
            disabled={toggle.isPending}
            onChange={onToggle}
            label={category.isLive ? 'Offered' : 'Hidden'}
          />
          {!editing && (
            <button type="button" className="link" onClick={() => setEditing(true)}>
              Rename
            </button>
          )}
          {/* Offered at all only when nothing depends on it. The server refuses
              otherwise, and a button that always 400s teaches people to ignore
              the message. */}
          {category.businessCount === 0 &&
            category.subcategories.every((s) => s.businessCount === 0) && (
              <button
                type="button"
                className="link danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete "${category.name}" and its ${category.subcategories.length} type(s)?\n\n` +
                        'Nothing is using it, so nothing is lost. This cannot be undone.',
                    )
                  ) {
                    remove.mutate();
                  }
                }}
              >
                Delete
              </button>
            )}
        </div>
      </div>

      {problem && (
        <p className="error small" role="alert">
          {problem}
        </p>
      )}

      <ul className="subs">
        {category.subcategories.map((subcategory) => (
          <SubcategoryRow
            key={subcategory.id}
            subcategory={subcategory}
            parentLive={category.isLive}
            parentName={category.name}
            onChanged={done}
            onError={fail}
          />
        ))}
        {category.subcategories.length === 0 && (
          <li className="muted small">No types yet. A business picks one of these.</li>
        )}
      </ul>

      <form
        className="sub-add"
        onSubmit={(event) => {
          event.preventDefault();
          addType.mutate();
        }}
      >
        <input
          value={newType}
          onChange={(event) => setNewType(event.target.value)}
          placeholder="Add a type, e.g. Barbershop"
        />
        <button type="submit" disabled={addType.isPending || newType.trim().length < 2}>
          Add
        </button>
      </form>
    </li>
  );
}

function SubcategoryRow({
  subcategory,
  parentLive,
  parentName,
  onChanged,
  onError,
}: {
  subcategory: AdminSubcategory;
  parentLive: boolean;
  parentName: string;
  onChanged: () => void;
  onError: (error: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);

  const toggle = useMutation({
    mutationFn: (isLive: boolean) => setSubcategoryLive(subcategory.id, isLive),
    onSuccess: onChanged,
    onError,
  });
  const rename = useMutation({
    mutationFn: (name: string) => updateSubcategory(subcategory.id, name),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => deleteSubcategory(subcategory.id),
    onSuccess: onChanged,
    onError,
  });

  const onToggle = (next: boolean) => {
    const n = subcategory.businessCount;
    const message = next
      ? `Offer "${subcategory.name}" again?`
      : `Stop offering "${subcategory.name}"?\n\n` +
        'New businesses will not be able to choose it.' +
        (n > 0
          ? `\n\nThe ${n} business${n === 1 ? '' : 'es'} already using it keep their listing.`
          : '');
    if (window.confirm(message)) toggle.mutate(next);
  };

  return (
    <li>
      {editing ? (
        <form
          className="sub-add"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem('name') as HTMLInputElement;
            rename.mutate(input.value.trim());
          }}
        >
          <input name="name" defaultValue={subcategory.name} autoFocus />
          <button type="submit" className="primary" disabled={rename.isPending}>
            Save
          </button>
          <button type="button" className="link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div>
          <span>{subcategory.name}</span>
          <span className="muted small">
            {' '}
            · {subcategory.businessCount} business
            {subcategory.businessCount === 1 ? '' : 'es'}
          </span>
          {/* Its own switch is on and the parent's is off, so it is not
              actually offered. Saying so beats a row that looks open. */}
          {subcategory.isLive && !parentLive && (
            <div className="muted small">
              Not offered while “{parentName}” is hidden.
            </div>
          )}
        </div>
      )}

      <div className="people-actions">
        <Toggle
          checked={subcategory.isLive}
          disabled={toggle.isPending}
          onChange={onToggle}
          label={subcategory.isLive ? 'Offered' : 'Hidden'}
        />
        {!editing && (
          <button type="button" className="link" onClick={() => setEditing(true)}>
            Rename
          </button>
        )}
        {subcategory.businessCount === 0 && (
          <button
            type="button"
            className="link danger"
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Delete the type "${subcategory.name}"?\n\n` +
                    'Nothing is using it. This cannot be undone.',
                )
              ) {
                remove.mutate();
              }
            }}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
