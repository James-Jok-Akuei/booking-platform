import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  createLocation,
  createService,
  getCategories,
  getMe,
  getPayoutDestination,
  getProfile,
  getReadiness,
  listLocations,
  listServices,
  setHours,
  setProfileImage,
  submitForReview,
  submitPayoutDestination,
  updateProfile,
  type FoundAddress,
  type Readiness,
} from '../api/business';
import { AddressField, useDistrictFrom } from '../components/AddressField';
import { DistrictField, PlaceField, parseCoordinates } from '../components/NewBranchForm';
import { ImageButton } from '../components/ImageButton';
import { useMoney } from '../money';
import { CategoryMark } from '../ui/CategoryMark';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { NETWORK_NAME, NetworkMark, networkOf } from '../ui/NetworkMark';
import { ShopLogo } from '../ui/ShopLogo';
import { HOURS_PRESETS, ITEM_WORDS, STEPS, isDone, nextStep, weekOf, type StepKey } from './steps';
import './welcome.css';

/** The server's refusal in its own words, or ours. */
const said = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

/**
 * Setting up a shop (§256) — the first thing a new seller sees after signing
 * up, and where "Continue setting up" leads afterwards.
 *
 * Four short steps and a send-off, one at a time: who you are, where you are,
 * what you sell, where to send your money. Only what a shop cannot go live
 * without is asked; photos, a description, more branches, your team and the
 * rest are added from the app when it suits you, and the last step says so.
 * Every step can be skipped — the checklist on the Overview keeps what is
 * left — and the shop is sent for review only when the required ones are in
 * (§255). Each step reads what is already saved, so coming back later picks
 * up where you stopped, and a step already done shows what it holds.
 *
 * Full screen, outside the app's frame: nothing else to look at while setting
 * up, and "Finish later" is always one press away.
 */
