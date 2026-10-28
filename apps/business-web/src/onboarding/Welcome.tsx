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
  listDocuments,
  listLocations,
  listServices,
  setHours,
  setProfileImage,
  submitForReview,
  submitPayoutDestination,
  updateProfile,
  setKinds,
  MAX_KIND_CATEGORIES,
  OTHER,
  kindName,
  type DocumentKind,
  type FoundAddress,
  type Readiness,
} from '../api/business';
import { AuthWall } from '../auth/AuthWall';
import { AddressField, useDistrictFrom } from '../components/AddressField';
import { DistrictField, PlaceField, parseCoordinates } from '../components/NewBranchForm';
import { ImageButton } from '../components/ImageButton';
import { DropZone } from '../ui/DropZone';
import { PaperSlot } from '../papers/PaperSlot';
import { PAPER_WORDS, REGISTRATION_KINDS } from '../papers/words';
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
import { accessOf } from '../access';
import './welcome.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dayName, listOf, formatDate } from '../i18n/format';
import { plural } from '@lingui/core/macro';

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
  // The kinds of shop chosen, in order (the first is the main one), until their types are saved with them.
  const [kindDraft, setKindDraft] = useState<string[] | null>(null);
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
        ['readiness', 'profile', 'locations', 'services', 'payout-destination', 'documents', 'me'].map((key) =>
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
  // Named, so the meter reads as one sentence to a translator (§308).
  const total = required.length || 6;
  const percent = Math.round(share * 100);
  const access = accessOf(me.data?.businessMembership, me.isSuccess);
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
            <b><Trans>Bwangu<i>Reservations</i></Trans>
            </b>
            <small><Trans>For businesses</Trans></small>
          </span>
        </span>
        <button type="button" className="wz-later" onClick={finishLater}>
          <Trans>Finish later</Trans>
        <Icon name="close" size={15} stroke={2.2} />
        </button>
      </header>

      <Floats />

      <div className="wz-frame">
        <div className="wz-panel" role="dialog" aria-modal="true" aria-labelledby="wz-title">
          <aside className="wz-rail">
            <div className="wz-rail-head">
              <span className="wz-kicker"><Trans>Setting up</Trans></span>
              <h2 title={shopName ?? undefined}>{shopName ?? t`Your shop`}</h2>
              <p><Trans>About five minutes. Skip anything you do not have to hand — it waits on your Overview.</Trans></p>
            </div>

            <div className="wz-meter" aria-label={t`${doneCount} of ${required.length} required things done`}>
              <div className="wz-meter-top">
                <Trans>
                  <strong>
                    {doneCount} of {total}
                  </strong>{' '}
                  done <span>{percent}%</span>
                </Trans>
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
                        <em>{done ? t`Done` : s.short}</em>
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
                  <strong><Trans>Need a hand?</Trans></strong>
                  <em><Trans>We can set it up with you.</Trans></em>
                </span>
                <Link to="/help"><Trans>Talk to us</Trans></Link>
              </div>
              <p className="wz-lock">
                <Icon name="lock" size={14} />{' '}
                <Trans>Customers see nothing until we approve your shop and you post it.</Trans>
              </p>
            </div>
          </aside>

          <main className={`wz-main is-${dir}`}>
            <button type="button" className="wz-x" onClick={finishLater} aria-label={t`Finish later`} title={t`Finish later`}>
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

            {!access.runsBusiness ? (
              <div className="wz-stage">
                <div className="wz-step">
                  <header className="wz-head">
                    <div className="wz-col">
                      <h1 id="wz-title"><Trans>Only the owner can set up the shop</Trans></h1>
                      <p className="wz-lead">
                        <Trans>
                          Or a manager who looks after every branch. Ask them to finish setting it up — you can still
                          look around.
                        </Trans>
                      </p>
                    </div>
                  </header>
                  <div className="wz-scroll" />
                  <div className="wz-foot">
                    <div className="wz-col">
                      <span />
                      <button type="button" className="primary wz-go" onClick={finishLater}><Trans>Go to the dashboard </Trans><Icon name="arrowRight" size={17} stroke={2.4} />
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
                {screen === 'papers' && <PapersQ nav={nav} readiness={readiness.data} />}
                {screen === 'review' && <ReviewQ nav={nav} readiness={readiness.data} email={me.data?.email ?? ''} />}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * What is ahead, drifting beside the panel on a wide screen. Said as what the
 * shop WILL get, never as a notice — a "Deposit paid" beside a shop that has
 * no name yet reads as somebody else's money, or a mistake.
 */
function Floats() {
  return (
    <div className="wz-floats" aria-hidden="true">
      <span className="wz-float f1">
        <NetworkMark network="MTN_MOMO" size={36} />
        <span>
          <strong><Trans>Deposits by MoMo</Trans></strong>
          <em><Trans>Paid when they book</Trans></em>
        </span>
      </span>
      <span className="wz-float f2">
        <span className="wz-float-icon">
          <Icon name="calendarCheck" size={19} />
        </span>
        <span>
          <strong><Trans>Bookings land here</Trans></strong>
          <em><Trans>Once your shop is posted</Trans></em>
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
            {section === 'review' ? t`Last step` : part.title}
            {questions.length > 1 && <em>{t` · ${n} of ${questions.length}`}</em>}
            {optional && <i><Trans>Optional</Trans></i>}
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
  label = t`Next`,
  nav,
  skipLabel = t`Skip for now`,
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
              <Icon name="chevronLeft" size={17} stroke={2.2} />{' '}
              <Trans>Back</Trans>
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
                <Trans><span className="wz-spin" aria-hidden="true" />Saving…</Trans>
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

/** A category's types in a few words — the named ones, not "Other". */
const describe = (all: string[]) => {
  const names = all.filter((n) => n !== 'Other');
  const firstThree = names.slice(0, 3).join(', ');
  return names.length > 3 ? t`${firstThree} and more` : names.join(', ');
};

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
    onError: (error) => setProblem(said(error, t`That did not save. Check your connection and try again.`)),
  });
  const ready = name.trim().length >= 2;
  const main = profile.data?.kinds[0];
  const kind = main ? `${main.category.name} · ${kindName(main)}` : profile.data?.subcategory ? `${profile.data.category?.name} · ${profile.data.subcategory.name}` : null;

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
      <QHead screen="name" title={t`What’s your shop called?`} lead={t`The name customers see when they find you — the one on your sign is best.`} />
      <Body>
        <BigInput icon="store" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t`e.g. Kigali Barbers`} aria-label={t`Shop name`} autoFocus />
        <div className="wz-preview" aria-label={t`How customers will see you`}>
          <span className="wz-preview-tag">
            <Icon name="eye" size={13} />{' '}
            <Trans>How customers see you</Trans>
          </span>
          {name.trim() || profile.data?.logoUrl ? (
            <ShopLogo logoUrl={profile.data?.logoUrl ?? null} name={name.trim() || t`Shop`} size={56} />
          ) : (
            <span className="wz-logo-blank">
              <StepGlyph name="shop" size={26} />
            </span>
          )}
          <span className="wz-preview-text">
            <strong>{name.trim() || t`Your shop’s name`}</strong>
            <em>{kind ?? t`Barbers, salons, spas, garages and more`}</em>
          </span>
        </div>
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={save.isPending} ready={ready} />
    </form>
  );
}

