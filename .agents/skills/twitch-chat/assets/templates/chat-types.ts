/**
 * chat-types.ts — TypeScript types for Twitch chat over EventSub + the Helix chat endpoints.
 *
 * Source: dev.twitch.tv EventSub Reference / Subscription Types / API Reference (snapshot 2026-10-26).
 * Types only (no runtime code) — import with `import type { ... } from './chat-types.js'`, which is
 * erased at runtime, so this works with tsc, bundlers AND Node 22's native type stripping.
 *
 * Nullability follows the docs: fields documented as "Optional"/"Null if ..." are `T | null`.
 * Twitch adds enum values over time (notice types, message types, fragment types) — always keep a
 * default branch when you switch on them.
 */

// ---------------------------------------------------------------------------------------------
// Message fragments (channel.chat.message, channel.chat.notification, pinned messages, ...)
// ---------------------------------------------------------------------------------------------

export interface CheermoteMeta {
  /** Lower-cased prefix, e.g. "cheer". Full cheermote text is prefix + bits ("cheer100"). */
  prefix: string;
  bits: number;
  /** Tier level of the cheermote (matches a `tiers[].id` of Get Cheermotes, e.g. 100). */
  tier: number;
}

export interface EmoteMeta {
  id: string;
  emote_set_id: string;
  /** Broadcaster who owns the emote; "0" (or empty) for global emotes. */
  owner_id: string;
  /** "static" and/or "animated". Prefer "animated" when present. */
  format: Array<'static' | 'animated'>;
}

export interface MentionMeta {
  user_id: string;
  user_name: string;
  user_login: string;
}

/**
 * GIF fragment metadata (added 2026-07-16). The EventSub reference table names the id field `id`,
 * the changelog entry says `gif_id` — read both. Render `url` exactly as given (docs: "must not be
 * modified").
 */
export interface GifMeta {
  id?: string;
  gif_id?: string;
  url: string;
}

interface FragmentBase {
  /** Always present: the literal text of this fragment (emote name, "@user", "Cheer100", ...). */
  text: string;
  cheermote?: CheermoteMeta | null;
  emote?: EmoteMeta | null;
  mention?: MentionMeta | null;
  gif?: GifMeta | null;
}
export interface TextFragment extends FragmentBase { type: 'text' }
export interface EmoteFragment extends FragmentBase { type: 'emote'; emote: EmoteMeta }
export interface CheermoteFragment extends FragmentBase { type: 'cheermote'; cheermote: CheermoteMeta }
export interface MentionFragment extends FragmentBase { type: 'mention'; mention: MentionMeta }
export interface GifFragment extends FragmentBase { type: 'gif'; gif: GifMeta }
export type ChatFragment = TextFragment | EmoteFragment | CheermoteFragment | MentionFragment | GifFragment;

export interface ChatMessageBody {
  text: string;
  fragments: ChatFragment[];
}

/** One entry of the `badges` array. Look up the image via Get Global/Channel Chat Badges (set_id + id). */
export interface ChatBadge {
  set_id: string;
  id: string;
  /** Only used for subscriber badges today: number of months subscribed (e.g. "16"). */
  info: string;
}

// ---------------------------------------------------------------------------------------------
// channel.chat.message (v1)
// ---------------------------------------------------------------------------------------------

export type ChatMessageType =
  | 'text'
  | 'channel_points_highlighted'
  | 'channel_points_sub_only'
  | 'user_intro'
  | 'power_ups_message_effect'
  | 'power_ups_gigantified_emote';

export interface ChatReply {
  parent_message_id: string;
  parent_message_body: string;
  parent_user_id: string;
  parent_user_name: string;
  parent_user_login: string;
  /** Top-level message of the reply thread. */
  thread_message_id: string;
  thread_user_id: string;
  thread_user_name: string;
  thread_user_login: string;
}

