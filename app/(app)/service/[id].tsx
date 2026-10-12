import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { serviceApi } from '../../../src/api/service';
import {
  SERVICE_DECLINE_REASONS,
  SERVICE_MIN_PHOTOS,
  SERVICE_PROBLEM_REASONS,
  SERVICE_REVISIT_REASONS,
  SERVICE_TERMINAL,
  ServiceJob,
  ServiceStepResult,
} from '../../../src/api/serviceTypes';
import { ApiError } from '../../../src/api/types';
import { useNow } from '../../../src/hooks/useNow';
import { useWorkload } from '../../../src/hooks/useWorkload';
import { serverNow } from '../../../src/lib/clock';
import { money } from '../../../src/lib/format';
import { getOwed, onOwedChange, OwedPhotos, takenFor } from '../../../src/photos/owed';
import { useUploads } from '../../../src/photos/uploader';
import { passBackOtherOffers, useAcceptLock, withAcceptLock } from '../../../src/store/acceptLock';
import { useSession } from '../../../src/store/session';
import { CONTENT_MAX_W, glass, gradius, gspace } from '../../../src/theme/glass';
import { servicePalette as S } from '../../../src/theme/workspace';
import { CodeSheet } from '../../../src/ui/CodeSheet';
import { confirm, notice } from '../../../src/ui/ConfirmSheet';
import { GlassCard } from '../../../src/ui/glass/GlassCard';
import { GlassIcon, GlassIconName } from '../../../src/ui/glass/GlassIcon';
import { GlassScreen } from '../../../src/ui/glass/GlassScreen';
import { GlassText } from '../../../src/ui/glass/GlassText';
import { Chip, Countdown, km, slotText, StatusPill, SvcButton, SvcHeader, Tile } from '../../../src/ui/service/ServiceKit';
import { SosShield } from '../../../src/ui/SosSheet';
import { showToast } from '../../../src/ui/Toast';

/**
 * One service visit, from the offer to the customer's sign-off.
 *
 * Like the delivery job screen, it keeps no state machine of its own: the
 * server's `allowed_actions` decide the one big button. The steps are
 *
 *   offer → Accept → parts check → Start travel → I've arrived
 *         → before photos → Start work → Finish work → after photos
 *         → customer's code (sign-off) → done
 *
 * with "Needs another visit" and "Report a problem" on the side.
 */

type Reasons = 'decline' | 'revisit' | 'problem' | null;