/** The categories a profile already lists, in order, main first. */
const savedCategories = (profile: { kinds: Array<{ category: { id: string } }>; category: { id: string } | null } | undefined) => {
  if (!profile) return [];
  const ids = profile.kinds.map((k) => k.category.id);
  if (ids.length === 0 && profile.category) ids.push(profile.category.id);
  return [...new Set(ids)];
};

function KindQ({ nav, draft, onDraft }: { nav: Nav; draft: string[] | null; onDraft: (ids: string[]) => void }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories, staleTime: 10 * 60_000 });
  const [picked, setPicked] = useState<string[] | null>(draft);
  // Chosen in order: the first is the main kind (§265).
  const chosen = picked ?? savedCategories(profile.data);
  const full = chosen.length >= MAX_KIND_CATEGORIES;
  const toggle = (id: string) =>
    setPicked(chosen.includes(id) ? chosen.filter((c) => c !== id) : full ? chosen : [...chosen, id]);

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (chosen.length === 0) return;
        onDraft(chosen);
        nav.next();
      }}
    >
      <QHead
        screen="kind"
        title={t`What kind of shop is it?`}
        lead={t`Choose all that fit, up to four — a shop with a salon at one branch and a spa at another is both. The first you choose is your main one.`}
      />
      <Body>
        <div className="wz-kinds" role="group" aria-label={t`What kind of shop`}>
          {(categories.data ?? []).map((c, i) => {
            const at = chosen.indexOf(c.id);
            const on = at >= 0;
            return (
              <button
                key={c.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                className={`wz-kind${on ? ' is-on' : ''}${!on && full ? ' is-full' : ''}`}
                onClick={() => toggle(c.id)}
                title={!on && full ? t`Up to ${MAX_KIND_CATEGORIES} kinds — take one off first` : undefined}
              >
                {at === 0 ? (
                  <span className="wz-kind-main"><Trans>Main</Trans></span>
                ) : (
                  <span className="wz-kind-tick" aria-hidden="true">
                    <DrawnCheck size={12} stroke={3.4} />
                  </span>
                )}
                <strong>{c.name}</strong>
                <em>{describe(c.subcategories.map((s) => s.name))}</em>
                <LineArt icon={c.icon} delay={120 + i * 70} />
              </button>
            );
          })}
          {categories.isLoading && [0, 1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} className="skeleton wz-kind-skel" />)}
        </div>
        <p className="wz-quiet wz-kind-count" aria-live="polite">
          {chosen.length === 0
            ? t`Nothing chosen yet.`
            : full
              ? t`${chosen.length} of up to ${MAX_KIND_CATEGORIES} chosen — take one off to choose another.`
              : t`${chosen.length} of up to ${MAX_KIND_CATEGORIES} chosen.`}
        </p>
      </Body>
      <Foot nav={nav} ready={chosen.length > 0} />
    </form>
  );
}

