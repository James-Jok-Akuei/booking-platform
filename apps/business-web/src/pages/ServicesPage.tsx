import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import { SellerAgreementGate, useOutstandingLegal } from '../components/LegalGate';
import {
  createService,
  getProfile,
  discardServiceDraft,
  listServiceDrafts,
  saveServiceDraft,
  startServiceDraft,
  type ServiceDraft,
  listLocations,
  listServices,
  setServiceOfferedAt,
  setServiceOfferedEverywhere,
  updateService,
  type Location,
  type Service,
} from '../api/business';
import { useMoney } from '../money';
import {
  addServiceImage,
  removeServiceImage,
  setServiceImageCover,
} from '../api/business';
import { ago } from '../lib/time';
import { Avatar } from '../ui/Avatar';
import { alertDialog, confirmDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { MoreMenu } from '../ui/MoreMenu';
import { Portal } from '../ui/Portal';
import { Switch } from '../ui/Switch';
import { RichTextBox } from '../ui/RichTextBox';
import './services.css';
import { useAccess } from '../access';
import { DropZone, PHOTOS, sortFiles } from '../ui/DropZone';
import {
  ChoicesEditor,
  choicesProblem,
  groupsFromDraft,
  groupsFromService,
  groupsToInput,
  type GroupDraft,
} from './choices/ChoicesEditor';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { formatTime, formatDate } from '../i18n/format';
import { plural } from '@lingui/core/macro';

type Editor = { mode: 'new' } | { mode: 'edit'; service: Service; focus?: 'photos' };

/**
 * Where a new service's draft stands, said at the top of the panel (§269):
 * nothing typed yet, saving, saved (and when), or not saved and trying again.
 */
type DraftSave = { kind: 'new' } | { kind: 'saving' } | { kind: 'saved'; at: Date } | { kind: 'failed' };

/**
 * What the business sells, and for how much (§10, §194).
 *
 * Services belong to the BUSINESS, not to a location (§10.2) — each is offered
 * at the branches chosen, at that branch's price (§72). The page shows them
 * as a catalogue of cards: the cover a customer sees, the price at each branch
 * with a switch to pause it there, and whether the words a customer reads are
 * written. Adding and editing happen in a panel from the right, in sections.
 */
export function ServicesPage() {
  const queryClient = useQueryClient();
  const money = useMoney();
  const [editor, setEditor] = useState<Editor | null>(null);
  const adding = editor?.mode === 'new';

  const services = useQuery({ queryKey: ['services'], queryFn: listServices });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  // The menu and its prices are the whole shop's: the owner, or a manager of
  // every branch, changes them; a manager of some branches switches services
  // on or off there; staff look (§277).
  const access = useAccess();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['services'] });

  /**
   * The draft behind the "add a service" form (§123).
   *
   * One draft per open form, created when it opens and thrown away when the
   * service is actually created — a draft that outlived its service would sit in
   * the Unfinished list forever, describing something that already exists.
   *
   * The debounce lives HERE rather than in the form, because the form unmounts
   * the moment it closes and that is exactly when the last keystroke still needs
   * saving. A ref holds the timer so a re-render does not start a second one.
   */
  const [draftId, setDraftIdState] = useState<string | null>(null);
  // The same id for timers that outlive a render — a retry must not save into
  // the draft that was open when it was scheduled if another is open now.
  const draftRef = useRef<string | null>(null);
  const setDraftId = (id: string | null) => {
    draftRef.current = id;
    setDraftIdState(id);
  };
  const [resumed, setResumed] = useState<Service | undefined>(undefined);
  // A draft's questions, in the shape the form sends (§300).
  const [resumedChoices, setResumedChoices] = useState<unknown>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftSave, setDraftSave] = useState<DraftSave>({ kind: 'new' });
  // What was typed last, and whether anything has been typed at all: the form
  // reports what it opened with too, and that is not an edit.
  const latest = useRef<FormValues | null>(null);
  const edited = useRef(false);
  // Editing a service that already exists: changes wait for "Save changes".
  const [dirty, setDirty] = useState(false);
  // A draft just saved by hand, lit up for a moment in Drafts.
  const [fresh, setFresh] = useState<string | null>(null);

  const drafts = useQuery({
    queryKey: ['service-drafts'],
    queryFn: listServiceDrafts,
    enabled: access.ready && access.runsBusiness,
  });
  const refreshDrafts = () => queryClient.invalidateQueries({ queryKey: ['service-drafts'] });

  const discard = useMutation({
    mutationFn: discardServiceDraft,
    onSuccess: refreshDrafts,
  });

  const writeDraft = (id: string, values: FormValues) =>
    saveServiceDraft(id, {
      name: values.name || null,
      title: values.title.trim() || null,
      description: values.description.trim() || null,
      instructions: values.instructions.trim() || null,
      discountPercent: values.discountPercent,
      discountEndsOn: values.discountEndsOn,
      durationMinutes: values.durationMinutes,
      depositPercentage: values.depositPercentage,
      offers: values.offers,
      // The questions as written so far (§300), unchecked like the rest.
      choices: values.choices,
      noteEnabled: values.noteEnabled,
      notePrompt: values.notePrompt,
      priceConfirmedAtShop: values.priceConfirmedAtShop,
    }).then(() => {
      if (draftRef.current === id) setDraftSave({ kind: 'saved', at: new Date() });
      void refreshDrafts();
    });

  const scheduleDraftSave = (delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    // Long enough that typing a name is one save rather than eleven, short
    // enough that closing the laptop lid loses a sentence and not a service.
    timer.current = setTimeout(() => {
      timer.current = null;
      const id = draftRef.current;
      if (!id || !latest.current) return;
      writeDraft(id, latest.current).catch(() => {
        // Still no error box mid-sentence (§123) — but no longer silent: the
        // panel says it is not saved, and it tries again by itself.
        if (draftRef.current !== id) return;
        setDraftSave({ kind: 'failed' });
        scheduleDraftSave(5000);
      });
    }, delay);
  };

  const queueDraftSave = (values: FormValues, changed: boolean) => {
    if (!draftRef.current) return;
    if (!changed && !edited.current) return;
    edited.current = true;
    latest.current = values;
    setDraftSave({ kind: 'saving' });
    scheduleDraftSave(1200);
  };

  /**
   * Saves what is waiting NOW rather than in a moment — before "Save as draft"
   * or closing ends the panel. True when everything typed is saved.
   */
  const flushDraft = async () => {
    const id = draftRef.current;
    if (!id || !edited.current || !latest.current) return true;
    if (!timer.current && draftSave.kind === 'saved') return true;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setDraftSave({ kind: 'saving' });
    try {
      await writeDraft(id, latest.current);
      return true;
    } catch {
      setDraftSave({ kind: 'failed' });
      return false;
    }
  };

  /** Reopens the form with a draft's contents, and keeps saving into it. */
  const resume = (draft: ServiceDraft) => {
    // A draft is a service about to be listed, so the agreement comes first
    // here too (§280) — it used to be asked only by "Add a service".
    if (needAgreement(() => openDraft(draft))) return;
    openDraft(draft);
  };

  const openDraft = (draft: ServiceDraft) => {
    setDraftId(draft.id);
    setResumed({
      id: draft.id,
      name: draft.name ?? '',
      title: draft.title,
      description: draft.description,
      discountPercent: draft.discountPercent,
      discountEndsOn: draft.discountEndsOn,
      instructions: draft.instructions,
      durationMinutes: draft.durationMinutes ?? 30,
      depositPercentage: draft.depositPercentage ?? '20',
      isActive: true,
      locations: draft.offers.map((offer) => ({
        locationId: offer.locationId,
        priceMinor: offer.priceMinor,
      })),
      choiceGroups: [],
      noteEnabled: draft.noteEnabled ?? true,
      notePrompt: draft.notePrompt,
      priceConfirmedAtShop: draft.priceConfirmedAtShop ?? false,
    } as unknown as Service);
    setResumedChoices(draft.choices);
    setEditor({ mode: 'new' });
  };

  const { sellerAgreement } = useOutstandingLegal();
  const [gateOpen, setGateOpen] = useState(false);
  /**
   * What to do once the Seller Agreement is accepted (§280): open a new form,
   * carry on with a draft, or post the service that was waiting on it — so
   * agreeing carries on with what the person was doing.
   */
  const afterAgreeing = useRef<(() => void) | null>(null);
  const needAgreement = (then: () => void) => {
    if (!sellerAgreement) return false;
    afterAgreeing.current = then;
    setGateOpen(true);
    return true;
  };

  const startNew = () => {
    setResumed(undefined);
    setResumedChoices(undefined);
    // Asked BEFORE the form opens, not after it is filled in (§126.4).
    // Making somebody write a whole service and then telling them they
    // cannot post it is the worst possible moment to raise this.
    if (needAgreement(() => void openNew())) return;
    void openNew();
  };

  const openNew = async () => {
    // Started BEFORE the form opens, so the first keystroke has somewhere
    // to go rather than being the one that gets lost.
    const draft = await startServiceDraft().catch(() => null);
    setDraftId(draft?.id ?? null);
    setEditor({ mode: 'new' });
    refreshDrafts();
  };

  const closeEditor = () => {
    // Closing a new one keeps the draft. That is the whole point: the text is
    // still there under Drafts when they come back.
    if (timer.current) clearTimeout(timer.current);
    save.reset();
    timer.current = null;
    setEditor(null);
    setDraftId(null);
    setResumed(undefined);
    setResumedChoices(undefined);
    setDirty(false);
    setDraftSave({ kind: 'new' });
    edited.current = false;
    latest.current = null;
  };

  /**
   * Every way out of the panel — ✕, Escape, the backdrop, Cancel (§269).
   *
   * A new service saves what is waiting first; one opened and never typed in
   * leaves no empty "Untitled service" behind. A service that exists asks
   * before throwing away changes that were never saved.
   */
  const asking = useRef(false);
  const requestClose = async () => {
    if (asking.current || !editor) return;
    asking.current = true;
    try {
      if (editor.mode === 'edit' && dirty) {
        const leave = await confirmDialog({
          title: t`Leave without saving?`,
          body: (
            <p>
              <Trans>
                Your changes to “{editor.service.name}” are not saved yet. If you leave now, the service stays as it was.
              </Trans>
            </p>
          ),
          tone: 'warn',
          icon: 'pencil',
          confirmLabel: t`Leave without saving`,
          cancelLabel: t`Keep editing`,
        });
        if (!leave) return;
      }
      if (editor.mode === 'new') {
        if (!edited.current && !resumed && draftRef.current) {
          discard.mutate(draftRef.current);
        } else if (!(await flushDraft())) {
          const close = await confirmDialog({
            title: t`Close without your last changes?`,
            body: <p><Trans>We could not save what you typed last — check your connection. Everything before it is saved.</Trans></p>,
            tone: 'warn',
            icon: 'alert',
            confirmLabel: t`Close anyway`,
            cancelLabel: t`Keep writing`,
          });
          if (!close) return;
        }
      }
      closeEditor();
    } finally {
      asking.current = false;
    }
  };

  /** "Save as draft": saved now, the panel closed, the draft lit up in Drafts. */
  const saveAsDraft = async () => {
    const id = draftRef.current;
    if (!(await flushDraft())) return;
    closeEditor();
    if (id) {
      setFresh(id);
      setTimeout(() => setFresh((was) => (was === id ? null : was)), 4000);
    }
  };

  // Whether a new service is seen as soon as it is added (§268): not while
  // the shop is waiting for approval, not posted yet, or paused.
  const profile = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const p = profile.data;
  // What still keeps services from customers — said as a whole sentence where it is shown (§308).
  const hiddenUntil: HiddenUntil = !p
    ? null
    : p.status !== 'APPROVED'
      ? 'approval'
      : !p.publishedAt
        ? 'posting'
        : p.pausedAt
          ? 'paused'
          : null;

  /**
   * Posting a NEW service is one act (§165): the service, then its photos, in
   * the order they were chosen, with the button saying which photo is going.
   * The service exists from the first step; a photo that fails after it is
   * reported with the service kept, never a service that quietly vanished.
   */
  const [posting, setPosting] = useState<string | null>(null);
  const [postProblem, setPostProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (input: {
      id?: string;
      body: Record<string, unknown>;
      files?: File[];
      /** An existing service's photos as the form left them, cover first (§281). */
      photos?: PhotoItem[];
      /** …and as they were when it opened. */
      before?: Service['images'];
    }) => {
      if (input.id) {
        setPostProblem(null);
        setPosting(t`Saving…`);
        const updated = await updateService(input.id, input.body);
        if (input.photos) await applyPhotos(input.id, input.before ?? [], input.photos);
        return updated;
      }
      setPostProblem(null);
      setPosting(t`Posting the service…`);
      const created = await createService(input.body as never);
      const files = input.files ?? [];
      const failed: string[] = [];
      for (const [index, file] of files.entries()) {
        setPosting(t`Uploading photo ${index + 1} of ${files.length}…`);
        try {
          await addServiceImage(created.id, file);
        } catch (error) {
          failed.push(error instanceof ApiError ? error.message : file.name);
        }
      }
      if (failed.length > 0) {
        setPostProblem(
          `The service is posted, but ${failed.length} of ${files.length} photo(s) did not upload: ` +
            `${failed[0]}. Add them from Edit on the service below.`,
        );
      }
      return created;
    },
    onSettled: () => setPosting(null),
    // Refused because the Seller Agreement changed since it was last read
    // (§280): show it right here, and post once it is accepted.
    onError: (error, input) => {
      if (input.id || !(error instanceof ApiError)) return;
      if ((error.body as { code?: string } | undefined)?.code !== 'AGREEMENT_REQUIRED') return;
      save.reset();
      afterAgreeing.current = () => save.mutate(input);
      void queryClient.invalidateQueries({ queryKey: ['legal-status'] });
      setGateOpen(true);
    },
    onSuccess: () => {
      // The draft became a service. Keeping it would leave Drafts describing
      // something that already exists.
      const id = draftRef.current;
      closeEditor();
      if (id) discard.mutate(id);
      refresh();
    },
  });

  /**
   * The photo changes made in an open form, sent when it is saved (§281):
   * the removed ones go, the new ones go up, and the first becomes the cover.
   * Until then customers see the photos as they were.
   */
  const applyPhotos = async (serviceId: string, before: Service['images'], after: PhotoItem[]) => {
    const kept = new Set(after.filter((p) => p.id).map((p) => p.id!));
    const failed: string[] = [];
    const said = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

    // Removed first, so a full service has room for the new ones.
    const gone = before.filter((image) => !kept.has(image.id));
    for (const image of gone) {
      setPosting(t`Removing photos…`);
      try {
        await removeServiceImage(serviceId, image.id);
      } catch (error) {
        failed.push(said(error, t`a photo was not removed`));
      }
    }

    const fresh = after.filter((p) => p.file);
    const uploaded = new Map<string, string>();
    for (const [index, photo] of fresh.entries()) {
      setPosting(t`Uploading photo ${index + 1} of ${fresh.length}…`);
      try {
        uploaded.set(photo.key, (await addServiceImage(serviceId, photo.file!)).id);
      } catch (error) {
        failed.push(said(error, photo.file!.name));
      }
    }

    // The cover is the first photo in the form; new photos go up last, so it
    // is moved to the front only when the stored order would not already
    // lead with it.
    const first = after[0];
    const coverId = first ? (first.id ?? uploaded.get(first.key)) : undefined;
    const storedFirst =
      [...before].sort((a, b) => a.displayOrder - b.displayOrder).find((image) => kept.has(image.id))?.id ??
      (fresh[0] ? uploaded.get(fresh[0].key) : undefined);
    if (coverId && coverId !== storedFirst) {
      try {
        await setServiceImageCover(serviceId, coverId);
      } catch (error) {
        failed.push(said(error, t`the cover was not changed`));
      }
    }

    queryClient.invalidateQueries({ queryKey: ['service-images', serviceId] });
    if (failed.length > 0) {
      const why = failed[0];
      setPostProblem(
        plural(failed.length, {
          one: `Saved, but # photo change did not go through: ${why}. Open Edit on the service to try again.`,
          other: `Saved, but # photo changes did not go through: ${why}. Open Edit on the service to try again.`,
        }),
      );
    }
  };

  /** Every branch at once. Acts on the branches, never on the retired flag. */
  const everywhere = useMutation({
    mutationFn: (input: { id: string; isOffered: boolean }) =>
      setServiceOfferedEverywhere(input.id, input.isOffered),
    onSuccess: refresh,
  });

  /**
   * Un-retires a service whose own flag was turned off through the API.
   *
   * The screen never sets that flag — "everywhere" is a statement about
   * branches (§76) — but a service retired before this existed still needs a
   * way back.
   */
  const unretire = useMutation({
    mutationFn: (id: string) => updateService(id, { isActive: true }),
    onSuccess: refresh,
  });

  /**
   * Pausing or resuming at one branch (§74). Separate from retiring, which is
   * "we have stopped doing this at all" rather than "not here, for now".
   */
  const toggle = useMutation({
    mutationFn: (input: { id: string; locationId: string; isOffered: boolean }) =>
      setServiceOfferedAt(input.id, input.locationId, input.isOffered),
    onSuccess: (result) => {
      // Pausing the last branch leaves it bookable by nobody. Worth saying
      // once, in the server's own words rather than a guess made here.
      if (!result.isOffered && result.offeredAtCount === 0) {
        void alertDialog({ title: t`Nobody can book it now`, body: <p>{result.message}</p>, tone: 'warn' });
      }
      refresh();
    },
  });

  const busy = save.isPending || everywhere.isPending || toggle.isPending || unretire.isPending;

  /**
   * Grouped by whether a customer can book it, not by the `isActive` flag.
   *
   * A service everybody has paused is in exactly the same position as a retired
   * one — in your catalogue, bookable by nobody — so it belongs in the same
   * section, where there is an obvious way to bring it back.
   */
  const onSale =
    services.data?.filter((s) => s.isActive && s.locations.some((o) => o.isOffered)) ?? [];
  const notOnSale =
    services.data?.filter((s) => !s.isActive || !s.locations.some((o) => o.isOffered)) ?? [];
  const withSale = onSale.filter((s) => s.discountPercent && !isSaleOver(s.discountEndsOn)).length;
  const noPhotos = onSale.filter((s) => s.images.length === 0).length;

  const retire = async (service: Service) => {
    const ok = await confirmDialog({
      title: t`Stop offering “${service.name}” at every branch?`,
      body: (
        <p>
          <Trans>
            It moves to “Not on sale”, keeps its prices, and you can put it back at any time.
            Appointments already made are unaffected.
          </Trans>
        </p>
      ),
      tone: 'danger',
      icon: 'pause',
      confirmLabel: t`Stop offering everywhere`,
      cancelLabel: t`Keep it on sale`,
    });
    if (ok) everywhere.mutate({ id: service.id, isOffered: false });
  };

  // A refused save is said inside the open form, where the person is (§280).
  const error = (editor ? null : save.error) ?? everywhere.error ?? toggle.error ?? unretire.error;
  const saveProblem = save.error ? (save.error instanceof ApiError ? save.error.message : t`That did not save. Check your connection and try again.`) : null;

  return (
    <section className="sv">
      {gateOpen && sellerAgreement && (
        <SellerAgreementGate
          document={sellerAgreement}
          onCancel={() => {
            afterAgreeing.current = null;
            setGateOpen(false);
          }}
          onAccepted={() => {
            setGateOpen(false);
            // Straight on to what they were trying to do. Accepting and then
            // being returned to where they started is a second thing to do.
            const next = afterAgreeing.current;
            afterAgreeing.current = null;
            next?.();
          }}
        />
      )}

      <div className="page-top">
        <header className="page-head sv-head">
          <div>
            <h1><Trans>Services</Trans></h1>
            <p className="muted sv-lead">
              <Trans>
                Each service is offered at the branches you choose, at <strong>that branch's price</strong> —
                a city-centre shop can charge more than a quieter one for the same work. The deposit
                percentage is what a customer pays up front to hold the slot; the rest is settled with you
                directly.
              </Trans>
            </p>
          </div>
          {access.runsBusiness && (
            <button type="button" className="primary sv-add" onClick={startNew}>
              <Icon name="plus" size={18} stroke={2.4} />{' '}
              <Trans>Add a service</Trans>
            </button>
          )}
        </header>
      </div>

      {!access.runsBusiness && (
        <p className="sv-scope">
          <Icon name="shield" size={16} />
          {access.runsBranches
            ? t`You can switch a service on or off at your branches. The owner, or a manager of every branch, changes the menu and its prices.`
            : t`You can see what is on sale at your branches. The owner or a manager changes it.`}
        </p>
      )}

      {services.data && services.data.length > 0 && (
        <div className="sv-chips">
          <span className="sv-chip">
            <Trans><i className="dot-ok" /> {onSale.length} on sale</Trans>
          </span>
          {withSale > 0 && (
            <span className="sv-chip is-accent">
              <Icon name="percent" size={14} stroke={2.2} />
              <Trans>{withSale} with a discount</Trans>
            </span>
          )}
          {noPhotos > 0 && (
            <span className="sv-chip is-warn">
              <Icon name="camera" size={14} />
              <Trans>{noPhotos} without photos</Trans>
            </span>
          )}
          {notOnSale.length > 0 && (
            <span className="sv-chip">
              <Trans><i className="dot-off" /> {notOnSale.length} not on sale</Trans>
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="notice" role="alert">
          {error instanceof ApiError ? error.message : t`That did not work.`}
        </p>
      )}
      {postProblem && (
        <p className="notice" role="alert">
          {postProblem}
        </p>
      )}

      {/* Unfinished services, shared by the shop (§123). Above the catalogue,
          because "did I already start this?" comes before writing it again. */}
      {!adding && access.runsBusiness && (drafts.data?.length ?? 0) > 0 && (
        <section className="sv-drafts">
          <h2 className="sv-section-title">
            <Icon name="pencil" size={16} />
            <Trans>
              Drafts
              <span>{drafts.data!.length}</span>
              <em className="sv-drafts-note">Saved as you typed — customers never see a draft</em>
            </Trans>
          </h2>
          <div className="sv-draft-row">
            {drafts.data?.map((item) => (
              <article key={item.id} className={`sv-draft${fresh === item.id ? ' is-fresh' : ''}`}>
                <div className="sv-draft-top">
                  <span className="sv-draft-icon">
                    <Icon name="tag" size={18} />
                  </span>
                  <div>
                    <strong>{item.name || t`Untitled service`}</strong>
                    <span>{fresh === item.id ? t`Saved just now` : t`Last saved ${ago(item.updatedAt)}`}</span>
                  </div>
                </div>
                <div className="sv-draft-by">
                  <Avatar label={item.createdBy.email} size={22} />
                  <span><Trans>started by {item.createdBy.email}</Trans></span>
                </div>
                <div className="sv-draft-actions">
                  <button
                    type="button"
                    className="link danger-link"
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: t`Throw this draft away?`,
                          body: <p><Trans>What was written in it cannot be brought back.</Trans></p>,
                          tone: 'danger',
                          icon: 'trash',
                          confirmLabel: t`Discard`,
                        })
                      ) {
                        discard.mutate(item.id);
                      }
                    }}
                  >
                    <Trans>Discard</Trans>
                  </button>
                  <button type="button" className="dark" onClick={() => resume(item)}><Trans>Carry on </Trans><Icon name="arrowRight" size={16} stroke={2.2} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {services.isLoading && (
        <div className="sv-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton sv-skeleton" />
          ))}
        </div>
      )}

      {services.data && services.data.length === 0 && (
        <div className="sv-empty">
          <span>
            <Icon name="tag" size={30} />
          </span>
          {access.runsBusiness ? (
            <>
              <h2><Trans>Put your first service on sale</Trans></h2>
              <p>
                <Trans>
                  A name, how long it takes, a price at each branch — and a photo or two. Customers can book
                  it the moment it is posted.
                </Trans>
              </p>
              <button type="button" className="primary" onClick={startNew}>
                <Icon name="plus" size={18} stroke={2.4} />{' '}
                <Trans>Add a service</Trans>
              </button>
            </>
          ) : (
            <>
              <h2><Trans>Nothing on sale at your branches yet</Trans></h2>
              <p><Trans>When the owner adds a service at your branch, it shows here.</Trans></p>
            </>
          )}
        </div>
      )}

      {onSale.length > 0 && (
        <div className="sv-grid">
          {onSale.map((service, i) => (
            <ServiceCard
              key={service.id}
              index={i}
              service={service}
              money={money}
              busy={busy}
              canEdit={access.runsBusiness}
              canToggle={access.runsBranches}
              onEdit={() => setEditor({ mode: 'edit', service })}
              onPhotos={() => setEditor({ mode: 'edit', service, focus: 'photos' })}
              onToggle={(locationId, isOffered) => toggle.mutate({ id: service.id, locationId, isOffered })}
              onRetire={() => retire(service)}
            />
          ))}
        </div>
      )}

      {notOnSale.length > 0 && (
        <section className="sv-off">
          <h2 className="sv-section-title">
            <Icon name="pause" size={16} />
            <Trans>
              Not on sale
              <span>{notOnSale.length}</span>
            </Trans>
          </h2>
          <p className="muted small sv-off-lead">
            <Trans>
              Still yours, and bookable by nobody. Kept so past appointments resolve to what was booked.
              Switch a branch back on — or press <strong>Put back on sale</strong> if you retired it
              everywhere.
            </Trans>
          </p>
          <div className="sv-grid">
            {notOnSale.map((service, i) => (
              <ServiceCard
                key={service.id}
                index={i}
                service={service}
                money={money}
                busy={busy}
                restore
                canEdit={access.runsBusiness}
                canToggle={access.runsBranches}
                onEdit={() => setEditor({ mode: 'edit', service })}
                onPhotos={() => setEditor({ mode: 'edit', service, focus: 'photos' })}
                onToggle={(locationId, isOffered) => toggle.mutate({ id: service.id, locationId, isOffered })}
                // Two different ways back, because they undo two different
                // things: a service retired through the API needs its flag
                // cleared, and one simply switched off everywhere needs its
                // branches turned back on.
                onRetire={() =>
                  service.isActive
                    ? everywhere.mutate({ id: service.id, isOffered: true })
                    : unretire.mutate(service.id)
                }
              />
            ))}
          </div>
        </section>
      )}

      {editor && (
        <EditorPanel
          title={editor.mode === 'new' ? (resumed ? t`Carry on with your service` : t`New service`) : editor.service.name}
          eyebrow={editor.mode === 'new' ? t`Add a service` : t`Edit service`}
          status={
            <SaveState
              look={
                editor.mode === 'new'
                  ? draftSave
                  : save.isPending
                    ? { kind: 'saving' }
                    : dirty
                      ? { kind: 'unsaved' }
                      : { kind: 'clean' }
              }
              editing={editor.mode === 'edit'}
            />
          }
          onClose={() => void requestClose()}
        >
          {editor.mode === 'new' ? (
            <ServiceForm
              key={draftId ?? 'new'}
              money={money}
              locations={locations.data ?? []}
              busy={save.isPending}
              initial={resumed}
              draftChoices={resumedChoices}
              busyLabel={posting ?? undefined}
              creating
              hiddenUntil={hiddenUntil}
              canDraft={draftSave.kind !== 'new' || Boolean(resumed)}
              onSaveDraft={() => void saveAsDraft()}
              problem={saveProblem}
              onSubmit={(body, photos) => {
                const files = photos.flatMap((p) => (p.file ? [p.file] : []));
                // However the form was opened, the agreement is asked before posting (§280).
                if (needAgreement(() => save.mutate({ body, files }))) return;
                save.mutate({ body, files });
              }}
              onChange={queueDraftSave}
              onCancel={() => void requestClose()}
            />
          ) : (
            <ServiceForm
              key={editor.service.id}
              money={money}
              locations={locations.data ?? []}
              busy={save.isPending}
              initial={editor.service}
              busyLabel={posting ?? undefined}
              focus={editor.focus}
              onCancel={() => void requestClose()}
              onDirtyChange={setDirty}
              problem={saveProblem}
              onSubmit={(body, photos) =>
                save.mutate({ id: editor.service.id, body, photos, before: editor.service.images })
              }
            />
          )}
        </EditorPanel>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** The panel from the right that adding and editing happen in. */
function EditorPanel({
  title,
  eyebrow,
  status,
  onClose,
  children,
}: {
  title: string;
  eyebrow: string;
  /** Whether what is typed is saved, under the title (§269). */
  status?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <Portal>
      <div className="drawer-backdrop" onMouseDown={onClose}>
        <aside
          className="drawer sv-panel"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="sv-panel-head">
            <div>
              <p>{eyebrow}</p>
              <h2>{title}</h2>
              {status}
            </div>
            <button type="button" className="sv-panel-close" onClick={onClose} aria-label={t`Close this panel`}>
              <Icon name="close" size={18} />
            </button>
          </header>
          {children}
        </aside>
      </div>
    </Portal>
  );
}

type SaveLook = DraftSave | { kind: 'unsaved' } | { kind: 'clean' };

/**
 * Whether what is in the panel is saved, in a few words (§269). A new service
 * saves itself as a draft while it is written, and says so; a service that
 * exists waits for "Save changes", and says when something has not been.
 */
function SaveState({ look, editing }: { look: SaveLook; editing: boolean }) {
  const at = (date: Date) => formatTime(date, { hour: '2-digit', minute: '2-digit' });
  const [icon, words, tone]: [ReactNode, string, string] =
    look.kind === 'saving'
      ? [<i className="sv-save-spin" />, editing ? t`Saving…` : t`Saving draft…`, 'is-saving']
      : look.kind === 'saved'
        ? [<Icon name="check" size={13} stroke={3} />, t`Draft saved · ${at(look.at)}`, 'is-saved']
        : look.kind === 'failed'
          ? [<Icon name="alert" size={13} />, t`Not saved — trying again`, 'is-failed']
          : look.kind === 'unsaved'
            ? [<i className="sv-save-dot" />, t`Unsaved changes`, 'is-unsaved']
            : look.kind === 'clean'
              ? [<Icon name="check" size={13} stroke={3} />, t`All changes saved`, 'is-clean']
              : [<Icon name="pencil" size={13} />, t`Saved as a draft while you type`, 'is-new'];
  return (
    <span className={`sv-save ${tone}`} role="status" aria-live="polite" key={look.kind}>
      {icon}
      {words}
    </span>
  );
}

function ServiceCard({
  service,
  index,
  money,
  busy,
  restore = false,
  canEdit,
  canToggle,
  onEdit,
  onPhotos,
  onToggle,
  onRetire,
}: {
  service: Service;
  index: number;
  money: ReturnType<typeof useMoney>;
  busy: boolean;
  /** True under "Not on sale", where the card's action brings it back. */
  restore?: boolean;
  /** The whole service — words, prices, photos (§277). */
  canEdit: boolean;
  /** On or off at a branch. */
  canToggle: boolean;
  onEdit: () => void;
  onPhotos: () => void;
  onToggle: (locationId: string, isOffered: boolean) => void;
  onRetire: () => void;
}) {
  // The deposit is a percentage, so it differs per branch wherever the price
  // does. Shown against the cheapest, which is the smallest a customer ever
  // hands over.
  const live = service.isActive ? service.locations.filter((o) => o.isOffered) : [];
  const cheapest = live.length ? Math.min(...live.map((o) => o.priceMinor)) : null;
  const depositMinor =
    cheapest === null ? null : Math.round((cheapest * Number(service.depositPercentage)) / 100);
  const sale = service.discountPercent && !isSaleOver(service.discountEndsOn) ? service.discountPercent : null;
  const cover = service.images[0]?.url ?? null;

  // The words a customer reads (§180, §185): a glance shows which services
  // still have nothing to say for themselves.
  const words: Array<[string, boolean]> = [
    [t`Title`, Boolean(service.title)],
    [t`Description`, Boolean(service.description)],
    [t`Instructions`, Boolean(service.instructions)],
  ];
  const written = words.filter(([, has]) => has).length;

  return (
    <article className={`svc${restore ? ' is-off' : ''}`} style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <button
        type="button"
        className="svc-cover"
        onClick={canEdit ? onPhotos : undefined}
        disabled={!canEdit}
        aria-label={t`Photos of ${service.name}`}
      >
        {cover ? (
          <img src={cover} alt="" />
        ) : (
          <span className="svc-cover-empty">
            <Icon name="camera" size={26} />
            <span>{canEdit ? t`Add a photo` : t`No photo yet`}</span>
          </span>
        )}
        {/* A sale running now (§186), on the picture so it is seen. */}
        {sale && <span className="svc-sale">−{sale}%</span>}
        <span className="svc-count">
          <Icon name="image" size={14} />
          {service.images.length === 0
            ? t`No photos`
            : plural(service.images.length, { one: '# photo', other: '# photos' })}
        </span>
      </button>

      <div className="svc-body">
        <h3>{service.name}</h3>
        <p className={`svc-title${service.title ? '' : ' is-missing'}`}>{service.title || t`No title yet`}</p>

        <div className="svc-meta">
          <span>
            <Icon name="clock" size={15} />
            <Trans>{service.durationMinutes} min</Trans>
          </span>
          <span>
            <Icon name="wallet" size={15} />
            <Trans>{service.depositPercentage}% deposit</Trans>
          </span>
          {/* The questions customers answer (§300), and a price agreed later. */}
          {service.choiceGroups.length > 0 && (
            <span title={service.choiceGroups.map((g) => g.name).join(', ')}>
              <Icon name="sliders" size={15} /> {service.choiceGroups.length}{' '}
              {service.choiceGroups.length === 1 ? t`question` : t`questions`}
            </span>
          )}
          {service.priceConfirmedAtShop && (
            <span>
              <Icon name="tag" size={15} />{' '}
              <Trans>price at the shop</Trans>
            </span>
          )}
        </div>
        {depositMinor !== null && (
          <p className="svc-dep"><Trans>from {money.format(depositMinor)} up front</Trans></p>
        )}
        {sale && (
          <p className="svc-sale-line">
            <Icon name="percent" size={13} stroke={2.2} />
            <Trans>{sale}% off</Trans>
            {service.discountEndsOn ? t` · until ${niceDay(service.discountEndsOn.slice(0, 10))}` : t` · until you end it`}
          </p>
        )}

        <ul className="svc-branches">
          {service.locations.map((offer) => {
            const on = offer.isOffered && service.isActive;
            const price = sale ? salePrice(offer.priceMinor, sale) : offer.priceMinor;
            return (
              <li key={offer.locationId} className={on ? '' : 'is-paused'}>
                <span className="svc-branch">
                  <strong>{money.format(price)}</strong>
                  {sale && <s>{money.format(offer.priceMinor)}</s>}
                  <span>{offer.location.name}</span>
                </span>
                {/* Reads the EFFECTIVE state, not the branch flag alone. A
                    retired service sells nothing anywhere, so offering to stop
                    it here would be stopping something already stopped. */}
                {!service.isActive ? (
                  <span className="muted small"><Trans>service stopped</Trans></span>
                ) : !canToggle ? (
                  <span className={`svc-state${offer.isOffered ? ' is-on' : ''}`}>
                    {offer.isOffered ? t`On sale` : t`Paused`}
                  </span>
                ) : (
                  <Switch
                    checked={offer.isOffered}
                    disabled={busy}
                    label={offer.isOffered ? t`Stop offering here (${offer.location.name})` : t`Put back on sale here (${offer.location.name})`}
                    onChange={(next) => onToggle(offer.locationId, next)}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {live.length === 0 && (
          // No branch is selling it. Stated plainly, not as an error — it is a
          // choice, not a fault.
          <p className="svc-none">{service.isActive ? t`Switched off at every branch` : t`Service stopped`}</p>
        )}

        <div className="svc-words" title={t`What a customer reads on the service's page`}>
          {words.map(([label, has]) => (
            <span key={label} className={has ? 'is-done' : ''}>
              <Icon name={has ? 'check' : 'minus'} size={12} stroke={2.6} />
              {label}
            </span>
          ))}
          <em>{written}/3</em>
        </div>
      </div>

      {canEdit && (
        <footer className="svc-foot">
          <button type="button" onClick={onEdit}>
            <Icon name="pencil" size={16} />{' '}
            <Trans>Edit</Trans>
          </button>
          <button type="button" onClick={onPhotos}>
            <Icon name="image" size={16} />{' '}
            <Trans>Photos</Trans>
          </button>
          {restore ? (
            <button type="button" className="primary svc-restore" disabled={busy} onClick={onRetire}>
              <Trans>Put back on sale</Trans>
            </button>
          ) : (
            <MoreMenu
              disabled={busy}
              items={[
                { label: t`Edit`, icon: 'pencil', onClick: onEdit },
                { label: t`Photos`, icon: 'image', onClick: onPhotos },
                { label: t`Stop offering everywhere`, icon: 'pause', onClick: onRetire, danger: true },
              ]}
            />
          )}
        </footer>
      )}
    </article>
  );
}

/**
 * A photo in the form (§281): one already on the service (`id`), or one chosen
 * here and not sent yet (`file`). `key` tells them apart in a list.
 */
type PhotoItem = { key: string; url: string; id?: string; file?: File };

type FormValues = {
  name: string;
  title: string;
  description: string;
  instructions: string;
  discountPercent: number | null;
  discountEndsOn: string | null;
  durationMinutes: number | null;
  depositPercentage: number | null;
  offers: Array<{ locationId: string; priceMinor: number }>;
  /** The questions customers answer while booking (§300), as they are sent. */
  choices: ReturnType<typeof groupsToInput>;
  noteEnabled: boolean;
  notePrompt: string | null;
  priceConfirmedAtShop: boolean;
};

function Section({ icon, title, hint, children, id }: { icon: IconName; title: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <section className="sv-section" id={id}>
      <header>
        <span className="sv-section-icon">
          <Icon name={icon} size={18} />
        </span>
        <div>
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
      </header>
      <div className="sv-section-body">{children}</div>
    </section>
  );
}

/** What still keeps a service from customers (§308: a key, so each case is its own sentence). */
type HiddenUntil = 'approval' | 'posting' | 'paused' | null;

function ServiceForm({
  money,
  locations,
  busy,
  busyLabel,
  creating = false,
  initial,
  draftChoices,
  focus,
  hiddenUntil = null,
  canDraft = false,
  onSaveDraft,
  problem = null,
  onSubmit,
  onCancel,
  onChange,
  onDirtyChange,
}: {
  money: ReturnType<typeof useMoney>;
  locations: Location[];
  busy: boolean;
  /** What the button says while busy, e.g. "Uploading photo 2 of 5…". */
  busyLabel?: string;
  /** A NEW service (or a draft of one): photos are chosen here and the button posts. */
  creating?: boolean;
  initial?: Service;
  /** A draft's questions (§300), when carrying on with one. */
  draftChoices?: unknown;
  /** Open scrolled to a section — the cover's "Photos" lands on the photos. */
  focus?: 'photos';
  /** When customers will see a new service, if not at once (§268) — e.g. "you post your shop". */
  hiddenUntil?: HiddenUntil;
  /** Something is written, so "Save as draft" has something to keep. */
  canDraft?: boolean;
  /** "Save as draft" on a NEW service: saved now, and the panel closes (§269). */
  onSaveDraft?: () => void;
  /** Why the last post or save was refused, said beside the button (§280). */
  problem?: string | null;
  /** The photos as the form leaves them, cover first (§165, §281). */
  onSubmit: (body: Record<string, unknown>, photos: PhotoItem[]) => void;
  onCancel?: () => void;
  /**
   * Called whenever anything in the form changes, so a NEW service can be kept
   * as a draft while it is being written (§123). Absent when editing an existing
   * service, which is already saved and needs no draft. `changed` is whether
   * it differs from what the form opened with.
   */
  onChange?: (values: FormValues, changed: boolean) => void;
  /** An existing service: whether anything differs from what is saved (§269). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  // The headline under the photos on the customer's page (§185).
  const [title, setTitle] = useState(initial?.title ?? '');
  // What it is, and what to know before coming (§180). Both reach the
  // customer: under "About this service", and on the reservation.
  const [description, setDescription] = useState(initial?.description ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  // A sale (§186). One that has already ended starts the form empty: it is
  // history, and saving the form clears it.
  const saleEnded = isSaleOver(initial?.discountEndsOn ?? null);
  const [discount, setDiscount] = useState(
    initial?.discountPercent && !saleEnded ? String(initial.discountPercent) : '',
  );
  const [saleEndsOn, setSaleEndsOn] = useState(
    initial?.discountEndsOn && !saleEnded ? initial.discountEndsOn.slice(0, 10) : '',
  );
  const percentOff = /^\d+$/.test(discount.trim()) ? Number(discount.trim()) : null;
  const [duration, setDuration] = useState(String(initial?.durationMinutes ?? 30));
  const [deposit, setDeposit] = useState(initial?.depositPercentage ?? '20');
  // What customers answer while booking (§300), and the note. Saved with the
  // rest, never before (§281).
  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    draftChoices !== undefined
      ? groupsFromDraft(draftChoices, money)
      : groupsFromService(initial?.choiceGroups ?? [], money),
  );
  const [noteEnabled, setNoteEnabled] = useState(initial?.noteEnabled ?? true);
  const [notePrompt, setNotePrompt] = useState(initial?.notePrompt ?? '');
  const [priceAtShop, setPriceAtShop] = useState(initial?.priceConfirmedAtShop ?? false);
  const choiceInput = groupsToInput(groups, money);
  const choiceSig = JSON.stringify(choiceInput);
  // The photos, cover first. Every change waits for the button (§281) —
  // "Post" for a new service, "Save changes" for one already on sale — so
  // customers see nothing until the seller says so. A new photo is held as a
  // file until then (§165).
  const PHOTO_LIMIT = 11;
  const startPhotos = useMemo<PhotoItem[]>(
    () =>
      [...(initial?.images ?? [])]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((image) => ({ key: image.id, url: image.url, id: image.id })),
    // What the form opened with, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [photos, setPhotos] = useState<PhotoItem[]>(startPhotos);
  const madeUrls = useRef<string[]>([]);
  useEffect(() => () => madeUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  // Checked as dropped ones are (§305): photos only, each under the size limit.
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  const addFiles = (chosen: File[]) => {
    const { taken: picked, problem } = sortFiles(chosen, PHOTOS);
    const room = PHOTO_LIMIT - photos.length;
    setPhotoProblem(
      problem ??
        (picked.length > room
          ? plural(picked.length - room, {
              one: `${PHOTO_LIMIT} photos is the most for a service, so # was left out.`,
              other: `${PHOTO_LIMIT} photos is the most for a service, so # were left out.`,
            })
          : null),
    );
    setPhotos((was) =>
      [
        ...was,
        ...picked.map((file) => {
          const url = URL.createObjectURL(file);
          madeUrls.current.push(url);
          return { key: url, url, file };
        }),
      ].slice(0, PHOTO_LIMIT),
    );
  };
  const photoSig = photos.map((p) => p.key).join('|');
  const photosChanged = photoSig !== startPhotos.map((p) => p.key).join('|');

  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === 'photos') {
      setTimeout(() => body.current?.querySelector('#sv-photos')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 260);
    }
  }, [focus]);

  /**
   * One price box per branch, empty meaning "not offered here".
   *
   * Price and branch are the SAME decision since §72 — a price with no branch
   * means nothing — so they are one control rather than a checkbox that then
   * reveals a field. An empty box is how you stop offering it somewhere.
   */
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const byLocation = new Map((initial?.locations ?? []).map((o) => [o.locationId, o.priceMinor]));
    return Object.fromEntries(
      locations.map((l) => [l.id, byLocation.has(l.id) ? money.toMajor(byLocation.get(l.id)!) : '']),
    );
  });

  const offers = locations
    .filter((l) => prices[l.id]?.trim() !== '' && prices[l.id] !== undefined)
    .map((l) => ({ locationId: l.id, priceMinor: money.toMinor(prices[l.id]) }));

  // Reported on every change; the PAGE decides how often to actually save.
  // Debouncing here would put the timer in the component that unmounts when the
  // form closes, which is exactly when the last keystroke still needs saving.
  // What the form opened with is the baseline: matching it is not a change.
  const baseline = useRef<string | null>(null);
  useEffect(() => {
    const values: FormValues = {
      name,
      title,
      description,
      instructions,
      discountPercent: percentOff,
      discountEndsOn: percentOff && saleEndsOn ? saleEndsOn : null,
      durationMinutes: Number(duration) || null,
      depositPercentage: deposit === '' ? null : Number(deposit),
      offers,
      choices: choiceInput,
      noteEnabled,
      notePrompt: notePrompt.trim() || null,
      priceConfirmedAtShop: priceAtShop,
    };
    const snapshot = JSON.stringify(values);
    if (baseline.current === null) baseline.current = snapshot;
    const changed = snapshot !== baseline.current;
    onChange?.(values, changed);
    // A photo added, removed or made the cover is a change too (§281).
    onDirtyChange?.(changed || photosChanged);
    // `offers` is derived from `prices` and rebuilt each render, so watching it
    // directly would fire this on every render rather than on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, title, description, instructions, discount, saleEndsOn, duration, deposit, prices, photoSig, choiceSig, noteEnabled, notePrompt, priceAtShop]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The box cannot stop typing at the limit as a plain one did; it says so here.
    const overDescription = description.length - 2000;
    const overInstructions = instructions.length - 600;
    if (overDescription > 0 || overInstructions > 0) {
      void alertDialog({
        title: t`A little too long`,
        body: (
          <p>
            {overDescription > 0 && overInstructions > 0
              ? t`Shorten the description by ${overDescription} and the special instructions by ${overInstructions} characters — the count is at the top right of each box.`
              : overDescription > 0
                ? plural(overDescription, {
                    one: 'Shorten the description by # character — the count is at the top right of each box.',
                    other: 'Shorten the description by # characters — the count is at the top right of each box.',
                  })
                : plural(overInstructions, {
                    one: 'Shorten the special instructions by # character — the count is at the top right of each box.',
                    other: 'Shorten the special instructions by # characters — the count is at the top right of each box.',
                  })}
          </p>
        ),
        tone: 'warn',
        icon: 'pencil',
      });
      return;
    }
    if (offers.length === 0) {
      void alertDialog({
        title: t`Give it a price`,
        body: <p><Trans>Give a price at a least one branch, or nobody can book it.</Trans></p>,
        tone: 'warn',
        icon: 'tag',
      });
      return;
    }
    const choiceTrouble = choicesProblem(groups);
    if (choiceTrouble) {
      setGroups((was) => was.map((g, i) => ({ ...g, open: i === firstTroubled(was) })));
      void alertDialog({
        title: t`Finish your questions`,
        body: <p>{choiceTrouble}</p>,
        tone: 'warn',
        icon: 'sliders',
      });
      return;
    }
    if (discount.trim() && (percentOff === null || percentOff < 1 || percentOff > 90)) {
      void alertDialog({
        title: t`Check the discount`,
        body: <p><Trans>A discount is a whole number from 1 to 90 percent off — or leave it empty for no discount.</Trans></p>,
        tone: 'warn',
        icon: 'percent',
      });
      return;
    }
    onSubmit(
      {
        name: name.trim(),
        // Blank is "nothing to say": sent as null so the server stores nothing.
        title: title.trim() || null,
        description: description.trim() || null,
        instructions: instructions.trim() || null,
        // The sale (§186): null ends it; a last day only with a percentage.
        discountPercent: percentOff,
        discountEndsOn: percentOff && saleEndsOn ? saleEndsOn : null,
        durationMinutes: Number(duration),
        depositPercentage: Number(deposit),
        offers,
        // The whole list as it should be (§300): kept ones by id, the rest new.
        choiceGroups: choiceInput,
        noteEnabled,
        notePrompt: notePrompt.trim() || null,
        priceConfirmedAtShop: priceAtShop,
      },
      photos,
    );
  };

  const depositShare = (minor: number) => Math.round((minor * Number(deposit || 0)) / 100);

  return (
    <form className="sv-form" onSubmit={submit}>
      <div className="sv-form-body" ref={body}>
        {/* The words a customer reads (§180, §185), in the order the service's
            page shows them. */}
        <Section icon="pencil" title={t`Name and words`} hint={t`What customers read when they choose it`}>
          <div className="sv-field">
            <label htmlFor="sname"><Trans>Name</Trans></label>
            <input
              id="sname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t`e.g. Haircut`}
              required
              autoFocus={creating}
            />
          </div>
          <div className="sv-field">
            <label htmlFor="stitle"><Trans>Title <em>{title.length}/100</em></Trans>
            </label>
            <input
              id="stitle"
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t`One line that makes someone want it — e.g. “Sharp fades and clean line-ups”`}
            />
            <span className="sv-help">
              <Trans>The headline right under the photos. The name above stays the short label on cards.</Trans>
            </span>
          </div>
          <div className="sv-field">
            <label id="sdesc-label" onClick={() => document.getElementById('sdesc')?.focus()}>
              <Trans>Description</Trans>
            </label>
            <RichTextBox
              id="sdesc"
              labelledBy="sdesc-label"
              rows={4}
              maxLength={2000}
              value={description}
              onChange={setDescription}
              placeholder={t`What it is and what is included — a customer reads this before choosing it.`}
            />
            <span className="sv-help"><Trans>Shown under “About this service”.</Trans></span>
          </div>
          <div className="sv-field">
            <label id="sinstr-label" onClick={() => document.getElementById('sinstr')?.focus()}>
              <Trans>Special instructions</Trans>
            </label>
            <RichTextBox
              id="sinstr"
              labelledBy="sinstr-label"
              rows={3}
              maxLength={600}
              value={instructions}
              onChange={setInstructions}
              placeholder={t`What to know before coming: arrive ten minutes early, bring a towel, park at the back…`}
            />
            <span className="sv-help">
              <Trans>Shown as “Before you come” — on the service, and again on the customer’s reservation.</Trans>
            </span>
          </div>
        </Section>

        <Section icon="tag" title={t`Price and time`} hint={t`How long it takes, and what it costs at each branch`}>
          <div className="sv-two">
            <div className="sv-field">
              <label htmlFor="sdur"><Trans>Minutes</Trans></label>
              <div className="sv-affix">
                <input
                  id="sdur"
                  type="number"
                  min="5"
                  step="5"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  required
                />
                <span><Trans>min</Trans></span>
              </div>
            </div>
            <div className="sv-field">
              <label htmlFor="sdep"><Trans>Deposit %</Trans></label>
              <div className="sv-affix">
                <input
                  id="sdep"
                  type="number"
                  min="0"
                  max="100"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  required
                />
                <span>%</span>
              </div>
            </div>
          </div>

          <div className="sv-field">
            <label><Trans>Price per branch ({money.code})</Trans></label>
            <div className="sv-prices">
              {locations.map((location) => {
                const value = prices[location.id] ?? '';
                const minor = value.trim() ? money.toMinor(value) : null;
                return (
                  <label key={location.id} className={`sv-price${value.trim() ? ' is-set' : ''}`}>
                    <span className="sv-price-branch">
                      <Icon name="pin" size={16} />
                      {location.name}
                    </span>
                    <span className="sv-affix sv-price-input">
                      <span>{money.code}</span>
                      <input
                        type="number"
                        min="0"
                        step={money.exponent === 0 ? '1' : '0.01'}
                        placeholder={t`not offered`}
                        value={value}
                        onChange={(e) => setPrices((current) => ({ ...current, [location.id]: e.target.value }))}
                      />
                    </span>
                    <span className="sv-price-dep">
                      {minor !== null && Number.isFinite(minor) ? t`${money.format(depositShare(minor))} up front` : '—'}
                    </span>
                  </label>
                );
              })}
            </div>
            <span className="sv-help">
              <Trans>The price is for one person. Leave a branch blank to stop offering it there.</Trans>
            </span>
            {/* How many people one booking can be for is the branch's to say,
                not the service's (§189). */}
            <span className="sv-help">
              <Trans>
                How many people can book the same time is set for each branch, under{' '}
                <Link to="/hours">Branches &amp; hours</Link> → “People served at once”.
              </Trans>
            </span>
          </div>
        </Section>

        {/* What customers answer while booking (§300, §304): each answer can
            add to the price and the time. After the price, because it builds on it. */}
        <Section
          id="sv-choices"
          icon="sliders"
          title={t`Questions for customers`}
          hint={
            groups.length > 0
              ? plural(groups.length, { one: '# question customers answer when they book', other: '# questions customers answer when they book' })
              : t`Optional — ask what they want, like the cut or extras`
          }
        >
          <ChoicesEditor
            money={money}
            groups={groups}
            onGroups={setGroups}
            noteEnabled={noteEnabled}
            onNoteEnabled={setNoteEnabled}
            notePrompt={notePrompt}
            onNotePrompt={setNotePrompt}
            priceAtShop={priceAtShop}
            onPriceAtShop={setPriceAtShop}
            basePriceMinor={offers.length ? Math.min(...offers.map((o) => o.priceMinor)) : null}
            durationMinutes={Number(duration) || 0}
          />
        </Section>

        {/* A sale (§186): a percentage off every branch's price, until a last
            day or until it is ended. What customers will pay is worked out as
            it is typed, branch by branch. */}
        <Section icon="percent" title={t`Discount`} hint={t`Optional — customers see the old price crossed out`}>
          <div className="sv-two">
            <div className="sv-field">
              <label htmlFor="sdisc"><Trans>Percent off</Trans></label>
              <div className="sv-affix">
                <input
                  id="sdisc"
                  type="number"
                  min="1"
                  max="90"
                  step="1"
                  placeholder={t`e.g. 20`}
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
                <span>%</span>
              </div>
            </div>
            <div className="sv-field">
              <label htmlFor="sends"><Trans>Last day</Trans></label>
              <input
                id="sends"
                type="date"
                min={todayYmd()}
                value={saleEndsOn}
                disabled={!percentOff}
                onChange={(e) => setSaleEndsOn(e.target.value)}
              />
            </div>
          </div>
          {percentOff !== null && percentOff >= 1 && percentOff <= 90 ? (
            <div className="sv-sale-preview">
              {locations
                .filter((l) => prices[l.id]?.trim())
                .map((l) => {
                  const list = money.toMinor(prices[l.id]);
                  return (
                    <div key={l.id}>
                      <span>{l.name}</span>
                      <span className="sv-sale-pay">
                        <Trans>
                          customers pay <strong>{money.format(salePrice(list, percentOff))}</strong> instead of{' '}
                          <s>{money.format(list)}</s>
                        </Trans>
                      </span>
                    </div>
                  );
                })}
              <p>
                {saleEndsOn
                  ? t`${percentOff}% off until the end of ${niceDay(saleEndsOn)}. Bookings made before then keep the discounted price.`
                  : t`${percentOff}% off until you end it. Bookings already made keep the price they were made at.`}
              </p>
            </div>
          ) : saleEnded && initial?.discountEndsOn ? (
            <span className="sv-help"><Trans>The last sale ended on {niceDay(initial.discountEndsOn.slice(0, 10))}.</Trans></span>
          ) : null}
          {(discount || saleEndsOn) && (
            <button
              type="button"
              className="link danger-link"
              onClick={() => {
                setDiscount('');
                setSaleEndsOn('');
              }}
            >
              <Trans>End the discount</Trans>
            </button>
          )}
        </Section>

        <Section
          id="sv-photos"
          icon="camera"
          title={t`Photos`}
          hint={t`${photos.length} of ${PHOTO_LIMIT} · choose the cover with “Make cover”`}
        >
          <p className="sv-help">
            {creating
              ? t`Customers see these when they pick this service. Add them now and they go up with it; you can change them later from Edit.`
              : t`Customers see these when they pick this service. Changes here wait for “Save changes” — nothing changes in the app until you press it.`}
          </p>
          <DropZone
            onFiles={addFiles}
            multiple
            disabled={busy || photos.length >= PHOTO_LIMIT}
            hint={t`Drop photos for this service`}
          >
          <div className="sv-photo-grid">
            {photos.map((photo, index) => (
              <PhotoTile
                key={photo.key}
                url={photo.url}
                cover={index === 0}
                fresh={!creating && !photo.id}
                busy={busy}
                // The cover is simply the first: choosing one moves it there,
                // and it leads once the form is saved (§187).
                onCover={() => setPhotos((was) => [was[index], ...was.filter((_, i) => i !== index)])}
                onRemove={() => setPhotos((was) => was.filter((_, i) => i !== index))}
              />
            ))}
            {photos.length < PHOTO_LIMIT && (
              <>
                <input
                  id="service-photos-pick"
                  type="file"
                  multiple
                  className="visually-hidden"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  disabled={busy}
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    event.target.value = '';
                  }}
                />
                <label htmlFor="service-photos-pick" className={`sv-photo-add${busy ? ' is-disabled' : ''}`}>
                  <Icon name="upload" size={22} />
                  {photos.length === 0 ? t`Add photos` : t`Add more photos`}
                  <small className="drop-tip"><Trans>or drop them here</Trans></small>
                </label>
              </>
            )}
          </div>
          </DropZone>
          {photoProblem && (
            <p className="sv-form-problem sv-photo-problem" role="alert">
              <Icon name="alert" size={16} />
              <span>{photoProblem}</span>
            </p>
          )}
          {photos.length === 0 && !creating && (
            <p className="sv-help"><Trans>No photos. A service with a photo is easier to choose than one without.</Trans></p>
          )}
          {!creating && photosChanged && (
            <p className="sv-photo-pending" role="status">
              <Icon name="info" size={15} />
              <Trans>
                Photo changes are not saved yet — customers still see the photos as they
                were until you press “Save changes”.
              </Trans>
            </p>
          )}
        </Section>
      </div>

      <footer className="sv-form-foot">
        {problem && !busy && (
          <p className="sv-form-problem" role="alert">
            <Icon name="alert" size={16} />
            <span>{problem}</span>
          </p>
        )}
        {creating && !busy && !problem && offers.length > 0 && (
          <span className="sv-golive">
            <i className={hiddenUntil ? 'dot-off' : 'dot-ok'} />
            {hiddenUntil
              ? hiddenUntil === 'approval'
                ? plural(offers.length, {
                    one: 'Ready at # branch — customers see it once your shop is live.',
                    other: 'Ready at # branches — customers see it once your shop is live.',
                  })
                : hiddenUntil === 'posting'
                  ? plural(offers.length, {
                      one: 'Ready at # branch — customers see it once you post your shop.',
                      other: 'Ready at # branches — customers see it once you post your shop.',
                    })
                  : plural(offers.length, {
                      one: 'Ready at # branch — customers see it once you open your shop again.',
                      other: 'Ready at # branches — customers see it once you open your shop again.',
                    })
              : photos.length > 0
                ? t`Goes live at ${plural(offers.length, { one: '# branch', other: '# branches' })} with ${plural(photos.length, { one: '# photo', other: '# photos' })}.`
                : plural(offers.length, { one: 'Goes live at # branch.', other: 'Goes live at # branches.' })}
          </span>
        )}
        <div className="sv-form-actions">
          {creating && onSaveDraft ? (
            <button
              type="button"
              className="sv-draft-btn"
              onClick={onSaveDraft}
              disabled={busy || !canDraft}
              title={canDraft ? t`Keep it under Drafts and finish it later` : t`Type something first`}
            >
              <Icon name="pencil" size={16} />{' '}
              <Trans>Save as draft</Trans>
            </button>
          ) : (
            onCancel && (
              <button type="button" onClick={onCancel}>
                <Trans>Cancel</Trans>
              </button>
            )
          )}
          <button type="submit" className="primary" disabled={busy}>
            {busy ? (busyLabel ?? t`Saving…`) : creating ? (hiddenUntil ? t`Add this service` : t`Post this service`) : t`Save changes`}
          </button>
        </div>
      </footer>
    </form>
  );
}

/** The first question that would stop the form saving, to open it. */
function firstTroubled(groups: GroupDraft[]) {
  return groups.findIndex((g) => choicesProblem([g]) !== null);
}

/** Today in the seller's own calendar, as YYYY-MM-DD. */
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A sale's last day has passed (§186). A last day of today is still on. */
function isSaleOver(endsOn: string | null) {
  return endsOn !== null && endsOn.slice(0, 10) < todayYmd();
}

/** "Sun 12 Oct", for a YYYY-MM-DD. */
function niceDay(ymd: string) {
  return formatDate(new Date(`${ymd}T12:00:00Z`), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** The same rounding the server uses: half up, to a whole unit (§186). */
function salePrice(priceMinor: number, percent: number) {
  return Math.round((priceMinor * (100 - percent)) / 100);
}

/**
 * One photo of a service (§187): the cover marked on the picture itself and
 * framed in coral; every other photo offers "Make cover".
 */
function PhotoTile({
  url,
  cover,
  fresh = false,
  busy,
  onCover,
  onRemove,
}: {
  url: string;
  cover: boolean;
  /** Added in this form and not saved yet (§281). */
  fresh?: boolean;
  busy?: boolean;
  onCover: () => void;
  onRemove: () => void;
}) {
  return (
    <figure className={cover ? 'sv-photo is-cover' : 'sv-photo'}>
      <img src={url} alt="" />
      {cover && <span className="sv-cover-badge"><Trans>★ Cover</Trans></span>}
      {fresh && <span className="sv-new-badge"><Trans>Not saved</Trans></span>}
      <figcaption>
        {cover ? (
          <span className="sv-on-card"><Trans>On the card</Trans></span>
        ) : (
          <button type="button" disabled={busy} onClick={onCover}>
            <Trans>Make cover</Trans>
          </button>
        )}
        <button type="button" className="sv-photo-remove" disabled={busy} onClick={onRemove} aria-label={t`Remove`}>
          <Icon name="trash" size={15} />
        </button>
      </figcaption>
    </figure>
  );
}
