import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  addGalleryPhoto,
  getCategories,
  getGallery,
  getProfile,
  getReadiness,
  listLocations,
  pauseBusiness,
  removeGalleryPhoto,
  resumeBusiness,
  setProfileImage,
  updateProfile,
  setKinds,
  MAX_KIND_CATEGORIES,
  OTHER,
  kindName,
  type BusinessProfile,
  type Location,
} from '../api/business';
import { initialsOf } from '../ui/Avatar';
import { CustomerPhone } from '../shopfront/CustomerPhone';
import { confirmDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { Select } from '../ui/Select';
import { ShopLogo } from '../ui/ShopLogo';
import { Stars } from '../ui/Stars';
import { Switch } from '../ui/Switch';
import { shopStateWord } from '../onboarding/steps';
import { LineArt } from '../onboarding/LineArt';
import { usePostShop } from '../onboarding/usePostShop';
import { RichTextBox } from '../ui/RichTextBox';
import './profile.css';
import { useAccess } from '../access';

/** Mirrors ALLOWED_MIME_TYPES on the server (§132.3). */
const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

/**
 * How a business looks to a customer (§88, §197).
 *
 * Everything here is the shop window: the name and description a customer
 * reads before booking, and the photos they judge the place by. The details
 * form sits beside a live preview of the shop as the customer's app shows it,
 * so every word is seen where it will be read.
 */
export function ProfilePage() {
  const access = useAccess();
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });

  return (
    <section className="pf">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Your shopfront</h1>
            <p className="muted">What a customer sees before they book. The photos do most of the work.</p>
          </div>
        </header>
      </div>

      {/* The shopfront is the whole shop's (§277); a branch's photos are its own. */}
      {access.ready && !access.runsBusiness && (
        <p className="pf-scope">
          <Icon name="shield" size={16} />
          {access.runsBranches
            ? 'The owner, or a manager of every branch, changes the shopfront. You can add and remove photos at your branches.'
            : 'The owner or a manager changes the shopfront. You can see it here as customers do.'}
        </p>
      )}

      {profile.isLoading && <div className="skeleton pf-skeleton" />}
      {profile.data && (
        <>
          {/* Approved and not yet showing: posting comes before pausing (§268). */}
          {profile.data.status === 'APPROVED' && !profile.data.publishedAt ? (
            <PostPanel profile={profile.data} />
          ) : (
            <PausePanel profile={profile.data} />
          )}
          <ShopWindow profile={profile.data} locations={locations.data ?? []} canEdit={access.runsBusiness} />
          <Strength profile={profile.data} locations={locations.data ?? []} />
          <Details profile={profile.data} locations={locations.data ?? []} canEdit={access.runsBusiness} />
          <Galleries locations={locations.data} canEdit={access.runsBranches} />
        </>
      )}
    </section>
  );
}

/** A hidden file input with its own label as the control (§81.4, §132.3). */
function PickImage({
  id,
  busy,
  onPick,
  className,
  children,
}: {
  id: string;
  busy: boolean;
  onPick: (file: File) => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <input
        id={id}
        type="file"
        className="visually-hidden"
        accept={ACCEPT}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the SAME file twice still fires a change.
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
      <label htmlFor={id} className={`${className}${busy ? ' is-busy' : ''}`}>
        {children}
      </label>
    </>
  );
}