function TypeQ({ nav, draft }: { nav: Nav; draft: string[] | null }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories, staleTime: 10 * 60_000 });
  const [order, setOrder] = useState<string[] | null>(draft);
  const categoryIds = order ?? savedCategories(profile.data);
  const groups = categoryIds
    .map((id) => categories.data?.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  // The types chosen, in the order they were chosen; seeded from what is saved.
  const saved = (profile.data?.kinds ?? []).map((k) => k.subcategory.id);
  const [picked, setPicked] = useState<string[] | null>(null);
  const types = picked ?? (saved.length ? saved : profile.data?.subcategory ? [profile.data.subcategory.id] : []);
  // What the shop writes for an "Other" it ticks (§267), seeded from what is saved.
  const savedLabels = Object.fromEntries((profile.data?.kinds ?? []).filter((k) => k.otherLabel).map((k) => [k.subcategory.id, k.otherLabel!]));
  const [typed, setTyped] = useState<Record<string, string> | null>(null);
  const labels = typed ?? savedLabels;
  const [problem, setProblem] = useState<string | null>(null);

  const typesIn = (categoryId: string) => {
    const group = groups.find((g) => g.id === categoryId);
    return types.filter((t) => group?.subcategories.some((s) => s.id === t));
  };
  const empty = groups.filter((g) => typesIn(g.id).length === 0);
  // Saved as: the main category's types first, then each other category's, in the order chosen.
  const ordered = groups.flatMap((g) => typesIn(g.id));
  const others = groups.flatMap((g) => g.subcategories.filter((s) => s.name === OTHER && types.includes(s.id)));
  const unlabelled = others.filter((o) => (labels[o.id] ?? '').trim().length < 2);
  const otherLabels = others.map((o) => ({ subcategoryId: o.id, label: (labels[o.id] ?? '').trim() }));
  const unchanged =
    ordered.length === saved.length &&
    ordered.every((t, i) => t === saved[i]) &&
    otherLabels.every((o) => o.label === (savedLabels[o.subcategoryId] ?? ''));

  const save = useMutation({
    mutationFn: () => setKinds(ordered, otherLabels),
    onSuccess: () => nav.saved(),
    onError: (error) => setProblem(said(error, t`That did not save. Check your connection and try again.`)),
  });
  const toggle = (id: string) => setPicked(types.includes(id) ? types.filter((t) => t !== id) : [...types, id]);

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        setProblem(null);
        if (groups.length === 0 || empty.length > 0 || unlabelled.length > 0) return;
        if (unchanged) nav.next();
        else save.mutate();
      }}
    >
      <QHead
        screen="type"
        title={groups.length > 1 ? t`Which describe it best?` : t`Which describes it best?`}
        lead={groups.length > 1 ? t`Choose at least one in each. You can choose more than one.` : t`Choose all that apply.`}
      />
      <Body>
        {groups.length === 0 && (
          <p className="wz-note is-warn">
            <Icon name="alert" size={15} /><Trans>Choose what kind of shop it is first.{' '}</Trans>
            <button type="button" className="wz-inline" onClick={() => nav.go('kind')}>
              <Trans>Choose it</Trans>
            </button>
          </p>
        )}
        {groups.map((group, g) => (
          <section key={group.id} className="wz-group">
            <div className="wz-chosen">
              <LineArt icon={group.icon} />
              <span>
                <em>{g === 0 ? t`Main kind` : t`Also`}</em>
                <strong>{group.name}</strong>
              </span>
              {g === 0 ? (
                <button type="button" className="wz-link" onClick={() => nav.go('kind')}>
                  <Trans>Change</Trans>
                </button>
              ) : (
                <button type="button" className="wz-link" onClick={() => setOrder([group.id, ...categoryIds.filter((c) => c !== group.id)])}>
                  <Trans>Make it the main one</Trans>
                </button>
              )}
            </div>
            <div className="wz-options" role="group" aria-label={t`Types of ${group.name}`}>
              {group.subcategories.map((s, i) => {
                const on = types.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`wz-option${on ? ' is-on' : ''}`}
                    style={{ animationDelay: `${i * 40}ms` }}
                    onClick={() => toggle(s.id)}
                  >
                    <span className="wz-box" aria-hidden="true">
                      {on && <DrawnCheck size={12} stroke={3.4} />}
                    </span>
                    {s.name}
                  </button>
                );
              })}
            </div>
            {/* "Other": what it is, in a few words, shown to customers in its place (§267). */}
            {group.subcategories
              .filter((s) => s.name === OTHER && types.includes(s.id))
              .map((s) => (
                <label key={s.id} className="wz-field wz-writein">
                  <span className="wz-label"><Trans>What kind exactly?</Trans></span>
                  <BigInput
                    icon="pencil"
                    value={labels[s.id] ?? ''}
                    onChange={(e) => setTyped({ ...labels, [s.id]: e.target.value })}
                    maxLength={40}
                    placeholder={WRITE_IN_EXAMPLES[group.icon ?? ''] ?? t`In a few words`}
                    autoFocus
                  />
                  <em><Trans>Customers see this instead of “Other”. Our team checks it with the rest of your shop.</Trans></em>
                </label>
              ))}
          </section>
        ))}
        {groups.length > 1 && empty.length > 0 && (
          <p className="wz-quiet"><Trans>Still to choose: one in {empty.map((g) => g.name).join(' and ')}.</Trans></p>
        )}
        {unlabelled.length > 0 && empty.length === 0 && <p className="wz-quiet"><Trans>Say what kind it is, under “Other”.</Trans></p>}
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={save.isPending} ready={groups.length > 0 && empty.length === 0 && unlabelled.length === 0} />
    </form>
  );
}

