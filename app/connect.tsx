import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ENV_DEFAULTS } from '../src/api/config';
import { MOCK_DELIVERY_OTP, MOCK_PICKUP_OTP } from '../src/api/mock/fixtures';
import { listDatabases, normalisePhone } from '../src/api/rest/client';
import { ApiError } from '../src/api/types';
import { useSession } from '../src/store/session';
import { glass, gradius, gspace, poppins } from '../src/theme/glass';
import { Field } from '../src/ui/Field';
import { GlassButton } from '../src/ui/glass/GlassButton';
import { GlassCard } from '../src/ui/glass/GlassCard';
import { GlassIcon, GlassIconName } from '../src/ui/glass/GlassIcon';
import { GlassScreen } from '../src/ui/glass/GlassScreen';
import { GlassText } from '../src/ui/glass/GlassText';
import { OtpBoxes } from '../src/ui/OtpBoxes';

/**
 * Sign-in and server settings on one screen.
 *
 * A rider signs in with the WhatsApp number on their rider record in Odoo
 * (Delivery ▸ Configuration ▸ Riders & Couriers). "Send code" has Odoo send a
 * 6-digit code there; typing it signs the phone in with a token, kept in the
 * keystore. There is no password and no Odoo user for a rider.
 *
 * The screen doubles as the server config. The test host is a Cloudflare quick
 * tunnel whose address changes on restart; being able to paste the new one here
 * is what stops that costing a rebuild every time. Like Odoo's own login page,
 * a whole address is enough to load the server's databases. The rider picks
 * one from a popup — nothing is picked for them — and only a server that
 * hides its list makes them type the name.
 *
 * Sign-in is the whole point of the screen, so it leads. Demo mode is a link
 * under the card, and the support number and route key — settings, not
 * credentials — fold away under "More settings".
 *
 * It stays outside the tabs group, so it is not a tab — reached only from
 * Profile or by the Gate redirect.
 */

/** Wide enough for a phone in landscape, narrow enough not to sprawl on a tablet. */
const FORM_MAX_W = 480;

type ServerState =
  | { kind: 'idle' }
  | { kind: 'invalid' }
  | { kind: 'checking' }
  | { kind: 'found'; dbs: string[] }
  | { kind: 'hidden' }
  | { kind: 'failed'; message: string };

/**
 * Whether the text is a whole server address yet: a scheme and a host with a
 * dot in it (or localhost), an optional port, an optional path. Half a link
 * is not worth a request — it can only fail, and the failure would flash red
 * at a rider who is still typing.
 */
const SERVER_URL = /^https?:\/\/(localhost|[\w-]+(\.[\w-]+)+)(:\d{1,5})?(\/\S*)?$/i;

const COULD_NOT_LOAD = "Couldn't load databases from this link. Check it and try again.";

