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
import './profile.css';

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

      {profile.isLoading && <div className="skeleton pf-skeleton" />}
      {profile.data && (
        <>
          <PausePanel profile={profile.data} />
          <ShopWindow profile={profile.data} locations={locations.data ?? []} />
          <Strength profile={profile.data} locations={locations.data ?? []} />
          <Details profile={profile.data} locations={locations.data ?? []} />
          <Galleries locations={locations.data} />
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

function ShopWindow({ profile, locations }: { profile: BusinessProfile; locations: Location[] }) {
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
  const live = profile.status === 'APPROVED' && !profile.pausedAt;

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
        <PickImage id="cover-upload" busy={busy} onPick={pick('cover')} className="pf-cover-btn">
          <Icon name="camera" size={17} />
          {uploading === 'cover' ? 'Uploading…' : profile.coverImageUrl ? 'Change cover' : 'Add a cover photo'}
        </PickImage>
      </div>

      <div className="pf-id">
        <div className="pf-logo">
          {profile.logoUrl ? <img src={profile.logoUrl} alt="" /> : <span>{initialsOf(profile.name ?? 'B')}</span>}
          <PickImage id="logo-upload" busy={busy} onPick={pick('logo')} className="pf-logo-btn">
            <Icon name="camera" size={16} />
            <span className="visually-hidden">{profile.logoUrl ? 'Change logo' : 'Add a logo'}</span>
          </PickImage>
          {uploading === 'logo' && <i className="pf-logo-busy" />}
        </div>
        <div className="pf-id-text">
          <h2>{profile.name ?? 'Unnamed business'}</h2>
          <p>
            {profile.category?.name ?? 'No category chosen'}
            {profile.subcategory && <> · {profile.subcategory.name}</>}
          </p>
          <div className="pf-badges">
            <span className={`pf-badge${live ? ' is-live' : ' is-off'}`}>
              <i /> {shopStateWord(profile.status, Boolean(profile.pausedAt), readiness.data?.submittedAt)}
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
        <PickImage id="logo-upload-2" busy={busy} onPick={pick('logo')} className="pf-logo-change">
          {profile.logoUrl ? 'Change logo' : 'Add a logo'}
        </PickImage>
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
    { label: 'Category and type', done: Boolean(profile.category && profile.subcategory), icon: 'tag' },
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

function Details({ profile, locations }: { profile: BusinessProfile; locations: Location[] }) {
  const queryClient = useQueryClient();
  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories });

  const [name, setName] = useState(profile.name ?? '');
  const [description, setDescription] = useState(profile.description ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [categoryId, setCategoryId] = useState(profile.category?.id ?? '');
  const [subcategoryId, setSubcategoryId] = useState(profile.subcategory?.id ?? '');
  const [saved, setSaved] = useState(false);

  // The server is the source of truth: after a save the form follows what came
  // back, not what was typed.
  useEffect(() => {
    setName(profile.name ?? '');
    setDescription(profile.description ?? '');
    setPhone(profile.phone ?? '');
    setCategoryId(profile.category?.id ?? '');
    setSubcategoryId(profile.subcategory?.id ?? '');
  }, [profile]);

  const chosen = categories.data?.find((category) => category.id === categoryId);
  const sub = chosen?.subcategories.find((s) => s.id === subcategoryId);
  const dirty =
    name !== (profile.name ?? '') ||
    description !== (profile.description ?? '') ||
    phone !== (profile.phone ?? '') ||
    categoryId !== (profile.category?.id ?? '') ||
    subcategoryId !== (profile.subcategory?.id ?? '');

  const save = useMutation({
    mutationFn: () =>
      updateProfile({
        name: name.trim(),
        description: description.trim(),
        phone: phone.trim(),
        ...(categoryId ? { categoryId } : {}),
        ...(subcategoryId ? { subcategoryId } : {}),
      }),
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
        <header>
          <h2>Details</h2>
          <p>Shown on your shop’s page in the app.</p>
        </header>

        <label className="pf-field">
          <span>Business name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
        </label>

        <label className="pf-field pf-grow">
          <span>
            What you do <em>{description.length}/2000</em>
          </span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="A customer reads this before booking. Say what you offer and what makes you worth the trip."
          />
        </label>

        <label className="pf-field">
          <span>Phone</span>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} />
        </label>

        <div className="pf-two">
          <div className="pf-field">
            <span>Category</span>
            <Select
              value={categoryId}
              onChange={(next) => {
                setCategoryId(next);
                // A subcategory must belong to its category — the server checks,
                // and keeping a stale one would send a pair it will refuse.
                setSubcategoryId('');
              }}
              label="Category"
              placeholder="Choose one"
              options={categories.data?.map((category) => ({ value: category.id, label: category.name })) ?? []}
            />
          </div>

          <div className="pf-field">
            <span>Type of business</span>
            <Select
              value={subcategoryId}
              onChange={setSubcategoryId}
              disabled={!chosen}
              label="Type of business"
              placeholder={chosen ? 'Choose one' : 'Pick a category first'}
              options={chosen?.subcategories.map((subcategory) => ({ value: subcategory.id, label: subcategory.name })) ?? []}
            />
          </div>
        </div>

        {save.error && (
          <p className="error small" role="alert">
            {save.error instanceof ApiError ? save.error.message : 'That did not save.'}
          </p>
        )}

        <footer className="pf-form-foot">
          <span>
            {saved && !save.isPending && !dirty ? (
              <span className="ok">
                <Icon name="checkCircle" size={16} /> Saved.
              </span>
            ) : dirty ? (
              'The preview shows your changes — save to make them live.'
            ) : (
              ''
            )}
          </span>
          <button type="submit" className="primary" disabled={save.isPending || !dirty}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </footer>
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
            subcategory: sub?.name ?? null,
            categoryIcon: chosen?.icon ?? null,
            logoUrl: profile.logoUrl,
            coverImageUrl: profile.coverImageUrl,
          }}
        />
      </aside>
    </div>
  );
}

function Galleries({ locations }: { locations: Location[] | undefined }) {
  return (
    <section className="pf-galleries">
      <header className="pf-galleries-head">
        <h2>Photos</h2>
        <p>Each branch has its own photos, because a customer wants to see the place they are actually walking into.</p>
      </header>
      {locations?.map((location) => <LocationGallery key={location.id} id={location.id} name={location.name} />)}
      {locations?.length === 0 && <p className="muted">Add a branch first, under Branches &amp; hours.</p>}
    </section>
  );
}

function LocationGallery({ id, name }: { id: string; name: string }) {
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
          </figure>
        ))}
        {!full && (
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
function PausePanel({ profile }: { profile: BusinessProfile }) {
  const queryClient = useQueryClient();
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
        <span>
          {toggle.isPending ? (paused ? 'Opening…' : 'Pausing…') : paused ? 'Open the shop again' : 'Pause the shop'}
        </span>
        <Switch
          checked={!paused}
          disabled={toggle.isPending}
          label={paused ? 'Open the shop again' : 'Pause the shop'}
          onChange={() => void flip()}
        />
      </div>
    </div>
  );
}