/** What a write-in under each category's "Other" might be, as a hint (§267). */
const WRITE_IN_EXAMPLES: Record<string, string> = {
  get sparkles() { return t`e.g. Henna artist`; },
  get 'heart-pulse'() { return t`e.g. Reflexology`; },
  get stethoscope() { return t`e.g. Hearing tests`; },
  get dumbbell() { return t`e.g. Climbing wall`; },
  get utensils() { return t`e.g. Cooking at your table`; },
  get ticket() { return t`e.g. Poetry nights`; },
  get people() { return t`e.g. Chess club`; },
  get mountain() { return t`e.g. Coffee farm visit`; },
  get bed() { return t`e.g. Camping`; },
  get briefcase() { return t`e.g. CV writing`; },
  get car() { return t`e.g. Car hire`; },
  get shirt() { return t`e.g. Beading`; },
  get 'home-tools'() { return t`e.g. Solar panel fitting`; },
  get paw() { return t`e.g. Pet photography`; },
  get camera() { return t`e.g. Drone filming`; },
  get 'calendar-star'() { return t`e.g. Photo booth hire`; },
};

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
    onError: (error) => setProblem(said(error, t`That picture did not upload. Try a JPG or PNG under 5 MB.`)),
  });
  const save = useMutation({
    mutationFn: () => updateProfile({ phone: phone.trim() }),
    onSuccess: () => nav.saved(),
    onError: (error) => setProblem(said(error, t`That did not save. Check your connection and try again.`)),
  });
  const ready = phone.replace(/\D/g, '').length >= 9;
  const name = profile.data?.name ?? t`Shop`;

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
      <QHead screen="contact" title={t`How can customers reach you?`} lead={t`A number customers can call. We may call it too, to check your shop before it goes live.`} />
      <Body>
        <BigInput icon="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={30} placeholder="+250 788 123 456" aria-label={t`Phone number`} autoFocus />
        <div className="wz-sep">
          <span><Trans>And if you have one</Trans></span>
        </div>
        <DropZone
          onFiles={([file]) => logo.mutate(file)}
          disabled={logo.isPending}
          hint={profile.data?.logoUrl ? t`Drop to make it your new logo` : t`Drop to make it your logo`}
        >
        <div className="wz-logo">
          {profile.data?.logoUrl ? (
            <ShopLogo logoUrl={profile.data.logoUrl} name={name} size={52} />
          ) : (
            <span className="wz-logo-drop">
              <Icon name="image" size={22} />
            </span>
          )}
          <span className="wz-logo-text">
            <strong>{profile.data?.logoUrl ? t`Your logo` : t`Add your logo`}</strong>
            <em>{profile.data?.logoUrl ? t`It shows on every card customers see.` : t`Optional · square works best · JPG, PNG or WebP`}</em>
          </span>
          <ImageButton id="wz-logo" label={profile.data?.logoUrl ? t`Change` : t`Upload`} busy={logo.isPending} onPick={(file) => file && logo.mutate(file)} />
        </div>
        </DropZone>
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
        <QHead screen="address" title={t`Where is your shop?`} lead={t`Your branch is on the map.`} />
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
            <Icon name="info" size={15} />{' '}
            <Trans>More branches and photos are in <b>Branches &amp; hours</b>, whenever you want them.</Trans>
          </p>
        </Body>
        <Foot nav={nav} label={t`Continue`} noSkip />
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
      <QHead screen="address" title={t`Where is your shop?`} lead={t`Start typing the address and pick it from the list — we put you on the map.`} />
      <Body>
        <div className="wz-address bf">
          <AddressField id="wz-address" value={address} onChange={setAddress} onPick={onPick} placeholder={t`e.g. KG 11 Ave, Kimironko`} />
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
                <strong><Trans>On the map</Trans></strong>
                <em><Trans>Customers nearby will find you here.</Trans></em>
              </span>
              <button type="button" className="wz-link" onClick={() => setManual((v) => !v)}>
                {manual ? t`Done` : t`Move the pin`}
              </button>
            </div>
          </div>
        )}

        {(manual || !pinned) && (
          <div className={`wz-manual bf${manual ? ' is-open' : ''}`}>
            {manual ? (
              <PlaceField value={place} onChange={setPlace} onProblem={setProblem} hint={t`Paste your Google Maps link, or use your position if you are at the shop now.`} />
            ) : (
              <button type="button" className="wz-link" onClick={() => setManual(true)}>
                <Icon name="pin" size={15} />{' '}
                <Trans>Can’t find it? Paste a map link or use where you are</Trans>
              </button>
            )}
          </div>
        )}

        {(pinned || districtId) && (
          <div className="wz-field bf">
            <DistrictField value={districtId} onChange={setDistrictId} hint={t`Customers search by area, so this is how they find you.`} />
          </div>
        )}

        <div className="wz-field">
          {renaming ? (
            <>
              <span className="wz-label"><Trans>Branch name</Trans></span>
              <BigInput icon="store" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t`Kigali Barbers — Kimironko`} autoFocus />
            </>
          ) : (
            <p className="wz-quiet"><Trans>Shown to customers as </Trans><b>{branchName || t`your shop’s name`}</b>.{' '}
              <button
                type="button"
                className="wz-link"
                onClick={() => {
                  setName(branchName);
                  setRenaming(true);
                }}
              >
                <Trans>Rename</Trans>
              </button>
            </p>
          )}
        </div>

        {active.length > 0 && (
          <p className="wz-note">
            <Icon name="info" size={15} />
            <Trans>
              Your branch “{active[0].name}” has no map pin or district yet. Add them in{' '}
              <Link to="/hours">Branches &amp; hours</Link>, or add the address here.
            </Trans>
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
/** Day names in the app's language (§308), Sunday first. */
const DAY_SHORT = () => [0, 1, 2, 3, 4, 5, 6].map((day) => dayName(day, 'short'));
const DAY_LONG = () => [0, 1, 2, 3, 4, 5, 6].map((day) => dayName(day));
const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d));