export interface ChatMessageEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message_id: string;
  message: ChatMessageBody;
  message_type: ChatMessageType | (string & {});
  badges: ChatBadge[];
  cheer: { bits: number } | null;
  /** "#RRGGBB" or "" if the user never set a color — you must pick a fallback. */
  color: string;
  reply: ChatReply | null;
  channel_points_custom_reward_id: string | null;
  // Shared chat: all null when the message was sent in this broadcaster's own channel.
  source_broadcaster_user_id: string | null;
  source_broadcaster_user_login: string | null;
  source_broadcaster_user_name: string | null;
  source_message_id: string | null;
  source_badges: ChatBadge[] | null;
  /** Shared chat only: true if the message was delivered to the source channel only. */
  is_source_only?: boolean | null;
}

// ---------------------------------------------------------------------------------------------
// channel.chat.notification (v1) — the EventSub replacement for IRC USERNOTICE
// ---------------------------------------------------------------------------------------------

export type ChatNoticeType =
  | 'sub' | 'resub' | 'sub_gift' | 'community_sub_gift' | 'gift_paid_upgrade' | 'prime_paid_upgrade'
  | 'raid' | 'unraid' | 'pay_it_forward' | 'announcement' | 'bits_badge_tier' | 'charity_donation'
  | 'watch_streak' | 'modiversary' | 'gifted_drops_summary'
  | 'shared_chat_sub' | 'shared_chat_resub' | 'shared_chat_sub_gift' | 'shared_chat_community_sub_gift'
  | 'shared_chat_gift_paid_upgrade' | 'shared_chat_prime_paid_upgrade' | 'shared_chat_raid'
  | 'shared_chat_pay_it_forward' | 'shared_chat_announcement' | 'shared_chat_modiversary'
  | 'shared_chat_gifted_drops_summary'
  | 'unknown';

/** "1000" | "2000" | "3000" (Prime subs report tier "1000" plus is_prime). */
export type SubTier = '1000' | '2000' | '3000' | (string & {});

export interface NoticeSub { sub_tier: SubTier; is_prime: boolean; duration_months: number }
export interface NoticeResub {
  cumulative_months: number;
  duration_months: number;
  streak_months: number | null;
  /** Reference table says `sub_tier`; the official example payload shows `sub_plan`. Read both. */
  sub_tier?: SubTier;
  sub_plan?: SubTier;
  is_prime?: boolean | null;
  is_gift: boolean;
  gifter_is_anonymous: boolean | null;
  gifter_user_id: string | null;
  gifter_user_name: string | null;
  gifter_user_login: string | null;
}
export interface NoticeSubGift {
  duration_months: number;
  cumulative_total: number | null;
  recipient_user_id: string;
  recipient_user_name: string;
  recipient_user_login: string;
  sub_tier: SubTier;
  /** Set when this single gift is part of a community (mystery) gift. */
  community_gift_id: string | null;
}
export interface NoticeCommunitySubGift { id: string; total: number; sub_tier: SubTier; cumulative_total: number | null }
export interface NoticeGiftPaidUpgrade { gifter_is_anonymous: boolean; gifter_user_id: string | null; gifter_user_name: string | null }
export interface NoticePrimePaidUpgrade { sub_tier: SubTier }
export interface NoticePayItForward {
  gifter_is_anonymous: boolean;
  gifter_user_id: string | null;
  gifter_user_name: string | null;
  gifter_user_login: string | null;
}
export interface NoticeRaid { user_id: string; user_name: string; user_login: string; viewer_count: number; profile_image_url: string }
export interface NoticeAnnouncement { color: string }
export interface NoticeBitsBadgeTier { tier: number }
export interface NoticeCharityDonation {
  charity_name: string;
  /** Minor units: value 550 + decimal_place 2 + "USD" = $5.50. */
  amount: { value: number; decimal_place: number; currency: string };
}
export interface NoticeWatchStreak { streak_count: number; channel_points_awarded: number }
export interface NoticeModiversary { months: number }
export interface NoticeGiftedDropsSummary { recipient_count: number }

