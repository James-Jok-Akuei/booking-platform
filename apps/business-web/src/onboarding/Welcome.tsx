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
import { StaticMap } from '../components/StaticMap';
import { useMoney } from '../money';
import { Icon, type IconName } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { NETWORK_NAME, NetworkMark, networkOf } from '../ui/NetworkMark';
import { ShopLogo } from '../ui/ShopLogo';
import { LineArt } from './LineArt';
import { DrawnCheck, StepGlyph } from './StepIcons';
import {
  HOURS_PRESETS,
  ITEM_WORDS,
  SCREENS,
  SKIP_TO,
  STEPS,
  isDone,
  isScreen,
  nextStep,
  sectionOf,
  weekOf,
  type Screen,
} from './steps';
import './welcome.css';

/** The server's refusal in its own words, or ours. */
const said = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

type ServiceDraft = { name: string; duration: number };

/** What a question needs to move on. */
type Nav = {
  /** On to the next question, nothing saved. */
  next: () => void;
  /** After a save: what the checklist reads is asked again, then on (or to `to`). */
  saved: (to?: Screen) => Promise<void>;
  back?: () => void;
  skip: () => void;
  go: (screen: Screen) => void;
};

/**
 * Setting up a shop (§256; drawn as a panel over the shops' photos in §262;
 * one question to a screen in §263).
 *
 * Four parts and a send-off — your shop, where you are, your first service,
 * getting paid — each asked as a few short questions, so a screen holds one
 * thing: the name; what kind of shop (drawn, not listed); which kind exactly;
 * how to reach you; the address; the hours; the service; its price. Every
 * question can be skipped, each reads what is already saved, and coming back
 * opens on the first one still unanswered.
 *
 * The panel holds still in the middle of the screen; only a question's
 * middle scrolls. On a phone it is a sheet over a band of the photos.
 */