function ShopWindow({
  profile,
  locations,
  canEdit,
}: {
  profile: BusinessProfile;
  locations: Location[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const readiness = useQuery({ queryKey: ['readiness'], queryFn: getReadiness });
  const [problem, setProblem] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (input: { kind: 'logo' | 'cover'; file: File }) => setProfileImage(input.kind, input.file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'That did not upload.'),
  });

  const pick = (kind: 'logo' | 'cover') => (file: File) => {
    setProblem(null);
    upload.mutate({ kind, file });
  };
  const busy = upload.isPending;
  const uploading = upload.isPending ? upload.variables?.kind : null;

  const rated = locations.filter((l) => l.ratingCount > 0);
  const count = rated.reduce((s, l) => s + l.ratingCount, 0);
  const rating = count ? rated.reduce((s, l) => s + Number(l.ratingAvg ?? 0) * l.ratingCount, 0) / count : null;
  const live = profile.status === 'APPROVED' && Boolean(profile.publishedAt) && !profile.pausedAt;

  return (
    <div className="pf-window">
      <div
        className={`pf-cover${profile.coverImageUrl ? '' : ' is-empty'}`}
        style={profile.coverImageUrl ? { backgroundImage: `url(${profile.coverImageUrl})` } : undefined}
      >
        {!profile.coverImageUrl && (
          <span className="pf-cover-hint">
            <Icon name="image" size={28} />
            No cover photo yet
          </span>
        )}
        {canEdit && (
          <PickImage id="cover-upload" busy={busy} onPick={pick('cover')} className="pf-cover-btn">
            <Icon name="camera" size={17} />
            {uploading === 'cover' ? 'Uploading…' : profile.coverImageUrl ? 'Change cover' : 'Add a cover photo'}
          </PickImage>
        )}
      </div>

      <div className="pf-id">
        <div className="pf-logo">
          {profile.logoUrl ? <img src={profile.logoUrl} alt="" /> : <span>{initialsOf(profile.name ?? 'B')}</span>}
          {canEdit && (
            <PickImage id="logo-upload" busy={busy} onPick={pick('logo')} className="pf-logo-btn">
              <Icon name="camera" size={16} />
              <span className="visually-hidden">{profile.logoUrl ? 'Change logo' : 'Add a logo'}</span>
            </PickImage>
          )}
          {uploading === 'logo' && <i className="pf-logo-busy" />}
        </div>
        <div className="pf-id-text">
          <h2>{profile.name ?? 'Unnamed business'}</h2>
          <p>
            {profile.category?.name ?? 'No category chosen'}
            {profile.subcategory && <> · {profile.kinds[0] ? kindName(profile.kinds[0]) : profile.subcategory.name}</>}
          </p>
          <div className="pf-badges">
            <span className={`pf-badge${live ? ' is-live' : ' is-off'}`}>
              <i /> {shopStateWord(profile.status, Boolean(profile.pausedAt), readiness.data?.submittedAt, Boolean(profile.publishedAt))}
            </span>
            {rating !== null && (
              <span className="pf-badge">
                <Stars value={rating} size={13} /> {rating.toFixed(1)} · {count} reviews
              </span>
            )}
            <span className="pf-badge">
              <Icon name="pin" size={14} /> {locations.length} {locations.length === 1 ? 'branch' : 'branches'}
            </span>
          </div>
        </div>
        {canEdit && (
          <PickImage id="logo-upload-2" busy={busy} onPick={pick('logo')} className="pf-logo-change">
            {profile.logoUrl ? 'Change logo' : 'Add a logo'}
          </PickImage>
        )}
      </div>

      {problem && (
        <p className="notice pf-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** How complete the shop window is: the things a customer judges a shop by. */
function Strength({ profile, locations }: { profile: BusinessProfile; locations: Location[] }) {
  const active = locations.filter((l) => l.isActive);
  const steps: Array<{ label: string; done: boolean; icon: IconName }> = [
    { label: 'Cover photo', done: Boolean(profile.coverImageUrl), icon: 'image' },
    { label: 'Logo', done: Boolean(profile.logoUrl), icon: 'store' },
    { label: 'What you do', done: (profile.description ?? '').trim().length >= 40, icon: 'pencil' },
    { label: 'Kind of shop', done: Boolean(profile.category && profile.subcategory), icon: 'tag' },
    { label: 'Phone', done: Boolean(profile.phone), icon: 'phone' },
    {
      label: 'Photos at every branch',
      done: active.length > 0 && active.every((l) => (l._count?.media ?? 0) > 0),
      icon: 'camera',
    },
  ];
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  const r = 34;
  const c = 2 * Math.PI * r;

  return (
    <article className="pf-strength">
      <div className="pf-ring" aria-label={`${pct}% complete`}>
        <svg viewBox="0 0 80 80" width="88" height="88">
          <circle cx="40" cy="40" r={r} className="pf-ring-track" />
          <circle
            cx="40"
            cy="40"
            r={r}
            className="pf-ring-fill"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - done / steps.length)}
          />
        </svg>
        <strong>{pct}%</strong>
      </div>
      <div className="pf-strength-text">
        <h2>{done === steps.length ? 'Your shop window is complete' : 'Make your shop window stand out'}</h2>
        <p>
          {done === steps.length
            ? 'Everything a customer looks for is here.'
            : `${steps.length - done} ${steps.length - done === 1 ? 'thing' : 'things'} left — shops with photos and a good description get chosen first.`}
        </p>
        <ul>
          {steps.map((s) => (
            <li key={s.label} className={s.done ? 'is-done' : ''}>
              <Icon name={s.done ? 'checkCircle' : s.icon} size={15} />
              {s.label}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function Details({
  profile,
  locations,
  canEdit,
}: {
  profile: BusinessProfile;
  locations: Location[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories });

  const [name, setName] = useState(profile.name ?? '');
  const [description, setDescription] = useState(profile.description ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  // Every kind of place the shop is (§265), as types in order — the first is the main one.
  const savedKinds = profile.kinds.length ? profile.kinds.map((k) => k.subcategory.id) : profile.subcategory ? [profile.subcategory.id] : [];
  const [kinds, setKindsList] = useState<string[]>(savedKinds);
  // What the shop wrote for each "Other" it lists (§267).
  const savedLabels: Record<string, string> = Object.fromEntries(
    profile.kinds.filter((k) => k.otherLabel).map((k) => [k.subcategory.id, k.otherLabel!]),
  );
  const [labels, setLabels] = useState<Record<string, string>>(savedLabels);
  const [addCategoryId, setAddCategoryId] = useState('');
  const [addTypeId, setAddTypeId] = useState('');
  const [addLabel, setAddLabel] = useState('');
  const [saved, setSaved] = useState(false);

  // The server is the source of truth: after a save the form follows what came
  // back, not what was typed.
  useEffect(() => {
    setName(profile.name ?? '');
    setDescription(profile.description ?? '');
    setPhone(profile.phone ?? '');
    setKindsList(profile.kinds.length ? profile.kinds.map((k) => k.subcategory.id) : profile.subcategory ? [profile.subcategory.id] : []);
    setLabels(Object.fromEntries(profile.kinds.filter((k) => k.otherLabel).map((k) => [k.subcategory.id, k.otherLabel!])));
    // Only when the shop itself changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Each listed type with its category, from the taxonomy (or, for one no longer offered, from the profile).
  const typeOf = (id: string) => {
    for (const c of categories.data ?? []) {
      const t = c.subcategories.find((s) => s.id === id);
      if (t) return { category: { id: c.id, name: c.name, icon: c.icon }, subcategory: { id: t.id, name: t.name } };
    }
    return profile.kinds.find((k) => k.subcategory.id === id) ?? null;
  };
  const listed = kinds.map(typeOf).filter((k): k is NonNullable<ReturnType<typeof typeOf>> => Boolean(k));
  const usedCategories = [...new Set(listed.map((k) => k.category.id))];
  const addCategory = categories.data?.find((c) => c.id === addCategoryId);
  const categoryFull = usedCategories.length >= MAX_KIND_CATEGORIES && !usedCategories.includes(addCategoryId);
  const main = listed[0] ?? null;
  const others = listed.filter((k) => k.subcategory.name === OTHER);
  const otherLabels = others.map((k) => ({ subcategoryId: k.subcategory.id, label: (labels[k.subcategory.id] ?? '').trim() }));
  const unlabelled = otherLabels.some((o) => o.label.length < 2);
  const addIsOther = addCategory?.subcategories.find((t) => t.id === addTypeId)?.name === OTHER;
  const kindsChanged =
    kinds.length !== savedKinds.length ||
    kinds.some((k, i) => k !== savedKinds[i]) ||
    otherLabels.some((o) => o.label !== (savedLabels[o.subcategoryId] ?? ''));
  const dirty =
    name !== (profile.name ?? '') ||
    description !== (profile.description ?? '') ||
    phone !== (profile.phone ?? '') ||
    kindsChanged;

  const save = useMutation({
    // Only what changed is sent: a shop changing its kinds is not held up by a
    // field it never touched.
    mutationFn: async () => {
      const body = {
        ...(name !== (profile.name ?? '') ? { name: name.trim() } : {}),
        ...(description !== (profile.description ?? '') ? { description: description.trim() } : {}),
        ...(phone !== (profile.phone ?? '') ? { phone: phone.trim() } : {}),
      };
      if (Object.keys(body).length > 0) await updateProfile(body);
      if (kindsChanged && kinds.length > 0) await setKinds(kinds, otherLabels);
    },
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    save.mutate();
  };

  return (
    <div className="pf-details">
      <form className="pf-form" onSubmit={submit}>
        <fieldset className="pf-fieldset" disabled={!canEdit}>
          <header>
            <h2>Details</h2>
            <p>
              {canEdit
                ? 'Shown on your shop’s page in the app.'
                : 'Shown on your shop’s page in the app. The owner, or a manager of every branch, changes them.'}
            </p>
          </header>

          <label className="pf-field">
            <span>Business name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
          </label>

          {/* Not a <label>: a click on its words would press the first button
              of the formatting bar inside it. */}
          <div className="pf-field pf-grow">
            <span id="pf-desc-label">What you do</span>
            <RichTextBox
              labelledBy="pf-desc-label"
              value={description}
              onChange={setDescription}
              rows={5}
              maxLength={2000}
              placeholder="A customer reads this before booking. Say what you offer and what makes you worth the trip."
            />
          </div>

          <label className="pf-field">
            <span>Phone</span>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} />
          </label>

          {/* Every kind of place the shop is (§265): a salon whose other branch is a spa is both. */}
          <div className="pf-field">
            <span>
              Kinds of shop <em>the first is your main one · up to {MAX_KIND_CATEGORIES} categories</em>
            </span>
            {listed.length > 0 && (
              <ul className="pf-kinds">
                {listed.map((k, i) => (
                  <li key={k.subcategory.id}>
                    <LineArt icon={k.category.icon} className="pf-kind-art" />
                    {k.subcategory.name === OTHER ? (
                      // "Other": what it is, in the shop's own words, shown to customers (§267).
                      <span className="pf-kind-text">
                        <input
                          className="pf-kind-writein"
                          value={labels[k.subcategory.id] ?? ''}
                          onChange={(e) => setLabels({ ...labels, [k.subcategory.id]: e.target.value })}
                          maxLength={40}
                          placeholder="What kind exactly?"
                          aria-label={`What kind of ${k.category.name} exactly`}
                        />
                        <em>Other · {k.category.name}</em>
                      </span>
                    ) : (
                      <span className="pf-kind-text">
                        <strong>{k.subcategory.name}</strong>
                        <em>{k.category.name}</em>
                      </span>
                    )}
                    {i === 0 ? (
                      <span className="pf-kind-main">Main</span>
                    ) : (
                      <button type="button" className="pf-kind-link" onClick={() => setKindsList([k.subcategory.id, ...kinds.filter((id) => id !== k.subcategory.id)])}>
                        Make main
                      </button>
                    )}
                    <button
                      type="button"
                      className="pf-kind-remove"
                      aria-label={`Remove ${k.subcategory.name}`}
                      title={listed.length === 1 ? 'A shop needs at least one kind' : 'Remove'}
                      disabled={listed.length === 1}
                      onClick={() => setKindsList(kinds.filter((id) => id !== k.subcategory.id))}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="pf-kind-add">
              <Select
                value={addCategoryId}
                onChange={(next) => {
                  setAddCategoryId(next);
                  setAddTypeId('');
                }}
                label="Category"
                placeholder={listed.length ? 'Add another kind…' : 'Choose a category'}
                options={categories.data?.map((category) => ({ value: category.id, label: category.name })) ?? []}
              />
              <Select
                value={addTypeId}
                onChange={setAddTypeId}
                disabled={!addCategory || categoryFull}
                label="Type"
                placeholder={categoryFull ? `Up to ${MAX_KIND_CATEGORIES} categories` : addCategory ? 'Which type' : 'Then a type'}
                options={addCategory?.subcategories.filter((t) => !kinds.includes(t.id)).map((t) => ({ value: t.id, label: t.name })) ?? []}
              />
              <button
                type="button"
                disabled={!addTypeId || (addIsOther && addLabel.trim().length < 2)}
                onClick={() => {
                  setKindsList([...kinds, addTypeId]);
                  if (addIsOther) setLabels({ ...labels, [addTypeId]: addLabel.trim() });
                  setAddTypeId('');
                  setAddLabel('');
                }}
              >
                <Icon name="plus" size={16} /> Add
              </button>
            </div>
            {addIsOther && (
              <input
                className="pf-kind-add-writein"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                maxLength={40}
                placeholder="What kind exactly? e.g. Henna artist"
                aria-label="What kind exactly"
                autoFocus
              />
            )}
            {unlabelled && <span className="pf-kind-hint">Say what each “Other” is — customers see it in its place.</span>}
          </div>

          {save.error && (
            <p className="error small" role="alert">
              {save.error instanceof ApiError ? save.error.message : 'That did not save.'}
            </p>
          )}

          {canEdit && (
            <footer className="pf-form-foot">
              <span>
                {saved && !save.isPending && !dirty ? (
                  <span className="ok">
                    <Icon name="checkCircle" size={16} /> Saved.
                  </span>
                ) : description.length > 2000 ? (
                  <span className="error">“What you do” is {description.length - 2000} characters too long.</span>
                ) : dirty ? (
                  'The preview shows your changes — save to make them live.'
                ) : (
                  ''
                )}
              </span>
              <button type="submit" className="primary" disabled={save.isPending || !dirty || unlabelled || description.length > 2000}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </footer>
          )}
        </fieldset>
      </form>

      {/* The shop as the customer's app shows it, as it is being written (§208). */}
      <aside className="pf-preview" aria-label="How customers see your shop">
        <p className="pf-preview-label">
          <Icon name="eye" size={15} /> How customers see you
        </p>
        <CustomerPhone
          locations={locations}
          live={{
            name,
            description,
            subcategory: main ? (main.subcategory.name === OTHER ? labels[main.subcategory.id] || OTHER : main.subcategory.name) : null,
            categoryIcon: main?.category.icon ?? null,
            logoUrl: profile.logoUrl,
            coverImageUrl: profile.coverImageUrl,
          }}
        />
      </aside>
    </div>
  );
}

function Galleries({ locations, canEdit }: { locations: Location[] | undefined; canEdit: boolean }) {
  return (
    <section className="pf-galleries">
      <header className="pf-galleries-head">
        <h2>Photos</h2>
        <p>Each branch has its own photos, because a customer wants to see the place they are actually walking into.</p>
      </header>
      {locations?.map((location) => (
        <LocationGallery key={location.id} id={location.id} name={location.name} canEdit={canEdit} />
      ))}
      {locations?.length === 0 && <p className="muted">Add a branch first, under Branches &amp; hours.</p>}
    </section>
  );
}

function LocationGallery({ id, name, canEdit }: { id: string; name: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const gallery = useQuery({ queryKey: ['gallery', id], queryFn: () => getGallery(id) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['gallery', id] });
    // The branch's photo count feeds the shop-window checklist.
    queryClient.invalidateQueries({ queryKey: ['locations'] });
  };

  const add = useMutation({
    mutationFn: (file: File) => addGalleryPhoto(id, file),
    onSuccess: refresh,
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'That did not upload.'),
  });

  const drop = useMutation({
    mutationFn: (mediaId: string) => removeGalleryPhoto(id, mediaId),
    onSuccess: refresh,
  });

  const full = (gallery.data?.remaining ?? 1) <= 0;
  const count = gallery.data?.count ?? 0;
  const limit = gallery.data?.limit ?? 0;

  return (
    <article className="pf-gallery">
      <header>
        <div>
          <h3>
            <Icon name="pin" size={16} /> {name}
          </h3>
          {gallery.data && (
            <span className="pf-meter">
              <i style={{ width: `${limit ? (count / limit) * 100 : 0}%` }} />
            </span>
          )}
        </div>
        {gallery.data && (
          <span className="pf-count">
            {count} of {limit}
          </span>
        )}
      </header>

      <div className="pf-photos">
        {gallery.data?.photos.map((photo) => (
          <figure key={photo.id} className="pf-photo">
            <img src={photo.url} alt="" />
            {canEdit && (
              <button
                type="button"
                disabled={drop.isPending}
                aria-label="Remove"
                onClick={async () => {
                  if (
                    await confirmDialog({
                      title: 'Remove this photo?',
                      body: <p>It cannot be brought back.</p>,
                      tone: 'danger',
                      icon: 'trash',
                      confirmLabel: 'Remove',
                    })
                  ) {
                    drop.mutate(photo.id);
                  }
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            )}
          </figure>
        ))}
        {!full && canEdit && (
          <PickImage
            id={`gallery-${id}`}
            busy={add.isPending}
            className="pf-photo-add"
            onPick={(file) => {
              setProblem(null);
              add.mutate(file);
            }}
          >
            <Icon name="upload" size={22} />
            {add.isPending ? 'Uploading…' : 'Add a photo'}
          </PickImage>
        )}
      </div>

      {full && <p className="muted small">This branch is at its {limit} photo limit.</p>}
      {problem && (
        <p className="error small" role="alert">
          {problem}
        </p>
      )}
    </article>
  );
}

/**
 * Pausing the whole shop (§119.3).
 *
 * At the TOP of the shopfront page and not buried in a settings list: while it
 * is on, nothing else on this page is doing anything, and a business that cannot
 * see why its calendar is empty will decide the platform is broken.
 *
 * Owner-only on the server. Everyone sees the state — a staff member who cannot
 * find the shop in the app deserves to know why without asking.
 */
/**
 * Approved, and not yet showing (§268): the same bar as the pause, saying the
 * shop is ready and waiting on its owner, with the one thing to do. Here as
 * well as on the Overview, because this page is where a seller looks the shop
 * over before showing it.
 */
function PostPanel({ profile }: { profile: BusinessProfile }) {
  // Posting shows the whole shop: the owner, or a manager of every branch (§277).
  const canAct = useAccess().runsBusiness;
  const { ask, post } = usePostShop(profile.name ?? 'your shop');

  return (
    <div className="pf-pause is-unposted">
      <ShopLogo
        logoUrl={profile.logoUrl}
        name={profile.name ?? 'Your business'}
        size={48}
        className="pf-pause-logo"
        state="off"
        badge={{ icon: 'check', tone: 'ok' }}
      />
      <div className="pf-pause-text">
        <h2>Approved — not posted yet</h2>
        <p>
          Customers cannot see your shop until you post it. Take your time — everything you change is saved, and nobody
          sees it until you post.
        </p>
        {post.error && (
          <p className="error small" role="alert">
            {post.error instanceof ApiError ? post.error.message : 'That did not work.'}
          </p>
        )}
      </div>
      <div className="pf-pause-action">
        {canAct ? (
          <button type="button" className="primary pf-post" disabled={post.isPending} onClick={() => void ask()}>
            {post.isPending ? 'Posting…' : 'Post my shop'}
            {!post.isPending && <Icon name="send" size={16} />}
          </button>
        ) : (
          <span>The owner, or a manager of every branch, posts it.</span>
        )}
      </div>
    </div>
  );
}

function PausePanel({ profile }: { profile: BusinessProfile }) {
  const queryClient = useQueryClient();
  // Owner-only on the server; everyone else sees the state (§277).
  const canPause = useAccess().pauses;
  const [problem, setProblem] = useState<string | null>(null);
  const paused = profile.pausedAt !== null;

  const toggle = useMutation({
    mutationFn: () => (paused ? resumeBusiness() : pauseBusiness()),
    onSuccess: () => {
      setProblem(null);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'That did not work.'),
  });

  const flip = async () => {
    if (
      paused ||
      (await confirmDialog({
        title: 'Pause the shop?',
        body: (
          <>
            <p>
              Customers stop finding you and cannot make new bookings. Everything already booked still
              happens and you are still paid for it.
            </p>
            <p>You can turn this off whenever you like.</p>
          </>
        ),
        tone: 'warn',
        icon: 'pause',
        confirmLabel: 'Pause the shop',
        cancelLabel: 'Keep it open',
      }))
    ) {
      toggle.mutate();
    }
  };

  return (
    <div className={`pf-pause${paused ? ' is-paused' : ''}`}>
      {/* The shop's own logo, not a play button (§231): this card is about it. */}
      <ShopLogo
        logoUrl={profile.logoUrl}
        name={profile.name ?? 'Your business'}
        size={48}
        className="pf-pause-logo"
        state={paused ? undefined : profile.status === 'APPROVED' ? 'live' : 'off'}
        badge={paused ? { icon: 'pause', tone: 'warn' } : undefined}
      />
      <div className="pf-pause-text">
        <h2>{paused ? 'Your shop is paused' : 'Your shop is open'}</h2>
        <p>
          {paused
            ? 'Customers cannot find you or make new bookings. Bookings you already have still happen, and money you are owed is still paid out — pausing does not cancel anything.'
            : 'Going away, or fully booked for a while? Pausing takes every branch out of search and stops new bookings, and you can undo it at any time.'}
        </p>
        {problem && (
          <p className="error small" role="alert">
            {problem}
          </p>
        )}
      </div>
      <div className="pf-pause-action">
        {canPause ? (
          <>
            <span>
              {toggle.isPending ? (paused ? 'Opening…' : 'Pausing…') : paused ? 'Open the shop again' : 'Pause the shop'}
            </span>
            <Switch
              checked={!paused}
              disabled={toggle.isPending}
              label={paused ? 'Open the shop again' : 'Pause the shop'}
              onChange={() => void flip()}
            />
          </>
        ) : (
          <span>Only the owner pauses the shop.</span>
        )}
      </div>
    </div>
  );
}