export interface ChatNotificationEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  chatter_is_anonymous: boolean;
  color: string;
  badges: ChatBadge[];
  /** Ready-made human text, e.g. "viewer23 subscribed at Tier 1. They've subscribed for 10 months!" */
  system_message: string;
  message_id: string;
  /** The user's optional attached message (e.g. resub message). Often empty. */
  message: ChatMessageBody;
  notice_type: ChatNoticeType | (string & {});
  sub: NoticeSub | null;
  resub: NoticeResub | null;
  sub_gift: NoticeSubGift | null;
  community_sub_gift: NoticeCommunitySubGift | null;
  gift_paid_upgrade: NoticeGiftPaidUpgrade | null;
  prime_paid_upgrade: NoticePrimePaidUpgrade | null;
  pay_it_forward: NoticePayItForward | null;
  raid: NoticeRaid | null;
  /** `{}` when notice_type is "unraid", otherwise null. */
  unraid: Record<string, never> | null;
  announcement: NoticeAnnouncement | null;
  bits_badge_tier: NoticeBitsBadgeTier | null;
  charity_donation: NoticeCharityDonation | null;
  watch_streak: NoticeWatchStreak | null;
  modiversary: NoticeModiversary | null;
  gifted_drops_summary: NoticeGiftedDropsSummary | null;
  // shared_chat_* carry the same shape as their non-shared counterparts, for notices that happened
  // in ANOTHER channel of the shared chat session.
  shared_chat_sub: NoticeSub | null;
  shared_chat_resub: NoticeResub | null;
  shared_chat_sub_gift: NoticeSubGift | null;
  shared_chat_community_sub_gift: NoticeCommunitySubGift | null;
  shared_chat_gift_paid_upgrade: NoticeGiftPaidUpgrade | null;
  shared_chat_prime_paid_upgrade: NoticePrimePaidUpgrade | null;
  shared_chat_pay_it_forward: NoticePayItForward | null;
  shared_chat_raid: NoticeRaid | null;
  shared_chat_announcement: NoticeAnnouncement | null;
  shared_chat_modiversary: NoticeModiversary | null;
  shared_chat_gifted_drops_summary: NoticeGiftedDropsSummary | null;
  source_broadcaster_user_id: string | null;
  source_broadcaster_user_login: string | null;
  source_broadcaster_user_name: string | null;
  source_message_id: string | null;
  source_badges: ChatBadge[] | null;
  is_source_only: boolean | null;
}

// ---------------------------------------------------------------------------------------------
// Deletion / clearing / settings / AutoMod-held (sender side) / shared chat / whispers
// ---------------------------------------------------------------------------------------------

interface BroadcasterRef {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
}

/** channel.chat.clear — whole chat cleared (/clear). */
export type ChatClearEvent = BroadcasterRef;

/** channel.chat.clear_user_messages — user banned or timed out; remove all their messages. */
export interface ChatClearUserMessagesEvent extends BroadcasterRef {
  target_user_id: string;
  target_user_name: string;
  target_user_login: string;
}

/** channel.chat.message_delete — one message removed. */
export interface ChatMessageDeleteEvent extends BroadcasterRef {
  target_user_id: string;
  target_user_name: string;
  target_user_login: string;
  message_id: string;
}

/** channel.chat_settings.update — only the NEW state; diff against your cache yourself. */
export interface ChatSettingsUpdateEvent extends BroadcasterRef {
  emote_mode: boolean;
  follower_mode: boolean;
  follower_mode_duration_minutes: number | null;
  slow_mode: boolean;
  slow_mode_wait_time_seconds: number | null;
  subscriber_mode: boolean;
  unique_chat_mode: boolean;
}

/** Fragments in AutoMod/held-message events are slimmer (no owner_id/format on emotes). */
export interface HeldFragment {
  type?: 'text' | 'emote' | 'cheermote' | (string & {});
  text: string;
  emote?: { id: string; emote_set_id: string } | null;
  cheermote?: CheermoteMeta | null;
}

