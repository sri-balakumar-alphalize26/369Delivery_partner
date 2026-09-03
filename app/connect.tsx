import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ENV_DEFAULTS } from '../src/api/config';
import { ApiError } from '../src/api/types';
import { useSession } from '../src/store/session';
import { cardColor, cardRadius, space } from '../src/theme/tokens';
import { Card } from '../src/ui/Card';
import { Field } from '../src/ui/Field';
import { GradientHeader } from '../src/ui/GradientHeader';
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
 *
 * The reference draws a mobile-number and one-time-code sign-in. That flow does
 * not exist yet, so this is the reference's *styling* over the fields that are
 * actually wired up. Drawing the OTP form would be drawing a login that cannot
 * log anyone in.
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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: cardColor.canvas }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.huge + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <GradientHeader
          style={{
            paddingTop: insets.top + space.huge,
            paddingHorizontal: space.xl,
            paddingBottom: space.huge,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              backgroundColor: cardColor.card,
              borderRadius: cardRadius.card,
              padding: space.sm,
            }}
          >
            <Image
              source={require('../assets/images/brand-full.png')}
              style={{ width: 96, height: 96 }}
              resizeMode="contain"
            />
          </View>
          <Text variant="cardTitle" style={{ color: cardColor.card, marginTop: space.lg }}>
            Delivery Partner
          </Text>
          <Text
            variant="cardBody"
            style={{ color: 'rgba(255,255,255,0.72)', marginTop: space.xs }}
          >
            Connect to start earning
          </Text>
        </GradientHeader>

        <View style={{ paddingHorizontal: space.xl, marginTop: -space.xxl }}>
          <Card>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ flex: 1, paddingRight: space.lg }}>
                <Text variant="cardBody" style={{ color: cardColor.textPrimary }}>
                  Use demo data
                </Text>
                <Text
                  variant="cardCaption"
                  style={{ color: cardColor.textSecondary, marginTop: 2 }}
                >
                  Try the app with no server at all
                </Text>
              </View>
              <Switch
                value={useMock}
                onValueChange={setUseMock}
                trackColor={{ true: cardColor.brand }}
              />
            </View>

            <View
              style={{
                borderBottomWidth: 1,
                borderColor: cardColor.divider,
                marginVertical: space.lg,
              }}
            />

            {useMock ? (
              <Text variant="cardBody" style={{ color: cardColor.textSecondary }}>
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
          </Card>

          {error ? (
            <Text variant="cardBody" style={{ color: cardColor.red, marginTop: space.lg }}>
              {error}
            </Text>
          ) : null}
          {ok ? (
            <Text variant="cardBody" style={{ color: cardColor.green, marginTop: space.lg }}>
              {ok}
            </Text>
          ) : null}

          <Pressable
            onPress={save}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => ({
              backgroundColor: cardColor.brand,
              borderRadius: cardRadius.button,
              height: 54,
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: space.xl,
              opacity: busy ? 0.5 : pressed ? 0.85 : 1,
            })}
          >
            <Text variant="cardButton" style={{ color: cardColor.card }}>
              Continue
            </Text>
          </Pressable>

          {!useMock ? (
            <Pressable
              onPress={test}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => ({
                paddingVertical: space.lg,
                alignItems: 'center',
                opacity: busy ? 0.5 : pressed ? 0.6 : 1,
              })}
            >
              <Text variant="cardBody" style={{ color: cardColor.brand }}>
                Test connection
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