export function Welcome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const readiness = useQuery({
    queryKey: ['readiness'],
    queryFn: getReadiness,
  });
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });

  const asked = params.get('step') as StepKey | null;
  const step: StepKey = asked && STEPS.some((s) => s.key === asked) ? asked : nextStep(readiness.data);
  const index = STEPS.findIndex((s) => s.key === step);
  const go = (key: StepKey) => {
    setParams({ step: key });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const forward = () => go(STEPS[Math.min(index + 1, STEPS.length - 1)].key);
  const back = () => go(STEPS[Math.max(index - 1, 0)].key);

  /** After a save: everything the checklist reads is asked again, then on. */
  const saved = async () => {
    await Promise.all(
      ['readiness', 'profile', 'locations', 'services', 'payout-destination', 'me'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
    forward();
  };

  // A shop that is live, or suspended, has nothing to set up here.
  if (readiness.data?.status === 'APPROVED' || readiness.data?.status === 'SUSPENDED') return <Navigate to="/" replace />;

  const required = (readiness.data?.items ?? []).filter((i) => i.required);
  const doneCount = required.filter((i) => i.done).length;
  const role = me.data?.businessMembership?.role;

  return (
    <div className="wz">
      <header className="wz-top">
        <span className="wz-brand">
          <Logo size={36} />
          <span>
            <span>
              Bwangu<b>Reservations</b>
            </span>
            <em>Setting up your shop</em>
          </span>
        </span>
        <div className="wz-progress" aria-label={`${doneCount} of ${required.length} required things done`}>
          <i
            style={{
              width: `${required.length ? (doneCount / required.length) * 100 : 0}%`,
            }}
          />
        </div>
        <button type="button" className="wz-later" onClick={() => navigate('/')}>
          Finish later <Icon name="close" size={16} />
        </button>
      </header>

      <div className="wz-body">
        <aside className="wz-rail">
          <h2>Set up your shop</h2>
          <p>About five minutes. Skip anything you do not have to hand — it waits for you on your Overview.</p>
          <ol>
            {STEPS.map((s, i) => {
              const done = s.key !== 'review' && isDone(readiness.data, s.keys);
              return (
                <li key={s.key} className={`${s.key === step ? 'is-on' : ''}${done ? ' is-done' : ''}`}>
                  <button type="button" onClick={() => go(s.key)}>
                    <span className="wz-dot">{done ? <Icon name="check" size={14} stroke={3} /> : i + 1}</span>
                    <span>
                      <strong>{s.title}</strong>
                      <em>{s.short}</em>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="wz-rail-foot">
            <Icon name="lock" size={14} /> Customers see nothing until your shop is approved.
          </p>
        </aside>

        <main className="wz-main">
          <div className="wz-phone-steps" aria-hidden="true">
            {step === 'review' ? 'Last step' : `Step ${index + 1} of 4`} · {STEPS[index].title}
          </div>
          {role === 'STAFF' ? (
            <div className="wz-card">
              <h1>Only the owner or a manager can set up the shop</h1>
              <p className="wz-lead">Ask them to finish setting it up. You can still look around.</p>
              <div className="wz-foot">
                <span />
                <button type="button" className="primary" onClick={() => navigate('/')}>
                  Go to the dashboard
                </button>
              </div>
            </div>
          ) : (
            <div className="wz-card" key={step}>
              {step === 'shop' && <ShopStep onSaved={saved} onSkip={forward} />}
              {step === 'branch' && <BranchStep onSaved={saved} onSkip={forward} onBack={back} />}
              {step === 'service' && <ServiceStep onSaved={saved} onSkip={forward} onBack={back} />}
              {step === 'paid' && <PaidStep onSaved={saved} onSkip={forward} onBack={back} />}
              {step === 'review' && (
                <ReviewStep readiness={readiness.data} email={me.data?.email ?? ''} onGo={go} onBack={back} />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function StepHead({ n, title, lead }: { n: number; title: ReactNode; lead: ReactNode }) {
  return (
    <>
      <span className="wz-eyebrow">Step {n} of 4</span>
      <h1>{title}</h1>
      <p className="wz-lead">{lead}</p>
    </>
  );
}

function Foot({
  busy,
  ready,
  label,
  onSkip,
  onBack,
  skipLabel = 'Skip for now',
  form,
}: {
  busy: boolean;
  ready: boolean;
  label: string;
  onSkip?: () => void;
  onBack?: () => void;
  skipLabel?: string;
  form?: string;
}) {
  return (
    <div className="wz-foot">
      <div>
        {onBack && (
          <button type="button" className="wz-back" onClick={onBack}>
            <Icon name="chevronLeft" size={16} /> Back
          </button>
        )}
      </div>
      <div>
        {onSkip && (
          <button type="button" className="wz-skip" onClick={onSkip} disabled={busy}>
            {skipLabel}
          </button>
        )}
        <button type="submit" form={form} className="primary wz-go" disabled={busy || !ready}>
          {busy ? 'Saving…' : label}
          {!busy && <Icon name="arrowRight" size={17} stroke={2.4} />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Your shop

function ShopStep({ onSaved, onSkip }: { onSaved: () => void; onSkip: () => void }) {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: getCategories,
    staleTime: 10 * 60_000,
  });
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [phone, setPhone] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // Filled from what is saved, once it arrives.
  useEffect(() => {
    if (!profile.data) return;
    setName(profile.data.name ?? '');
    setCategoryId(profile.data.category?.id ?? '');
    setSubcategoryId(profile.data.subcategory?.id ?? '');
    setPhone(profile.data.phone ?? '');
  }, [profile.data]);

  const logo = useMutation({
    mutationFn: (file: File) => setProfileImage('logo', file),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profile'] }),
    onError: (error) => setProblem(said(error, 'That picture did not upload. Try a JPG or PNG under 5 MB.')),
  });
  const save = useMutation({
    mutationFn: () =>
      updateProfile({
        name: name.trim(),
        phone: phone.trim(),
        ...(categoryId ? { categoryId } : {}),
        ...(subcategoryId ? { subcategoryId } : {}),
      }),
    onSuccess: onSaved,
    onError: (error) => setProblem(said(error, 'That did not save. Check your connection and try again.')),
  });

  const chosen = categories.data?.find((c) => c.id === categoryId);
  const type = chosen?.subcategories.find((s) => s.id === subcategoryId);
  const digits = phone.replace(/\D/g, '');
  const ready = name.trim().length >= 2 && Boolean(subcategoryId) && digits.length >= 9;

  return (
    <form
      id="wz-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (ready) save.mutate();
      }}
    >
      <StepHead n={1} title="Tell us about your shop" lead="This is what customers see first when they find you." />

      <div className="wz-preview" aria-label="How customers will see you">
        {name.trim() || profile.data?.logoUrl ? (
          <ShopLogo logoUrl={profile.data?.logoUrl ?? null} name={name.trim() || 'Shop'} size={52} />
        ) : (
          <span className="wz-logo-blank">
            <Icon name="store" size={24} />
          </span>
        )}
        <span>
          <strong>{name.trim() || 'Your shop’s name'}</strong>
          <em>{type ? `${chosen?.name} · ${type.name}` : 'What kind of shop'}</em>
        </span>
        <i>How customers see you</i>
      </div>

      <label className="wz-field">
        <span>Shop name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Kigali Barbers"
          autoFocus
        />
      </label>

      <div className="wz-field">
        <span>What kind of shop is it?</span>
        <div className="wz-cats" role="radiogroup" aria-label="Category">
          {(categories.data ?? []).map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === categoryId}
              className={c.id === categoryId ? 'is-on' : ''}
              onClick={() => {
                if (c.id !== categoryId) setSubcategoryId('');
                setCategoryId(c.id);
              }}
            >
              <CategoryMark icon={c.icon} size={36} />
              <span>{c.name}</span>
            </button>
          ))}
          {categories.isLoading && [0, 1, 2, 3].map((i) => <span key={i} className="skeleton wz-cat-skel" />)}
        </div>
        {chosen && (
          <div className="wz-types" role="radiogroup" aria-label="Type">
            {chosen.subcategories.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === subcategoryId}
                className={s.id === subcategoryId ? 'is-on' : ''}
                onClick={() => setSubcategoryId(s.id)}
              >
                {s.id === subcategoryId && <Icon name="check" size={14} stroke={3} />}
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="wz-field">
        <span>Phone number</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          maxLength={30}
          placeholder="+250 788 123 456"
        />
        <em>Customers call it, and we may call to check your shop before it goes live.</em>
      </label>

      <div className="wz-field wz-logo">
        <span>
          Your logo <em>optional</em>
        </span>
        <div>
          {profile.data?.logoUrl ? <ShopLogo logoUrl={profile.data.logoUrl} name={name || 'Shop'} size={44} /> : null}
          <ImageButton
            id="wz-logo"
            label={profile.data?.logoUrl ? 'Change it' : 'Upload a logo'}
            busy={logo.isPending}
            onPick={(file) => file && logo.mutate(file)}
          />
          {logo.isPending && <em>Uploading…</em>}
        </div>
      </div>

      {problem && (
        <p className="wz-problem" role="alert">
          <Icon name="alert" size={16} /> {problem}
        </p>
      )}
      <Foot busy={save.isPending} ready={ready} label="Save and continue" onSkip={onSkip} form="wz-form" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// 2. Where you are

function HoursPicker({
  value,
  onChange,
}: {
  value: { preset: string; open: string; close: string };
  onChange: (next: { preset: string; open: string; close: string }) => void;
}) {
  return (
    <div className="wz-field">
      <span>When are you open?</span>
      <div className="wz-presets" role="radiogroup" aria-label="Opening days">
        {HOURS_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={value.preset === p.key}
            className={value.preset === p.key ? 'is-on' : ''}
            onClick={() => onChange({ preset: p.key, open: p.open, close: p.close })}
          >
            <Icon name={value.preset === p.key ? 'checkCircle' : 'calendar'} size={16} />
            {p.label}
          </button>
        ))}
      </div>
      <div className="wz-times">
        <label>
          Opens
          <input type="time" value={value.open} onChange={(e) => onChange({ ...value, open: e.target.value })} />
        </label>
        <span aria-hidden="true">–</span>
        <label>
          Closes
          <input type="time" value={value.close} onChange={(e) => onChange({ ...value, close: e.target.value })} />
        </label>
      </div>
      <em>Different hours on some days, or a lunch break? Change them any time in Branches &amp; hours.</em>
    </div>
  );
}

function BranchStep({ onSaved, onSkip, onBack }: { onSaved: () => void; onSkip: () => void; onBack: () => void }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: listLocations,
  });
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [place, setPlace] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [hours, setHoursChoice] = useState({
    preset: 'mon-sat',
    open: '08:00',
    close: '18:00',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const districtFrom = useDistrictFrom();

  const active = (locations.data ?? []).filter((l) => l.isActive);
  const findable = active.find((l) => l.districtId && l.latitude !== null && l.longitude !== null) ?? null;
  const branch = findable ?? null;
  const hasHours = branch ? branch.hours.some((h) => !h.isClosed) : false;

  useEffect(() => {
    if (!name && profile.data?.name) setName(profile.data.name);
    // Only the first time the name arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.data?.name]);

  const preset = HOURS_PRESETS.find((p) => p.key === hours.preset)!;
  const week = weekOf(preset.days, hours.open, hours.close);
  const hoursOk = hours.close > hours.open;

  const create = useMutation({
    mutationFn: async () => {
      const parsed = parseCoordinates(place);
      if ('error' in parsed) throw new Error(parsed.error);
      const made = await createLocation({
        name: name.trim(),
        address: address.trim(),
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        districtId,
      });
      await setHours(made.id, week);
    },
    onSuccess: onSaved,
    onError: (error) =>
      setProblem(error instanceof ApiError || error instanceof Error ? error.message : 'That did not save.'),
  });
  const saveHours = useMutation({
    mutationFn: () => setHours(branch!.id, week),
    onSuccess: onSaved,
    onError: (error) => setProblem(said(error, 'Those hours did not save.')),
  });

  const onPick = (found: FoundAddress) => {
    setPlace(`${found.latitude.toFixed(6)}, ${found.longitude.toFixed(6)}`);
    const district = districtFrom(found);
    if (district) setDistrictId(district);
    setProblem(null);
  };

  const coordinates = place.trim() ? parseCoordinates(place) : null;
  const formReady =
    name.trim().length >= 2 &&
    address.trim().length >= 3 &&
    districtId !== '' &&
    coordinates !== null &&
    !('error' in coordinates) &&
    hoursOk;

  // A branch customers can find is already here: show it, and only ask for hours if they are missing.
  if (branch) {
    return (
      <form
        id="wz-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setProblem(null);
          if (hasHours) onSaved();
          else if (hoursOk) saveHours.mutate();
        }}
      >
        <StepHead n={2} title="Where customers find you" lead="Your branch is on the map." />
        <div className="wz-have">
          <span className="wz-have-icon">
            <Icon name="pin" size={20} />
          </span>
          <span>
            <strong>{branch.name}</strong>
            <em>
              {branch.address}
              {branch.district && ` · ${branch.district.name}`}
            </em>
          </span>
          <Icon name="checkCircle" size={20} />
        </div>
        {hasHours ? (
          <div className="wz-have">
            <span className="wz-have-icon">
              <Icon name="clock" size={20} />
            </span>
            <span>
              <strong>Opening hours are set</strong>
              <em>Open {branch.hours.filter((h) => !h.isClosed).length} days a week</em>
            </span>
            <Icon name="checkCircle" size={20} />
          </div>
        ) : (
          <HoursPicker value={hours} onChange={setHoursChoice} />
        )}
        <p className="wz-note">
          <Icon name="info" size={15} /> More branches, photos and opening times are in <b>Branches &amp; hours</b>,
          whenever you want them.
        </p>
        {problem && (
          <p className="wz-problem" role="alert">
            <Icon name="alert" size={16} /> {problem}
          </p>
        )}
        <Foot
          busy={saveHours.isPending}
          ready={hasHours || hoursOk}
          label={hasHours ? 'Continue' : 'Save and continue'}
          onBack={onBack}
          form="wz-form"
        />
      </form>
    );
  }

  return (
    <form
      id="wz-form"
      className="bf wz-branch"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (formReady) create.mutate();
      }}
    >
      <StepHead
        n={2}
        title="Where customers find you"
        lead="Your first branch — the place customers come to. Its address puts you on the map."
      />

      <label className="wz-field">
        <span>Branch name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Kigali Barbers — Kimironko"
        />
        <em>If you have only one place, your shop’s name is fine.</em>
      </label>

      <div className="wz-field">
        <span>Address</span>
        <AddressField
          id="wz-address"
          value={address}
          onChange={setAddress}
          onPick={onPick}
          placeholder="Start typing — KG 11 Ave, Kimironko…"
        />
        <em>Pick a suggestion and we drop the pin for you.</em>
      </div>

      <PlaceField
        value={place}
        onChange={setPlace}
        onProblem={setProblem}
        hint="Or paste your Google Maps link, or use your position if you are at the shop now."
      />

      <DistrictField
        value={districtId}
        onChange={setDistrictId}
        hint="Customers search by area, so this is how they find you."
      />

      <HoursPicker value={hours} onChange={setHoursChoice} />

      {active.length > 0 && (
        <p className="wz-note">
          <Icon name="info" size={15} /> Your branch “{active[0].name}” has no map pin or district yet. Add them in{' '}
          <Link to="/hours">Branches &amp; hours</Link>, or add the place here.
        </p>
      )}
      {problem && (
        <p className="wz-problem" role="alert">
          <Icon name="alert" size={16} /> {problem}
        </p>
      )}
      <Foot
        busy={create.isPending}
        ready={formReady}
        label="Save and continue"
        onSkip={onSkip}
        onBack={onBack}
        form="wz-form"
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// 3. Your first service

const DURATIONS = [15, 30, 45, 60, 90, 120];
const DEPOSITS = [20, 30, 50];

function ServiceStep({ onSaved, onSkip, onBack }: { onSaved: () => void; onSkip: () => void; onBack: () => void }) {
  const money = useMoney();
  const services = useQuery({ queryKey: ['services'], queryFn: listServices });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: listLocations,
  });
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState(30);
  const [deposit, setDeposit] = useState(20);
  const [problem, setProblem] = useState<string | null>(null);

  const open = (locations.data ?? []).filter((l) => l.isActive);
  const offered = (services.data ?? []).filter((s) => s.isActive && s.locations.some((o) => o.isOffered));
  const priceMinor = money.toMinor(price.replace(/[, ]/g, ''));
  const ready = name.trim().length >= 2 && Number.isFinite(priceMinor) && priceMinor > 0 && open.length > 0;

  const create = useMutation({
    mutationFn: () =>
      createService({
        name: name.trim(),
        durationMinutes: duration,
        depositPercentage: deposit,
        offers: open.map((l) => ({ locationId: l.id, priceMinor })),
      }),
    onSuccess: onSaved,
    onError: (error) => setProblem(said(error, 'That service did not save.')),
  });

  const examples = useMemo(() => {
    const type = profile.data?.subcategory?.name.toLowerCase() ?? '';
    if (/barber/.test(type)) return ['Haircut', 'Beard trim', 'Haircut and beard'];
    if (/hair|braid|locs/.test(type)) return ['Wash and blow-dry', 'Braids', 'Relaxer'];
    if (/nail/.test(type)) return ['Manicure', 'Pedicure', 'Gel nails'];
    if (/massage|spa/.test(type)) return ['Full-body massage', 'Back massage', 'Steam room'];
    if (/car|tyre|vehicle/.test(type)) return ['Car wash', 'Oil change', 'Wheel balancing'];
    if (/photo/.test(type)) return ['Portrait session', 'Event coverage', 'Studio hour'];
    return [];
  }, [profile.data?.subcategory?.name]);

  if (offered.length > 0) {
    const first = offered[0];
    return (
      <form
        id="wz-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSaved();
        }}
      >
        <StepHead
          n={3}
          title="What customers can book"
          lead={`You have ${offered.length} ${offered.length === 1 ? 'service' : 'services'} ready to book.`}
        />
        <div className="wz-have">
          <span className="wz-have-icon">
            <Icon name="tag" size={20} />
          </span>
          <span>
            <strong>{first.name}</strong>
            <em>
              {money.format(Math.min(...first.locations.map((o) => o.priceMinor)))} · {first.durationMinutes} min ·{' '}
              {Number(first.depositPercentage)}% deposit
            </em>
          </span>
          <Icon name="checkCircle" size={20} />
        </div>
        <p className="wz-note">
          <Icon name="info" size={15} /> Add more, with photos and descriptions, in <b>Services</b> whenever you like.
        </p>
        <Foot busy={false} ready label="Continue" onBack={onBack} form="wz-form" />
      </form>
    );
  }

  const depositMinor = Number.isFinite(priceMinor) && priceMinor > 0 ? Math.round((priceMinor * deposit) / 100) : null;

  return (
    <form
      id="wz-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (ready) create.mutate();
      }}
    >
      <StepHead
        n={3}
        title="Add your first service"
        lead="One thing customers can book. You can add the rest later, with photos."
      />

      {open.length === 0 && (
        <p className="wz-note is-warn">
          <Icon name="alert" size={15} /> A service is offered at a branch, so add your branch first.{' '}
          <button type="button" className="wz-inline" onClick={onBack}>
            Back to your branch
          </button>
        </p>
      )}

      <label className="wz-field">
        <span>Service name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder={examples[0] ?? 'Haircut'}
          autoFocus
        />
        {examples.length > 0 && (
          <div className="wz-examples">
            {examples.map((e) => (
              <button key={e} type="button" onClick={() => setName(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
      </label>

      <div className="wz-two">
        <label className="wz-field">
          <span>Price</span>
          <span className="wz-money">
            <b>{money.code || 'RWF'}</b>
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="5,000" />
          </span>
        </label>
        <div className="wz-field">
          <span>How long it takes</span>
          <div className="wz-chips">
            {DURATIONS.map((d) => (
              <button key={d} type="button" className={d === duration ? 'is-on' : ''} onClick={() => setDuration(d)}>
                {d < 60 ? `${d} min` : d % 60 === 0 ? `${d / 60} h` : `${Math.floor(d / 60)} h ${d % 60}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="wz-field">
        <span>Deposit to book</span>
        <div className="wz-chips">
          {DEPOSITS.map((d) => (
            <button key={d} type="button" className={d === deposit ? 'is-on' : ''} onClick={() => setDeposit(d)}>
              {d}%
            </button>
          ))}
        </div>
        <em>
          {depositMinor !== null
            ? `Customers pay ${money.format(depositMinor)} on their phone to book, and the rest at your shop.`
            : 'Customers pay this part on their phone to hold their time, and the rest at your shop.'}{' '}
          A deposit means fewer people who book and do not come.
        </em>
      </div>

      {problem && (
        <p className="wz-problem" role="alert">
          <Icon name="alert" size={16} /> {problem}
        </p>
      )}
      <Foot
        busy={create.isPending}
        ready={ready}
        label="Save and continue"
        onSkip={onSkip}
        onBack={onBack}
        form="wz-form"
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// 4. Getting paid (optional)

function PaidStep({ onSaved, onSkip, onBack }: { onSaved: () => void; onSkip: () => void; onBack: () => void }) {
  const current = useQuery({
    queryKey: ['payout-destination'],
    queryFn: getPayoutDestination,
  });
  const [msisdn, setMsisdn] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const network = networkOf(msisdn);
  const digits = msisdn.replace(/\D/g, '');

  const save = useMutation({
    mutationFn: () => submitPayoutDestination(msisdn.trim()),
    onSuccess: onSaved,
    onError: (error) => setProblem(said(error, 'That number did not save.')),
  });

  const have = current.data?.destination ?? null;
  if (have && have.status !== 'REJECTED') {
    return (
      <form
        id="wz-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSaved();
        }}
      >
        <StepHead n={4} title="Getting paid" lead="Your share of every deposit is sent to this number." />
        <div className="wz-have">
          <NetworkMark network={have.provider} size={40} />
          <span>
            <strong>
              {NETWORK_NAME[have.provider]} · •••• {(have.msisdn ?? have.msisdnLast3 ?? '').slice(-3)}
            </strong>
            <em>{have.status === 'VERIFIED' ? 'Checked — payouts go here' : 'Waiting to be checked by our team'}</em>
          </span>
          <Icon name="checkCircle" size={20} />
        </div>
        <Foot busy={false} ready label="Continue" onBack={onBack} form="wz-form" />
      </form>
    );
  }

  return (
    <form
      id="wz-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (digits.length >= 9) save.mutate();
      }}
    >
      <StepHead
        n={4}
        title={
          <>
            Getting paid <span className="wz-optional">optional</span>
          </>
        }
        lead="Where we send your share of each deposit. Your shop can go live without it — you are paid once it is added and checked."
      />
      <label className="wz-field">
        <span>Mobile money number</span>
        <span className="wz-msisdn">
          {network ? (
            <NetworkMark network={network} size={32} />
          ) : (
            <span className="wz-msisdn-blank">
              <Icon name="phone" size={17} />
            </span>
          )}
          <input
            value={msisdn}
            onChange={(e) => setMsisdn(e.target.value)}
            inputMode="tel"
            placeholder="+250 788 123 456"
            maxLength={20}
          />
          {network && <em>{NETWORK_NAME[network]}</em>}
        </span>
        <em>
          MTN MoMo or Airtel Money, in the shop’s or the owner’s name. Our team checks it before the first payout.
        </em>
      </label>
      {problem && (
        <p className="wz-problem" role="alert">
          <Icon name="alert" size={16} /> {problem}
        </p>
      )}
      <Foot
        busy={save.isPending}
        ready={digits.length >= 9}
        label="Save and continue"
        onSkip={onSkip}
        skipLabel="Add it later"
        onBack={onBack}
        form="wz-form"
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// 5. Send for review

function ReviewStep({
  readiness,
  email,
  onGo,
  onBack,
}: {
  readiness: Readiness | undefined;
  email: string;
  onGo: (step: StepKey) => void;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sent, setSent] = useState(false);
  const submit = useMutation({
    mutationFn: submitForReview,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['readiness'] });
      setSent(true);
    },
  });

  if (!readiness) return <div className="skeleton wz-skel" />;

  const waiting = readiness.status === 'PENDING' && readiness.submittedAt !== null;
  if (sent || waiting) {
    return (
      <div className="wz-sent">
        <span className="wz-sent-ring">
          <span>
            <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
              <path d="M5 12.5l4.2 4.2L19 7" />
            </svg>
          </span>
        </span>
        <h1>{sent ? 'Your shop is with us for review' : 'Your shop is waiting for review'}</h1>
        <p className="wz-lead">
          {readiness.submittedAt && !sent
            ? `Sent ${new Date(readiness.submittedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}. `
            : ''}
          Here is what happens next.
        </p>
        <ol className="wz-next">
          <li>
            <b>1</b>
            <span>
              <strong>We check your details</strong> — usually within one working day. We may call your shop’s number.
            </span>
          </li>
          <li>
            <b>2</b>
            <span>
              <strong>You get an email</strong> at {email || 'your address'} the moment you are approved, and your shop
              goes live.
            </span>
          </li>
          <li>
            <b>3</b>
            <span>
              <strong>Meanwhile, make it shine</strong> — photos, a description, more services and your team. Shops with
              photos get booked first.
            </span>
          </li>
        </ol>
        <button type="button" className="primary wz-go" onClick={() => navigate('/', { replace: true })}>
          Go to my dashboard <Icon name="arrowRight" size={17} stroke={2.4} />
        </button>
      </div>
    );
  }

  const rejected = readiness.status === 'REJECTED';
  const missing = readiness.items.filter((i) => i.required && !i.done);
  const later = readiness.items.filter((i) => !i.required);

  return (
    <div>
      <span className="wz-eyebrow">Last step</span>
      <h1>{rejected ? 'Send your shop back for review' : missing.length ? 'Almost there' : 'Ready to go live'}</h1>
      <p className="wz-lead">
        {rejected
          ? 'Fix what we asked, then send it back. Everything you set up is still here.'
          : missing.length
            ? `${missing.length} ${missing.length === 1 ? 'thing is' : 'things are'} still needed before we can review your shop.`
            : 'We check every shop before customers can book it. Send yours now — it only takes a moment.'}
      </p>

      {rejected && readiness.statusReason && (
        <div className="wz-reason">
          <Icon name="alert" size={18} />
          <span>
            <strong>What we said</strong>
            {readiness.statusReason}
          </span>
        </div>
      )}

      {missing.length === 0 ? (
        <div className="wz-allin">
          <Icon name="checkCircle" size={22} />
          <span>
            <strong>Everything we need is in</strong>
            <em>
              {readiness.items
                .filter((i) => i.required)
                .map((i) => ITEM_WORDS[i.key].label)
                .join(' · ')}
            </em>
          </span>
        </div>
      ) : (
        <ul className="wz-check">
          {readiness.items
            .filter((i) => i.required)
            .map((i) => (
              <li key={i.key} className={i.done ? 'is-done' : ''}>
                <Icon name={i.done ? 'checkCircle' : 'dot'} size={18} />
                <span>{ITEM_WORDS[i.key].label}</span>
                {!i.done && (
                  <button type="button" onClick={() => onGo(ITEM_WORDS[i.key].step)}>
                    Add it <Icon name="arrowRight" size={14} stroke={2.2} />
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}
      <p className="wz-sub">Nice to have — add whenever you like</p>
      <ul className="wz-check is-optional">
        {later.map((i) => (
          <li key={i.key} className={i.done ? 'is-done' : ''}>
            <Icon name={i.done ? 'checkCircle' : 'dot'} size={18} />
            <span>{ITEM_WORDS[i.key].label}</span>
            {!i.done && (
              <button type="button" onClick={() => onGo(ITEM_WORDS[i.key].step)}>
                Add it <Icon name="arrowRight" size={14} stroke={2.2} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {submit.error && (
        <p className="wz-problem" role="alert">
          <Icon name="alert" size={16} />{' '}
          {said(submit.error, 'That did not send. Check your connection and try again.')}
        </p>
      )}
      <div className="wz-foot">
        <div>
          <button type="button" className="wz-back" onClick={onBack}>
            <Icon name="chevronLeft" size={16} /> Back
          </button>
        </div>
        <div>
          <button type="button" className="wz-skip" onClick={() => navigate('/')}>
            Finish later
          </button>
          <button
            type="button"
            className="primary wz-go"
            disabled={!readiness.canSubmit || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? 'Sending…' : rejected ? 'Send back for review' : 'Send for review'}
            {!submit.isPending && <Icon name="send" size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