/** "Monday to Saturday", "Every day", "Mon, Wed and Fri". */
function daysInWords(days: number[]) {
  const preset = HOURS_PRESETS.find((p) => sameDays(p.days, days));
  if (preset) return preset.label;
  const ordered = DAY_ORDER.filter((d) => days.includes(d));
  if (ordered.length === 0) return t`No days chosen`;
  const run = DAY_ORDER.indexOf(ordered[ordered.length - 1]) - DAY_ORDER.indexOf(ordered[0]) + 1 === ordered.length;
  if (run && ordered.length > 2) {
    const first = DAY_LONG()[ordered[0]];
    const last = DAY_LONG()[ordered[ordered.length - 1]];
    return t`${first} to ${last}`;
  }
  const names = ordered.map((d) => DAY_SHORT()[d]);
  return names.length === 1 ? DAY_LONG()[ordered[0]] : listOf(names);
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
    onError: (error) => setProblem(said(error, t`Those hours did not save.`)),
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
      <QHead screen="hours" title={t`When are you open?`} lead={hasHours ? t`Your opening hours are set.` : t`Pick your usual week. Lunch breaks and odd days can be set later.`} />
      <Body>
        {!branch ? (
          <p className="wz-note is-warn">
            <Icon name="alert" size={15} /><Trans>Hours belong to a branch, so add your address first.{' '}</Trans>
            <button type="button" className="wz-inline" onClick={() => nav.go('address')}>
              <Trans>Add the address</Trans>
            </button>
          </p>
        ) : hasHours ? (
          <Have
            icon={<StepGlyph name="clock" size={22} />}
            title={t`Opening hours are set`}
            text={t`Open ${branch.hours.filter((h) => !h.isClosed).length} days a week — change them any time in Branches & hours`}
          />
        ) : (
          <>
            <div className="wz-presets" role="radiogroup" aria-label={t`Common weeks`}>
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
              <div className="wz-week" role="group" aria-label={t`Open on`}>
                {DAY_ORDER.map((d) => {
                  const on = week.days.includes(d);
                  return (
                    <button key={d} type="button" aria-pressed={on} className={on ? 'is-on' : ''} onClick={() => toggle(d)} title={DAY_LONG()[d]}>
                      {DAY_SHORT()[d]}
                    </button>
                  );
                })}
              </div>
              <div className="wz-times">
                <label>
                  <span><Trans>Opens</Trans></span>
                  <input type="time" value={week.open} onChange={(e) => setWeek({ ...week, open: e.target.value })} />
                </label>
                <span className="wz-times-to" aria-hidden="true">
                  <Icon name="arrowRight" size={16} />
                </span>
                <label>
                  <span><Trans>Closes</Trans></span>
                  <input type="time" value={week.close} onChange={(e) => setWeek({ ...week, close: e.target.value })} />
                </label>
              </div>
              <p className="wz-hours-sum">
                <StepGlyph name="clock" size={17} />
                {week.days.length ? (
                  <span><Trans>Open <b>{daysInWords(week.days)}</b>, {week.open}–{week.close}</Trans>
                  </span>
                ) : (
                  <span><Trans>Choose the days you open.</Trans></span>
                )}
              </p>
            </div>
          </>
        )}
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={save.isPending} ready={hasHours || (Boolean(branch) && ready)} label={hasHours ? t`Continue` : t`Next`} noSkip={hasHours} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Your first service: what it is, then what it costs

const DURATIONS = [15, 30, 45, 60, 90, 120];
const DEPOSITS = [20, 30, 50];
const durationWords = (d: number) => {
  const hours = Math.floor(d / 60);
  const minutes = d % 60;
  return d < 60 ? t`${d} min` : minutes === 0 ? t`${hours} h` : t`${hours} h ${minutes}`;
};

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
      <QHead screen={screen} title={t`What customers can book`} lead={plural(offered.length, { one: 'You have # service ready to book.', other: 'You have # services ready to book.' })} />
      <Body>
        <Have
          icon={<StepGlyph name="service" size={22} />}
          title={first.name}
          text={t`${money.format(Math.min(...first.locations.map((o) => o.priceMinor)))} · ${first.durationMinutes} min · ${Number(first.depositPercentage)}% deposit`}
        />
        <p className="wz-note">
          <Icon name="info" size={15} />{' '}
          <Trans>Add more, with photos and descriptions, in <b>Services</b> whenever you like.</Trans>
        </p>
      </Body>
      <Foot nav={nav} label={t`Continue`} noSkip />
    </form>
  );
}

/**
 * A few things a shop of this type is booked for, one press each (§256, §266) —
 * in the seller's language, since the one pressed becomes their service's name.
 */
