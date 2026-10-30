/**
 * selftest.ts — unit tests for the twitch-chat templates, using example lines/payloads copied from the
 * official docs (scripts/fixtures/*.json are verbatim doc examples). No dependencies.
 *
 *   node scripts/selftest.ts        (Node >= 22.18; exits non-zero on failure)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseIrcLine, unescapeTagValue, parseBadges, parseEmotes, parseGifs, parseAction,
} from '../assets/templates/irc-client.ts';
import {
  parseCommand, levelFromBadges, Level, CommandRouter, defaultCommands, makeDispatcher,
  SlidingWindowLimiter, truncateMessage,
} from '../assets/templates/chatbot.ts';
import { buildMessageNodes, emoteUrl, nameColor, safeHttpsUrl } from '../assets/templates/overlay/render-model.ts';
import type { ChatMessageEvent, ChatNotificationEvent, EventSubWsMessage, ChatMessageBody } from '../assets/templates/chat-types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = <T>(name: string): T => JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8')) as T;

let passed = 0;
const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

// ------------------------------------------------------------------------------------------------
// IRC parsing — lines copied from https://dev.twitch.tv/docs/chat/irc/
// ------------------------------------------------------------------------------------------------

test('IRC PRIVMSG with tags + emotes (docs example)', () => {
  const line = '@badge-info=;badges=turbo/1;color=#0D4200;display-name=ronni;emotes=25:0-4,12-16/1902:6-10;id=b34ccfc7-4977-403a-8a94-33c6bac34fb8;mod=0;room-id=1337;subscriber=0;tmi-sent-ts=1507246572675;turbo=1;user-id=1337;user-type=global_mod :ronni!ronni@ronni.tmi.twitch.tv PRIVMSG #ronni :Kappa Keepo Kappa';
  const m = parseIrcLine(line)!;
  assert.equal(m.command, 'PRIVMSG');
  assert.deepEqual(m.params, ['#ronni']);
  assert.equal(m.trailing, 'Kappa Keepo Kappa');
  assert.equal(m.nick, 'ronni');
  assert.equal(m.tags['display-name'], 'ronni');
  assert.equal(m.tags['badge-info'], '');
  assert.equal(m.tags['user-type'], 'global_mod');
  assert.deepEqual(parseBadges(m.tags['badges']), [{ set_id: 'turbo', id: '1' }]);
  const emotes = parseEmotes(m.tags['emotes']);
  assert.deepEqual(emotes.map((e) => e.id), ['25', '1902', '25']);
  const chars = Array.from(m.trailing!);
  assert.deepEqual(emotes.map((e) => chars.slice(e.start, e.end + 1).join('')), ['Kappa', 'Keepo', 'Kappa']);
});

test('IRC USERNOTICE resub: \\s unescaping in system-msg', () => {
  const line = '@badge-info=;badges=staff/1,broadcaster/1,turbo/1;color=#008000;display-name=ronni;emotes=;id=db25007f-7a18-43eb-9379-80131e44d633;login=ronni;mod=0;msg-id=resub;msg-param-cumulative-months=6;msg-param-streak-months=2;msg-param-should-share-streak=1;msg-param-sub-plan=Prime;msg-param-sub-plan-name=Prime;room-id=12345678;subscriber=1;system-msg=ronni\\shas\\ssubscribed\\sfor\\s6\\smonths!;tmi-sent-ts=1507246572675;turbo=1;user-id=87654321;user-type=staff :tmi.twitch.tv USERNOTICE #dallas :Great stream -- keep it up!';
  const m = parseIrcLine(line)!;
  assert.equal(m.command, 'USERNOTICE');
  assert.equal(m.tags['msg-id'], 'resub');
  assert.equal(m.tags['system-msg'], 'ronni has subscribed for 6 months!');
  assert.equal(m.trailing, 'Great stream -- keep it up!');
  assert.equal(m.nick, null);
  assert.deepEqual(parseBadges(m.tags['badges']).map((b) => b.set_id), ['staff', 'broadcaster', 'turbo']);
});

test('IRC USERNOTICE raid: \\n escape becomes newline', () => {
  const line = '@badge-info=;badges=turbo/1;color=#9ACD32;display-name=TestChannel;emotes=;id=3d830f12-795c-447d-af3c-ea05e40fbddb;login=testchannel;mod=0;msg-id=raid;msg-param-displayName=TestChannel;msg-param-login=testchannel;msg-param-viewerCount=15;room-id=33332222;subscriber=0;system-msg=15\\sraiders\\sfrom\\sTestChannel\\shave\\sjoined\\n!;tmi-sent-ts=1507246572675;turbo=1;user-id=123456;user-type= :tmi.twitch.tv USERNOTICE #othertestchannel';
  const m = parseIrcLine(line)!;
  assert.equal(m.tags['system-msg'], '15 raiders from TestChannel have joined\n!');
  assert.equal(m.tags['msg-param-viewerCount'], '15');
  assert.equal(m.trailing, null);
});

test('IRC CLEARCHAT timeout / CLEARMSG / ROOMSTATE / PING / 001', () => {
  const t = parseIrcLine('@ban-duration=350;room-id=12345678;target-user-id=87654321;tmi-sent-ts=1642719320727 :tmi.twitch.tv CLEARCHAT #dallas :ronni')!;
  assert.equal(t.command, 'CLEARCHAT'); assert.equal(t.trailing, 'ronni'); assert.equal(t.tags['ban-duration'], '350');
  const all = parseIrcLine('@room-id=12345678;tmi-sent-ts=1642715695392 :tmi.twitch.tv CLEARCHAT #dallas')!;
  assert.equal(all.trailing, null); assert.deepEqual(all.params, ['#dallas']);
  const cm = parseIrcLine('@login=foo;room-id=;target-msg-id=94e6c7ff-bf98-4faa-af5d-7ad633a158a9;tmi-sent-ts=1642720582342 :tmi.twitch.tv CLEARMSG #bar :what a great day')!;
  assert.equal(cm.tags['target-msg-id'], '94e6c7ff-bf98-4faa-af5d-7ad633a158a9'); assert.equal(cm.trailing, 'what a great day');
  const rs = parseIrcLine('@emote-only=0;followers-only=-1;r9k=0;room-id=12345678;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #bar')!;
  assert.equal(rs.tags['followers-only'], '-1');
  const ping = parseIrcLine('PING :tmi.twitch.tv')!;
  assert.equal(ping.command, 'PING'); assert.equal(ping.trailing, 'tmi.twitch.tv'); assert.equal(ping.prefix, null);
  const w = parseIrcLine(':tmi.twitch.tv 001 twitchdev :Welcome, GLHF!\r\n')!;
  assert.equal(w.command, '001'); assert.deepEqual(w.params, ['twitchdev']); assert.equal(w.trailing, 'Welcome, GLHF!');
  const ack = parseIrcLine(':tmi.twitch.tv CAP * ACK :twitch.tv/membership twitch.tv/tags twitch.tv/commands')!;
  assert.deepEqual(ack.params, ['*', 'ACK']);
  assert.equal(parseIrcLine(''), null);
});

test('IRC gifs tag (docs example, 2026-07)', () => {
  const line = '@badge-info=subscriber/30;badges=broadcaster/1,subscriber/0;color=#033700;display-name=TwitchDev;emotes=;first-msg=0;flags=;gifs=0-33|joSNxeswxuc74Juo8X|https://media4.giphy.com/media/joSNxeswxuc74Juo8X/giphy.gif?cid=095d7a5dzizsiwgabonagkmigggv8v1spfai91ac3x0dsiy0&ep=v1_gifs_trending&rid=giphy.gif&ct=g;id=401abf17-7e99-45d6-9bdf-43934e839327;mod=0;returning-chatter=0;room-id=12826;subscriber=1;tmi-sent-ts=1783632907018;turbo=0;user-id=141981764;user-type= :twitchdev!twitchdev@twitchdev.tmi.twitch.tv PRIVMSG #twitch :[Y A Y Yes GIF by Djemilah Birnie]';
  const m = parseIrcLine(line)!;
  const gifs = parseGifs(m.tags['gifs']);
  assert.equal(gifs.length, 1);
  assert.equal(gifs[0]!.id, 'joSNxeswxuc74Juo8X');
  assert.equal(gifs[0]!.end, 33);
  assert.ok(gifs[0]!.url.endsWith('&ct=g'));
  assert.deepEqual(parseGifs('0-1|a|https://x/a,b|c,3-4|d|https://y/d'), [
    { start: 0, end: 1, id: 'a', url: 'https://x/a,b|c' }, { start: 3, end: 4, id: 'd', url: 'https://y/d' }]);
});

test('IRC tag unescaping edge cases + /me', () => {
  assert.equal(unescapeTagValue('a\\:b\\sc\\\\d\\rx\\ny'), 'a;b c\\d\rx\ny');
  assert.equal(unescapeTagValue('trailing\\'), 'trailing'); // lone trailing backslash dropped
  assert.equal(unescapeTagValue('\\q'), 'q');               // unknown escape -> char itself
  assert.deepEqual(parseAction('\u0001ACTION teleports behind you\u0001'), { action: true, text: 'teleports behind you' });
});

// ------------------------------------------------------------------------------------------------
// Command parsing / permissions / limiter
// ------------------------------------------------------------------------------------------------

test('parseCommand', () => {
  assert.deepEqual(parseCommand('!dice 20'), { name: 'dice', args: ['20'], rest: '20' });
  assert.deepEqual(parseCommand('  !PiNg  '), { name: 'ping', args: [], rest: '' });
  assert.deepEqual(parseCommand('!so  @Someone   now'), { name: 'so', args: ['@Someone', 'now'], rest: '@Someone   now' });
  assert.equal(parseCommand('hello !ping'), null);
  assert.equal(parseCommand('!'), null);
  assert.equal(parseCommand('! ping'), null);
  assert.deepEqual(parseCommand('?help', '?')?.name, 'help');
  // Reply gotcha: Twitch prefixes "@parent " to replies.
  assert.equal(parseCommand('@SomeBot !ping', '!', 'somebot')?.name, 'ping');
  assert.equal(parseCommand('@SomeBot !ping', '!'), null);
});

test('levelFromBadges (docs badge examples)', () => {
  const ev = fixture<{ event: ChatMessageEvent }>('channel.chat.message.json').event;
  assert.equal(levelFromBadges(ev.badges), Level.moderator); // moderator + subscriber + sub-gifter
  assert.equal(levelFromBadges([{ set_id: 'founder', id: '0', info: '3' }]), Level.subscriber);
  assert.equal(levelFromBadges([{ set_id: 'vip', id: '1', info: '' }]), Level.vip);
  assert.equal(levelFromBadges([], '42', '42'), Level.broadcaster);
  assert.equal(levelFromBadges([{ set_id: 'sub-gifter', id: '1', info: '' }]), Level.everyone);
});

test('SlidingWindowLimiter + truncateMessage', () => {
  const l = new SlidingWindowLimiter(2, 1000);
  assert.equal(l.waitTime(0), 0); l.record(0);
  assert.equal(l.waitTime(10), 0); l.record(10);
  assert.ok(l.waitTime(20) > 900);
  assert.equal(l.waitTime(1001), 0);
  assert.equal(Array.from(truncateMessage('x'.repeat(600))).length, 500);
  const emoji = truncateMessage('😀'.repeat(600));
  assert.equal(Array.from(emoji).length, 500);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(emoji)); // no dangling high surrogate
  assert.equal(truncateMessage('a\r\nb'), 'a b');
});

// ------------------------------------------------------------------------------------------------
// Bot dispatch with the official channel.chat.message example
// ------------------------------------------------------------------------------------------------

function wsEnvelope(doc: { subscription: { type: string; version: string }; event: unknown }, id: string): EventSubWsMessage {
  return {
    metadata: { message_id: id, message_type: 'notification', message_timestamp: new Date().toISOString(),
      subscription_type: doc.subscription.type, subscription_version: doc.subscription.version },
    payload: { subscription: doc.subscription as EventSubWsMessage['payload']['subscription'], event: doc.event },
  };
}
function withText(ev: ChatMessageEvent, text: string): ChatMessageEvent {
  return { ...ev, message: { text, fragments: [{ type: 'text', text, cheermote: null, emote: null, mention: null }] } };
}

test('dispatch: docs fixture routes commands, ignores own msgs, dedupes, enforces cooldown/permissions', async () => {
  const doc = fixture<{ subscription: { type: string; version: string; condition: { user_id: string } }; event: ChatMessageEvent }>('channel.chat.message.json');
  const botId = doc.subscription.condition.user_id; // "2914196" — the user we read chat as
  const sent: Array<{ text: string; replyTo?: string }> = [];
  const router = new CommandRouter({ prefix: '!', botUserId: botId }, { send: (text, replyTo) => sent.push({ text, replyTo }) });
  for (const c of defaultCommands()) router.register(c);
  const dispatch = makeDispatcher(router);

  // Untouched docs example ("Hi chat") is not a command.
  assert.deepEqual(await dispatch(wsEnvelope(doc, 'm1')), { handled: false, reason: 'not-a-command' });

  // Same payload with "!hello" routes to the hello command and says hi to the chatter.
  const hello = { ...doc, event: withText(doc.event, '!hello') };
  assert.deepEqual(await dispatch(wsEnvelope(hello, 'm2')), { handled: true, command: 'hello' });
  assert.equal(sent.at(-1)?.text, 'Hey @viewer32 HeyGuys');

  // Redelivered message id -> ignored.
  assert.equal(await dispatch(wsEnvelope(hello, 'm2')), null);

  // !ping replies in-thread (reply_parent_message_id = triggering message_id).
  await dispatch(wsEnvelope({ ...doc, event: withText(doc.event, '!ping') }, 'm3'));
  assert.deepEqual(sent.at(-1), { text: 'pong', replyTo: doc.event.message_id });

  // The bot's own message must never trigger anything (EventSub echoes it back).
  const own = { ...doc, event: { ...withText(doc.event, '!ping'), chatter_user_id: botId } };
  assert.deepEqual(await dispatch(wsEnvelope(own, 'm4')), { handled: false, reason: 'own-message' });

  // Non-privileged user: cooldown applies, mod-only command refused.
  const pleb = { ...withText(doc.event, '!ping'), badges: [], chatter_user_id: '777' };
  assert.equal((await router.dispatch(pleb, 1_000)).handled, true);
  assert.deepEqual(await router.dispatch(pleb, 2_000), { handled: false, reason: 'cooldown' });
  assert.equal((await router.dispatch(pleb, 7_000)).handled, true);
  assert.deepEqual(await router.dispatch({ ...pleb, message: withText(doc.event, '!count').message }), { handled: false, reason: 'permission' });

  // Moderator (fixture badges) may use !count; state is updated.
  await dispatch(wsEnvelope({ ...doc, event: withText(doc.event, '!count') }, 'm5'));
  assert.equal(router.state.counters['count'], 1);

  // Reply to the bot: text arrives as "@parent !ping".
  const reply = { ...withText(doc.event, '@somebot !ping'), reply: {
    parent_message_id: 'p', parent_message_body: 'x', parent_user_id: '1', parent_user_name: 'SomeBot', parent_user_login: 'somebot',
    thread_message_id: 'p', thread_user_id: '1', thread_user_name: 'SomeBot', thread_user_login: 'somebot' }, chatter_user_id: '888' };
  assert.equal((await router.dispatch(reply)).handled, true);

  // Shared chat message from another channel (docs shared example) is skipped by default.
  const shared = fixture<{ subscription: { type: string; version: string }; event: ChatMessageEvent }>('channel.chat.message.shared.json');
  assert.deepEqual(await dispatch(wsEnvelope({ ...shared, event: withText(shared.event, '!ping') }, 'm6')),
    { handled: false, reason: 'shared-chat' });
});

test('notification fixture (resub) shape', () => {
  const ev = fixture<{ event: ChatNotificationEvent }>('channel.chat.notification.resub.json').event;
  assert.equal(ev.notice_type, 'resub');
  assert.equal(ev.resub?.cumulative_months, 10);
  // Docs inconsistency: table says resub.sub_tier, example says resub.sub_plan -> read both.
  assert.equal(ev.resub?.sub_tier ?? ev.resub?.sub_plan, '1000');
  assert.equal(ev.sub, null);
});

// ------------------------------------------------------------------------------------------------
// Overlay render model (pure)
// ------------------------------------------------------------------------------------------------

test('render model: emote CDN URL matches docs, fragments map to nodes, unsafe input neutralized', () => {
  // Docs: "the twitchRaid image file would be at https://static-cdn.jtvnw.net/emoticons/v2/62836/static/light/3.0"
  assert.equal(emoteUrl('62836', 'static', 'light', '3.0'), 'https://static-cdn.jtvnw.net/emoticons/v2/62836/static/light/3.0');

  const base = fixture<{ event: ChatMessageEvent }>('channel.chat.message.json').event;
  const message = fixture<ChatMessageBody>('message.emotes.json'); // "RAID TombRaid RAID twitchRaid RAID"
  const assets = { badges: { 'moderator/1': { url1x: 'https://a/1', url2x: 'https://a/2', url4x: 'https://a/3', title: 'Moderator' } }, cheermotes: [] };
  const nodes = buildMessageNodes({ ...base, message }, assets, { theme: 'dark', scale: '2.0', preferAnimated: true });
  assert.deepEqual(nodes.map((n) => n.kind), ['badge', 'name', 'text', 'emote', 'text', 'emote', 'text']);
  assert.deepEqual(nodes[3], { kind: 'emote', url: 'https://static-cdn.jtvnw.net/emoticons/v2/864205/static/dark/2.0', alt: 'TombRaid' });
  assert.deepEqual(nodes[1], { kind: 'name', text: 'viewer32', color: '#00FF7F' });

  // Empty color -> deterministic palette color; CSS injection attempt -> fallback.
  assert.match(nameColor('', '123'), /^#[0-9A-F]{6}$/);
  assert.equal(nameColor('red;background:url(x)', '123'), nameColor('', '123'));
  // gif fragment with a non-https URL degrades to text.
  const evil = buildMessageNodes({ ...base, message: { text: 'x', fragments: [
    { type: 'gif', text: '[gif]', gif: { id: '1', url: 'javascript:alert(1)' } },
    { type: 'text', text: '<img src=x onerror=alert(1)>' }] } }, assets, { theme: 'dark', scale: '1.0', preferAnimated: false });
  assert.deepEqual(evil.slice(-2), [{ kind: 'text', text: '[gif]' }, { kind: 'text', text: '<img src=x onerror=alert(1)>' }]);
  assert.equal(safeHttpsUrl('https://media4.giphy.com/a.gif?x=1&y=2'), 'https://media4.giphy.com/a.gif?x=1&y=2');
});

// ------------------------------------------------------------------------------------------------

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { console.error(`FAIL ${name}\n`, e); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} passed`);
