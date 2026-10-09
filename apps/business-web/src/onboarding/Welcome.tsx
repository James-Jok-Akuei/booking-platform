import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type InputHTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from 'react';
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
import { AuthWall } from '../auth/AuthWall';
import { AddressField, useDistrictFrom } from '../components/AddressField';
import { DistrictField, PlaceField, parseCoordinates } from '../components/NewBranchForm';
import { ImageButton } from '../components/ImageButton';
import { useMoney } from '../money';
import { CategoryMark } from '../ui/CategoryMark';
import { Icon, type IconName } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { NETWORK_NAME, NetworkMark, networkOf } from '../ui/NetworkMark';
import { ShopLogo } from '../ui/ShopLogo';
import { DrawnCheck, StepGlyph } from './StepIcons';
import { HOURS_PRESETS, ITEM_WORDS, STEPS, isDone, nextStep, weekOf, type StepKey } from './steps';
import './welcome.css';

/** The server's refusal in its own words, or ours. */
const said = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

/**
 * Setting up a shop (§256, redrawn in §262) — the first thing a new seller
 * sees after signing up, and where "Continue setting up" leads afterwards.
 *
 * Four short steps and a send-off: who you are, where you are, what you sell,
 * where to send your money. Only what a shop cannot go live without is asked;
 * every step can be skipped, and each reads what is already saved.
 *
 * It is drawn as a panel floating over the shops' own photos — the sign-in's
 * wall (§238), softened and dimmed — so the seller sets up among the places
 * already taking bookings. The panel holds still in the middle of the screen
 * and only its middle scrolls: the steps on the left, the step's title above
 * and its buttons below stay where they are. On a phone the photos are a band
 * at the top and the panel a sheet rising over them.
 */
