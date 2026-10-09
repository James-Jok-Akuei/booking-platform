import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { Toggle } from '../components/Toggle';
import {
  createCategory,
  createSubcategory,
  listAdminCategories,
  setCategoryLive,
  setSubcategoryLive,
  updateCategory,
  updateSubcategory,
  type AdminCategory,
  type AdminSubcategory,
} from '../api/admin';
import { CATEGORY_LOOKS, categoryLook } from '../ui/CategoryMark';
import { LineArt } from '../ui/LineArt';
import { confirmDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import './taxonomy.css';

const shops = (n: number) => `${n} ${n === 1 ? 'shop' : 'shops'}`;

/**
 * The taxonomy: what a shop may choose when it signs up (§252, §98).
 *
 * Each category as the customer app draws it — its own colours and mark —
 * with its types under it. Switching something off gates the **picker** only:
 * a shop already in it keeps its listing and stays in search, because it did
 * not make this decision (§98). **Nothing is deleted** (§101): off is a
 * retirement and can be undone, and a mistake in a name is fixed by renaming.
 * Every switch asks first; it changes what every future sign-up can choose.
 */
export function CategoriesPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const categories = useQuery({ queryKey: ['admin-categories'], queryFn: listAdminCategories });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });

  const list = categories.data ?? [];
  const live = list.filter((c) => c.isLive).length;
  const types = list.reduce((sum, c) => sum + c.subcategories.length, 0);
  const liveTypes = list.reduce((sum, c) => sum + (c.isLive ? c.subcategories.filter((s) => s.isLive).length : 0), 0);
  const inUse = list.reduce((sum, c) => sum + c.businessCount, 0);

  return (
    <section className="tx">
      <div className="page-top">
        <header className="page-head tx-head">
          <div>
            <h1>Categories</h1>
            <p className="muted">What a shop can choose when it signs up. Nothing is ever deleted — switching one off retires it, and on brings it back.</p>
          </div>
          <button type="button" className="primary tx-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={17} /> Add a category
          </button>
        </header>
      </div>

      {categories.data && (
        <div className="tx-stats">
          <div>
            <strong>
              {live}
              <small> of {list.length}</small>
            </strong>
            <span>categories offered</span>
          </div>
          <div>
            <strong>
              {liveTypes}
              <small> of {types}</small>
            </strong>
            <span>types a shop can pick</span>
          </div>
          <div>
            <strong>{inUse}</strong>
            <span>shops listed in them</span>
          </div>
        </div>
      )}

      {categories.isLoading && (
        <div className="tx-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton tx-skel" />
          ))}
        </div>
      )}

      <div className="tx-grid">
        {list.map((category, i) => (
          <CategoryCard key={category.id} category={category} index={i} onChanged={refresh} />
        ))}
      </div>

      {adding && <NewCategory onClose={() => setAdding(false)} onDone={refresh} />}
    </section>
  );
}

/**
 * The drawings the apps know (§264); anything else is drawn as a shopfront.
 * The same fine-line drawing a customer sees on the home screen and the
 * categories wall, and a seller sees when setting up.
 */
function MarkPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div className="tx-marks" role="radiogroup" aria-label="Its drawing">
      {Object.entries(CATEGORY_LOOKS).map(([key, look], i) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          className={value === key ? 'is-on' : ''}
          onClick={() => onChange(key)}
          title={look.name}
        >
          <LineArt icon={key} delay={i * 50} />
          <span>{look.name}</span>
        </button>
      ))}
    </div>
  );
}

