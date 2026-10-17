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
import { ImageButton } from '../components/ImageButton';
import {
  addServiceImage,
  getServiceImages,
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
    } as unknown as Service);
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
          title: 'Leave without saving?',
          body: (
            <p>
              Your changes to “{editor.service.name}” are not saved yet. If you leave now, the service stays as it was.
            </p>
          ),
          tone: 'warn',
          icon: 'pencil',
          confirmLabel: 'Leave without saving',
          cancelLabel: 'Keep editing',
        });
        if (!leave) return;
      }
      if (editor.mode === 'new') {
        if (!edited.current && !resumed && draftRef.current) {
          discard.mutate(draftRef.current);
        } else if (!(await flushDraft())) {
          const close = await confirmDialog({
            title: 'Close without your last changes?',
            body: <p>We could not save what you typed last — check your connection. Everything before it is saved.</p>,
            tone: 'warn',
            icon: 'alert',
            confirmLabel: 'Close anyway',
            cancelLabel: 'Keep writing',
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
  const hiddenUntil = !p
    ? null
    : p.status !== 'APPROVED'
      ? 'your shop is live'
      : !p.publishedAt
        ? 'you post your shop'
        : p.pausedAt
          ? 'you open your shop again'
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
    mutationFn: async (input: { id?: string; body: Record<string, unknown>; files?: File[] }) => {
      if (input.id) return updateService(input.id, input.body);
      setPostProblem(null);
      setPosting('Posting the service…');
      const created = await createService(input.body as never);
      const files = input.files ?? [];
      const failed: string[] = [];
      for (const [index, file] of files.entries()) {
        setPosting(`Uploading photo ${index + 1} of ${files.length}…`);
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
        void alertDialog({ title: 'Nobody can book it now', body: <p>{result.message}</p>, tone: 'warn' });
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
      title: `Stop offering “${service.name}” at every branch?`,
      body: (
        <p>
          It moves to “Not on sale”, keeps its prices, and you can put it back at any time.
          Appointments already made are unaffected.
        </p>
      ),
      tone: 'danger',
      icon: 'pause',
      confirmLabel: 'Stop offering everywhere',
      cancelLabel: 'Keep it on sale',
    });
    if (ok) everywhere.mutate({ id: service.id, isOffered: false });
  };

  // A refused save is said inside the open form, where the person is (§280).
  const error = (editor ? null : save.error) ?? everywhere.error ?? toggle.error ?? unretire.error;
  const saveProblem = save.error ? (save.error instanceof ApiError ? save.error.message : 'That did not save. Check your connection and try again.') : null;

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
            <h1>Services</h1>
            <p className="muted sv-lead">
              Each service is offered at the branches you choose, at <strong>that branch's price</strong> —
              a city-centre shop can charge more than a quieter one for the same work. The deposit
              percentage is what a customer pays up front to hold the slot; the rest is settled with you
              directly.
            </p>
          </div>
          {access.runsBusiness && (
            <button type="button" className="primary sv-add" onClick={startNew}>
              <Icon name="plus" size={18} stroke={2.4} />
              Add a service
            </button>
          )}
        </header>
      </div>

      {!access.runsBusiness && (
        <p className="sv-scope">
          <Icon name="shield" size={16} />
          {access.runsBranches
            ? 'You can switch a service on or off at your branches. The owner, or a manager of every branch, changes the menu and its prices.'
            : 'You can see what is on sale at your branches. The owner or a manager changes it.'}
        </p>
      )}

      {services.data && services.data.length > 0 && (
        <div className="sv-chips">
          <span className="sv-chip">
            <i className="dot-ok" /> {onSale.length} on sale
          </span>
          {withSale > 0 && (
            <span className="sv-chip is-accent">
              <Icon name="percent" size={14} stroke={2.2} /> {withSale} with a sale on
            </span>
          )}
          {noPhotos > 0 && (
            <span className="sv-chip is-warn">
              <Icon name="camera" size={14} /> {noPhotos} without photos
            </span>
          )}
          {notOnSale.length > 0 && (
            <span className="sv-chip">
              <i className="dot-off" /> {notOnSale.length} not on sale
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="notice" role="alert">
          {error instanceof ApiError ? error.message : 'That did not work.'}
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
            <Icon name="pencil" size={16} /> Drafts
            <span>{drafts.data!.length}</span>
            <em className="sv-drafts-note">Saved as you typed — customers never see a draft</em>
          </h2>
          <div className="sv-draft-row">
            {drafts.data?.map((item) => (
              <article key={item.id} className={`sv-draft${fresh === item.id ? ' is-fresh' : ''}`}>
                <div className="sv-draft-top">
                  <span className="sv-draft-icon">
                    <Icon name="tag" size={18} />
                  </span>
                  <div>
                    <strong>{item.name || 'Untitled service'}</strong>
                    <span>{fresh === item.id ? 'Saved just now' : `Last saved ${ago(item.updatedAt)}`}</span>
                  </div>
                </div>
                <div className="sv-draft-by">
                  <Avatar label={item.createdBy.email} size={22} />
                  <span>started by {item.createdBy.email}</span>
                </div>
                <div className="sv-draft-actions">
                  <button
                    type="button"
                    className="link danger-link"
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: 'Throw this draft away?',
                          body: <p>What was written in it cannot be brought back.</p>,
                          tone: 'danger',
                          icon: 'trash',
                          confirmLabel: 'Discard',
                        })
                      ) {
                        discard.mutate(item.id);
                      }
                    }}
                  >
                    Discard
                  </button>
                  <button type="button" className="dark" onClick={() => resume(item)}>
                    Carry on <Icon name="arrowRight" size={16} stroke={2.2} />
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
              <h2>Put your first service on sale</h2>
              <p>
                A name, how long it takes, a price at each branch — and a photo or two. Customers can book
                it the moment it is posted.
              </p>
              <button type="button" className="primary" onClick={startNew}>
                <Icon name="plus" size={18} stroke={2.4} /> Add a service
              </button>
            </>
          ) : (
            <>
              <h2>Nothing on sale at your branches yet</h2>
              <p>When the owner adds a service at your branch, it shows here.</p>
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
            <Icon name="pause" size={16} /> Not on sale
            <span>{notOnSale.length}</span>
          </h2>
          <p className="muted small sv-off-lead">
            Still yours, and bookable by nobody. Kept so past appointments resolve to what was booked.
            Switch a branch back on — or press <strong>Put back on sale</strong> if you retired it
            everywhere.
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
          title={editor.mode === 'new' ? (resumed ? 'Carry on with your service' : 'New service') : editor.service.name}
          eyebrow={editor.mode === 'new' ? 'Add a service' : 'Edit service'}
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
              busyLabel={posting ?? undefined}
              creating
              hiddenUntil={hiddenUntil}
              canDraft={draftSave.kind !== 'new' || Boolean(resumed)}
              onSaveDraft={() => void saveAsDraft()}
              problem={saveProblem}
              onSubmit={(body, files) => {
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
              focus={editor.focus}
              onCancel={() => void requestClose()}
              onDirtyChange={setDirty}
              problem={saveProblem}
              onSubmit={(body) => save.mutate({ id: editor.service.id, body })}
              photos={<ServicePhotos serviceId={editor.service.id} />}
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
          <button type="button" className="sv-panel-close" onClick={onClose} aria-label="Close this panel">
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
  const at = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const [icon, words, tone]: [ReactNode, string, string] =
    look.kind === 'saving'
      ? [<i className="sv-save-spin" />, editing ? 'Saving…' : 'Saving draft…', 'is-saving']
      : look.kind === 'saved'
        ? [<Icon name="check" size={13} stroke={3} />, `Draft saved · ${at(look.at)}`, 'is-saved']
        : look.kind === 'failed'
          ? [<Icon name="alert" size={13} />, 'Not saved — trying again', 'is-failed']
          : look.kind === 'unsaved'
            ? [<i className="sv-save-dot" />, 'Unsaved changes', 'is-unsaved']
            : look.kind === 'clean'
              ? [<Icon name="check" size={13} stroke={3} />, 'All changes saved', 'is-clean']
              : [<Icon name="pencil" size={13} />, 'Saved as a draft while you type', 'is-new'];
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
    ['Title', Boolean(service.title)],
    ['Description', Boolean(service.description)],
    ['Instructions', Boolean(service.instructions)],
  ];
  const written = words.filter(([, has]) => has).length;

  return (
    <article className={`svc${restore ? ' is-off' : ''}`} style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
      <button
        type="button"
        className="svc-cover"
        onClick={canEdit ? onPhotos : undefined}
        disabled={!canEdit}
        aria-label={`Photos of ${service.name}`}
      >
        {cover ? (
          <img src={cover} alt="" />
        ) : (
          <span className="svc-cover-empty">
            <Icon name="camera" size={26} />
            <span>{canEdit ? 'Add a photo' : 'No photo yet'}</span>
          </span>
        )}
        {/* A sale running now (§186), on the picture so it is seen. */}
        {sale && <span className="svc-sale">−{sale}%</span>}
        <span className="svc-count">
          <Icon name="image" size={14} />
          {service.images.length === 0
            ? 'No photos'
            : `${service.images.length} photo${service.images.length === 1 ? '' : 's'}`}
        </span>
      </button>

      <div className="svc-body">
        <h3>{service.name}</h3>
        <p className={`svc-title${service.title ? '' : ' is-missing'}`}>{service.title || 'No title yet'}</p>

        <div className="svc-meta">
          <span>
            <Icon name="clock" size={15} /> {service.durationMinutes} min
          </span>
          <span>
            <Icon name="wallet" size={15} /> {service.depositPercentage}% deposit
          </span>
        </div>
        {depositMinor !== null && (
          <p className="svc-dep">from {money.format(depositMinor)} up front</p>
        )}
        {sale && (
          <p className="svc-sale-line">
            <Icon name="percent" size={13} stroke={2.2} /> {sale}% off
            {service.discountEndsOn ? ` · until ${niceDay(service.discountEndsOn.slice(0, 10))}` : ' · until you end it'}
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
                  <span className="muted small">service stopped</span>
                ) : !canToggle ? (
                  <span className={`svc-state${offer.isOffered ? ' is-on' : ''}`}>
                    {offer.isOffered ? 'On sale' : 'Paused'}
                  </span>
                ) : (
                  <Switch
                    checked={offer.isOffered}
                    disabled={busy}
                    label={offer.isOffered ? `Stop offering here (${offer.location.name})` : `Put back on sale here (${offer.location.name})`}
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
          <p className="svc-none">{service.isActive ? 'Switched off at every branch' : 'Service stopped'}</p>
        )}

        <div className="svc-words" title="What a customer reads on the service's page">
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
            <Icon name="pencil" size={16} /> Edit
          </button>
          <button type="button" onClick={onPhotos}>
            <Icon name="image" size={16} /> Photos
          </button>
          {restore ? (
            <button type="button" className="primary svc-restore" disabled={busy} onClick={onRetire}>
              Put back on sale
            </button>
          ) : (
            <MoreMenu
              disabled={busy}
              items={[
                { label: 'Edit', icon: 'pencil', onClick: onEdit },
                { label: 'Photos', icon: 'image', onClick: onPhotos },
                { label: 'Stop offering everywhere', icon: 'pause', onClick: onRetire, danger: true },
              ]}
            />
          )}
        </footer>
      )}
    </article>
  );
}

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

function ServiceForm({
  money,
  locations,
  busy,
  busyLabel,
  creating = false,
  initial,
  focus,
  photos,
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
  /** Open scrolled to a section — the cover's "Photos" lands on the photos. */
  focus?: 'photos';
  /** An existing service's live photo manager, shown as the last section. */
  photos?: ReactNode;
  /** When customers will see a new service, if not at once (§268) — e.g. "you post your shop". */
  hiddenUntil?: string | null;
  /** Something is written, so "Save as draft" has something to keep. */
  canDraft?: boolean;
  /** "Save as draft" on a NEW service: saved now, and the panel closes (§269). */
  onSaveDraft?: () => void;
  /** Why the last post or save was refused, said beside the button (§280). */
  problem?: string | null;
  /** `files` are the photos chosen for a NEW service, cover first (§165). */
  onSubmit: (body: Record<string, unknown>, files: File[]) => void;
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
  // Photos chosen while writing a NEW service (§165). Held as files until
  // "Post", because a photo needs a service to belong to and there is none
  // yet; an existing service has its live photo manager instead.
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);
  const PHOTO_LIMIT = 11;

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
    };
    const snapshot = JSON.stringify(values);
    if (baseline.current === null) baseline.current = snapshot;
    const changed = snapshot !== baseline.current;
    onChange?.(values, changed);
    onDirtyChange?.(changed);
    // `offers` is derived from `prices` and rebuilt each render, so watching it
    // directly would fire this on every render rather than on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, title, description, instructions, discount, saleEndsOn, duration, deposit, prices]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The box cannot stop typing at the limit as a plain one did; it says so here.
    const long = [
      description.length > 2000 && `the description by ${description.length - 2000}`,
      instructions.length > 600 && `the special instructions by ${instructions.length - 600}`,
    ].filter(Boolean);
    if (long.length > 0) {
      void alertDialog({
        title: 'A little too long',
        body: <p>Shorten {long.join(' and ')} characters — the count is at the top right of each box.</p>,
        tone: 'warn',
        icon: 'pencil',
      });
      return;
    }
    if (offers.length === 0) {
      void alertDialog({
        title: 'Give it a price',
        body: <p>Give a price at a least one branch, or nobody can book it.</p>,
        tone: 'warn',
        icon: 'tag',
      });
      return;
    }
    if (discount.trim() && (percentOff === null || percentOff < 1 || percentOff > 90)) {
      void alertDialog({
        title: 'Check the sale',
        body: <p>A sale is a whole number from 1 to 90 percent off — or leave it empty for no sale.</p>,
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
      },
      files,
    );
  };

  const depositShare = (minor: number) => Math.round((minor * Number(deposit || 0)) / 100);

  return (
    <form className="sv-form" onSubmit={submit}>
      <div className="sv-form-body" ref={body}>
        {/* The words a customer reads (§180, §185), in the order the service's
            page shows them. */}
        <Section icon="pencil" title="Name and words" hint="What customers read when they choose it">
          <div className="sv-field">
            <label htmlFor="sname">Name</label>
            <input
              id="sname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Haircut"
              required
              autoFocus={creating}
            />
          </div>
          <div className="sv-field">
            <label htmlFor="stitle">
              Title <em>{title.length}/100</em>
            </label>
            <input
              id="stitle"
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="One line that makes someone want it — e.g. “Sharp fades and clean line-ups”"
            />
            <span className="sv-help">
              The headline right under the photos. The name above stays the short label on cards.
            </span>
          </div>
          <div className="sv-field">
            <label id="sdesc-label" onClick={() => document.getElementById('sdesc')?.focus()}>
              Description
            </label>
            <RichTextBox
              id="sdesc"
              labelledBy="sdesc-label"
              rows={4}
              maxLength={2000}
              value={description}
              onChange={setDescription}
              placeholder="What it is and what is included — a customer reads this before choosing it."
            />
            <span className="sv-help">Shown under “About this service”.</span>
          </div>
          <div className="sv-field">
            <label id="sinstr-label" onClick={() => document.getElementById('sinstr')?.focus()}>
              Special instructions
            </label>
            <RichTextBox
              id="sinstr"
              labelledBy="sinstr-label"
              rows={3}
              maxLength={600}
              value={instructions}
              onChange={setInstructions}
              placeholder="What to know before coming: arrive ten minutes early, bring a towel, park at the back…"
            />
            <span className="sv-help">
              Shown as “Before you come” — on the service, and again on the customer’s reservation.
            </span>
          </div>
        </Section>

        <Section icon="tag" title="Price and time" hint="How long it takes, and what it costs at each branch">
          <div className="sv-two">
            <div className="sv-field">
              <label htmlFor="sdur">Minutes</label>
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
                <span>min</span>
              </div>
            </div>
            <div className="sv-field">
              <label htmlFor="sdep">Deposit %</label>
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
            <label>Price per branch ({money.code})</label>
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
                        placeholder="not offered"
                        value={value}
                        onChange={(e) => setPrices((current) => ({ ...current, [location.id]: e.target.value }))}
                      />
                    </span>
                    <span className="sv-price-dep">
                      {minor !== null && Number.isFinite(minor) ? `${money.format(depositShare(minor))} up front` : '—'}
                    </span>
                  </label>
                );
              })}
            </div>
            <span className="sv-help">
              The price is for one person. Leave a branch blank to stop offering it there.
            </span>
            {/* How many people one booking can be for is the branch's to say,
                not the service's (§189). */}
            <span className="sv-help">
              How many people can book the same time is set for each branch, under{' '}
              <Link to="/hours">Branches &amp; hours</Link> → “People served at once”.
            </span>
          </div>
        </Section>

        {/* A sale (§186): a percentage off every branch's price, until a last
            day or until it is ended. What customers will pay is worked out as
            it is typed, branch by branch. */}
        <Section icon="percent" title="Sale" hint="Optional — customers see the old price crossed out">
          <div className="sv-two">
            <div className="sv-field">
              <label htmlFor="sdisc">Percent off</label>
              <div className="sv-affix">
                <input
                  id="sdisc"
                  type="number"
                  min="1"
                  max="90"
                  step="1"
                  placeholder="e.g. 20"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
                <span>%</span>
              </div>
            </div>
            <div className="sv-field">
              <label htmlFor="sends">Last day</label>
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
                        customers pay <strong>{money.format(salePrice(list, percentOff))}</strong> instead of{' '}
                        <s>{money.format(list)}</s>
                      </span>
                    </div>
                  );
                })}
              <p>
                {saleEndsOn
                  ? `${percentOff}% off until the end of ${niceDay(saleEndsOn)}. Bookings made before then keep the sale price.`
                  : `${percentOff}% off until you end it. Bookings already made keep the price they were made at.`}
              </p>
            </div>
          ) : saleEnded && initial?.discountEndsOn ? (
            <span className="sv-help">The last sale ended on {niceDay(initial.discountEndsOn.slice(0, 10))}.</span>
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
              End the sale
            </button>
          )}
        </Section>

        {creating ? (
          <Section
            id="sv-photos"
            icon="camera"
            title="Photos"
            hint={`${files.length} of ${PHOTO_LIMIT} · choose the cover with “Make cover”`}
          >
            <p className="sv-help">
              Customers see these when they pick this service. Add them now and they go up with it; you
              can change them later from Edit.
            </p>
            <div className="sv-photo-grid">
              {previews.map((url, index) => (
                <PhotoTile
                  key={url}
                  url={url}
                  cover={index === 0}
                  // The cover is simply the first: choosing one moves it there,
                  // and it goes up first when the service is posted (§187).
                  onCover={() => setFiles((was) => [was[index], ...was.filter((_, i) => i !== index)])}
                  onRemove={() => setFiles((was) => was.filter((_, i) => i !== index))}
                />
              ))}
              {files.length < PHOTO_LIMIT && (
                <>
                  <input
                    id="new-service-photos"
                    type="file"
                    multiple
                    className="visually-hidden"
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    disabled={busy}
                    onChange={(event) => {
                      const picked = Array.from(event.target.files ?? []);
                      setFiles((was) => [...was, ...picked].slice(0, PHOTO_LIMIT));
                      event.target.value = '';
                    }}
                  />
                  <label htmlFor="new-service-photos" className={`sv-photo-add${busy ? ' is-disabled' : ''}`}>
                    <Icon name="upload" size={22} />
                    {files.length === 0 ? 'Add photos' : 'Add more photos'}
                  </label>
                </>
              )}
            </div>
          </Section>
        ) : (
          photos && (
            <Section id="sv-photos" icon="camera" title="Photos" hint="Changes here are saved straight away">
              {photos}
            </Section>
          )
        )}
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
              ? `Ready at ${offers.length} ${offers.length === 1 ? 'branch' : 'branches'} — customers see it once ${hiddenUntil}.`
              : `Goes live at ${offers.length} ${offers.length === 1 ? 'branch' : 'branches'}${
                  files.length > 0 ? ` with ${files.length} ${files.length === 1 ? 'photo' : 'photos'}` : ''
                }.`}
          </span>
        )}
        <div className="sv-form-actions">
          {creating && onSaveDraft ? (
            <button
              type="button"
              className="sv-draft-btn"
              onClick={onSaveDraft}
              disabled={busy || !canDraft}
              title={canDraft ? 'Keep it under Drafts and finish it later' : 'Type something first'}
            >
              <Icon name="pencil" size={16} /> Save as draft
            </button>
          ) : (
            onCancel && (
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
            )
          )}
          <button type="submit" className="primary" disabled={busy}>
            {busy ? (busyLabel ?? 'Saving…') : creating ? (hiddenUntil ? 'Add this service' : 'Post this service') : 'Save changes'}
          </button>
        </div>
      </footer>
    </form>
  );
}