export function Welcome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const readiness = useQuery({ queryKey: ['readiness'], queryFn: getReadiness });
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  // Which way the steps slide: forward from the right, back from the left.
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const root = useRef<HTMLDivElement>(null);

  const asked = params.get('step') as StepKey | null;
  const step: StepKey = asked && STEPS.some((s) => s.key === asked) ? asked : nextStep(readiness.data);
  const index = STEPS.findIndex((s) => s.key === step);
  const go = (key: StepKey) => {
    const target = STEPS.findIndex((s) => s.key === key);
    if (target === index) return;
    setDir(target < index ? 'back' : 'fwd');
    setParams({ step: key });
  };
  const forward = () => go(STEPS[Math.min(index + 1, STEPS.length - 1)].key);
  const back = () => go(STEPS[Math.max(index - 1, 0)].key);
  const finishLater = () => navigate('/');

  /** After a save: everything the checklist reads is asked again, then on. */
  const saved = async () => {
    await Promise.all(
      ['readiness', 'profile', 'locations', 'services', 'payout-destination', 'me'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
    forward();
  };

  // The photos lean a touch away from the mouse.
  const lean = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !root.current) return;
    root.current.style.setProperty('--mx', ((event.clientX / window.innerWidth) * 2 - 1).toFixed(3));
    root.current.style.setProperty('--my', ((event.clientY / window.innerHeight) * 2 - 1).toFixed(3));
  };

  // A shop that is live, or suspended, has nothing to set up here.
  if (readiness.data?.status === 'APPROVED' || readiness.data?.status === 'SUSPENDED') return <Navigate to="/" replace />;

  const required = (readiness.data?.items ?? []).filter((i) => i.required);
  const doneCount = required.filter((i) => i.done).length;
  const share = required.length ? doneCount / required.length : 0;
  const role = me.data?.businessMembership?.role;
  const shopName = me.data?.businessMembership?.businessProfile.name?.trim() || null;

  return (
    <div className={`wz is-${step}`} ref={root} onPointerMove={lean}>
      <div className="wz-bg" aria-hidden="true">
        <AuthWall />
      </div>

      <header className="wz-top">
        <span className="wz-brand">
          <Logo size={38} />
          <span>
            <b>
              Bwangu<i>Reservations</i>
            </b>
            <small>For businesses</small>
          </span>
        </span>
        <button type="button" className="wz-later" onClick={finishLater}>
          Finish later
          <Icon name="close" size={15} stroke={2.2} />
        </button>
      </header>

      <Floats />

      <div className="wz-frame">
        <div className="wz-panel" role="dialog" aria-modal="true" aria-labelledby="wz-title">
          <aside className="wz-rail">
            <div className="wz-rail-head">
              <span className="wz-kicker">Setting up</span>
              <h2 title={shopName ?? undefined}>{shopName ?? 'Your shop'}</h2>
              <p>About five minutes. Skip anything you do not have to hand — it waits on your Overview.</p>
            </div>

            <div className="wz-meter" aria-label={`${doneCount} of ${required.length} required things done`}>
              <div className="wz-meter-top">
                <strong>
                  {doneCount} of {required.length || 6}
                </strong>
                done
                <span>{Math.round(share * 100)}%</span>
              </div>
              <div className="wz-meter-bar">
                <i style={{ '--p': share } as CSSProperties} />
              </div>
            </div>

            <ol className="wz-steps">
              {STEPS.map((s) => {
                const done = s.key !== 'review' && isDone(readiness.data, s.keys);
                const on = s.key === step;
                return (
                  <li key={s.key} className={`${on ? 'is-on' : ''}${done ? ' is-done' : ''}`}>
                    <button type="button" onClick={() => go(s.key)} aria-current={on ? 'step' : undefined}>
                      <span className="wz-badge">{done && !on ? <DrawnCheck size={18} /> : <StepGlyph name={s.key} size={21} />}</span>
                      <span className="wz-step-text">
                        <strong>{s.title}</strong>
                        <em>{done ? 'Done' : s.short}</em>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div className="wz-rail-foot">
              <div className="wz-help">
                <span className="wz-help-icon">
                  <StepGlyph name="headset" size={20} />
                </span>
                <span>
                  <strong>Need a hand?</strong>
                  <em>We can set it up with you.</em>
                </span>
                <Link to="/help">Talk to us</Link>
              </div>
              <p className="wz-lock">
                <Icon name="lock" size={14} /> Customers see nothing until we approve your shop.
              </p>
            </div>
          </aside>

          <main className={`wz-main is-${dir}`}>
            <button type="button" className="wz-x" onClick={finishLater} aria-label="Finish later" title="Finish later">
              <Icon name="close" size={18} stroke={2.2} />
            </button>

            {/* On a phone the steps are four bars over the step. */}
            <div className="wz-phone-chrome" aria-hidden="true">
              <div className="wz-segs">
                {STEPS.filter((s) => s.key !== 'review').map((s) => (
                  <i key={s.key} className={s.key === step ? 'is-on' : isDone(readiness.data, s.keys) ? 'is-done' : ''} />
                ))}
              </div>
              <span>
                {step === 'review' ? 'Last step' : `Step ${index + 1} of 4`} · {STEPS[index].title}
              </span>
            </div>

            {role === 'STAFF' ? (
              <div className="wz-stage">
                <div className="wz-step">
                  <StepHead step="shop" title="Only the owner or a manager can set up the shop" lead="Ask them to finish setting it up. You can still look around." />
                  <div className="wz-scroll" />
                  <div className="wz-foot">
                    <span />
                    <button type="button" className="primary wz-go" onClick={finishLater}>
                      Go to the dashboard <Icon name="arrowRight" size={17} stroke={2.4} />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="wz-stage" key={step}>
                {step === 'shop' && <ShopStep onSaved={saved} onSkip={forward} />}
                {step === 'branch' && <BranchStep onSaved={saved} onSkip={forward} onBack={back} />}
                {step === 'service' && <ServiceStep onSaved={saved} onSkip={forward} onBack={back} />}
                {step === 'paid' && <PaidStep onSaved={saved} onSkip={forward} onBack={back} />}
                {step === 'review' && <ReviewStep readiness={readiness.data} email={me.data?.email ?? ''} onGo={go} onBack={back} />}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

/** Two moments from a seller's day, drifting beside the panel on a wide screen. */
function Floats() {
  const money = useMoney();
  return (
    <div className="wz-floats" aria-hidden="true">
      <span className="wz-float f1">
        <NetworkMark network="MTN_MOMO" size={36} />
        <span>
          <strong>Deposit paid</strong>
          <em>{money.code || 'RWF'} 1,400 · MTN MoMo</em>
        </span>
      </span>
      <span className="wz-float f2">
        <span className="wz-float-icon">
          <Icon name="calendarCheck" size={19} />
        </span>
        <span>
          <strong>New booking</strong>
          <em>Haircut · Saturday 10:30</em>
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The step's frame: a head that stays, a middle that scrolls, a foot that stays

function StepHead({
  step,
  n,
  title,
  lead,
  optional,
}: {
  step: StepKey;
  n?: number;
  title: ReactNode;
  lead: ReactNode;
  optional?: boolean;
}) {
  return (
    <header className="wz-head">
      <span className="wz-head-icon">
        <StepGlyph name={step} size={26} />
      </span>
      <div>
        <span className="wz-eyebrow">
          {n ? `Step ${n} of 4` : 'Last step'}
          {optional && <i>Optional</i>}
        </span>
        <h1 id="wz-title">{title}</h1>
        <p className="wz-lead">{lead}</p>
      </div>
    </header>
  );
}

function Foot({
  busy,
  ready,
  label,
  onSkip,
  onBack,
  skipLabel = 'Skip for now',
}: {
  busy: boolean;
  ready: boolean;
  label: string;
  onSkip?: () => void;
  onBack?: () => void;
  skipLabel?: string;
}) {
  return (
    <div className="wz-foot">
      <div>
        {onBack && (
          <button type="button" className="wz-back" onClick={onBack}>
            <Icon name="chevronLeft" size={17} stroke={2.2} /> Back
          </button>
        )}
      </div>
      <div>
        {onSkip && (
          <button type="button" className="wz-skip" onClick={onSkip} disabled={busy}>
            {skipLabel}
          </button>
        )}
        <button type="submit" className="primary wz-go" disabled={busy || !ready}>
          {busy ? (
            <>
              <span className="wz-spin" aria-hidden="true" /> Saving…
            </>
          ) : (
            <>
              {label}
              <Icon name="arrowRight" size={17} stroke={2.4} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="wz-problem" role="alert">
      <Icon name="alert" size={16} /> {text}
    </p>
  );
}

/** A text box with its meaning drawn at its start. */
function IconInput({ icon, ...props }: { icon: IconName } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="wz-input">
      <Icon name={icon} size={18} />
      <input {...props} />
    </span>
  );
}

/** What is already saved, shown instead of asked again. */
function Have({ icon, title, text, children }: { icon: ReactNode; title: ReactNode; text: ReactNode; children?: ReactNode }) {
  return (
    <div className="wz-have">
      <span className="wz-have-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <em>{text}</em>
      </span>
      {children ?? (
        <span className="wz-have-ok">
          <DrawnCheck size={15} stroke={3} />
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Your shop

function ShopStep({ onSaved, onSkip }: { onSaved: () => void; onSkip: () => void }) {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories, staleTime: 10 * 60_000 });
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
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (ready) save.mutate();
      }}
    >
      <StepHead step="shop" n={1} title="Tell us about your shop" lead="This is what customers see first when they find you." />
      <div className="wz-scroll">
        <div className="wz-preview" aria-label="How customers will see you">
          <span className="wz-preview-tag">
            <Icon name="eye" size={13} /> How customers see you
          </span>
          {name.trim() || profile.data?.logoUrl ? (
            <ShopLogo logoUrl={profile.data?.logoUrl ?? null} name={name.trim() || 'Shop'} size={56} />
          ) : (
            <span className="wz-logo-blank">
              <StepGlyph name="shop" size={26} />
            </span>
          )}
          <span className="wz-preview-text">
            <strong>{name.trim() || 'Your shop’s name'}</strong>
            <em>{type ? `${chosen?.name} · ${type.name}` : 'What kind of shop'}</em>
          </span>
        </div>

        <label className="wz-field">
          <span className="wz-label">Shop name</span>
          <IconInput icon="store" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Kigali Barbers" autoFocus />
        </label>

        <div className="wz-field">
          <span className="wz-label">What kind of shop is it?</span>
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
                <CategoryMark icon={c.icon} size={38} />
                <span>{c.name}</span>
                <i className="wz-cat-tick" aria-hidden="true">
                  <DrawnCheck size={11} stroke={3.4} />
                </i>
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
          <span className="wz-label">Phone number</span>
          <IconInput icon="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={30} placeholder="+250 788 123 456" />
          <em>Customers call it, and we may call to check your shop before it goes live.</em>
        </label>

        <div className="wz-field">
          <span className="wz-label">
            Your logo <small>optional</small>
          </span>
          <div className="wz-logo">
            {profile.data?.logoUrl ? (
              <ShopLogo logoUrl={profile.data.logoUrl} name={name || 'Shop'} size={48} />
            ) : (
              <span className="wz-logo-drop">
                <Icon name="image" size={20} />
              </span>
            )}
            <span className="wz-logo-text">
              <strong>{profile.data?.logoUrl ? 'Looking good' : 'Square works best'}</strong>
              <em>JPG or PNG, up to 5 MB</em>
            </span>
            <ImageButton
              id="wz-logo"
              label={profile.data?.logoUrl ? 'Change it' : 'Upload'}
              busy={logo.isPending}
              onPick={(file) => file && logo.mutate(file)}
            />
          </div>
        </div>
        <Problem text={problem} />
      </div>
      <Foot busy={save.isPending} ready={ready} label="Save and continue" onSkip={onSkip} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// 2. Where you are

type Week = { days: number[]; open: string; close: string };
/** Monday first, as a week is read here. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d));

/** "Monday to Saturday", "Every day", "Mon, Wed and Fri". */
function daysInWords(days: number[]) {
  const preset = HOURS_PRESETS.find((p) => sameDays(p.days, days));
  if (preset) return preset.label;
  const ordered = DAY_ORDER.filter((d) => days.includes(d));
  if (ordered.length === 0) return 'No days chosen';
  const run = DAY_ORDER.indexOf(ordered[ordered.length - 1]) - DAY_ORDER.indexOf(ordered[0]) + 1 === ordered.length;
  if (run && ordered.length > 2) return `${DAY_LONG[ordered[0]]} to ${DAY_LONG[ordered[ordered.length - 1]]}`;
  const names = ordered.map((d) => DAY_SHORT[d]);
  return names.length === 1 ? DAY_LONG[ordered[0]] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function HoursPicker({ value, onChange }: { value: Week; onChange: (next: Week) => void }) {
  const preset = HOURS_PRESETS.find((p) => sameDays(p.days, value.days));
  const toggle = (day: number) =>
    onChange({ ...value, days: value.days.includes(day) ? value.days.filter((d) => d !== day) : [...value.days, day] });
  return (
    <div className="wz-field">
      <span className="wz-label">When are you open?</span>
      <div className="wz-presets" role="radiogroup" aria-label="Common weeks">
        {HOURS_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={preset?.key === p.key}
            className={preset?.key === p.key ? 'is-on' : ''}
            onClick={() => onChange({ days: p.days, open: p.open, close: p.close })}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="wz-hours">
        <div className="wz-week" role="group" aria-label="Open on">
          {DAY_ORDER.map((d) => {
            const on = value.days.includes(d);
            return (
              <button key={d} type="button" aria-pressed={on} className={on ? 'is-on' : ''} onClick={() => toggle(d)} title={DAY_LONG[d]}>
                {DAY_SHORT[d]}
              </button>
            );
          })}
        </div>
        <div className="wz-times">
          <label>
            <span>Opens</span>
            <input type="time" value={value.open} onChange={(e) => onChange({ ...value, open: e.target.value })} />
          </label>
          <span className="wz-times-to" aria-hidden="true">
            <Icon name="arrowRight" size={16} />
          </span>
          <label>
            <span>Closes</span>
            <input type="time" value={value.close} onChange={(e) => onChange({ ...value, close: e.target.value })} />
          </label>
        </div>
        <p className="wz-hours-sum">
          <StepGlyph name="clock" size={17} />
          {value.days.length ? (
            <span>
              Open <b>{daysInWords(value.days)}</b>, {value.open}–{value.close}
            </span>
          ) : (
            <span>Choose the days you open.</span>
          )}
        </p>
      </div>
      <em>Different hours on some days, or a lunch break? Change them any time in Branches &amp; hours.</em>
    </div>
  );
}

function BranchStep({ onSaved, onSkip, onBack }: { onSaved: () => void; onSkip: () => void; onBack: () => void }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [place, setPlace] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [hours, setHoursChoice] = useState<Week>({ days: HOURS_PRESETS[0].days, open: '08:00', close: '18:00' });
  const [problem, setProblem] = useState<string | null>(null);
  const districtFrom = useDistrictFrom();

  const active = (locations.data ?? []).filter((l) => l.isActive);
  const branch = active.find((l) => l.districtId && l.latitude !== null && l.longitude !== null) ?? null;
  const hasHours = branch ? branch.hours.some((h) => !h.isClosed) : false;

  useEffect(() => {
    if (!name && profile.data?.name) setName(profile.data.name);
    // Only the first time the name arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.data?.name]);

  const week = weekOf(hours.days, hours.open, hours.close);
  const hoursOk = hours.close > hours.open && hours.days.length > 0;

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
    onError: (error) => setProblem(error instanceof ApiError || error instanceof Error ? error.message : 'That did not save.'),
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
    name.trim().length >= 2 && address.trim().length >= 3 && districtId !== '' && coordinates !== null && !('error' in coordinates) && hoursOk;

  // A branch customers can find is already here: show it, and only ask for hours if they are missing.
  if (branch) {
    return (
      <form
        className="wz-step"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setProblem(null);
          if (hasHours) onSaved();
          else if (hoursOk) saveHours.mutate();
        }}
      >
        <StepHead step="branch" n={2} title="Where customers find you" lead="Your branch is on the map." />
        <div className="wz-scroll">
          <Have
            icon={<StepGlyph name="branch" size={22} />}
            title={branch.name}
            text={
              <>
                {branch.address}
                {branch.district && ` · ${branch.district.name}`}
              </>
            }
          />
          {hasHours ? (
            <Have
              icon={<StepGlyph name="clock" size={22} />}
              title="Opening hours are set"
              text={`Open ${branch.hours.filter((h) => !h.isClosed).length} days a week`}
            />
          ) : (
            <HoursPicker value={hours} onChange={setHoursChoice} />
          )}
          <p className="wz-note">
            <Icon name="info" size={15} /> More branches, photos and opening times are in <b>Branches &amp; hours</b>, whenever you want them.
          </p>
          <Problem text={problem} />
        </div>
        <Foot busy={saveHours.isPending} ready={hasHours || hoursOk} label={hasHours ? 'Continue' : 'Save and continue'} onBack={onBack} />
      </form>
    );
  }

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (formReady) create.mutate();
      }}
    >
      <StepHead step="branch" n={2} title="Where customers find you" lead="Your first branch — the place customers come to. Its address puts you on the map." />
      <div className="wz-scroll bf">
        <label className="wz-field">
          <span className="wz-label">Branch name</span>
          <IconInput icon="store" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Kigali Barbers — Kimironko" />
          <em>If you have only one place, your shop’s name is fine.</em>
        </label>

        <div className="wz-field">
          <span className="wz-label">Address</span>
          <AddressField id="wz-address" value={address} onChange={setAddress} onPick={onPick} placeholder="Start typing — KG 11 Ave, Kimironko…" />
          <em>Pick a suggestion and we drop the pin for you.</em>
        </div>

        <PlaceField value={place} onChange={setPlace} onProblem={setProblem} hint="Or paste your Google Maps link, or use your position if you are at the shop now." />

        <DistrictField value={districtId} onChange={setDistrictId} hint="Customers search by area, so this is how they find you." />

        <HoursPicker value={hours} onChange={setHoursChoice} />

        {active.length > 0 && (
          <p className="wz-note">
            <Icon name="info" size={15} /> Your branch “{active[0].name}” has no map pin or district yet. Add them in{' '}
            <Link to="/hours">Branches &amp; hours</Link>, or add the place here.
          </p>
        )}
        <Problem text={problem} />
      </div>
      <Foot busy={create.isPending} ready={formReady} label="Save and continue" onSkip={onSkip} onBack={onBack} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// 3. Your first service

const DURATIONS = [15, 30, 45, 60, 90, 120];
const DEPOSITS = [20, 30, 50];
const durationWords = (d: number) => (d < 60 ? `${d} min` : d % 60 === 0 ? `${d / 60} h` : `${Math.floor(d / 60)} h ${d % 60}`);

function ServiceStep({ onSaved, onSkip, onBack }: { onSaved: () => void; onSkip: () => void; onBack: () => void }) {
  const money = useMoney();
  const services = useQuery({ queryKey: ['services'], queryFn: listServices });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState(30);
  const [deposit, setDeposit] = useState(20);
  const [problem, setProblem] = useState<string | null>(null);

  const open = (locations.data ?? []).filter((l) => l.isActive);
  const offered = (services.data ?? []).filter((s) => s.isActive && s.locations.some((o) => o.isOffered));
  const priceMinor = money.toMinor(price.replace(/[, ]/g, ''));
  const priced = Number.isFinite(priceMinor) && priceMinor > 0;
  const ready = name.trim().length >= 2 && priced && open.length > 0;

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
        className="wz-step"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSaved();
        }}
      >
        <StepHead
          step="service"
          n={3}
          title="What customers can book"
          lead={`You have ${offered.length} ${offered.length === 1 ? 'service' : 'services'} ready to book.`}
        />
        <div className="wz-scroll">
          <Have
            icon={<StepGlyph name="service" size={22} />}
            title={first.name}
            text={`${money.format(Math.min(...first.locations.map((o) => o.priceMinor)))} · ${first.durationMinutes} min · ${Number(first.depositPercentage)}% deposit`}
          />
          <p className="wz-note">
            <Icon name="info" size={15} /> Add more, with photos and descriptions, in <b>Services</b> whenever you like.
          </p>
        </div>
        <Foot busy={false} ready label="Continue" onBack={onBack} />
      </form>
    );
  }

  const depositMinor = priced ? Math.round((priceMinor * deposit) / 100) : 0;

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (ready) create.mutate();
      }}
    >
      <StepHead step="service" n={3} title="Add your first service" lead="One thing customers can book. You can add the rest later, with photos." />
      <div className="wz-scroll">
        {open.length === 0 && (
          <p className="wz-note is-warn">
            <Icon name="alert" size={15} /> A service is offered at a branch, so add your branch first.{' '}
            <button type="button" className="wz-inline" onClick={onBack}>
              Back to your branch
            </button>
          </p>
        )}

        <div className="wz-field">
          <label className="wz-label" htmlFor="wz-service">
            Service name
          </label>
          <IconInput id="wz-service" icon="tag" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={examples[0] ?? 'Haircut'} autoFocus />
          {examples.length > 0 && (
            <div className="wz-examples">
              <span>Try</span>
              {examples.map((e) => (
                <button key={e} type="button" className={e === name ? 'is-on' : ''} onClick={() => setName(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="wz-field">
          <span className="wz-label">Price</span>
          <span className="wz-money">
            <b>{money.code || 'RWF'}</b>
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="5,000" />
          </span>
        </label>

        <div className="wz-field">
          <span className="wz-label">How long it takes</span>
          <div className="wz-chips">
            {DURATIONS.map((d) => (
              <button key={d} type="button" className={d === duration ? 'is-on' : ''} onClick={() => setDuration(d)}>
                {durationWords(d)}
              </button>
            ))}
          </div>
        </div>

        <div className="wz-field">
          <span className="wz-label">Deposit to book</span>
          <div className="wz-chips">
            {DEPOSITS.map((d) => (
              <button key={d} type="button" className={d === deposit ? 'is-on' : ''} onClick={() => setDeposit(d)}>
                {d}%
              </button>
            ))}
          </div>
          {/* The price, split as the customer pays it. */}
          <div className={`wz-split${priced ? '' : ' is-empty'}`}>
            <div className="wz-split-bar">
              <i style={{ width: `${deposit}%` }} />
            </div>
            <div className="wz-split-legend">
              <span>
                <b className="is-now" />
                On their phone, to book
                <strong>{priced ? money.format(depositMinor) : `${deposit}%`}</strong>
              </span>
              <span>
                <b />
                At your shop
                <strong>{priced ? money.format(priceMinor - depositMinor) : `${100 - deposit}%`}</strong>
              </span>
            </div>
          </div>
          <em>A deposit means fewer people who book and do not come.</em>
        </div>
        <Problem text={problem} />
      </div>
      <Foot busy={create.isPending} ready={ready} label="Save and continue" onSkip={onSkip} onBack={onBack} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// 4. Getting paid (optional)

function PaidStep({ onSaved, onSkip, onBack }: { onSaved: () => void; onSkip: () => void; onBack: () => void }) {
  const current = useQuery({ queryKey: ['payout-destination'], queryFn: getPayoutDestination });
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
        className="wz-step"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSaved();
        }}
      >
        <StepHead step="paid" n={4} title="Getting paid" lead="Your share of every deposit is sent to this number." />
        <div className="wz-scroll">
          <Have
            icon={<NetworkMark network={have.provider} size={40} />}
            title={`${NETWORK_NAME[have.provider]} · •••• ${(have.msisdn ?? have.msisdnLast3 ?? '').slice(-3)}`}
            text={have.status === 'VERIFIED' ? 'Checked — payouts go here' : 'Waiting to be checked by our team'}
          />
        </div>
        <Foot busy={false} ready label="Continue" onBack={onBack} />
      </form>
    );
  }

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (digits.length >= 9) save.mutate();
      }}
    >
      <StepHead
        step="paid"
        n={4}
        optional
        title="Getting paid"
        lead="Where we send your share of each deposit. Your shop can go live without it — you are paid once it is added and checked."
      />
      <div className="wz-scroll">
        <label className="wz-field">
          <span className="wz-label">Mobile money number</span>
          <span className={`wz-msisdn${network ? ' is-known' : ''}`}>
            {network ? (
              <NetworkMark network={network} size={34} />
            ) : (
              <span className="wz-msisdn-blank">
                <Icon name="phone" size={17} />
              </span>
            )}
            <input value={msisdn} onChange={(e) => setMsisdn(e.target.value)} inputMode="tel" placeholder="+250 788 123 456" maxLength={20} />
            {network && <em>{NETWORK_NAME[network]}</em>}
          </span>
          <em>MTN MoMo or Airtel Money, in the shop’s or the owner’s name. Our team checks it before the first payout.</em>
        </label>
        <div className="wz-paid-how">
          {[
            { icon: 'banknote' as IconName, text: 'A customer pays a deposit to book' },
            { icon: 'shield' as IconName, text: 'We hold it safely until they come' },
            { icon: 'wallet' as IconName, text: 'Your share is sent to this number' },
          ].map((s, i) => (
            <span key={s.text}>
              <i>
                <Icon name={s.icon} size={17} />
              </i>
              {s.text}
              {i < 2 && <Icon name="chevronRight" size={15} />}
            </span>
          ))}
        </div>
        <Problem text={problem} />
      </div>
      <Foot busy={save.isPending} ready={digits.length >= 9} label="Save and continue" onSkip={onSkip} skipLabel="Add it later" onBack={onBack} />
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

  if (!readiness) {
    return (
      <div className="wz-step">
        <div className="wz-scroll">
          <div className="skeleton wz-skel" />
        </div>
      </div>
    );
  }

  const waiting = readiness.status === 'PENDING' && readiness.submittedAt !== null;
  if (sent || waiting) {
    return (
      <div className="wz-step is-sent">
        <div className="wz-scroll">
          <div className="wz-sent-hero" aria-hidden="true">
            <span className="wz-burst">
              <i />
              <i />
              <i />
            </span>
            <span className="wz-confetti">
              {Array.from({ length: 16 }, (_, i) => (
                <b key={i} style={{ '--i': i } as CSSProperties} />
              ))}
            </span>
            <span className="wz-sent-disc">
              <DrawnCheck size={46} stroke={2.4} />
            </span>
          </div>
          <h1 id="wz-title">{sent ? 'Your shop is with us for review' : 'Your shop is waiting for review'}</h1>
          <p className="wz-lead">
            {readiness.submittedAt && !sent
              ? `Sent ${new Date(readiness.submittedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}. `
              : ''}
            Here is what happens next.
          </p>
          <ol className="wz-next">
            <li>
              <span className="wz-next-icon">
                <StepGlyph name="shield" size={22} />
              </span>
              <span>
                <strong>We check your details</strong>
                Usually within one working day. We may call your shop’s number.
              </span>
            </li>
            <li>
              <span className="wz-next-icon is-ask">
                <StepGlyph name="mail" size={22} />
              </span>
              <span>
                <strong>You get an email</strong>
                At {email || 'your address'}, the moment you are approved and your shop goes live.
              </span>
            </li>
            <li>
              <span className="wz-next-icon is-ok">
                <StepGlyph name="sparkle" size={22} />
              </span>
              <span>
                <strong>Meanwhile, make it shine</strong>
                Photos, a description, more services and your team. Shops with photos get booked first.
              </span>
            </li>
          </ol>
        </div>
        <div className="wz-foot is-center">
          <span />
          <button type="button" className="primary wz-go" onClick={() => navigate('/', { replace: true })}>
            Go to my dashboard <Icon name="arrowRight" size={17} stroke={2.4} />
          </button>
        </div>
      </div>
    );
  }

  const rejected = readiness.status === 'REJECTED';
  const required = readiness.items.filter((i) => i.required);
  const missing = required.filter((i) => !i.done);
  const later = readiness.items.filter((i) => !i.required);

  return (
    <div className="wz-step">
      <StepHead
        step="review"
        title={rejected ? 'Send your shop back for review' : missing.length ? 'Almost there' : 'Ready to go live'}
        lead={
          rejected
            ? 'Fix what we asked, then send it back. Everything you set up is still here.'
            : missing.length
              ? `${missing.length} ${missing.length === 1 ? 'thing is' : 'things are'} still needed before we can review your shop.`
              : 'We check every shop before customers can book it. Send yours now — it only takes a moment.'
        }
      />
      <div className="wz-scroll">
        {rejected && readiness.statusReason && (
          <div className="wz-reason">
            <Icon name="alert" size={18} />
            <span>
              <strong>What we said</strong>
              {readiness.statusReason}
            </span>
          </div>
        )}

        <div className="wz-field">
          <span className="wz-label">
            What we need <small>{required.length - missing.length} of {required.length}</small>
          </span>
          <div className="wz-ready-grid">
            {required.map((i) => (
              <button
                key={i.key}
                type="button"
                className={`wz-ready${i.done ? ' is-done' : ''}`}
                onClick={() => onGo(ITEM_WORDS[i.key].step)}
                disabled={i.done}
              >
                <span className="wz-ready-icon">{i.done ? <DrawnCheck size={14} stroke={3.2} /> : <StepGlyph name={ITEM_WORDS[i.key].step} size={17} />}</span>
                <span>{ITEM_WORDS[i.key].label}</span>
                {!i.done && (
                  <em>
                    Add <Icon name="arrowRight" size={13} stroke={2.4} />
                  </em>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="wz-field">
          <span className="wz-label">Nice to have — add whenever you like</span>
          <div className="wz-ready-grid is-optional">
            {later.map((i) => (
              <button
                key={i.key}
                type="button"
                className={`wz-ready${i.done ? ' is-done' : ''}`}
                onClick={() => onGo(ITEM_WORDS[i.key].step)}
                disabled={i.done}
              >
                <span className="wz-ready-icon">{i.done ? <DrawnCheck size={14} stroke={3.2} /> : <StepGlyph name={ITEM_WORDS[i.key].step} size={17} />}</span>
                <span>{ITEM_WORDS[i.key].label}</span>
                {!i.done && (
                  <em>
                    Add <Icon name="arrowRight" size={13} stroke={2.4} />
                  </em>
                )}
              </button>
            ))}
          </div>
        </div>
        <Problem text={submit.error ? said(submit.error, 'That did not send. Check your connection and try again.') : null} />
      </div>
      <div className="wz-foot">
        <div>
          <button type="button" className="wz-back" onClick={onBack}>
            <Icon name="chevronLeft" size={17} stroke={2.2} /> Back
          </button>
        </div>
        <div>
          <button type="button" className="wz-skip" onClick={() => navigate('/')}>
            Finish later
          </button>
          <button type="button" className="primary wz-go" disabled={!readiness.canSubmit || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? (
              <>
                <span className="wz-spin" aria-hidden="true" /> Sending…
              </>
            ) : (
              <>
                {rejected ? 'Send back for review' : 'Send for review'}
                <Icon name="send" size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