export default function ServiceVisit() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = Number(raw);
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const timezone = useSession((s) => s.timezone);
  const lock = useAcceptLock((s) => s.busy);
  const { offers } = useWorkload();

  const { data: job, isLoading, refetch } = useQuery<ServiceJob>({
    queryKey: ['service-job', id],
    queryFn: () => serviceApi.job(id),
    refetchInterval: 10_000,
  });

  // Photos taken and still going up count as taken: Start work and Sign-off
  // do not wait for the upload, as on a delivery.
  const beforePhotos = useVisitPhotos(id, 'before');
  const afterPhotos = useVisitPhotos(id, 'after');

  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Reasons>(null);
  const [expired, setExpired] = useState(false);
  const [signoff, setSignoff] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [codeHint, setCodeHint] = useState('Ask the customer for the 6-digit code sent to them on WhatsApp.');
  const [used, setUsed] = useState<Record<string, number> | null>(null);
  const [note, setNote] = useState('');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['service-jobs'] });
    void qc.invalidateQueries({ queryKey: ['service-job', id] });
  };

  /** Run one step; the screen redraws from whatever the server sends back. */
  async function run(key: string, step: () => Promise<ServiceStepResult>) {
    setBusy(key);
    setProblem(null);
    try {
      const res = await step();
      qc.setQueryData(['service-job', id], res.job);
      refresh();
      return res;
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError('unknown', 'Something went wrong. Try again.');
      if (e.code === 'offer_expired' || e.code === 'not_found') {
        refresh();
        await notice('Offer expired', 'It went to another technician.');
        router.replace('/jobs');
      } else if (e.code === 'agent_busy') {
        refresh();
        await notice('That job could not be taken', e.message);
        router.replace('/jobs');
      } else if (e.code === 'network') {
        setProblem(`No signal. ${e.message}`);
      } else {
        setProblem(e.message);
        void refetch();
      }
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function accept() {
    // One Accept at a time across both lines; the server still has the last word.
    let res: ServiceStepResult | null = null;
    try {
      res = await withAcceptLock(`service:${id}`, () => run('accept', () => serviceApi.accept(id)));
    } catch (err) {
      setProblem((err as Error).message);
      return;
    }
    if (!res) return;
    const passed = await passBackOtherOffers('service');
    if (passed) showToast("You're busy now. The delivery offer went to the next rider.");
    void qc.invalidateQueries({ queryKey: ['orders'] });
  }

  async function openSignoff() {
    setCode('');
    setCodeError(null);
    setSignoff(true);
    await sendCode();
  }

  async function sendCode() {
    try {
      const r = await serviceApi.sendSignoffCode(id);
      setCodeHint(r.message);
      setResendAt(serverNow() + r.retry_after_seconds * 1000);
    } catch (err) {
      setCodeError((err as Error).message);
    }
  }

  async function submitCode() {
    setBusy('signoff');
    setCodeError(null);
    try {
      await serviceApi.verifySignoff(id, code);
      setSignoff(false);
      refresh();
      router.replace({ pathname: '/service-done/[id]', params: { id: String(id) } });
    } catch (err) {
      setCodeError((err as Error).message);
      setCode('');
    } finally {
      setBusy(null);
    }
  }

  if (isLoading || !job) {
    return (
      <GlassScreen>
        <SvcHeader title={isLoading ? 'Loading…' : 'That job is gone'} onBack={() => router.back()} />
      </GlassScreen>
    );
  }

  const can = (a: ServiceJob['allowed_actions'][number]) => job.allowed_actions.includes(a);
  const done = SERVICE_TERMINAL.includes(job.status);
  const otherOffer = offers.delivery;
  const lockedByOther = !!lock && lock !== `service:${id}`;

  if (reasons) {
    return (
      <ReasonScreen
        kind={reasons}
        job={job}
        busy={!!busy}
        onCancel={() => setReasons(null)}
        onSend={async (reason, text) => {
          if (reasons === 'decline') {
            const ok = await confirm({
              title: 'Decline this job?',
              message: 'It goes to the next technician at once and is not offered to you again.',
              okLabel: 'Decline',
            });
            if (!ok) return;
            const r = await run('decline', () => serviceApi.decline(id, reason));
            if (r) router.replace('/jobs');
          } else if (reasons === 'revisit') {
            const r = await run('revisit', () => serviceApi.needsRevisit(id, reason));
            if (r) {
              setReasons(null);
              await notice('Visit closed', r.message);
              router.replace('/jobs');
            }
          } else {
            const r = await run('report', () => serviceApi.reportIssue(id, reason, text));
            if (r) {
              setReasons(null);
              showToast(r.message ?? 'The office has been told.');
            }
          }
        }}
      />
    );
  }

  const header = (
    <SvcHeader
      eyebrow={job.status === 'offered' ? 'New service job' : `${job.ref} · ${job.kind === 'repair' ? 'Repair' : 'Install'}`}
      title={`${job.customer_name} · ${job.device}`}
      onBack={() => router.back()}
      right={<SosShield orderRef={job.ref} />}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gspace.xs, marginTop: gspace.sm }}>
        <StatusPill status={job.status} />
        {job.status === 'offered' && otherOffer ? (
          <Chip label={`+${otherOffer} MORE OFFER · DELIVERY`} tone="svc" />
        ) : null}
      </View>
    </SvcHeader>
  );

  return (
    <GlassScreen>
      {header}
      <ScrollView
        contentContainerStyle={{
          padding: gspace.xl,
          width: '100%',
          maxWidth: CONTENT_MAX_W,
          alignSelf: 'center',
          paddingBottom: gspace.xxxl + insets.bottom,
          rowGap: gspace.lg,
        }}
      >
        <GlassCard>
          <GlassText variant="label" tone="soft" upper>
            The job
          </GlassText>
          <GlassText variant="subtitle" style={{ marginTop: gspace.xs }}>
            {job.fault}
          </GlassText>
          <GlassText variant="body" tone="soft">
            {job.task}
          </GlassText>
          <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.md }}>
            <Tile label="Slot" value={slotText(job, timezone)} />
            <Tile label="Distance" value={km(job.distance_m) || '—'} />
            <Tile label={job.payment_status === 'cod' ? 'Collect' : 'Payment'} value={job.payment_status === 'cod' ? money(job.charge, job.currency) : 'Paid'} />
          </View>
        </GlassCard>

        <GlassCard>
          <GlassText variant="label" tone="soft" upper>
            Customer
          </GlassText>
          <GlassText variant="bodyStrong" style={{ marginTop: gspace.xs }}>
            {job.customer_name}
          </GlassText>
          <GlassText variant="body" tone="soft">
            {job.address}, {job.area}
          </GlassText>
          {job.status !== 'offered' && !done ? (
            <View style={{ flexDirection: 'row', gap: gspace.sm, marginTop: gspace.md }}>
              <RoundAction icon="nav" label="Navigate" onPress={() => navigate(job)} />
              <RoundAction icon="phone" label="Call" onPress={() => Linking.openURL(`tel:${job.customer_mobile}`)} />
              <RoundAction
                icon="whatsapp"
                label="WhatsApp"
                onPress={() => Linking.openURL(`https://wa.me/${job.customer_mobile.replace(/\D/g, '')}`)}
              />
            </View>
          ) : null}
        </GlassCard>

        {job.status === 'offered' ? (
          <>
            {expired ? (
              <GlassCard style={{ backgroundColor: glass.redSoft, borderColor: glass.redSoft }}>
                <GlassText variant="bodyStrong" tone="red">
                  Offer expired
                </GlassText>
                <GlassText variant="body" tone="red">
                  It went to another technician.
                </GlassText>
              </GlassCard>
            ) : (
              <Countdown expiresAt={job.offer_expires_at} onExpired={() => setExpired(true)} />
            )}
            <SvcButton
              title="Accept this job"
              onPress={accept}
              loading={busy === 'accept'}
              disabled={expired || lockedByOther || !can('accept')}
            />
            {lockedByOther ? (
              <GlassText variant="caption" tone="soft" style={{ textAlign: 'center' }}>
                Another job is being accepted. One moment.
              </GlassText>
            ) : null}
            <SvcButton title="Decline" kind="quiet" onPress={() => setReasons('decline')} disabled={!!busy || expired} />
          </>
        ) : null}

        {job.status === 'scheduled' || job.status === 'accepted' ? (
          <>
            {job.status === 'scheduled' ? (
              <GlassCard style={{ backgroundColor: S.soft, borderColor: S.soft }}>
                <GlassText variant="bodyStrong">Booked for {slotText(job, timezone)}</GlassText>
                <GlassText variant="body" tone="soft">
                  Deliveries carry on until you start travelling to this visit.
                </GlassText>
              </GlassCard>
            ) : null}
            <GlassCard>
              <GlassText variant="label" tone="soft" upper>
                Parts to carry
              </GlassText>
              {job.parts.length ? (
                job.parts.map((p) => (
                  <View key={p.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: gspace.sm, borderBottomWidth: 1, borderBottomColor: glass.divider }}>
                    <GlassText variant="body">
                      {p.name} ×{p.qty}
                    </GlassText>
                    <GlassText variant="caption" tone="soft">
                      {p.source === 'store' ? 'Collect from the store counter' : 'In your kit'}
                    </GlassText>
                  </View>
                ))
              ) : (
                <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
                  No parts needed.
                </GlassText>
              )}
            </GlassCard>
            <SvcButton title="Start travel" icon="nav" onPress={() => void run('travel', () => serviceApi.startTravel(id))} loading={busy === 'travel'} disabled={!can('start_travel')} />
          </>
        ) : null}

        {job.status === 'on_the_way' ? (
          <SvcButton title="I've arrived" onPress={() => void run('arrived', () => serviceApi.arrived(id))} loading={busy === 'arrived'} disabled={!can('arrived')} />
        ) : null}

        {job.status === 'arrived' ? (
          <>
            <PhotoRow stage="before" entry={beforePhotos} count={job.photo_counts.before} onOpen={() => router.push({ pathname: '/service-photos/[id]', params: { id: String(id), stage: 'before' } })} />
            <SvcButton
              title="Start work"
              icon="timer"
              onPress={() => void run('work', () => serviceApi.startWork(id))}
              loading={busy === 'work'}
              disabled={!can('start_work') || takenFor(beforePhotos, job.photo_counts.before) < SERVICE_MIN_PHOTOS}
            />
          </>
        ) : null}

        {job.status === 'working' ? (
          <>
            <WorkTimer since={job.work_started_at} />
            <GlassCard>
              <GlassText variant="label" tone="soft" upper>
                Parts used
              </GlassText>
              {job.parts.length ? (
                job.parts.map((p) => {
                  const n = (used ?? Object.fromEntries(job.parts.map((x) => [x.name, x.qty])))[p.name] ?? 0;
                  const set = (v: number) =>
                    setUsed({ ...(used ?? Object.fromEntries(job.parts.map((x) => [x.name, x.qty]))), [p.name]: Math.max(0, v) });
                  return (
                    <View key={p.name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: gspace.sm }}>
                      <GlassText variant="body" style={{ flex: 1 }}>
                        {p.name}
                      </GlassText>
                      <Stepper value={n} onChange={set} />
                    </View>
                  );
                })
              ) : (
                <GlassText variant="body" tone="soft">
                  No parts on this job.
                </GlassText>
              )}
              <GlassText variant="label" tone="soft" upper style={{ marginTop: gspace.md }}>
                Note
              </GlassText>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="What you did, anything the office should know"
                placeholderTextColor={glass.inkFaint}
                multiline
                style={{ minHeight: 64, marginTop: gspace.xs, borderWidth: 1, borderColor: glass.border, borderRadius: gradius.chip, padding: gspace.md, color: glass.ink, textAlignVertical: 'top' }}
              />
            </GlassCard>
            <SvcButton
              title="Finish work"
              onPress={() => {
                const counts = used ?? Object.fromEntries(job.parts.map((x) => [x.name, x.qty]));
                void run('finish', () =>
                  serviceApi.finishWork(id, {
                    parts_used: Object.entries(counts)
                      .filter(([, q]) => q > 0)
                      .map(([name, qty]) => ({ name, qty })),
                    note,
                  })
                );
              }}
              loading={busy === 'finish'}
              disabled={!can('finish_work')}
            />
          </>
        ) : null}

        {job.status === 'finished' ? (
          <>
            <PhotoRow stage="after" entry={afterPhotos} count={job.photo_counts.after} onOpen={() => router.push({ pathname: '/service-photos/[id]', params: { id: String(id), stage: 'after' } })} />
            {job.payment_status === 'cod' && job.charge ? (
              <GlassCard>
                <GlassText variant="label" tone="soft" upper>
                  Cash on completion
                </GlassText>
                <GlassText variant="title" nums>
                  Collect {money(job.charge, job.currency)}
                </GlassText>
              </GlassCard>
            ) : null}
            <SvcButton
              title="Customer sign-off – enter code"
              onPress={() => void openSignoff()}
              disabled={!can('verify_signoff') || takenFor(afterPhotos, job.photo_counts.after) < SERVICE_MIN_PHOTOS}
            />
          </>
        ) : null}

        {done ? (
          <GlassCard>
            <GlassText variant="subtitle">
              {job.status === 'signed_off' ? 'Signed off' : job.status === 'revisit' ? 'Closed for another visit' : 'This job is finished'}
            </GlassText>
            <GlassText variant="body" tone="soft">
              Nothing left to do here.
            </GlassText>
          </GlassCard>
        ) : null}

        {problem ? (
          <GlassText variant="bodyStrong" tone="red">
            {problem}
          </GlassText>
        ) : null}

        {!done && job.status !== 'offered' ? (
          <View style={{ borderTopWidth: 1, borderTopColor: glass.divider, paddingTop: gspace.md, rowGap: gspace.sm }}>
            <GlassText variant="label" tone="soft" upper>
              Something wrong?
            </GlassText>
            {can('needs_revisit') ? (
              <SvcButton title="Needs another visit" kind="ghost" onPress={() => setReasons('revisit')} />
            ) : null}
            {can('report_issue') ? (
              <SvcButton title="Report a problem" kind="quiet" onPress={() => setReasons('problem')} />
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <CodeSheet
        visible={signoff}
        title="Enter the customer's code"
        hint={codeHint}
        value={code}
        onChange={setCode}
        error={codeError}
        busy={busy === 'signoff'}
        canSubmit={code.length === 6}
        submitLabel="Signed off – finish job"
        submitKind="green"
        onSubmit={() => void submitCode()}
        onClose={() => setSignoff(false)}
        onResend={() => void sendCode()}
        resendAt={resendAt}
      />
    </GlassScreen>
  );
}

function navigate(job: ServiceJob) {
  const dest =
    job.latitude != null && job.longitude != null
      ? `${job.latitude},${job.longitude}`
      : encodeURIComponent(`${job.address}, ${job.area}`);
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${dest}`);
}

function RoundAction({ icon, label, onPress }: { icon: GlassIconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: gspace.sm, borderRadius: gradius.chip, backgroundColor: S.soft, opacity: pressed ? 0.7 : 1 })}
    >
      <GlassIcon name={icon} color={S.band} size={20} />
      <GlassText variant="caption" style={{ color: S.band, marginTop: 2 }}>
        {label}
      </GlassText>
    </Pressable>
  );
}

/**
 * This visit stage's photo batch in the background queue, kept current - and
 * the visit refetched as each one lands, so the server's count catches up.
 */
function useVisitPhotos(id: number, stage: 'before' | 'after'): OwedPhotos | null {
  const qc = useQueryClient();
  const [entry, setEntry] = useState<OwedPhotos | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      void getOwed(id, stage).then((e) => {
        if (live) setEntry(e);
      });
    read();
    const off = onOwedChange(() => {
      read();
      void qc.invalidateQueries({ queryKey: ['service-job', id] });
    });
    return () => {
      live = false;
      off();
    };
  }, [id, stage, qc]);
  return entry;
}

function PhotoRow({
  stage,
  entry,
  count,
  onOpen,
}: {
  stage: 'before' | 'after';
  entry: OwedPhotos | null;
  count: number;
  onOpen: () => void;
}) {
  const upload = useUploads();
  const taken = takenFor(entry, count);
  const ok = taken >= SERVICE_MIN_PHOTOS;
  const unsent = entry?.submitted ? entry.shots.filter((s) => !s.sent).length : 0;
  const status = !ok
    ? `${taken} of ${SERVICE_MIN_PHOTOS} taken · tap to take them`
    : unsent === 0
      ? `${taken} taken ✓`
      : upload.phase === 'waiting'
        ? `${taken} taken · waiting for signal · ${unsent} left`
        : `${taken} taken · sending ${entry!.shots.length - unsent + 1} of ${entry!.shots.length}`;
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <GlassCard style={{ flexDirection: 'row', alignItems: 'center', gap: gspace.md }}>
        <GlassIcon name="camera" color={S.band} size={24} />
        <View style={{ flex: 1 }}>
          <GlassText variant="bodyStrong">{stage === 'before' ? 'Before photos' : 'After photos'}</GlassText>
          <GlassText variant="caption" tone={ok ? 'green' : 'soft'}>
            {status}
          </GlassText>
        </View>
        <GlassIcon name="chev" color={glass.inkSoft} size={18} />
      </GlassCard>
    </Pressable>
  );
}

function WorkTimer({ since }: { since?: string | null }) {
  const now = useNow(1000);
  const secs = since ? Math.max(0, Math.floor((now - Date.parse(since)) / 1000)) : 0;
  const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return (
    <GlassCard style={{ alignItems: 'center' }}>
      <GlassText variant="label" tone="soft" upper>
        Time on job
      </GlassText>
      <GlassText variant="amountLg" nums style={{ color: S.band }}>
        {hh}:{mm}:{ss}
      </GlassText>
    </GlassCard>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const btn = (label: string, delta: number) => (
    <Pressable
      onPress={() => onChange(value + delta)}
      accessibilityRole="button"
      accessibilityLabel={delta > 0 ? 'One more' : 'One less'}
      hitSlop={6}
      style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: glass.border, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <GlassText variant="subtitle">{label}</GlassText>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: gspace.sm }}>
      {btn('−', -1)}
      <GlassText variant="subtitle" nums style={{ minWidth: 20, textAlign: 'center' }}>
        {value}
      </GlassText>
      {btn('+', 1)}
    </View>
  );
}

function ReasonScreen({
  kind,
  job,
  busy,
  onCancel,
  onSend,
}: {
  kind: Exclude<Reasons, null>;
  job: ServiceJob;
  busy: boolean;
  onCancel: () => void;
  onSend: (reason: string, note?: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [pick, setPick] = useState<string | null>(null);
  const [text, setText] = useState('');
  const list =
    kind === 'decline' ? SERVICE_DECLINE_REASONS : kind === 'revisit' ? SERVICE_REVISIT_REASONS : SERVICE_PROBLEM_REASONS;
  const title =
    kind === 'decline' ? 'Why decline this job?' : kind === 'revisit' ? 'Why another visit?' : 'What is the problem?';
  const sub =
    kind === 'decline'
      ? 'Pick one. The office sees why.'
      : kind === 'revisit'
        ? 'The office books the next slot with the customer.'
        : 'Pick one, then press Send. The office is told.';
  const send = kind === 'decline' ? 'Decline job' : kind === 'revisit' ? 'Send and close this visit' : 'Send report';
  return (
    <GlassScreen>
      <SvcHeader eyebrow={job.ref} title={title} onBack={onCancel} />
      <ScrollView contentContainerStyle={{ padding: gspace.xl, rowGap: gspace.md, width: '100%', maxWidth: CONTENT_MAX_W, alignSelf: 'center', paddingBottom: gspace.xxxl + insets.bottom }}>
        <GlassText variant="body" tone="soft">
          {sub}
        </GlassText>
        {list.map((r) => {
          const on = pick === r.key;
          return (
            <Pressable
              key={r.key}
              onPress={() => setPick(r.key)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={({ pressed }) => ({
                minHeight: 52,
                justifyContent: 'center',
                paddingHorizontal: gspace.lg,
                borderRadius: gradius.card,
                borderWidth: on ? 2 : 1,
                borderColor: on ? S.band : glass.border,
                backgroundColor: on ? S.soft : glass.fillStrong,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <GlassText variant={on ? 'bodyStrong' : 'body'}>{r.label}</GlassText>
            </Pressable>
          );
        })}
        {kind === 'problem' ? (
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="A short line is enough — the office reads these"
            placeholderTextColor={glass.inkFaint}
            multiline
            style={{ minHeight: 64, borderWidth: 1, borderColor: glass.border, borderRadius: gradius.chip, padding: gspace.md, color: glass.ink, textAlignVertical: 'top' }}
          />
        ) : null}
        {kind === 'decline' ? (
          <GlassText variant="caption" tone="red">
            The job goes to the next technician at once. It will not be offered to you again.
          </GlassText>
        ) : null}
        <SvcButton title={send} kind={kind === 'decline' ? 'danger' : 'primary'} disabled={!pick} loading={busy} onPress={() => pick && onSend(pick, text)} />
        <SvcButton title="Never mind" kind="quiet" onPress={onCancel} />
      </ScrollView>
    </GlassScreen>
  );
}