/**
 * Photos of one service (§132).
 *
 * The limit and the room left come from the SERVER, never from a constant
 * here: a number hardcoded in a client is a number that disagrees with the
 * server the first time either changes (§132.3).
 */
function ServicePhotos({ serviceId }: { serviceId: string }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);

  const photos = useQuery({
    queryKey: ['service-images', serviceId],
    queryFn: () => getServiceImages(serviceId),
  });

  // Both lists change: this one, and the service list that carries the cover.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['service-images', serviceId] });
    queryClient.invalidateQueries({ queryKey: ['services'] });
  };

  const add = useMutation({
    mutationFn: (file: File) => addServiceImage(serviceId, file),
    onSuccess: refresh,
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'That did not upload.'),
  });

  // The cover (§187): the listing that comes back is drawn at once, and the
  // services list is refreshed for its thumbnail.
  const cover = useMutation({
    mutationFn: (imageId: string) => setServiceImageCover(serviceId, imageId),
    onSuccess: (listing) => {
      queryClient.setQueryData(['service-images', serviceId], listing);
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'That did not change the cover.'),
  });

  const drop = useMutation({
    mutationFn: (imageId: string) => removeServiceImage(serviceId, imageId),
    onSuccess: refresh,
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'That did not delete.'),
  });

  const full = (photos.data?.remaining ?? 1) <= 0;

  return (
    <div className="sv-photos">
      <p className="sv-help">
        Customers see these when they pick this service. The <strong>cover</strong> is the one on the
        service’s card in the app — choose it with “Make cover”.
        {photos.data && (
          <span className="sv-photo-count">
            {' '}
            {photos.data.count} of {photos.data.limit}
          </span>
        )}
      </p>

      <div className="sv-photo-grid">
        {photos.data?.images.map((photo, index) => (
          <PhotoTile
            key={photo.id}
            url={photo.url}
            cover={index === 0}
            busy={cover.isPending || drop.isPending}
            onCover={() => {
              setProblem(null);
              cover.mutate(photo.id);
            }}
            onRemove={async () => {
              if (
                await confirmDialog({
                  title: 'Remove this photo?',
                  body: <p>It cannot be brought back.</p>,
                  tone: 'danger',
                  icon: 'trash',
                  confirmLabel: 'Remove',
                })
              ) {
                setProblem(null);
                drop.mutate(photo.id);
              }
            }}
          />
        ))}
      </div>

      {photos.data?.count === 0 && (
        <p className="sv-help">No photos yet. A service with a photo is easier to choose than one without.</p>
      )}

      {full ? (
        <p className="sv-help">
          This service is at its {photos.data?.limit} photo limit. Remove one to add another.
        </p>
      ) : (
        <ImageButton
          id={`service-photo-${serviceId}`}
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
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, {
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
  busy,
  onCover,
  onRemove,
}: {
  url: string;
  cover: boolean;
  busy?: boolean;
  onCover: () => void;
  onRemove: () => void;
}) {
  return (
    <figure className={cover ? 'sv-photo is-cover' : 'sv-photo'}>
      <img src={url} alt="" />
      {cover && <span className="sv-cover-badge">★ Cover</span>}
      <figcaption>
        {cover ? (
          <span className="sv-on-card">On the card</span>
        ) : (
          <button type="button" disabled={busy} onClick={onCover}>
            Make cover
          </button>
        )}
        <button type="button" className="sv-photo-remove" disabled={busy} onClick={onRemove} aria-label="Remove">
          <Icon name="trash" size={15} />
        </button>
      </figcaption>
    </figure>
  );
}