/** channel.chat.user_message_hold — the user in the condition had a message held by AutoMod. */
export interface ChatUserMessageHoldEvent extends BroadcasterRef {
  user_id: string;
  user_login: string;
  user_name: string;
  message_id: string;
  message: { text: string; fragments: HeldFragment[] };
}

/** channel.chat.user_message_update — moderators decided on that held message. */
export interface ChatUserMessageUpdateEvent extends ChatUserMessageHoldEvent {
  status: 'approved' | 'denied' | 'invalid' | (string & {});
}

export interface SharedChatParticipant {
  broadcaster_user_id: string;
  broadcaster_user_name: string;
  broadcaster_user_login: string;
}
/** channel.shared_chat.begin / .update (same shape). */
export interface SharedChatSessionEvent extends BroadcasterRef {
  session_id: string;
  host_broadcaster_user_id: string;
  host_broadcaster_user_name: string;
  host_broadcaster_user_login: string;
  participants: SharedChatParticipant[];
}
/** channel.shared_chat.end */
export interface SharedChatSessionEndEvent extends BroadcasterRef {
  session_id: string;
  host_broadcaster_user_id: string;
  host_broadcaster_user_name: string;
  host_broadcaster_user_login: string;
}

/** user.whisper.message */
export interface WhisperReceivedEvent {
  from_user_id: string;
  from_user_name: string;
  from_user_login: string;
  to_user_id: string;
  to_user_name: string;
  to_user_login: string;
  whisper_id: string;
  whisper: { text: string };
}

/** automod.message.hold v2 (moderator view). */
export interface AutomodMessageHoldV2Event {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  user_id: string;
  user_login: string;
  user_name: string;
  message_id: string;
  message: { text: string; fragments: HeldFragment[] };
  held_at: string;
  reason: 'automod' | 'blocked_term' | 'blocked_link' | (string & {});
  automod: { category: string; level: number; boundaries: Array<{ start_pos: number; end_pos: number }> } | null;
  blocked_term: {
    terms_found: Array<{
      term_id: string;
      boundary: { start_pos: number; end_pos: number };
      owner_broadcaster_user_id: string;
      owner_broadcaster_user_login: string;
      owner_broadcaster_user_name: string;
    }>;
  } | null;
}

/** Map of subscription type -> event payload, for typed dispatch. */
export interface ChatEventMap {
  'channel.chat.message': ChatMessageEvent;
  'channel.chat.notification': ChatNotificationEvent;
  'channel.chat.clear': ChatClearEvent;
  'channel.chat.clear_user_messages': ChatClearUserMessagesEvent;
  'channel.chat.message_delete': ChatMessageDeleteEvent;
  'channel.chat_settings.update': ChatSettingsUpdateEvent;
  'channel.chat.user_message_hold': ChatUserMessageHoldEvent;
  'channel.chat.user_message_update': ChatUserMessageUpdateEvent;
  'channel.shared_chat.begin': SharedChatSessionEvent;
  'channel.shared_chat.update': SharedChatSessionEvent;
  'channel.shared_chat.end': SharedChatSessionEndEvent;
  'user.whisper.message': WhisperReceivedEvent;
  'automod.message.hold': AutomodMessageHoldV2Event;
}
export type ChatSubscriptionType = keyof ChatEventMap;

// ---------------------------------------------------------------------------------------------
// EventSub WebSocket envelope (see the twitch-eventsub skill for the full transport story)
// ---------------------------------------------------------------------------------------------

export interface EventSubSubscriptionInfo {
  id: string;
  status: string;
  type: string;
  version: string;
  cost: number;
  condition: Record<string, string>;
  transport: { method: 'websocket' | 'webhook' | 'conduit'; session_id?: string; callback?: string; conduit_id?: string };
  created_at: string;
}

