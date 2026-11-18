// Forgot password: when a reset email goes (limits per address and for the whole site), and the link it carries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanEmail, FORGOT_PER_DAY, FORGOT_PER_HOUR, linkFrom, looksLikeEmail, shouldSendReset } from '../netlify/lib/accountlink.mjs';

const account = { id: 'u1', display_name: 'Reem' };
const email = 'reem@example.com';

test('emails only real accounts', () => {
  assert.ok(shouldSendReset({ email, account }));
  assert.ok(!shouldSendReset({ email, account: undefined }));
  assert.ok(!shouldSendReset({ email: 'setme@setme.invalid', account }));
  assert.ok(!shouldSendReset({ email: 'not an email', account }));
});

test('not again within a few minutes, a few a day, and a cap for everyone', () => {
  assert.ok(!shouldSendReset({ email, account, sentToThis: 1, sentToThisToday: 1 }));
  assert.ok(shouldSendReset({ email, account, sentToThis: 0, sentToThisToday: FORGOT_PER_DAY - 1 }));
  assert.ok(!shouldSendReset({ email, account, sentToThis: 0, sentToThisToday: FORGOT_PER_DAY }));
  assert.ok(!shouldSendReset({ email, account, sentLastHour: FORGOT_PER_HOUR }));
});

test('addresses are tidied before anything is looked up', () => {
  assert.equal(cleanEmail('  Reem@Example.COM '), email);
  assert.ok(looksLikeEmail(email) && !looksLikeEmail('reem@') && !looksLikeEmail(`${'a'.repeat(250)}@x.co`));
});

test('the link opens SetMe, which signs in only when Continue is tapped', () => {
  assert.equal(linkFrom({ hashed_token: 'abc' }, 'https://setme.club', 'recovery'), 'https://setme.club/?token_hash=abc&type=recovery');
  assert.equal(linkFrom({ properties: { hashed_token: 'x y' } }, 'https://setme.club', 'invite'), 'https://setme.club/?token_hash=x%20y&type=invite');
  assert.equal(linkFrom({ action_link: 'https://supabase/verify' }, 'o', 'recovery'), 'https://supabase/verify');
});