const EXAMPLES = (): Array<[RegExp, string[]]> => [
  [/barber/, [t`Haircut`, t`Beard trim`, t`Haircut and beard`]],
  [/braid|locs/, [t`Box braids`, t`Locs retwist`, t`Cornrows`]],
  [/^hair$|hair salon/, [t`Wash and blow-dry`, t`Braids`, t`Relaxer`]],
  [/nail/, [t`Manicure`, t`Pedicure`, t`Gel nails`]],
  [/lash|brow/, [t`Lash extensions`, t`Brow shaping`, t`Lash lift`]],
  [/make-?up/, [t`Bridal make-up`, t`Evening make-up`, t`Make-up lesson`]],
  [/facial|skin/, [t`Classic facial`, t`Deep-cleanse facial`, t`Body scrub`]],
  [/massage|spa|sauna/, [t`Full-body massage`, t`Back massage`, t`Steam room`]],
  [/tattoo|piercing/, [t`Small tattoo`, t`Ear piercing`, t`Consultation`]],
  [/dine-in|private dining/, [t`Table for two`, t`Table for four`, t`Private room for ten`]],
  [/pick-up/, [t`Lunch to collect`, t`Dinner to collect`, t`Breakfast to collect`]],
  [/movie/, [t`Standard ticket`, t`VIP seat`, t`Seat for two`]],
  [/concert|theatre|show|comedy|festival|sporting|exhibit/, [t`General admission`, t`VIP ticket`, t`Group of four`]],
  [/gym/, [t`Day pass`, t`Gym session`, t`Fitness assessment`]],
  [/pitch|court/, [t`Pitch for one hour`, t`Evening slot`, t`Weekend slot`]],
  [/swim/, [t`Swim session`, t`Swimming lesson`, t`Kids’ lesson`]],
  [/martial|dance|pilates/, [t`Drop-in class`, t`Private lesson`, t`Beginners’ class`]],
  [/personal training/, [t`One-hour session`, t`Fitness assessment`, t`Partner session`]],
  [/tutor|educational/, [t`One-hour lesson`, t`Exam revision`, t`Group lesson`]],
  [/coach|consult/, [t`First consultation`, t`One-hour session`, t`Follow-up`]],
  [/dental/, [t`Check-up and clean`, t`Filling`, t`Whitening`]],
  [/eye/, [t`Eye test`, t`Contact lens fitting`, t`Glasses fitting`]],
  [/clinic|dermatolog|specialist/, [t`Consultation`, t`Follow-up visit`, t`Check-up`]],
  [/lab|vaccin/, [t`Blood test`, t`Vaccination`, t`Health check`]],
  [/yoga|meditation/, [t`Yoga class`, t`Meditation session`, t`Private class`]],
  [/therapy|nutrition|acupuncture|chiropractic|physio/, [t`First session`, t`Follow-up session`, t`Assessment`]],
  [/hotel|guesthouse|apartment/, [t`One night, double room`, t`One night, single room`, t`Weekend stay`]],
  [/day pass|pool/, [t`Pool day pass`, t`Spa and pool day`, t`Family day pass`]],
  [/meeting|conference/, [t`Meeting room, half day`, t`Meeting room, full day`, t`Conference hall`]],
  [/gorilla|wildlife/, [t`Gorilla trekking`, t`Golden monkey trek`, t`Chimpanzee trek`]],
  [/safari/, [t`Full-day safari`, t`Half-day game drive`, t`Boat safari`]],
  [/tour|hik|boat|adventure/, [t`Kigali city tour`, t`Guided hike`, t`Lake boat trip`]],
  [/tailor|clothing|fitting/, [t`Trouser alterations`, t`Dress fitting`, t`Suit made to measure`]],
  [/shoe/, [t`Shoe repair`, t`Shoe shine`, t`Heel replacement`]],
  [/laundry|dry clean/, [t`Wash and fold`, t`Dry cleaning`, t`Ironing`]],
  [/driving/, [t`Driving lesson`, t`Test preparation`, t`Refresher lesson`]],
  [/car|tyre|vehicle|auto/, [t`Car wash`, t`Oil change`, t`Wheel balancing`]],
  [/photo|video|studio/, [t`Portrait session`, t`Event coverage`, t`Studio hour`]],
  [/groom|dog|pet|vet/, [t`Dog grooming`, t`Nail clipping`, t`Check-up`]],
  [/clean/, [t`Home cleaning`, t`Deep clean`, t`Office cleaning`]],
];
const examplesFor = (type: string | null | undefined) => {
  const name = type?.toLowerCase() ?? '';
  return EXAMPLES().find(([match]) => match.test(name))?.[1] ?? [];
};