export default function Connect() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { server, connect, sendCode } = useSession();

  const [url, setUrl] = useState('');
  const [db, setDb] = useState('');
  const [login, setLogin] = useState('');
  /**
   * The server, database and number a code was last sent for. A code belongs
   * to exactly those three, so editing any of them puts the form back to
   * asking for the number - by comparison, with no effect to keep in step.
   */
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [code, setCode] = useState('');
  /** Odoo's own words after a code request, shown above the boxes. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Seconds until another code may be asked for, as the server said. */
  const [cooldown, setCooldown] = useState(0);
  const [supportPhone, setSupportPhone] = useState('');
  const [orsKey, setOrsKey] = useState('');
  const [useMock, setUseMock] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverState, setServerState] = useState<ServerState>({ kind: 'idle' });
  /** Bumped by "Try again", to re-run the lookup for an unchanged address. */
  const [attempt, setAttempt] = useState(0);
  const [dbPickerOpen, setDbPickerOpen] = useState(false);

  // Filled once from the saved config. Not on every change to it: "Send code"
  // saves the config while the rider is still on this screen, and refilling
  // then would swap the typed number for its saved digits-only form and a
  // typed link for its trimmed one - which clears the chosen database.
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current) return;
    setUrl(server?.url ?? ENV_DEFAULTS.url);
    setDb(server?.db ?? ENV_DEFAULTS.db);
    setLogin(server?.login ?? '');
    setSupportPhone(server?.supportPhone ?? ENV_DEFAULTS.supportPhone);
    setOrsKey(server?.orsKey ?? ENV_DEFAULTS.orsKey);
    setUseMock(server?.useMock ?? true);
    if (server) filled.current = true;
  }, [server]);

  // Ask the server for its databases once the address is a whole link and has
  // stopped changing. The `alive` flag drops an answer for an address the
  // rider has already edited. Nothing is picked for them: the database is
  // cleared on every new address, so a name left over from another server can
  // never ride along into the sign-in.
  useEffect(() => {
    setDb('');
    const link = url.trim();
    if (useMock || !link) {
      setServerState({ kind: 'idle' });
      return;
    }
    if (!SERVER_URL.test(link)) {
      setServerState({ kind: 'invalid' });
      return;
    }
    let alive = true;
    setServerState({ kind: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const list = await listDatabases(link);
        if (!alive) return;
        if (!list) {
          setServerState({ kind: 'hidden' });
        } else if (!list.length) {
          setServerState({ kind: 'failed', message: 'This server has no databases yet.' });
        } else {
          setServerState({ kind: 'found', dbs: list });
        }
      } catch {
        if (alive) setServerState({ kind: 'failed', message: COULD_NOT_LOAD });
      }
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url, useMock, attempt]);

  const target = `${url.trim()}|${db.trim()}|${normalisePhone(login)}`;
  const stage: 'number' | 'code' = !useMock && sentFor === target ? 'code' : 'number';

  // The resend countdown. The server enforces the window; this only times the link.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // The server answers an unknown number the same as a known one, so a missing
  // or half-typed number has to be caught here or the rider waits for nothing.
  function missingField(): string | null {
    if (useMock) return null;
    if (!url.trim()) return 'Enter the server link.';
    if (serverState.kind === 'invalid') return 'Enter the full server link, starting with https://';
    if (serverState.kind === 'checking') return 'Still loading databases. One moment.';
    if (serverState.kind === 'failed') return COULD_NOT_LOAD;
    if (!db.trim()) return 'Choose a database.';
    if (normalisePhone(login).length < 8) {
      return 'Enter your WhatsApp number with the country code, e.g. 968 9123 4567.';
    }
    if (stage === 'code' && code.length !== 6) return 'Enter the 6-digit code from WhatsApp.';
    return null;
  }

  const config = () => ({
    url,
    db,
    login: useMock ? login : normalisePhone(login),
    supportPhone,
    orsKey,
    useMock,
  });

  /** Ask Odoo for a code. Also the "resend" link once a code has been sent. */
  async function requestCode() {
    setError(null);
    const missing = stage === 'code' ? null : missingField();
    if (missing) {
      setError(missing);
      return;
    }
    setBusy(true);
    try {
      const res = await sendCode(config());
      setSentFor(target);
      setCode('');
      setNotice(res.message ?? 'A code has been sent to your WhatsApp.');
      setCooldown(res.retry_after_seconds ?? 60);
    } catch (err) {
      // The server writes its own messages for riders — show them unchanged.
      setError(err instanceof ApiError ? err.message : 'Could not send a code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!useMock && stage === 'number') {
      await requestCode();
      return;
    }
    setError(null);
    const missing = missingField();
    if (missing) {
      setError(missing);
      return;
    }
    setBusy(true);
    try {
      await connect(config(), code);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  function switchMode(mock: boolean) {
    setUseMock(mock);
    setError(null);
  }

  const dbs = serverState.kind === 'found' ? serverState.dbs : null;

  // What the database field says before one is chosen. The list is the only
  // way in: a name is typed only for a server that answered but keeps its
  // list private, since there the link is right and the list simply withheld.
  const dbPlaceholder =
    serverState.kind === 'found'
      ? `${serverState.dbs.length} database${serverState.dbs.length === 1 ? '' : 's'} found · tap to choose`
      : serverState.kind === 'checking'
        ? 'Loading databases…'
        : serverState.kind === 'failed'
          ? "Couldn't load databases"
          : 'Enter the server link first';

  return (
    <GlassScreen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingTop: insets.top + gspace.xxl,
            paddingHorizontal: gspace.xl,
            paddingBottom: gspace.xxxl + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ width: '100%', maxWidth: FORM_MAX_W, alignSelf: 'center' }}>
            {/* ── Brand ─────────────────────────────────────────────── */}
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  backgroundColor: glass.fillStrong,
                  borderRadius: gradius.card,
                  borderWidth: 1,
                  borderColor: glass.border,
                  padding: gspace.sm,
                }}
              >
                <Image
                  source={require('../assets/images/brand-full.png')}
                  style={{ width: 72, height: 72 }}
                  resizeMode="contain"
                />
              </View>
              <GlassText variant="hero" style={{ marginTop: gspace.lg, textAlign: 'center' }}>
                {useMock ? 'Try the app' : 'Welcome back'}
              </GlassText>
              <GlassText
                variant="body"
                tone="soft"
                style={{ marginTop: gspace.xs, textAlign: 'center' }}
              >
                {useMock
                  ? 'Explore with sample jobs. No server needed.'
                  : 'Sign in to start taking deliveries.'}
              </GlassText>
            </View>

            {/* ── Sign in / demo ────────────────────────────────────── */}
            <GlassCard style={{ marginTop: gspace.xxl }} padding={gspace.xl}>
              {useMock ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <GlassIcon name="play" color={glass.orange} size={22} />
                    <GlassText variant="subtitle" style={{ marginLeft: gspace.sm }}>
                      Demo mode
                    </GlassText>
                  </View>
                  <GlassText variant="body" tone="soft" style={{ marginTop: gspace.sm }}>
                    Jobs, maps and earnings are made up, and nothing reaches the office.
                  </GlassText>
                  <View style={{ flexDirection: 'row', marginTop: gspace.lg, gap: gspace.md }}>
                    <CodeTile label="Pickup code" code={MOCK_PICKUP_OTP} />
                    <CodeTile label="Delivery code" code={MOCK_DELIVERY_OTP} />
                  </View>
                </>
              ) : (
                <>
                  <Field
                    label="Server link"
                    icon="link"
                    value={url}
                    onChangeText={setUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    placeholder="https://your-server.com"
                    style={{ fontSize: 16 }}
                  />
                  <ServerStatus state={serverState} onRetry={() => setAttempt((n) => n + 1)} />

                  {serverState.kind !== 'hidden' ? (
                    <DbField
                      value={db}
                      placeholder={dbPlaceholder}
                      loading={serverState.kind === 'checking'}
                      failed={serverState.kind === 'failed'}
                      enabled={!!dbs}
                      onPress={() => setDbPickerOpen(true)}
                    />
                  ) : (
                    <Field
                      label="Database"
                      icon="database"
                      value={db}
                      onChangeText={setDb}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="Ask the office for the name"
                    />
                  )}
                  <DbPicker
                    visible={dbPickerOpen}
                    options={dbs ?? []}
                    value={db}
                    onChoose={(name) => {
                      setDb(name);
                      setDbPickerOpen(false);
                      setError(null);
                    }}
                    onClose={() => setDbPickerOpen(false)}
                  />

                  <Field
                    label="WhatsApp number"
                    icon="phone"
                    value={login}
                    onChangeText={setLogin}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                    placeholder="With country code, e.g. 968 9123 4567"
                    returnKeyType="go"
                    onSubmitEditing={submit}
                  />

                  {stage === 'code' ? (
                    <View style={{ marginBottom: gspace.xl }}>
                      <GlassText variant="label" tone="soft" upper style={{ marginBottom: gspace.sm }}>
                        Code from WhatsApp
                      </GlassText>
                      {notice ? (
                        <GlassText variant="caption" tone="soft" style={{ marginBottom: gspace.md }}>
                          {notice}
                        </GlassText>
                      ) : null}
                      <OtpBoxes value={code} onChange={setCode} autoFocus />
                      <Pressable
                        onPress={requestCode}
                        disabled={busy || cooldown > 0}
                        hitSlop={10}
                        accessibilityRole="button"
                        style={({ pressed }) => ({
                          alignSelf: 'flex-start',
                          marginTop: gspace.md,
                          opacity: busy || cooldown > 0 ? 0.4 : pressed ? 0.6 : 1,
                        })}
                      >
                        <GlassText variant="caption" tone="orange" nums>
                          {cooldown > 0 ? `Send a new code (${cooldown}s)` : 'Send a new code'}
                        </GlassText>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              )}

              {error ? <ErrorBanner message={error} /> : null}

              <GlassButton
                title={useMock ? 'Open the demo' : stage === 'number' ? 'Send code' : 'Sign in'}
                kind={useMock ? 'orange' : 'dark'}
                onPress={submit}
                loading={busy}
                style={{ marginTop: error ? gspace.lg : gspace.xs }}
              />
            </GlassCard>

            {/* ── Mode switch ───────────────────────────────────────── */}
            <Pressable
              onPress={() => switchMode(!useMock)}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => ({
                alignSelf: 'center',
                marginTop: gspace.xl,
                paddingVertical: gspace.sm,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <GlassText variant="body" tone="soft" style={{ textAlign: 'center' }}>
                {useMock ? 'Have a rider login? ' : 'No login yet? '}
                <GlassText variant="bodyStrong" tone="orange">
                  {useMock ? 'Sign in instead' : 'Try the demo'}
                </GlassText>
              </GlassText>
            </Pressable>

            {/* ── More settings ─────────────────────────────────────── */}
            <Pressable
              onPress={() => setMoreOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: moreOpen }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: gspace.md,
                paddingVertical: gspace.sm,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <GlassIcon name="settings" size={16} color={glass.inkSoft} />
              <GlassText variant="caption" tone="soft" style={{ marginHorizontal: gspace.xs }}>
                More settings
              </GlassText>
              <GlassIcon name={moreOpen ? 'chevUp' : 'chevDown'} size={14} color={glass.inkSoft} />
            </Pressable>

            {moreOpen ? (
              <GlassCard style={{ marginTop: gspace.sm }} padding={gspace.xl}>
                {/* Outside the demo branch on purpose: who a rider calls when
                    they are stuck has nothing to do with which server the app
                    points at, and someone trying the demo should be able to
                    test the button. */}
                <Field
                  label="Support number"
                  icon="phone"
                  value={supportPhone}
                  onChangeText={setSupportPhone}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="phone-pad"
                  placeholder="Leave empty to hide the call button"
                  style={{ fontSize: 16 }}
                />
                <Field
                  label="Map route key"
                  icon="nav"
                  value={orsKey}
                  onChangeText={setOrsKey}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="openrouteservice.org key"
                  style={{ fontSize: 16 }}
                />
                <GlassText variant="caption" tone="faint" style={{ marginTop: -gspace.sm }}>
                  Saved when you sign in.
                </GlassText>
              </GlassCard>
            ) : null}

            {!useMock ? (
              <GlassText
                variant="caption"
                tone="faint"
                style={{ marginTop: gspace.lg, textAlign: 'center' }}
              >
                No code? Ask the office to check the WhatsApp number on your rider record.
              </GlassText>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </GlassScreen>
  );
}

/** One line under the server link saying what the app found there. */
function ServerStatus({ state, onRetry }: { state: ServerState; onRetry: () => void }) {
  if (state.kind === 'idle') return null;

  let icon: GlassIconName | null = null;
  let tone: 'soft' | 'green' | 'red' = 'soft';
  let text: string;
  switch (state.kind) {
    case 'invalid':
      icon = 'alert';
      text = 'Enter the full link, starting with https://';
      break;
    case 'checking':
      text = 'Looking for the server…';
      break;
    case 'found':
      icon = 'checked';
      tone = 'green';
      text = 'Server found';
      break;
    case 'hidden':
      icon = 'alert';
      text = 'Server found, but it keeps its databases private. Type the name below.';
      break;
    case 'failed':
      icon = 'alert';
      tone = 'red';
      text = state.message;
      break;
  }
  const color = tone === 'green' ? glass.green : tone === 'red' ? glass.red : glass.inkSoft;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: -gspace.md,
        marginBottom: gspace.xl,
      }}
    >
      {state.kind === 'checking' ? (
        <ActivityIndicator size="small" color={glass.inkSoft} />
      ) : icon ? (
        <GlassIcon name={icon} size={16} color={color} />
      ) : null}
      <GlassText variant="caption" tone={tone} style={{ marginLeft: gspace.sm, flex: 1 }}>
        {text}
      </GlassText>
      {state.kind === 'failed' ? (
        <Pressable
          onPress={onRetry}
          hitSlop={10}
          accessibilityRole="button"
          style={({ pressed }) => ({ marginLeft: gspace.sm, opacity: pressed ? 0.6 : 1 })}
        >
          <GlassText variant="caption" tone="orange" style={{ fontFamily: poppins.semibold }}>
            Try again
          </GlassText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The database, drawn to match `Field` so the form reads as one column of
 * inputs. It is a button, not an input: tapping it opens `DbPicker`. Until the
 * server has answered it is shut and says why — loading, or could not load.
 */
function DbField({
  value,
  placeholder,
  loading,
  failed,
  enabled,
  onPress,
}: {
  value: string;
  placeholder: string;
  loading: boolean;
  failed: boolean;
  enabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={{ marginBottom: gspace.xl }}>
      <GlassText variant="label" tone="soft" upper style={{ marginBottom: gspace.sm }}>
        Database
      </GlassText>
      <Pressable
        onPress={onPress}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityLabel={`Database, ${value || placeholder}`}
        accessibilityState={{ disabled: !enabled }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: gspace.md,
          borderBottomWidth: 1,
          borderBottomColor: failed ? glass.red : glass.divider,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={glass.inkFaint}
            style={{ width: 20, marginRight: gspace.md }}
          />
        ) : (
          <GlassIcon
            name="database"
            size={20}
            color={failed ? glass.red : glass.inkFaint}
            style={{ marginRight: gspace.md }}
          />
        )}
        <GlassText
          variant="body"
          tone={value ? 'ink' : failed ? 'red' : enabled ? 'soft' : 'faint'}
          numberOfLines={1}
          style={{ flex: 1, fontSize: 16 }}
        >
          {value || placeholder}
        </GlassText>
        {enabled ? <GlassIcon name="chevDown" size={18} color={glass.inkSoft} /> : null}
      </Pressable>
    </View>
  );
}

/**
 * The server's databases in a popup: a centred card over a dimmed screen,
 * closed by a choice, a tap outside, or the Android back button. No native
 * picker, so no rebuild. The list scrolls once it outgrows the card.
 */
function DbPicker({
  visible,
  options,
  value,
  onChoose,
  onClose,
}: {
  visible: boolean;
  options: string[];
  value: string;
  onChoose: (db: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{
          flex: 1,
          backgroundColor: 'rgba(15,23,42,0.45)',
          justifyContent: 'center',
          padding: gspace.xl,
        }}
      >
        {/* Swallows the press, so a tap on the card's own padding does not
            fall through to the backdrop and close it. */}
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%',
            maxWidth: 420,
            maxHeight: '75%',
            alignSelf: 'center',
            backgroundColor: glass.bg,
            borderRadius: gradius.card,
            paddingTop: gspace.xl,
            paddingBottom: gspace.sm,
          }}
        >
          <View style={{ paddingHorizontal: gspace.xl, marginBottom: gspace.md }}>
            <GlassText variant="title">Choose a database</GlassText>
            <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
              {options.length} found on this server
            </GlassText>
          </View>
          <ScrollView bounces={false}>
            {options.map((name) => {
              const selected = name === value;
              return (
                <Pressable
                  key={name}
                  onPress={() => onChoose(name)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: gspace.xl,
                    // 44+ tall: a gloved thumb has to hit one row, not two.
                    minHeight: 52,
                    borderTopWidth: 1,
                    borderTopColor: glass.divider,
                    backgroundColor: pressed
                      ? glass.fill
                      : selected
                        ? glass.fillLight
                        : 'transparent',
                  })}
                >
                  <GlassIcon
                    name="database"
                    size={18}
                    color={selected ? glass.indigo : glass.inkFaint}
                    style={{ marginRight: gspace.md }}
                  />
                  <GlassText
                    variant={selected ? 'bodyStrong' : 'body'}
                    tone={selected ? 'ink' : 'soft'}
                    numberOfLines={1}
                    style={{ flex: 1 }}
                  >
                    {name}
                  </GlassText>
                  {selected ? <GlassIcon name="check" size={18} color={glass.indigo} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CodeTile({ label, code }: { label: string; code: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: glass.orangeSoft,
        borderRadius: gradius.chip,
        borderWidth: 1,
        borderColor: glass.orangeLine,
        paddingVertical: gspace.md,
        paddingHorizontal: gspace.md,
      }}
    >
      <GlassText variant="caption" tone="soft">
        {label}
      </GlassText>
      <GlassText variant="title" nums style={{ marginTop: 2, letterSpacing: 2 }}>
        {code}
      </GlassText>
    </View>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: glass.redSoft,
        borderRadius: gradius.chip,
        padding: gspace.md,
      }}
    >
      <GlassIcon name="alert" size={18} color={glass.red} style={{ marginTop: 1 }} />
      <GlassText variant="body" tone="red" style={{ marginLeft: gspace.sm, flex: 1 }}>
        {message}
      </GlassText>
    </View>
  );
}
