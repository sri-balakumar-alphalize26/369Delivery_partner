import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ENV_DEFAULTS } from '../src/api/config';
import { MOCK_DELIVERY_OTP, MOCK_PICKUP_OTP } from '../src/api/mock/fixtures';
import { ApiError } from '../src/api/types';
import { useSession } from '../src/store/session';
import { glass, gradius, gspace } from '../src/theme/glass';
import { Field } from '../src/ui/Field';
import { GlassButton } from '../src/ui/glass/GlassButton';
import { GlassCard } from '../src/ui/glass/GlassCard';
import { GlassScreen } from '../src/ui/glass/GlassScreen';
import { GlassText } from '../src/ui/glass/GlassText';

/**
 * Sign-in and server settings on one screen.
 *
 * A rider signs in with their mobile number and the password the office set
 * with "Create app login" on their rider record in Odoo. The server answers
 * with a session cookie the phone keeps, so the password is typed here and
 * nowhere else — it is never stored.
 *
 * The screen doubles as the server config. The test host is a Cloudflare quick
 * tunnel whose address changes on restart; being able to paste the new one here
 * is what stops that costing a rebuild every time.
 *
 * It stays outside the tabs group, so it is not a tab — reached only from
 * Profile or by the Gate redirect.
 */
export default function Connect() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { server, connect } = useSession();

  const [url, setUrl] = useState('');
  const [db, setDb] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [orsKey, setOrsKey] = useState('');
  const [useMock, setUseMock] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    setUrl(server?.url ?? ENV_DEFAULTS.url);
    setDb(server?.db ?? ENV_DEFAULTS.db);
    setLogin(server?.login ?? '');
    setSupportPhone(server?.supportPhone ?? ENV_DEFAULTS.supportPhone);
    setOrsKey(server?.orsKey ?? ENV_DEFAULTS.orsKey);
    setUseMock(server?.useMock ?? true);
  }, [server]);

  const config = () => ({ url, db, login, supportPhone, orsKey, useMock });

  // The server would refuse an empty login too, but with a message about a
  // wrong password, which sends the rider looking in the wrong place.
  function missingLogin(): boolean {
    if (useMock || (login.trim() && password)) return false;
    setError('Enter your mobile number and password.');
    return true;
  }

  async function test() {
    setError(null);
    setOk(null);
    if (missingLogin()) return;
    setBusy(true);
    try {
      const rider = await connect(config(), password);
      setOk(`Connected as ${rider.name}`);
    } catch (err) {
      // The server writes its own messages for riders — show them unchanged.
      setError(err instanceof ApiError ? err.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    if (missingLogin()) return;
    setBusy(true);
    try {
      await connect(config(), password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassScreen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + gspace.xxxl,
            paddingHorizontal: gspace.xl,
            paddingBottom: gspace.xxxl + insets.bottom,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: 'center' }}>
            <View
              style={{
                backgroundColor: glass.fillStrong,
                borderRadius: gradius.card,
                borderWidth: 1,
                borderColor: glass.border,
                padding: gspace.md,
              }}
            >
              <Image
                source={require('../assets/images/brand-full.png')}
                style={{ width: 84, height: 84 }}
                resizeMode="contain"
              />
            </View>
            <GlassText variant="hero" style={{ marginTop: gspace.lg }}>
              Delivery Partner
            </GlassText>
            <GlassText variant="body" tone="soft" style={{ marginTop: gspace.xs }}>
              Connect to start earning
            </GlassText>
          </View>

          <GlassCard style={{ marginTop: gspace.xxl }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flex: 1, paddingRight: gspace.lg }}>
                <GlassText variant="bodyStrong">Use demo data</GlassText>
                <GlassText variant="caption" tone="soft" style={{ marginTop: 2 }}>
                  Try the app with no server at all
                </GlassText>
              </View>
              <Switch
                value={useMock}
                onValueChange={setUseMock}
                trackColor={{ true: glass.indigo }}
              />
            </View>

            <View
              style={{
                borderBottomWidth: 1,
                borderColor: glass.divider,
                marginVertical: gspace.lg,
              }}
            />

            {/* The codes are read from the fixtures, as Profile already does.
                They were typed out by hand here and went stale the moment the
                demo codes changed. */}
            {useMock ? (
              <GlassText variant="body" tone="soft">
                Demo mode is on. Pickup code is {MOCK_PICKUP_OTP} and delivery code is{' '}
                {MOCK_DELIVERY_OTP}.
              </GlassText>
            ) : (
              <>
                <Field
                  label="Server address"
                  value={url}
                  onChangeText={setUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="https://…trycloudflare.com"
                />
                <Field
                  label="Database"
                  value={db}
                  onChangeText={setDb}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="res-test1"
                />
                <Field
                  label="Mobile number"
                  value={login}
                  onChangeText={setLogin}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="username"
                  placeholder="The number on your rider record"
                />
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  autoComplete="password"
                  textContentType="password"
                  placeholder="Set by the office in Odoo"
                />
              </>
            )}

            {/* Outside the demo branch on purpose: who a rider calls when they
                are stuck has nothing to do with which server the app points at,
                and someone trying the demo should be able to test the button. */}
            <View
              style={{
                borderBottomWidth: 1,
                borderColor: glass.divider,
                marginVertical: gspace.lg,
              }}
            />
            <Field
              label="Support number"
              value={supportPhone}
              onChangeText={setSupportPhone}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="phone-pad"
              placeholder="Leave empty to hide the button"
            />
            <Field
              label="Route key"
              value={orsKey}
              onChangeText={setOrsKey}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="openrouteservice.org key, for the map route"
            />
          </GlassCard>

          {error ? (
            <GlassText variant="bodyStrong" tone="red" style={{ marginTop: gspace.lg }}>
              {error}
            </GlassText>
          ) : null}
          {ok ? (
            <GlassText variant="bodyStrong" tone="green" style={{ marginTop: gspace.lg }}>
              {ok}
            </GlassText>
          ) : null}

          <GlassButton
            title="Continue"
            kind="dark"
            onPress={save}
            loading={busy}
            style={{ marginTop: gspace.xl }}
          />

          {!useMock ? (
            <GlassButton
              title="Test connection"
              kind="ghost"
              onPress={test}
              disabled={busy}
              style={{ marginTop: gspace.md }}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </GlassScreen>
  );
}