function ServiceQ({ nav, draft, onDraft }: { nav: Nav; draft: ServiceDraft; onDraft: (d: ServiceDraft) => void }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const offered = useOffered();
  const [name, setName] = useState(draft.name);
  const [duration, setDuration] = useState(draft.duration);
  const open = (locations.data ?? []).filter((l) => l.isActive);

  const examples = useMemo(() => examplesFor(profile.data?.subcategory?.name), [profile.data?.subcategory?.name]);

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
      <QHead screen="service" title={t`What can customers book first?`} lead={t`Just one to start. You can add the rest later, with photos.`} />
      <Body>
        {open.length === 0 && (
          <p className="wz-note is-warn">
            <Icon name="alert" size={15} /><Trans>A service is offered at a branch, so add your address first.{' '}</Trans>
            <button type="button" className="wz-inline" onClick={() => nav.go('address')}>
              <Trans>Add the address</Trans>
            </button>
          </p>
        )}
        <div className="wz-field">
          <BigInput icon="tag" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t`e.g. ${examples[0] ?? 'Haircut'}`} aria-label={t`Service name`} autoFocus />
          {examples.length > 0 && (
            <div className="wz-examples">
              <span><Trans>Try</Trans></span>
              {examples.map((e) => (
                <button key={e} type="button" className={e === name ? 'is-on' : ''} onClick={() => setName(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="wz-field">
          <span className="wz-label"><Trans>How long does it take?</Trans></span>
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
    onError: (error) => setProblem(said(error, t`That service did not save.`)),
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
        title={draft.name ? t`How much is ${draft.name.toLowerCase()}?` : t`How much is it?`}
        lead={t`Customers pay a small part when they book, the rest at your shop.`}
      />
      <Body>
        {!draft.name ? (
          <p className="wz-note is-warn">
            <Icon name="alert" size={15} /><Trans>Name the service first.{' '}</Trans>
            <button type="button" className="wz-inline" onClick={() => nav.go('service')}>
              <Trans>Name it</Trans>
            </button>
          </p>
        ) : (
          <>
            <label className="wz-money is-big">
              <b>{money.code || t`RWF`}</b>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="5,000" aria-label={t`Price`} autoFocus />
              <em>{durationWords(draft.duration)}</em>
            </label>
            <div className="wz-field">
              <span className="wz-label"><Trans>Deposit to book</Trans></span>
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
                    <Trans><b className="is-now" />On their phone, to book</Trans>
                    <strong>{priced ? money.format(depositMinor) : `${deposit}%`}</strong>
                  </span>
                  <span>
                    <Trans><b />At your shop</Trans>
                    <strong>{priced ? money.format(priceMinor - depositMinor) : `${100 - deposit}%`}</strong>
                  </span>
                </div>
              </div>
              <em><Trans>A deposit means fewer people who book and do not come.</Trans></em>
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
    onError: (error) => setProblem(said(error, t`That number did not save.`)),
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
        <QHead screen="paid" title={t`Where should we send your money?`} lead={t`Your share of every deposit goes to this number.`} />
        <Body>
          <Have
            icon={<NetworkMark network={have.provider} size={40} />}
            title={`${NETWORK_NAME[have.provider]} · •••• ${(have.msisdn ?? have.msisdnLast3 ?? '').slice(-3)}`}
            text={have.status === 'VERIFIED' ? t`Checked — payouts go here` : t`Waiting to be checked by our team`}
          />
        </Body>
        <Foot nav={nav} label={t`Continue`} noSkip />
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
        title={t`Where should we send your money?`}
        lead={t`Your shop can go live without it — you are paid once it is added and checked.`}
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
          <input value={msisdn} onChange={(e) => setMsisdn(e.target.value)} inputMode="tel" placeholder={t`MoMo or Airtel number`} maxLength={20} aria-label={t`Mobile money number`} autoFocus />
          {network && <em>{NETWORK_NAME[network]}</em>}
        </span>
        <div className="wz-paid-how">
          {[
            { icon: 'banknote' as IconName, text: t`A customer pays a deposit to book` },
            { icon: 'shield' as IconName, text: t`We hold it safely until they come` },
            { icon: 'wallet' as IconName, text: t`Your share is sent to this number` },
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
        <p className="wz-quiet"><Trans>In the shop’s or the owner’s name. Our team checks it before the first payout.</Trans></p>
        <Problem text={problem} />
      </Body>
      <Foot nav={nav} busy={save.isPending} ready={digits.length >= 9} skipLabel={t`Add it later`} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Business papers (§314): a licensed trade's licence, or the registration that earns the mark

function PapersQ({ nav, readiness }: { nav: Nav; readiness: Readiness | undefined }) {
  const papers = useQuery({ queryKey: ['documents'], queryFn: listDocuments });
  const [picked, setPicked] = useState<DocumentKind | null>(null);
  const rules = readiness?.papers ?? [];
  const docs = papers.data?.documents ?? [];
  const docOf = (kind: DocumentKind) => docs.find((d) => d.kind === kind) ?? null;
  // A licensed trade cannot be reviewed until its licence is uploaded; every other shop may skip.
  const required = rules.length > 0;
  const missing = rules.some((rule) => rule.state === 'missing');
  // The registration slot that is open: the one chosen, else the one on record, else the first.
  const open = picked ?? REGISTRATION_KINDS.find((kind) => docOf(kind)) ?? 'RDB_CERTIFICATE';

  return (
    <form
      className="wz-step"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!(required && missing)) nav.next();
      }}
    >
      <QHead
        screen="papers"
        optional={!required}
        title={required ? t`Your licence` : t`Is your business registered?`}
        lead={
          required
            ? t`Your kind of shop cannot go live without it. Upload it here; our team checks it before you are approved.`
            : t`Upload your RDB certificate, TIN or trading licence. Once our team checks it, customers see “Registered business” on your page.`
        }
      />
      <Body>
        {required &&
          rules.map((rule) => (
            <div key={rule.key} className="wz-papers">
              {rule.kinds.length > 1 && <p className="wz-quiet"><Trans>Any one of these is enough.</Trans></p>}
              {rule.kinds.map((kind) => (
                <PaperSlot key={kind} kind={kind} doc={docOf(kind)} compact />
              ))}
            </div>
          ))}
        {!required && (
          <div className="wz-papers">
            <div className="wz-papers-pick" role="tablist" aria-label={t`Which paper`}>
              {REGISTRATION_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={open === kind}
                  className={`${open === kind ? 'is-on' : ''}${docOf(kind) ? ' is-have' : ''}`}
                  onClick={() => setPicked(kind)}
                >
                  {docOf(kind) && <DrawnCheck size={13} stroke={3} />}
                  {PAPER_WORDS[kind].name}
                </button>
              ))}
            </div>
            <PaperSlot key={open} kind={open} doc={docOf(open)} compact />
          </div>
        )}
        <p className="wz-quiet">
          <Icon name="lock" size={14} />{' '}
          {required
            ? t`A PDF or a clear photo of the whole page. Only you and our team can open it.`
            : t`Not registered yet? Skip this — your shop can still go live, and you can add it any time under Business papers.`}
        </p>
      </Body>
      <Foot nav={nav} ready={!(required && missing)} label={t`Continue`} skipLabel={required ? t`Add it later` : t`Skip for now`} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Send for review

function ReviewQ({ nav, readiness, email }: { nav: Nav; readiness: Readiness | undefined; email: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const address = email || t`your address`;
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
          <h1 id="wz-title">{sent ? t`Your shop is with us for review` : t`Your shop is waiting for review`}</h1>
          <p className="wz-lead">
            {readiness.submittedAt && !sent
              ? t`Sent ${formatDate(new Date(readiness.submittedAt), { day: 'numeric', month: 'long' })}. `
              : ''}
                <Trans>Here is what happens next.</Trans>
              </p>
          <ol className="wz-next">
            <li>
              <span className="wz-next-icon">
                <StepGlyph name="shield" size={22} />
              </span>
              <span>
                <Trans>
                  <strong>We check your details</strong>Usually within one working day. We may call your shop’s number.
                </Trans>
              </span>
            </li>
            <li>
              <span className="wz-next-icon is-ask">
                <StepGlyph name="mail" size={22} />
              </span>
              <span>
                <Trans><strong>You get an email</strong>At {address}, the moment you are approved.</Trans>
              </span>
            </li>
            <li>
              <span className="wz-next-icon is-ok">
                <StepGlyph name="review" size={22} />
              </span>
              <span>
                <Trans>
                  <strong>You post your shop</strong>When you are ready — one button on your dashboard. Customers see it from then, not before.
                </Trans>
              </span>
            </li>
            <li>
              <span className="wz-next-icon is-ok">
                <StepGlyph name="sparkle" size={22} />
              </span>
              <span>
                <Trans>
                  <strong>Meanwhile, make it shine</strong>Photos, a description, more services and your team. Shops with photos get booked first.
                </Trans>
              </span>
            </li>
          </ol>
        </Body>
        <div className="wz-foot is-center">
          <div className="wz-col">
            <button type="button" className="primary wz-go" onClick={() => navigate('/', { replace: true })}><Trans>Go to my dashboard </Trans><Icon name="arrowRight" size={17} stroke={2.4} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const rejected = readiness.status === 'REJECTED';
  const required = readiness.items.filter((i) => i.required);
  const missing = required.filter((i) => !i.done);
  const have = required.length - missing.length;
  const later = readiness.items.filter((i) => !i.required);
  const tile = (i: Readiness['items'][number]) => (
    <button key={i.key} type="button" className={`wz-ready${i.done ? ' is-done' : ''}`} onClick={() => nav.go(ITEM_WORDS[i.key].step)} disabled={i.done}>
      <span className="wz-ready-icon">{i.done ? <DrawnCheck size={14} stroke={3.2} /> : <StepGlyph name={ITEM_WORDS[i.key].section} size={17} />}</span>
      <span>{ITEM_WORDS[i.key].label}</span>
      {!i.done && (
        <em><Trans>Add </Trans><Icon name="arrowRight" size={13} stroke={2.4} />
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
        title={rejected ? t`Send your shop back for review` : missing.length ? t`Almost there` : t`Ready to send`}
        lead={
          rejected
            ? t`Fix what we asked, then send it back. Everything you set up is still here.`
            : missing.length
              ? plural(missing.length, {
                  one: '# thing is still needed before we can review your shop.',
                  other: '# things are still needed before we can review your shop.',
                })
              : t`We check every shop before customers can book it. Send yours now — it only takes a moment.`
        }
      />
      <Body>
        {rejected && readiness.statusReason && (
          <div className="wz-reason">
            <Icon name="alert" size={18} />
            <span>
              <strong><Trans>What we said</Trans></strong>
              {readiness.statusReason}
            </span>
          </div>
        )}
        <div className="wz-field">
          <span className="wz-label">
            <Trans>What we need <small>{have} of {required.length}</small></Trans>
          </span>
          <div className="wz-ready-grid">{required.map(tile)}</div>
        </div>
        <div className="wz-field">
          <span className="wz-label"><Trans>Nice to have — add whenever you like</Trans></span>
          <div className="wz-ready-grid is-optional">{later.map(tile)}</div>
        </div>
        <Problem text={submit.error ? said(submit.error, t`That did not send. Check your connection and try again.`) : null} />
      </Body>
      <div className="wz-foot">
        <div className="wz-col">
          <div>
            {nav.back && (
              <button type="button" className="wz-back" onClick={nav.back}>
                <Icon name="chevronLeft" size={17} stroke={2.2} />{' '}
                <Trans>Back</Trans>
              </button>
            )}
          </div>
          <div>
            <button type="submit" className="primary wz-go" disabled={!readiness.canSubmit || submit.isPending}>
              {submit.isPending ? (
                <>
                  <Trans><span className="wz-spin" aria-hidden="true" />Sending…</Trans>
                </>
              ) : (
                <>
                  {rejected ? t`Send back for review` : t`Send for review`}
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
