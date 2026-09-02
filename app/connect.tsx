import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Switch, View } from 'react-native';
import { ENV_DEFAULTS } from '../src/api/config';
import { ApiError } from '../src/api/types';
import { useSession } from '../src/store/session';
import { color, space } from '../src/theme/tokens';
import { Field } from '../src/ui/Field';
import { Hairline } from '../src/ui/Hairline';
import { PrimaryButton } from '../src/ui/PrimaryButton';
import { Screen } from '../src/ui/Screen';
import { Text } from '../src/ui/Text';

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
 */
export default function Connect() {
  const router = useRouter();
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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <Image
          source={require('../assets/images/brand-full.png')}
          style={{ width: '100%', height: 150, marginBottom: space.lg }}
          resizeMode="contain"
        />

        <Text variant="title">Connect</Text>
        <Text variant="body" tone="soft" style={{ marginTop: space.xs }}>
          One-time setup. The app remembers this.
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: space.xxl,
          }}
        >
          <View style={{ flex: 1, paddingRight: space.lg }}>
            <Text variant="bodyStrong">Use demo data</Text>
            <Text variant="body" tone="soft">
              Try the app with no server at all
            </Text>
          </View>
          <Switch
            value={useMock}
            onValueChange={setUseMock}
            trackColor={{ true: color.brand }}
          />
        </View>

        <Hairline />

        {useMock ? (
          <Text variant="body" tone="soft">
            Demo mode is on. Pickup code is 482913 and delivery code is 739214.
          </Text>
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

        {error ? (
          <Text variant="bodyStrong" tone="red" style={{ marginBottom: space.lg }}>
            {error}
          </Text>
        ) : null}
        {ok ? (
          <Text variant="bodyStrong" tone="green" style={{ marginBottom: space.lg }}>
            {ok}
          </Text>
        ) : null}

        {!useMock ? (
          <PrimaryButton
            label="Test connection"
            kind="ghost"
            onPress={test}
            disabled={busy}
            style={{ borderWidth: 1, borderColor: color.hairline, marginBottom: space.md }}
          />
        ) : null}

        <PrimaryButton label="Continue" onPress={save} loading={busy} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
