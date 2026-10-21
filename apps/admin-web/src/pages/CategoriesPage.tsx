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
  type TaxonomyTranslations,
  listWriteIns,
  promoteWriteIn,
  type WriteIn,
} from '../api/admin';
import { CATEGORY_LOOKS, categoryLook } from '../ui/CategoryMark';
import { LineArt } from '../ui/LineArt';
import { confirmDialog, promptDialog } from '../ui/Dialog';
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

      <WriteIns onChanged={refresh} />

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
    mutationFn: (body: { name: string; icon: string; description?: string; translations: TaxonomyTranslations }) =>
      updateCategory(category.id, body),
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
            <strong>
              {category.name}
              <Spoken translations={category.translations} />
            </strong>
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
  onSave: (body: { name: string; icon: string; description?: string; translations: TaxonomyTranslations }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? '');
  const [icon, setIcon] = useState(category.icon ?? 'store');
  const [words, setWords] = useState<TaxonomyTranslations>(category.translations ?? {});
  return (
    <form
      className="tx-edit"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim().length >= 2)
          onSave({ name: name.trim(), icon, ...(description.trim() ? { description: description.trim() } : {}), translations: words });
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" autoFocus maxLength={60} />
      <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What it covers" aria-label="What it covers" maxLength={200} />
      <OtherLanguages value={words} onChange={setWords} withDescription />
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
  const [words, setWords] = useState<TaxonomyTranslations>(type.translations ?? {});
  const rename = useMutation({
    mutationFn: (name: string) => updateSubcategory(type.id, name, words),
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
          <div className="tx-rename-row">
            <input name="name" defaultValue={type.name} autoFocus aria-label="New name" />
            <button type="submit" className="primary" disabled={rename.isPending}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          <OtherLanguages value={words} onChange={setWords} />
        </form>
      ) : (
        <>
          <span className="tx-type-name">
            <b>
              {type.name}
              <Spoken translations={type.translations} />
            </b>
            <em>{shadowed ? `Not offered while “${parentName}” is retired` : shops(type.businessCount)}</em>
          </span>
          <button
            type="button"
            className="tx-icon-btn is-quiet"
            onClick={() => setEditing(true)}
            aria-label={`Rename ${type.name}`}
            title="Rename, or name it in Kinyarwanda and French"
          >
            <Icon name="pencil" size={14} />
          </button>
          <Toggle checked={type.isLive} disabled={toggle.isPending} onChange={(v) => void onToggle(v)} label={type.isLive ? 'Offered' : 'Retired'} />
        </>
      )}
    </li>
  );
}

/**
 * What shops wrote under "Other" (§267), most-written first: the types the
 * list may be missing. One press makes a write-in a type of its own and moves
 * every shop that wrote it into that type.
 */
function WriteIns({ onChanged }: { onChanged: () => void }) {
  const queryClient = useQueryClient();
  const writeIns = useQuery({ queryKey: ['admin-write-ins'], queryFn: listWriteIns });
  const promote = useMutation({
    mutationFn: (input: { row: WriteIn; name: string }) => promoteWriteIn(input.row.categoryId, input.row.label, input.name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-write-ins'] });
      onChanged();
    },
  });

  const rows = writeIns.data ?? [];
  if (rows.length === 0) return null;

  const make = async (row: WriteIn) => {
    const name = await promptDialog({
      title: `Make “${row.label}” a type?`,
      body: (
        <p>
          It becomes a type in <strong>{row.categoryName}</strong> that any shop can choose, and the {shops(row.count)} that
          wrote it {row.count === 1 ? 'moves' : 'move'} from “Other” into it.
        </p>
      ),
      label: 'The type’s name — as customers will read it',
      initial: row.label,
      minLength: 2,
      minMessage: 'A name of at least 2 characters.',
      multiline: false,
      tone: 'ok',
      icon: 'plus',
      confirmLabel: 'Make it a type',
      cancelLabel: 'Not now',
    });
    if (name !== null) promote.mutate({ row, name: name.trim() });
  };

  return (
    <section className="tx-writeins" aria-labelledby="tx-writeins-title">
      <header>
        <div>
          <h2 id="tx-writeins-title">Written in under “Other”</h2>
          <p className="muted">What shops say they are when no type fits. When many write the same thing, make it a type.</p>
        </div>
      </header>
      {promote.error && (
        <p className="error small" role="alert">
          {promote.error instanceof ApiError ? promote.error.message : 'That did not work.'}
        </p>
      )}
      <ul>
        {rows.map((row) => (
          <li key={`${row.categoryId}:${row.label}`}>
            <LineArt icon={row.categoryIcon} className="tx-writein-art" />
            <span className="tx-writein-text">
              <strong>“{row.label}”</strong>
              <em>
                {row.categoryName} · {shops(row.count)}: {row.businesses.map((b) => b.name ?? 'No name yet').join(', ')}
              </em>
            </span>
            <button type="button" disabled={promote.isPending} onClick={() => void make(row)}>
              <Icon name="plus" size={15} /> Make it a type
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const LANGUAGE_BOXES = [
  { code: 'rw', label: 'Kinyarwanda' },
  { code: 'fr', label: 'French' },
] as const;

/**
 * Its name — and a category's description — in Kinyarwanda and French
 * (§308.3). The seeded names are translated with the rest of the apps' words;
 * these boxes are for a name made or changed here, or to correct one. Left
 * empty, a language shows the translators' version, else the English.
 */
function OtherLanguages({
  value,
  onChange,
  withDescription = false,
}: {
  value: TaxonomyTranslations;
  onChange: (next: TaxonomyTranslations) => void;
  withDescription?: boolean;
}) {
  const typed = LANGUAGE_BOXES.some(({ code }) => value[code]?.name || value[code]?.description);
  const set = (code: 'rw' | 'fr', field: 'name' | 'description', text: string) =>
    onChange({ ...value, [code]: { ...value[code], [field]: text } });
  return (
    <details className="tx-langs" open={typed}>
      <summary>
        <Icon name="globe" size={14} /> In Kinyarwanda and French
        <span>Optional — empty uses the translators’ version</span>
      </summary>
      {LANGUAGE_BOXES.map(({ code, label }) => (
        <div key={code} className="tx-lang">
          <span className="tx-lang-code">{code.toUpperCase()}</span>
          <input
            value={value[code]?.name ?? ''}
            onChange={(event) => set(code, 'name', event.target.value)}
            placeholder={`Name in ${label}`}
            aria-label={`Name in ${label}`}
            maxLength={60}
          />
          {withDescription && (
            <input
              value={value[code]?.description ?? ''}
              onChange={(event) => set(code, 'description', event.target.value)}
              placeholder={`What it covers, in ${label}`}
              aria-label={`What it covers, in ${label}`}
              maxLength={200}
            />
          )}
        </div>
      ))}
    </details>
  );
}

/** Small marks beside a name typed here in another language, the words on hover. */
function Spoken({ translations }: { translations?: TaxonomyTranslations }) {
  const typed = LANGUAGE_BOXES.filter(({ code }) => translations?.[code]?.name);
  if (typed.length === 0) return null;
  return (
    <span className="tx-spoken">
      {typed.map(({ code, label }) => (
        <abbr key={code} title={`${label}: ${translations![code]!.name}`}>
          {code.toUpperCase()}
        </abbr>
      ))}
    </span>
  );
}
