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
 * There is no login screen.
 *
 * The WhatsApp code flow is the production login, but WhatsApp is not confirmed
 * working on the test database yet — so rather than block every other screen
 * behind something untestable, the rider identity comes from a bearer token
 * generated in Odoo and pasted here.
 *
 * This screen doubles as the server config. The test host is a Cloudflare quick
 * tunnel whose address changes on restart; being able to paste the new one here
 * is what stops that costing a rebuild every time.
 *
 * The template draws a mobile-number and one-time-code sign-in. That flow does
 * not exist yet, so this is its *styling* over the fields that are actually
 * wired up. Drawing the OTP form would be drawing a login that cannot log
 * anyone in.
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
  const [token, setToken] = useState('');
  const [useMock, setUseMock] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    setUrl(server?.url ?? ENV_DEFAULTS.url);
    setDb(server?.db ?? ENV_DEFAULTS.db);
    setToken(server?.token ?? '');
    setUseMock(server?.useMock ?? true);
  }, [server]);

  async function test() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const rider = await connect({ url, db, token, useMock });
      setOk(`Connected as ${rider.name}`);
    } catch (err) {
      // The server writes its own messages for riders — show them unchanged.
      setError(err instanceof ApiError ? err.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await connect({ url, db, token, useMock });
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
                  label="Access token"
                  value={token}
                  onChangeText={setToken}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Paste the token from Odoo"
                />
              </>
            )}
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