function NewCategory({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  // A new category starts as a general shop (§266), never borrowing another kind's drawing by accident.
  const [icon, setIcon] = useState('store');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () =>
      createCategory({ name: name.trim(), icon, ...(description.trim() ? { description: description.trim() } : {}) }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length >= 2) create.mutate();
  };

  return (
    <Panel
      eyebrow="Categories"
      title="A new category"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="tx-new" className="primary" disabled={create.isPending || name.trim().length < 2}>
            {create.isPending ? 'Adding…' : 'Add the category'}
          </button>
        </>
      }
    >
      {/* As the customer app's categories wall draws it (§264). */}
      <div className="tx-preview" style={{ background: categoryLook(icon).tint }}>
        <div className="tx-preview-card">
          <strong>{name.trim() || 'Its name'}</strong>
          <span>{description.trim() || 'What it covers, in a few words.'}</span>
          <LineArt key={icon} icon={icon} />
        </div>
        <em>As customers will see it</em>
      </div>

      <form id="tx-new" className="tx-form" onSubmit={submit}>
        <label>
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Car Hire" autoFocus maxLength={60} />
        </label>
        <label>
          <span>
            What it covers <em>(optional)</em>
          </span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Cars and vans by the day, with or without a driver." maxLength={200} />
        </label>
        <div className="tx-field">
          <span>Its drawing</span>
          <MarkPicker value={icon} onChange={setIcon} />
        </div>
        <p className="tx-note">It is offered to shops as soon as it exists. Add its types next — a shop picks one of those.</p>
        {create.error && (
          <p className="error small" role="alert">
            {create.error instanceof ApiError ? create.error.message : 'That did not save.'}
          </p>
        )}
      </form>
    </Panel>
  );
}