export interface EventSubWsMetadata {
  message_id: string;
  message_type: 'session_welcome' | 'session_keepalive' | 'notification' | 'session_reconnect' | 'revocation';
  message_timestamp: string;
  subscription_type?: string;
  subscription_version?: string;
}

export interface EventSubWsSession {
  id: string;
  status: string;
  connected_at: string;
  keepalive_timeout_seconds: number | null;
  reconnect_url: string | null;
}

export interface EventSubWsMessage {
  metadata: EventSubWsMetadata;
  payload: {
    session?: EventSubWsSession;
    subscription?: EventSubSubscriptionInfo;
    event?: unknown;
  };
}

// ---------------------------------------------------------------------------------------------
// Helix chat endpoints
// ---------------------------------------------------------------------------------------------

/** POST /helix/chat/messages body. */
export interface SendChatMessageBody {
  broadcaster_id: string;
  sender_id: string;
  /** Max 500 characters. Emotes: type the case-sensitive emote name. */
  message: string;
  reply_parent_message_id?: string;
  /** App access token ONLY (400 with a user token). Default true for app tokens since 2025-05-19. */
  for_source_only?: boolean;
  /** Send + pin for 20 minutes. Needs moderator:manage:chat_messages; not combinable with reply/for_source_only. */
  pin?: boolean;
}

export interface SendChatMessageResult {
  message_id: string;
  is_sent: boolean;
  /** Present when is_sent is false. Only `automod_held` is shown in the docs — don't hardcode a list. */
  drop_reason: { code: string; message: string } | null;
}
export interface SendChatMessageResponse { data: SendChatMessageResult[] }

export interface HelixBadgeVersion {
  id: string;
  image_url_1x: string; // 18x18
  image_url_2x: string; // 36x36
  image_url_4x: string; // 72x72
  title: string;
  description: string;
  click_action: string | null;
  click_url: string | null;
}
export interface HelixBadgeSet { set_id: string; versions: HelixBadgeVersion[] }

export interface HelixEmote {
  id: string;
  name: string;
  images: { url_1x: string; url_2x: string; url_4x: string };
  tier?: string;
  emote_type?: string;
  emote_set_id?: string;
  owner_id?: string;
  format: Array<'static' | 'animated'>;
  scale: Array<'1.0' | '2.0' | '3.0'>;
  theme_mode: Array<'light' | 'dark'>;
}
/** Get Global/Channel Emotes and Get Emote Sets also return a top-level `template` string. */
export interface HelixEmotesResponse { data: HelixEmote[]; template: string }

export interface HelixCheermoteTier {
  min_bits: number;
  id: string; // "1" | "100" | "500" | "1000" | "5000" | "10000" | "100000"
  color: string;
  /** images[theme][format][size] -> URL; theme dark|light, format animated|static, size "1"|"1.5"|"2"|"3"|"4". */
  images: Record<'dark' | 'light', Record<'animated' | 'static', Record<string, string>>>;
  can_cheer: boolean;
  show_in_bits_card: boolean;
}
export interface HelixCheermote {
  prefix: string;
  tiers: HelixCheermoteTier[];
  type: string;
  order: number;
  last_updated: string;
  is_charitable: boolean;
}

// ---------------------------------------------------------------------------------------------
// Overlay protocol (backend -> browser source over a plain WebSocket, JSON text frames)
// ---------------------------------------------------------------------------------------------

/** Pre-resolved assets the overlay needs once per connection. Key of `badges` is "set_id/id". */
export interface OverlayAssets {
  badges: Record<string, { url1x: string; url2x: string; url4x: string; title: string }>;
  cheermotes: HelixCheermote[];
  /** Login of the bot user, so the overlay can hide its own messages if wanted. */
  botUserId?: string;
}

export type OverlayServerMessage =
  | { kind: 'assets'; assets: OverlayAssets }
  | { [K in ChatSubscriptionType]: { kind: 'event'; subscriptionType: K; event: ChatEventMap[K] } }[ChatSubscriptionType]
  | { kind: 'ping' };