export function Welcome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const readiness = useQuery({ queryKey: ['readiness'], queryFn: getReadiness });
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  // Answers carried between two questions before they are saved together.
  const [kindDraft, setKindDraft] = useState<string | null>(null);
  const [serviceDraft, setServiceDraft] = useState<ServiceDraft>({ name: '', duration: 30 });
  const root = useRef<HTMLDivElement>(null);

  const asked = params.get('step');
  const screen: Screen = isScreen(asked) ? asked : nextStep(readiness.data);
  const index = SCREENS.findIndex((s) => s.key === screen);
  const section = sectionOf(screen);

  const go = (key: Screen) => {
    const target = SCREENS.findIndex((s) => s.key === key);
    if (target === index) return;
    setDir(target < index ? 'back' : 'fwd');
    setParams({ step: key });
  };
  const after = (key: Screen) => SCREENS[Math.min(SCREENS.findIndex((s) => s.key === key) + 1, SCREENS.length - 1)].key;
  const nav: Nav = {
    next: () => go(after(screen)),
    saved: async (to) => {
      await Promise.all(
        ['readiness', 'profile', 'locations', 'services', 'payout-destination', 'me'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      go(to ?? after(screen));
    },
    back: index > 0 ? () => go(SCREENS[index - 1].key) : undefined,
    skip: () => go(SKIP_TO[screen]),
    go,
  };
  const finishLater = () => navigate('/');

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
  const sectionIndex = STEPS.findIndex((s) => s.key === section);

  return (
    <div className={`wz is-${screen}`} ref={root} onPointerMove={lean}>
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
                const on = s.key === section;
                return (
                  <li key={s.key} className={`${on ? 'is-on' : ''}${done ? ' is-done' : ''}`}>
                    <button
                      type="button"
                      onClick={() => go(SCREENS.find((q) => q.section === s.key)!.key)}
                      aria-current={on ? 'step' : undefined}
                    >
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

            {/* On a phone the four parts are four bars over the question. */}
            <div className="wz-phone-chrome" aria-hidden="true">
              <div className="wz-segs">
                {STEPS.filter((s) => s.key !== 'review').map((s, i) => (
                  <i
                    key={s.key}
                    className={s.key === section ? 'is-on' : isDone(readiness.data, s.keys) ? 'is-done' : i < sectionIndex ? 'is-past' : ''}
                  />
                ))}
              </div>
            </div>

            {role === 'STAFF' ? (
              <div className="wz-stage">
                <div className="wz-step">
                  <header className="wz-head">
                    <div className="wz-col">
                      <h1 id="wz-title">Only the owner or a manager can set up the shop</h1>
                      <p className="wz-lead">Ask them to finish setting it up. You can still look around.</p>
                    </div>
                  </header>
                  <div className="wz-scroll" />
                  <div className="wz-foot">
                    <div className="wz-col">
                      <span />
                      <button type="button" className="primary wz-go" onClick={finishLater}>
                        Go to the dashboard <Icon name="arrowRight" size={17} stroke={2.4} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="wz-stage" key={screen}>
                {screen === 'name' && <NameQ nav={nav} />}
                {screen === 'kind' && <KindQ nav={nav} draft={kindDraft} onDraft={setKindDraft} />}
                {screen === 'type' && <TypeQ nav={nav} draft={kindDraft} />}
                {screen === 'contact' && <ContactQ nav={nav} />}
                {screen === 'address' && <AddressQ nav={nav} />}
                {screen === 'hours' && <HoursQ nav={nav} />}
                {screen === 'service' && <ServiceQ nav={nav} draft={serviceDraft} onDraft={setServiceDraft} />}
                {screen === 'price' && <PriceQ nav={nav} draft={serviceDraft} />}
                {screen === 'paid' && <PaidQ nav={nav} />}
                {screen === 'review' && <ReviewQ nav={nav} readiness={readiness.data} email={me.data?.email ?? ''} />}
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
// A question's frame: the question (stays), its answer (scrolls), the way on (stays)

function QHead({ screen, title, lead, optional }: { screen: Screen; title: ReactNode; lead?: ReactNode; optional?: boolean }) {
  const section = sectionOf(screen);
  const questions = SCREENS.filter((s) => s.section === section);
  const n = questions.findIndex((q) => q.key === screen) + 1;
  const part = STEPS.find((s) => s.key === section)!;
  return (
    <header className="wz-head">
      <div className="wz-col">
        <div className="wz-head-meta">
          <span className="wz-eyebrow">
            {section === 'review' ? 'Last step' : part.title}
            {questions.length > 1 && <em>{` · ${n} of ${questions.length}`}</em>}
            {optional && <i>Optional</i>}
          </span>
          {questions.length > 1 && (
            <span className="wz-qdots" aria-hidden="true">
              {questions.map((q, i) => (
                <i key={q.key} className={i < n - 1 ? 'is-done' : i === n - 1 ? 'is-on' : ''} />
              ))}
            </span>
          )}
        </div>
        <h1 id="wz-title">{title}</h1>
        {lead && <p className="wz-lead">{lead}</p>}
      </div>
    </header>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div className="wz-scroll">
      <div className="wz-col wz-body">{children}</div>
    </div>
  );
}

function Foot({
  busy = false,
  ready = true,
  label = 'Next',
  nav,
  skipLabel = 'Skip for now',
  noSkip,
}: {
  busy?: boolean;
  ready?: boolean;
  label?: string;
  nav: Nav;
  skipLabel?: string;
  noSkip?: boolean;
}) {
  return (
    <div className="wz-foot">
      <div className="wz-col">
        <div>
          {nav.back && (
            <button type="button" className="wz-back" onClick={nav.back}>
              <Icon name="chevronLeft" size={17} stroke={2.2} /> Back
            </button>
          )}
        </div>
        <div>
          {!noSkip && (
            <button type="button" className="wz-skip" onClick={nav.skip} disabled={busy}>
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

/** A big, plain text box with its meaning drawn at its start. */
function BigInput({ icon, ...props }: { icon: IconName } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="wz-input is-big">
      <Icon name={icon} size={20} />
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

const describe = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).join(', ')} and more` : names.join(', '));

// ---------------------------------------------------------------------------
// Your shop: its name, what kind, which kind exactly, how to reach it

function NameQ({ nav }: { nav: Nav }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (profile.data?.name) setName(profile.data.name);
  }, [profile.data?.name]);

  const save = useMutation({
    mutationFn: () => updateProfile({ name: name.trim() }),
    onSuccess: () => nav.saved(),
    onError: (error) => setProblem(said(error, 'That did not save. Check your connection and try again.')),
  });
  const ready = name.trim().length >= 2;
  const kind = profile.data?.subcategory ? `${profile.data.category?.name} · ${profile.data.subcategory.name}` : null;

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (!ready) return;
        if (name.trim() === profile.data?.name) nav.next();
        else save.mutate();
      }}
    >
      <QHead screen="name" title="What’s your shop called?" lead="The name customers see when they find you — the one on your sign is best." />
      <Body>
        <BigInput icon="store" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Kigali Barbers" aria-label="Shop name" autoFocus />
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
            <em>{kind ?? 'Barbers, salons, spas, garages and more'}</em>
          </span>
        </div>
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={save.isPending} ready={ready} />
    </form>
  );
}

function KindQ({ nav, draft, onDraft }: { nav: Nav; draft: string | null; onDraft: (id: string) => void }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories, staleTime: 10 * 60_000 });
  const [picked, setPicked] = useState<string | null>(draft);
  const chosen = picked ?? profile.data?.category?.id ?? null;

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!chosen) return;
        onDraft(chosen);
        nav.next();
      }}
    >
      <QHead screen="kind" title="What kind of shop is it?" lead="Choose the one that fits best. Customers browse by it." />
      <Body>
        <div className="wz-kinds" role="radiogroup" aria-label="What kind of shop">
          {(categories.data ?? []).map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === chosen}
              className={`wz-kind${c.id === chosen ? ' is-on' : ''}`}
              onClick={() => setPicked(c.id)}
              onDoubleClick={() => {
                onDraft(c.id);
                nav.next();
              }}
            >
              <span className="wz-kind-tick" aria-hidden="true">
                <DrawnCheck size={12} stroke={3.4} />
              </span>
              <strong>{c.name}</strong>
              <em>{describe(c.subcategories.map((s) => s.name))}</em>
              <LineArt icon={c.icon} delay={120 + i * 70} />
            </button>
          ))}
          {categories.isLoading && [0, 1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} className="skeleton wz-kind-skel" />)}
        </div>
      </Body>
      <Foot nav={nav} ready={Boolean(chosen)} />
    </form>
  );
}

function TypeQ({ nav, draft }: { nav: Nav; draft: string | null }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories, staleTime: 10 * 60_000 });
  const categoryId = draft ?? profile.data?.category?.id ?? null;
  const category = categories.data?.find((c) => c.id === categoryId) ?? null;
  const savedType = profile.data?.category?.id === categoryId ? (profile.data?.subcategory?.id ?? null) : null;
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = picked ?? savedType;
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => updateProfile({ categoryId: categoryId!, subcategoryId: chosen! }),
    onSuccess: () => nav.saved(),
    onError: (error) => setProblem(said(error, 'That did not save. Check your connection and try again.')),
  });

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (!categoryId || !chosen) return;
        if (chosen === profile.data?.subcategory?.id && categoryId === profile.data?.category?.id) nav.next();
        else save.mutate();
      }}
    >
      <QHead screen="type" title="Which describes it best?" lead={category ? `Within ${category.name.toLowerCase()}.` : undefined} />
      <Body>
        {category ? (
          <>
            <div className="wz-chosen">
              <LineArt icon={category.icon} />
              <span>
                <em>Your kind of shop</em>
                <strong>{category.name}</strong>
              </span>
              <button type="button" className="wz-link" onClick={() => nav.go('kind')}>
                Change
              </button>
            </div>
            <div className="wz-options" role="radiogroup" aria-label="Which kind exactly">
              {category.subcategories.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === chosen}
                  className={`wz-option${s.id === chosen ? ' is-on' : ''}`}
                  style={{ animationDelay: `${i * 40}ms` }}
                  onClick={() => setPicked(s.id)}
                >
                  <span className="wz-radio" aria-hidden="true" />
                  {s.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="wz-note is-warn">
            <Icon name="alert" size={15} /> Choose what kind of shop it is first.{' '}
            <button type="button" className="wz-inline" onClick={() => nav.go('kind')}>
              Choose it
            </button>
          </p>
        )}
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={save.isPending} ready={Boolean(categoryId && chosen)} />
    </form>
  );
}

function ContactQ({ nav }: { nav: Nav }) {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const [phone, setPhone] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (profile.data?.phone) setPhone(profile.data.phone);
  }, [profile.data?.phone]);

  const logo = useMutation({
    mutationFn: (file: File) => setProfileImage('logo', file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['readiness'] });
    },
    onError: (error) => setProblem(said(error, 'That picture did not upload. Try a JPG or PNG under 5 MB.')),
  });
  const save = useMutation({
    mutationFn: () => updateProfile({ phone: phone.trim() }),
    onSuccess: () => nav.saved(),
    onError: (error) => setProblem(said(error, 'That did not save. Check your connection and try again.')),
  });
  const ready = phone.replace(/\D/g, '').length >= 9;
  const name = profile.data?.name ?? 'Shop';

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (!ready) return;
        if (phone.trim() === profile.data?.phone) nav.next();
        else save.mutate();
      }}
    >
      <QHead screen="contact" title="How can customers reach you?" lead="A number customers can call. We may call it too, to check your shop before it goes live." />
      <Body>
        <BigInput icon="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={30} placeholder="+250 788 123 456" aria-label="Phone number" autoFocus />
        <div className="wz-sep">
          <span>And if you have one</span>
        </div>
        <div className="wz-logo">
          {profile.data?.logoUrl ? (
            <ShopLogo logoUrl={profile.data.logoUrl} name={name} size={52} />
          ) : (
            <span className="wz-logo-drop">
              <Icon name="image" size={22} />
            </span>
          )}
          <span className="wz-logo-text">
            <strong>{profile.data?.logoUrl ? 'Your logo' : 'Add your logo'}</strong>
            <em>{profile.data?.logoUrl ? 'It shows on every card customers see.' : 'Optional · square works best · JPG or PNG'}</em>
          </span>
          <ImageButton id="wz-logo" label={profile.data?.logoUrl ? 'Change' : 'Upload'} busy={logo.isPending} onPick={(file) => file && logo.mutate(file)} />
        </div>
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={save.isPending} ready={ready} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Where you are: the address, then the hours

function AddressQ({ nav }: { nav: Nav }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const [address, setAddress] = useState('');
  const [place, setPlace] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [manual, setManual] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const districtFrom = useDistrictFrom();

  const active = (locations.data ?? []).filter((l) => l.isActive);
  const branch = active.find((l) => l.districtId && l.latitude !== null && l.longitude !== null) ?? null;
  const branchName = renaming ? name : name.trim() || profile.data?.name || '';

  const create = useMutation({
    mutationFn: async () => {
      const parsed = parseCoordinates(place);
      if ('error' in parsed) throw new Error(parsed.error);
      return createLocation({
        name: branchName.trim(),
        address: address.trim(),
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        districtId,
      });
    },
    onSuccess: () => nav.saved(),
    onError: (error) => setProblem(error instanceof ApiError || error instanceof Error ? error.message : 'That did not save.'),
  });

  const onPick = (found: FoundAddress) => {
    setPlace(`${found.latitude.toFixed(6)}, ${found.longitude.toFixed(6)}`);
    const district = districtFrom(found);
    if (district) setDistrictId(district);
    setProblem(null);
  };

  const coordinates = place.trim() ? parseCoordinates(place) : null;
  const pinned = coordinates && !('error' in coordinates) ? coordinates : null;
  const ready = branchName.trim().length >= 2 && address.trim().length >= 3 && districtId !== '' && pinned !== null;

  if (branch) {
    return (
      <form
        className="wz-step"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          nav.next();
        }}
      >
        <QHead screen="address" title="Where is your shop?" lead="Your branch is on the map." />
        <Body>
          {branch.latitude !== null && branch.longitude !== null && (
            <div className="wz-map">
              <StaticMap latitude={branch.latitude} longitude={branch.longitude} spanX={500} spanY={140} />
            </div>
          )}
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
          <p className="wz-note">
            <Icon name="info" size={15} /> More branches and photos are in <b>Branches &amp; hours</b>, whenever you want them.
          </p>
        </Body>
        <Foot nav={nav} label="Continue" noSkip />
      </form>
    );
  }

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (ready) create.mutate();
      }}
    >
      <QHead screen="address" title="Where is your shop?" lead="Start typing the address and pick it from the list — we put you on the map." />
      <Body>
        <div className="wz-address bf">
          <AddressField id="wz-address" value={address} onChange={setAddress} onPick={onPick} placeholder="e.g. KG 11 Ave, Kimironko" />
        </div>

        {pinned && (
          <div className="wz-pinned">
            <div className="wz-map">
              <StaticMap latitude={pinned.latitude} longitude={pinned.longitude} spanX={500} spanY={140} />
            </div>
            <div className="wz-pinned-text">
              <span className="wz-have-ok">
                <DrawnCheck size={15} stroke={3} />
              </span>
              <span>
                <strong>On the map</strong>
                <em>Customers nearby will find you here.</em>
              </span>
              <button type="button" className="wz-link" onClick={() => setManual((v) => !v)}>
                {manual ? 'Done' : 'Move the pin'}
              </button>
            </div>
          </div>
        )}

        {(manual || !pinned) && (
          <div className={`wz-manual bf${manual ? ' is-open' : ''}`}>
            {manual ? (
              <PlaceField value={place} onChange={setPlace} onProblem={setProblem} hint="Paste your Google Maps link, or use your position if you are at the shop now." />
            ) : (
              <button type="button" className="wz-link" onClick={() => setManual(true)}>
                <Icon name="pin" size={15} /> Can’t find it? Paste a map link or use where you are
              </button>
            )}
          </div>
        )}

        {(pinned || districtId) && (
          <div className="wz-field bf">
            <DistrictField value={districtId} onChange={setDistrictId} hint="Customers search by area, so this is how they find you." />
          </div>
        )}

        <div className="wz-field">
          {renaming ? (
            <>
              <span className="wz-label">Branch name</span>
              <BigInput icon="store" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Kigali Barbers — Kimironko" autoFocus />
            </>
          ) : (
            <p className="wz-quiet">
              Shown to customers as <b>{branchName || 'your shop’s name'}</b>.{' '}
              <button
                type="button"
                className="wz-link"
                onClick={() => {
                  setName(branchName);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
            </p>
          )}
        </div>

        {active.length > 0 && (
          <p className="wz-note">
            <Icon name="info" size={15} /> Your branch “{active[0].name}” has no map pin or district yet. Add them in{' '}
            <Link to="/hours">Branches &amp; hours</Link>, or add the address here.
          </p>
        )}
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={create.isPending} ready={ready} />
    </form>
  );
}

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

function HoursQ({ nav }: { nav: Nav }) {
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const [week, setWeek] = useState<Week>({ days: HOURS_PRESETS[0].days, open: '08:00', close: '18:00' });
  const [problem, setProblem] = useState<string | null>(null);
  const active = (locations.data ?? []).filter((l) => l.isActive);
  const branch = active.find((l) => l.districtId && l.latitude !== null) ?? active[0] ?? null;
  const hasHours = branch ? branch.hours.some((h) => !h.isClosed) : false;
  // A common week is chosen only while its days and its times both still hold.
  const preset = HOURS_PRESETS.find((p) => sameDays(p.days, week.days) && p.open === week.open && p.close === week.close);
  const ready = week.days.length > 0 && week.close > week.open;

  const save = useMutation({
    mutationFn: () => setHours(branch!.id, weekOf(week.days, week.open, week.close)),
    onSuccess: () => nav.saved(),
    onError: (error) => setProblem(said(error, 'Those hours did not save.')),
  });
  const toggle = (day: number) =>
    setWeek((w) => ({ ...w, days: w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day] }));

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (hasHours) nav.next();
        else if (branch && ready) save.mutate();
      }}
    >
      <QHead screen="hours" title="When are you open?" lead={hasHours ? 'Your opening hours are set.' : 'Pick your usual week. Lunch breaks and odd days can be set later.'} />
      <Body>
        {!branch ? (
          <p className="wz-note is-warn">
            <Icon name="alert" size={15} /> Hours belong to a branch, so add your address first.{' '}
            <button type="button" className="wz-inline" onClick={() => nav.go('address')}>
              Add the address
            </button>
          </p>
        ) : hasHours ? (
          <Have
            icon={<StepGlyph name="clock" size={22} />}
            title="Opening hours are set"
            text={`Open ${branch.hours.filter((h) => !h.isClosed).length} days a week — change them any time in Branches & hours`}
          />
        ) : (
          <>
            <div className="wz-presets" role="radiogroup" aria-label="Common weeks">
              {HOURS_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={preset?.key === p.key}
                  className={`wz-preset${preset?.key === p.key ? ' is-on' : ''}`}
                  onClick={() => setWeek({ days: p.days, open: p.open, close: p.close })}
                >
                  <span className="wz-radio" aria-hidden="true" />
                  <span>
                    <strong>{p.label}</strong>
                    <em>
                      {p.open}–{p.close}
                    </em>
                  </span>
                </button>
              ))}
            </div>
            <div className="wz-hours">
              <div className="wz-week" role="group" aria-label="Open on">
                {DAY_ORDER.map((d) => {
                  const on = week.days.includes(d);
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
                  <input type="time" value={week.open} onChange={(e) => setWeek({ ...week, open: e.target.value })} />
                </label>
                <span className="wz-times-to" aria-hidden="true">
                  <Icon name="arrowRight" size={16} />
                </span>
                <label>
                  <span>Closes</span>
                  <input type="time" value={week.close} onChange={(e) => setWeek({ ...week, close: e.target.value })} />
                </label>
              </div>
              <p className="wz-hours-sum">
                <StepGlyph name="clock" size={17} />
                {week.days.length ? (
                  <span>
                    Open <b>{daysInWords(week.days)}</b>, {week.open}–{week.close}
                  </span>
                ) : (
                  <span>Choose the days you open.</span>
                )}
              </p>
            </div>
          </>
        )}
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={save.isPending} ready={hasHours || (Boolean(branch) && ready)} label={hasHours ? 'Continue' : 'Next'} noSkip={hasHours} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Your first service: what it is, then what it costs

const DURATIONS = [15, 30, 45, 60, 90, 120];
const DEPOSITS = [20, 30, 50];
const durationWords = (d: number) => (d < 60 ? `${d} min` : d % 60 === 0 ? `${d / 60} h` : `${Math.floor(d / 60)} h ${d % 60}`);

function useOffered() {
  const services = useQuery({ queryKey: ['services'], queryFn: listServices });
  return (services.data ?? []).filter((s) => s.isActive && s.locations.some((o) => o.isOffered));
}

function OfferedHave({ nav, screen }: { nav: Nav; screen: Screen }) {
  const money = useMoney();
  const offered = useOffered();
  const first = offered[0];
  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        nav.go('paid');
      }}
    >
      <QHead screen={screen} title="What customers can book" lead={`You have ${offered.length} ${offered.length === 1 ? 'service' : 'services'} ready to book.`} />
      <Body>
        <Have
          icon={<StepGlyph name="service" size={22} />}
          title={first.name}
          text={`${money.format(Math.min(...first.locations.map((o) => o.priceMinor)))} · ${first.durationMinutes} min · ${Number(first.depositPercentage)}% deposit`}
        />
        <p className="wz-note">
          <Icon name="info" size={15} /> Add more, with photos and descriptions, in <b>Services</b> whenever you like.
        </p>
      </Body>
      <Foot nav={nav} label="Continue" noSkip />
    </form>
  );
}

function ServiceQ({ nav, draft, onDraft }: { nav: Nav; draft: ServiceDraft; onDraft: (d: ServiceDraft) => void }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const offered = useOffered();
  const [name, setName] = useState(draft.name);
  const [duration, setDuration] = useState(draft.duration);
  const open = (locations.data ?? []).filter((l) => l.isActive);

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

  if (offered.length > 0) return <OfferedHave nav={nav} screen="service" />;

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (name.trim().length < 2) return;
        onDraft({ name: name.trim(), duration });
        nav.next();
      }}
    >
      <QHead screen="service" title="What can customers book first?" lead="Just one to start. You can add the rest later, with photos." />
      <Body>
        {open.length === 0 && (
          <p className="wz-note is-warn">
            <Icon name="alert" size={15} /> A service is offered at a branch, so add your address first.{' '}
            <button type="button" className="wz-inline" onClick={() => nav.go('address')}>
              Add the address
            </button>
          </p>
        )}
        <div className="wz-field">
          <BigInput icon="tag" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={`e.g. ${examples[0] ?? 'Haircut'}`} aria-label="Service name" autoFocus />
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
        <div className="wz-field">
          <span className="wz-label">How long does it take?</span>
          <div className="wz-chips">
            {DURATIONS.map((d) => (
              <button key={d} type="button" className={d === duration ? 'is-on' : ''} onClick={() => setDuration(d)}>
                {durationWords(d)}
              </button>
            ))}
          </div>
        </div>
      </Body>
      <Foot nav={nav} ready={name.trim().length >= 2 && open.length > 0} />
    </form>
  );
}

function PriceQ({ nav, draft }: { nav: Nav; draft: ServiceDraft }) {
  const money = useMoney();
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const offered = useOffered();
  const [price, setPrice] = useState('');
  const [deposit, setDeposit] = useState(20);
  const [problem, setProblem] = useState<string | null>(null);
  const open = (locations.data ?? []).filter((l) => l.isActive);
  const priceMinor = money.toMinor(price.replace(/[, ]/g, ''));
  const priced = Number.isFinite(priceMinor) && priceMinor > 0;
  const depositMinor = priced ? Math.round((priceMinor * deposit) / 100) : 0;

  const create = useMutation({
    mutationFn: () =>
      createService({
        name: draft.name,
        durationMinutes: draft.duration,
        depositPercentage: deposit,
        offers: open.map((l) => ({ locationId: l.id, priceMinor })),
      }),
    onSuccess: () => nav.saved(),
    onError: (error) => setProblem(said(error, 'That service did not save.')),
  });

  if (offered.length > 0) return <OfferedHave nav={nav} screen="price" />;

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (priced && draft.name && open.length) create.mutate();
      }}
    >
      <QHead
        screen="price"
        title={draft.name ? `How much is ${draft.name.toLowerCase()}?` : 'How much is it?'}
        lead="Customers pay a small part when they book, the rest at your shop."
      />
      <Body>
        {!draft.name ? (
          <p className="wz-note is-warn">
            <Icon name="alert" size={15} /> Name the service first.{' '}
            <button type="button" className="wz-inline" onClick={() => nav.go('service')}>
              Name it
            </button>
          </p>
        ) : (
          <>
            <label className="wz-money is-big">
              <b>{money.code || 'RWF'}</b>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="5,000" aria-label="Price" autoFocus />
              <em>{durationWords(draft.duration)}</em>
            </label>
            <div className="wz-field">
              <span className="wz-label">Deposit to book</span>
              <div className="wz-chips">
                {DEPOSITS.map((d) => (
                  <button key={d} type="button" className={d === deposit ? 'is-on' : ''} onClick={() => setDeposit(d)}>
                    {d}%
                  </button>
                ))}
              </div>
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
          </>
        )}
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={create.isPending} ready={priced && Boolean(draft.name) && open.length > 0} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Getting paid (optional)

function PaidQ({ nav }: { nav: Nav }) {
  const current = useQuery({ queryKey: ['payout-destination'], queryFn: getPayoutDestination });
  const [msisdn, setMsisdn] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const network = networkOf(msisdn);
  const digits = msisdn.replace(/\D/g, '');

  const save = useMutation({
    mutationFn: () => submitPayoutDestination(msisdn.trim()),
    onSuccess: () => nav.saved(),
    onError: (error) => setProblem(said(error, 'That number did not save.')),
  });

  const have = current.data?.destination ?? null;
  if (have && have.status !== 'REJECTED') {
    return (
      <form
        className="wz-step"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          nav.next();
        }}
      >
        <QHead screen="paid" title="Where should we send your money?" lead="Your share of every deposit goes to this number." />
        <Body>
          <Have
            icon={<NetworkMark network={have.provider} size={40} />}
            title={`${NETWORK_NAME[have.provider]} · •••• ${(have.msisdn ?? have.msisdnLast3 ?? '').slice(-3)}`}
            text={have.status === 'VERIFIED' ? 'Checked — payouts go here' : 'Waiting to be checked by our team'}
          />
        </Body>
        <Foot nav={nav} label="Continue" noSkip />
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
      <QHead
        screen="paid"
        optional
        title="Where should we send your money?"
        lead="Your shop can go live without it — you are paid once it is added and checked."
      />
      <Body>
        <span className={`wz-msisdn is-big${network ? ' is-known' : ''}`}>
          {network ? (
            <NetworkMark network={network} size={36} />
          ) : (
            <span className="wz-msisdn-blank">
              <Icon name="phone" size={18} />
            </span>
          )}
          <input value={msisdn} onChange={(e) => setMsisdn(e.target.value)} inputMode="tel" placeholder="MoMo or Airtel number" maxLength={20} aria-label="Mobile money number" autoFocus />
          {network && <em>{NETWORK_NAME[network]}</em>}
        </span>
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
        <p className="wz-quiet">In the shop’s or the owner’s name. Our team checks it before the first payout.</p>
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={save.isPending} ready={digits.length >= 9} skipLabel="Add it later" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Send for review

function ReviewQ({ nav, readiness, email }: { nav: Nav; readiness: Readiness | undefined; email: string }) {
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
        <Body>
          <div className="skeleton wz-skel" />
        </Body>
      </div>
    );
  }

  const waiting = readiness.status === 'PENDING' && readiness.submittedAt !== null;
  if (sent || waiting) {
    return (
      <div className="wz-step is-sent">
        <Body>
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
        </Body>
        <div className="wz-foot is-center">
          <div className="wz-col">
            <button type="button" className="primary wz-go" onClick={() => navigate('/', { replace: true })}>
              Go to my dashboard <Icon name="arrowRight" size={17} stroke={2.4} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const rejected = readiness.status === 'REJECTED';
  const required = readiness.items.filter((i) => i.required);
  const missing = required.filter((i) => !i.done);
  const later = readiness.items.filter((i) => !i.required);
  const tile = (i: Readiness['items'][number]) => (
    <button key={i.key} type="button" className={`wz-ready${i.done ? ' is-done' : ''}`} onClick={() => nav.go(ITEM_WORDS[i.key].step)} disabled={i.done}>
      <span className="wz-ready-icon">{i.done ? <DrawnCheck size={14} stroke={3.2} /> : <StepGlyph name={ITEM_WORDS[i.key].section} size={17} />}</span>
      <span>{ITEM_WORDS[i.key].label}</span>
      {!i.done && (
        <em>
          Add <Icon name="arrowRight" size={13} stroke={2.4} />
        </em>
      )}
    </button>
  );

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (readiness.canSubmit) submit.mutate();
      }}
    >
      <QHead
        screen="review"
        title={rejected ? 'Send your shop back for review' : missing.length ? 'Almost there' : 'Ready to go live'}
        lead={
          rejected
            ? 'Fix what we asked, then send it back. Everything you set up is still here.'
            : missing.length
              ? `${missing.length} ${missing.length === 1 ? 'thing is' : 'things are'} still needed before we can review your shop.`
              : 'We check every shop before customers can book it. Send yours now — it only takes a moment.'
        }
      />
      <Body>
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
          <div className="wz-ready-grid">{required.map(tile)}</div>
        </div>
        <div className="wz-field">
          <span className="wz-label">Nice to have — add whenever you like</span>
          <div className="wz-ready-grid is-optional">{later.map(tile)}</div>
        </div>
        <Problem text={submit.error ? said(submit.error, 'That did not send. Check your connection and try again.') : null} />
      </Body>
      <div className="wz-foot">
        <div className="wz-col">
          <div>
            {nav.back && (
              <button type="button" className="wz-back" onClick={nav.back}>
                <Icon name="chevronLeft" size={17} stroke={2.2} /> Back
              </button>
            )}
          </div>
          <div>
            <button type="submit" className="primary wz-go" disabled={!readiness.canSubmit || submit.isPending}>
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
    </form>
  );
}