function CategoryCard({ category, index, onChanged }: { category: AdminCategory; index: number; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [newType, setNewType] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const look = categoryLook(category.icon);

  const fail = (error: unknown) => setProblem(error instanceof ApiError ? error.message : 'That did not work.');
  const done = () => {
    setProblem(null);
    onChanged();
  };

  const toggle = useMutation({ mutationFn: (isLive: boolean) => setCategoryLive(category.id, isLive), onSuccess: done, onError: fail });
  const save = useMutation({
    mutationFn: (body: { name: string; icon: string; description?: string }) => updateCategory(category.id, body),
    onSuccess: () => {
      setEditing(false);
      done();
    },
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

  const onToggle = async (next: boolean) => {
    const n = category.businessCount;
    const sure = await confirmDialog({
      title: next ? `Offer “${category.name}” again?` : `Stop offering “${category.name}”?`,
      body: next ? (
        <p>New shops will be able to choose it, and customers will see it on the home screen.</p>
      ) : (
        <p>
          New shops will not be able to choose it.
          {n > 0 && ` The ${shops(n)} already in it keep their listing and stay in search. Nothing is removed.`}
        </p>
      ),
      tone: next ? 'ok' : 'warn',
      icon: next ? 'checkCircle' : 'pause',
      confirmLabel: next ? 'Offer it' : 'Stop offering it',
      cancelLabel: 'Not now',
    });
    if (sure) toggle.mutate(next);
  };

  return (
    <article className={`tx-card${category.isLive ? '' : ' is-off'}`} style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <header className="tx-card-head" style={{ background: `linear-gradient(180deg, ${look.tint}, transparent)` }}>
        <LineArt icon={category.icon} delay={Math.min(index, 8) * 60} className="tx-card-art" />
        {editing ? (
          <EditCategory category={category} busy={save.isPending} onSave={(body) => save.mutate(body)} onCancel={() => setEditing(false)} />
        ) : (
          <div className="tx-title">
            <strong>{category.name}</strong>
            <span>
              {shops(category.businessCount)}
              {category.description && ` · ${category.description}`}
            </span>
          </div>
        )}
        {!editing && (
          <div className="tx-card-acts">
            <Toggle checked={category.isLive} disabled={toggle.isPending} onChange={(v) => void onToggle(v)} label={category.isLive ? 'Offered' : 'Retired'} />
            <button type="button" className="tx-icon-btn" onClick={() => setEditing(true)} aria-label={`Edit ${category.name}`} title="Rename, describe or change its drawing">
              <Icon name="pencil" size={15} />
            </button>
          </div>
        )}
      </header>

      {problem && (
        <p className="error small tx-problem" role="alert">
          {problem}
        </p>
      )}

      <ul className="tx-types">
        {category.subcategories.map((s) => (
          <TypeRow key={s.id} type={s} parentLive={category.isLive} parentName={category.name} onChanged={done} onError={fail} />
        ))}
        {category.subcategories.length === 0 && <li className="tx-none">No types yet. A shop picks one of these when it signs up.</li>}
      </ul>

      <form
        className="tx-add-type"
        onSubmit={(event) => {
          event.preventDefault();
          if (newType.trim().length >= 2) addType.mutate();
        }}
      >
        <Icon name="plus" size={15} />
        <input value={newType} onChange={(event) => setNewType(event.target.value)} placeholder="Add a type, like Barbershop" aria-label={`Add a type to ${category.name}`} />
        {newType.trim().length >= 2 && (
          <button type="submit" className="primary" disabled={addType.isPending}>
            {addType.isPending ? 'Adding…' : 'Add'}
          </button>
        )}
      </form>
    </article>
  );
}

function EditCategory({
  category,
  busy,
  onSave,
  onCancel,
}: {
  category: AdminCategory;
  busy: boolean;
  onSave: (body: { name: string; icon: string; description?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? '');
  const [icon, setIcon] = useState(category.icon ?? 'store');
  return (
    <form
      className="tx-edit"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim().length >= 2) onSave({ name: name.trim(), icon, ...(description.trim() ? { description: description.trim() } : {}) });
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" autoFocus maxLength={60} />
      <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What it covers" aria-label="What it covers" maxLength={200} />
      <MarkPicker value={icon} onChange={setIcon} />
      <div className="tx-edit-acts">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy || name.trim().length < 2}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function TypeRow({
  type,
  parentLive,
  parentName,
  onChanged,
  onError,
}: {
  type: AdminSubcategory;
  parentLive: boolean;
  parentName: string;
  onChanged: () => void;
  onError: (error: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const toggle = useMutation({ mutationFn: (isLive: boolean) => setSubcategoryLive(type.id, isLive), onSuccess: onChanged, onError });
  const rename = useMutation({
    mutationFn: (name: string) => updateSubcategory(type.id, name),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError,
  });

  const onToggle = async (next: boolean) => {
    const n = type.businessCount;
    const sure = await confirmDialog({
      title: next ? `Offer “${type.name}” again?` : `Stop offering “${type.name}”?`,
      body: next ? undefined : (
        <p>
          New shops will not be able to choose it.
          {n > 0 && ` The ${shops(n)} already using it keep their listing.`}
        </p>
      ),
      tone: next ? 'ok' : 'warn',
      icon: next ? 'checkCircle' : 'pause',
      confirmLabel: next ? 'Offer it' : 'Stop offering it',
      cancelLabel: 'Not now',
    });
    if (sure) toggle.mutate(next);
  };

  // Its own switch is on and the parent's is off, so it is not actually
  // offered. Saying so beats a row that looks open.
  const shadowed = type.isLive && !parentLive;

  return (
    <li className={type.isLive && parentLive ? '' : 'is-off'}>
      {editing ? (
        <form
          className="tx-rename"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem('name') as HTMLInputElement;
            if (input.value.trim().length >= 2) rename.mutate(input.value.trim());
          }}
        >
          <input name="name" defaultValue={type.name} autoFocus aria-label="New name" />
          <button type="submit" className="primary" disabled={rename.isPending}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="tx-type-name">
            <b>{type.name}</b>
            <em>{shadowed ? `Not offered while “${parentName}” is retired` : shops(type.businessCount)}</em>
          </span>
          <button type="button" className="tx-icon-btn is-quiet" onClick={() => setEditing(true)} aria-label={`Rename ${type.name}`} title="Rename">
            <Icon name="pencil" size={14} />
          </button>
          <Toggle checked={type.isLive} disabled={toggle.isPending} onChange={(v) => void onToggle(v)} label={type.isLive ? 'Offered' : 'Retired'} />
        </>
      )}
    </li>
  );
}
