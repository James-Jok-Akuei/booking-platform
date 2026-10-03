import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  addGalleryPhoto,
  getCategories,
  getGallery,
  getProfile,
  listLocations,
  pauseBusiness,
  removeGalleryPhoto,
  resumeBusiness,
  setProfileImage,
  updateProfile,
  type BusinessProfile,
} from '../api/business';

/**
 * How a business looks to a customer.
 *
 * Everything here is the shop window: the name and description a customer
 * reads before booking, and the photos they judge the place by. None of it was
 * reachable until §88 — a business that signed up got a listing with no
 * description and no photo and no way to add either.
 */
export function ProfilePage() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Your shopfront</h1>
          <p className="muted">
            What a customer sees before they book. The photos do most of the work.
          </p>
        </div>
      </header>

      {profile.isLoading && <p className="muted">Loading…</p>}
      {profile.data && (
        <>
          <PausePanel profile={profile.data} />
          <ShopWindow profile={profile.data} />
          <Details profile={profile.data} />
          <Galleries />
        </>
      )}
    </section>
  );
}

function ShopWindow({ profile }: { profile: BusinessProfile }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (input: { kind: 'logo' | 'cover'; file: File }) =>
      setProfileImage(input.kind, input.file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'That did not upload.'),
  });

  const pick = (kind: 'logo' | 'cover') => (file: File | null) => {
    setProblem(null);
    if (file) upload.mutate({ kind, file });
  };

  return (
    <div className="shopwindow">
      <div
        className="cover"
        style={
          profile.coverImageUrl
            ? { backgroundImage: `url(${profile.coverImageUrl})` }
            : undefined
        }
      >
        {!profile.coverImageUrl && (
          <span className="muted small">No cover photo yet</span>
        )}
        <div className="cover-action">
          <ImageButton
            id="cover-upload"
            label={profile.coverImageUrl ? 'Change cover' : 'Add a cover photo'}
            busy={upload.isPending}
            onPick={pick('cover')}
          />
        </div>
      </div>

      <div className="logo-row">
        <div className="logo">
          {profile.logoUrl ? (
            <img src={profile.logoUrl} alt="" />
          ) : (
            <span className="muted small">No logo</span>
          )}
        </div>
        <div>
          <strong>{profile.name ?? 'Unnamed business'}</strong>
          <div className="muted small">
            {profile.category?.name ?? 'No category chosen'}
            {profile.subcategory && <> · {profile.subcategory.name}</>}
          </div>
          <ImageButton
            id="logo-upload"
            label={profile.logoUrl ? 'Change logo' : 'Add a logo'}
            busy={upload.isPending}
            onPick={pick('logo')}
          />
        </div>
      </div>

      {problem && (
        <p className="error small" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * A file input referenced by `htmlFor`, never wrapped by its label (§81.4) —
 * wrapping re-dispatches the click and makes a selection look ignored. The
 * input is cleared after each pick so choosing the same file twice still fires.
 */
function ImageButton({
  id,
  label,
  busy,
  onPick,
}: {
  id: string;
  label: string;
  busy: boolean;
  onPick: (file: File | null) => void;
}) {
  return (
    <>
      <input
        id={id}
        type="file"
        className="visually-hidden"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        disabled={busy}
        onChange={(event) => {
          onPick(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
      />
      <label htmlFor={id} className={busy ? 'file-trigger disabled' : 'file-trigger'}>
        {busy ? 'Uploading…' : label}
      </label>
    </>
  );
}

function Details({ profile }: { profile: BusinessProfile }) {
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
    <form className="stack panel" onSubmit={submit}>
      <h2>Details</h2>

      <label>
        Business name
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </label>

      <label>
        What you do
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="A customer reads this before booking. Say what you offer and what makes you worth the trip."
        />
      </label>

      <label>
        Phone
        <input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} />
      </label>

      <div className="two-up">
        <label>
          Category
          <select
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              // A subcategory must belong to its category — the server checks,
              // and keeping a stale one would send a pair it will refuse.
              setSubcategoryId('');
            }}
          >
            <option value="">Choose one</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Type of business
          <select
            value={subcategoryId}
            onChange={(event) => setSubcategoryId(event.target.value)}
            disabled={!chosen}
          >
            <option value="">{chosen ? 'Choose one' : 'Pick a category first'}</option>
            {chosen?.subcategories.map((subcategory) => (
              <option key={subcategory.id} value={subcategory.id}>
                {subcategory.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {save.error && (
        <p className="error small" role="alert">
          {save.error instanceof ApiError ? save.error.message : 'That did not save.'}
        </p>
      )}

      <div className="row-end">
        {saved && !save.isPending && <span className="muted small">Saved.</span>}
        <button type="submit" className="primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function Galleries() {
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });

  return (
    <div className="panel">
      <h2>Photos</h2>
      <p className="muted small">
        Each branch has its own photos, because a customer wants to see the place they
        are actually walking into.
      </p>
      {locations.data?.map((location) => (
        <LocationGallery key={location.id} id={location.id} name={location.name} />
      ))}
      {locations.data?.length === 0 && (
        <p className="muted empty">Add a branch first, under Branches &amp; hours.</p>
      )}
    </div>
  );
}

function LocationGallery({ id, name }: { id: string; name: string }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const gallery = useQuery({ queryKey: ['gallery', id], queryFn: () => getGallery(id) });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['gallery', id] });

  const add = useMutation({
    mutationFn: (file: File) => addGalleryPhoto(id, file),
    onSuccess: refresh,
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'That did not upload.'),
  });

  const drop = useMutation({
    mutationFn: (mediaId: string) => removeGalleryPhoto(id, mediaId),
    onSuccess: refresh,
  });

  const full = (gallery.data?.remaining ?? 1) <= 0;

  return (
    <div className="branch-gallery">
      <div className="branch-head">
        <strong>{name}</strong>
        {gallery.data && (
          <span className="muted small">
            {gallery.data.count} of {gallery.data.limit}
          </span>
        )}
      </div>

      <div className="photo-grid">
        {gallery.data?.photos.map((photo) => (
          <figure key={photo.id}>
            <img src={photo.url} alt="" />
            <button
              type="button"
              className="link"
              disabled={drop.isPending}
              onClick={() => {
                if (window.confirm('Remove this photo? It cannot be brought back.')) {
                  drop.mutate(photo.id);
                }
              }}
            >
              Remove
            </button>
          </figure>
        ))}
      </div>

      {full ? (
        <p className="muted small">This branch is at its {gallery.data?.limit} photo limit.</p>
      ) : (
        <ImageButton
          id={`gallery-${id}`}
          label="Add a photo"
          busy={add.isPending}
          onPick={(file) => {
            setProblem(null);
            if (file) add.mutate(file);
          }}
        />
      )}

      {problem && (
        <p className="error small" role="alert">
          {problem}
        </p>
      )}
    </div>
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
    onError: (error) =>
      setProblem(
        error instanceof ApiError ? error.message : 'That did not work.',
      ),
  });

  return (
    <div className={paused ? 'card setting paused' : 'card setting'}>
      <div className="setting-head">
        <h2>{paused ? 'Your shop is paused' : 'Your shop is open'}</h2>
        <p className="muted small">
          {paused ? (
            <>
              Customers cannot find you or make new bookings. Bookings you
              already have still happen, and money you are owed is still paid out
              — pausing does not cancel anything.
            </>
          ) : (
            <>
              Going away, or fully booked for a while? Pausing takes every branch
              out of search and stops new bookings, and you can undo it at any
              time.
            </>
          )}
        </p>
      </div>

      {problem && (
        <p className="error small" role="alert">
          {problem}
        </p>
      )}

      <div className="row-end">
        <button
          type="button"
          className={paused ? 'primary' : undefined}
          disabled={toggle.isPending}
          onClick={() => {
            if (
              paused ||
              window.confirm(
                'Pause the shop?\n\n' +
                  'Customers stop finding you and cannot make new bookings. ' +
                  'Everything already booked still happens and you are still ' +
                  'paid for it.\n\nYou can turn this off whenever you like.',
              )
            ) {
              toggle.mutate();
            }
          }}
        >
          {toggle.isPending
            ? paused
              ? 'Opening…'
              : 'Pausing…'
            : paused
              ? 'Open the shop again'
              : 'Pause the shop'}
        </button>
      </div>
    </div>
  );
}
