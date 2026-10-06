import { Pressable, View } from 'react-native';
import { DeliveryOrder } from '../api/types';
import { shopName } from '../lib/format';
import { openWhatsApp } from '../lib/navigate';
import { photoRef } from '../lib/photoName';
import { useSession } from '../store/session';
import { glass, gspace } from '../theme/glass';
import { GlassIcon } from './glass/GlassIcon';
import { GlassText } from './glass/GlassText';

/**
 * One-tap messages to the customer, as today's rider apps have: a chip opens
 * WhatsApp on the customer's chat with the whole message already typed, so the
* rider only presses send. The chips follow the step: on the way, or at the
 * door.
 *
 * The chip stays short on the screen; the WhatsApp message is written in full,
 * so a customer who did not expect it understands it at once: who is writing,
 * which order, and exactly what is asked ("come down" alone read as rude).
 */
const LINES: Record<'way' | 'door', { chip: string; text: string }[]> = {
  way: [
    {
      chip: "I'm on my way",
      text: 'I have picked up your order and I am on my way to you now. I will message you when I reach.',
    },
    {
      chip: 'Running 10 min late',
      text: 'I am running about 10 minutes late. Sorry for the wait, I am on my way with your order.',
    },
    {
      chip: 'Share your location',
      text: 'I am near your address but I cannot find the exact place. Please share your location here on WhatsApp so I can bring your order to you.',
    },
  ],
  door: [
    {
      chip: "I'm at the gate",
      text: 'I have reached the gate of your building with your order. Please tell me where to come, or meet me at the gate.',
    },
    {
      chip: 'Please come down',
      text: 'I have reached your building with your order. Could you please come down to the entrance to collect it? I am waiting there.',
    },
    {
      chip: "I'm at the door",
      text: 'I am at your door with your order. Please open the door to collect it.',
    },
    {
      chip: 'Share your location',
      text: 'I am near your address but I cannot find the exact place. Please share your location here on WhatsApp so I can bring your order to you.',
    },
  ],
};

export function QuickReplies({ order, stage }: { order: DeliveryOrder; stage: 'way' | 'door' }) {
  const rider = (useSession((s) => s.rider?.name) ?? '').trim().split(/\s+/)[0];
  const first = (order.customer_name ?? '').trim().split(/\s+/)[0];
  const shop = shopName(order.shop);
  // "Hello Fatma, this is bala, the delivery rider for your order S00042 from
  // 369 Mart Al Khuwair. I have reached your building..."
  const message = (line: string) =>
    [
      first ? `Hello ${first},` : 'Hello,',
      `this is ${rider || 'your delivery rider'}${rider ? ', the delivery rider' : ''} for your order ${photoRef(order)}${shop ? ` from ${shop}` : ''}.`,
      line,
    ].join(' ');

  return (
    <View style={{ marginTop: gspace.md }}>
      <GlassText variant="label" tone="soft" upper style={{ marginBottom: gspace.sm }}>
        Quick message
      </GlassText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: gspace.sm }}>
        {LINES[stage].map((l) => (
          <Pressable
            key={l.chip}
            onPress={() => openWhatsApp(order.customer_mobile, message(l.text))}
            accessibilityRole="button"
            accessibilityLabel={`WhatsApp the customer: ${l.chip}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              columnGap: 6,
              minHeight: 40,
              paddingHorizontal: gspace.md,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: glass.border,
              backgroundColor: pressed ? glass.fill : glass.white,
            })}
          >
            <GlassIcon name="whatsapp" size={16} color={glass.green} />
            <GlassText variant="bodyStrong" style={{ fontSize: 13 }}>
              {l.chip}
            </GlassText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
