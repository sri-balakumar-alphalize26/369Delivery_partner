import createQr from 'qrcode-generator';
import { useMemo } from 'react';
import { View } from 'react-native';
import { glass, gradius, gspace } from '../theme/glass';
import { GlassText } from './glass/GlassText';

/**
 * The customer's pay link as a QR, for them to scan with their own phone.
 *
 * Delivery 19.0.21.4.0 sends `pay_url` on cash jobs: the same pay page the
 * WhatsApp chat links to. The server decides which methods that page offers
 * (card, or Demo on a test server); the app only shows the code, never opens
 * the link, and never handles a payment itself. When the payment lands the job
 * turns `paid` and `pay_url` goes null on the next poll, which removes this.
 *
 * Drawn with plain Views, so it needs no native module and runs in Expo Go.
 * Each row's dark modules are merged into runs: a long link is about 2,000
 * modules, but only a few hundred runs.
 */

/** White modules kept around the code; scanners need a clear border. */
const QUIET = 4;

export function PayQr({ url, size = 220 }: { url: string; size?: number }) {
  const { count, runs } = useMemo(() => {
    // The link exactly as the server sent it — a wrapper URL, not to be unwrapped.
    const qr = createQr(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const out: { row: number; col: number; len: number }[] = [];
    for (let row = 0; row < n; row += 1) {
      let col = 0;
      while (col < n) {
        if (!qr.isDark(row, col)) {
          col += 1;
          continue;
        }
        const start = col;
        while (col < n && qr.isDark(row, col)) col += 1;
        out.push({ row, col: start, len: col - start });
      }
    }
    return { count: n, runs: out };
  }, [url]);

  // Whole pixels per module, so neighbouring modules never leave hairline gaps.
  const cell = Math.max(2, Math.floor(size / (count + QUIET * 2)));
  const side = cell * (count + QUIET * 2);

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel="Payment QR code for the customer to scan"
        style={{
          width: side,
          height: side,
          backgroundColor: '#FFFFFF',
          borderRadius: gradius.chip,
          borderWidth: 1,
          borderColor: glass.border,
        }}
      >
        {runs.map((r, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (r.col + QUIET) * cell,
              top: (r.row + QUIET) * cell,
              width: r.len * cell,
              height: cell,
              backgroundColor: '#000000',
            }}
          />
        ))}
      </View>
      <GlassText
        variant="caption"
        tone="soft"
        style={{ marginTop: gspace.sm, textAlign: 'center' }}
      >
        The customer scans this with their own phone to pay by card.
      </GlassText>
    </View>
  );
}
