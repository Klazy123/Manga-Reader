import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const vars = Object.fromEntries(env.split(/\r?\n/)
  .filter(x => x.trim() && !x.trimStart().startsWith('#') && x.includes('='))
  .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }));
if (!vars.SUPABASE_URL || !vars.SUPABASE_SERVICE_ROLE_KEY) throw Error('Заполни .env');
const db = createClient(vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const accounts = JSON.parse(readFileSync('accounts.json', 'utf8'));
if (!Array.isArray(accounts) || !accounts.length) throw Error('В accounts.json должен быть массив пользователей');
const names = new Set(), emails = new Set();
for (const a of accounts) {
  if (!a.username || !a.email || !a.password || a.password.length < 12)
    throw Error('У каждого должны быть username, email и пароль от 12 символов');
  const name = a.username.toLowerCase(), email = a.email.toLowerCase();
  if (names.has(name) || emails.has(email)) throw Error('Повторяющийся ник или email в accounts.json');
  names.add(name); emails.add(email);
}
if (!names.has('katsuro')) throw Error('В accounts.json должен быть Katsuro');

// Находим Auth-пользователей, даже если прошлый запуск не успел создать login_names.
async function findAuthUserByEmail(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw Error(`Не удалось получить пользователей Auth: ${error.message}`);
    const user = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
}

for (const a of accounts) {
  const { data: known, error: knownError } = await db.from('login_names')
    .select('user_id,login_email').eq('username', a.username).maybeSingle();
  if (knownError) throw Error(`Чтение login_names: ${knownError.message}`);
  if (known && known.login_email.toLowerCase() !== a.email.toLowerCase())
    throw Error(`Для ${a.username} указан другой email в базе. Исправь несоответствие вручную.`);

  const authUser = await findAuthUserByEmail(a.email);
  if (known && authUser && known.user_id !== authUser.id)
    throw Error(`Конфликт ID для ${a.username}: login_names и Auth указывают на разных пользователей.`);
  let id = known?.user_id ?? authUser?.id;
  let created = false;
  if (!id) {
    const { data, error } = await db.auth.admin.createUser({
      email: a.email, password: a.password, email_confirm: true
    });
    if (error) throw Error(`Не удалось создать ${a.username}: ${error.message}`);
    id = data.user.id;
    created = true;
  }
  const role = a.username.toLowerCase() === 'katsuro' ? 'admin' : 'reader';
  const { error: pErr } = await db.from('profiles')
    .upsert({ id, username: a.username, role }, { onConflict: 'id' });
  if (pErr) throw Error(`Профиль ${a.username}: ${pErr.message}`);
  const { error: lErr } = await db.from('login_names')
    .upsert({ username: a.username, login_email: a.email, user_id: id }, { onConflict: 'username' });
  if (lErr) throw Error(`Логин ${a.username}: ${lErr.message}`);
  console.log(`✓ ${a.username} (${role}) — ${created ? 'создан' : 'уже существует, записи проверены'}`);
}
console.log('Готово. Пароли существующих аккаунтов не изменены.');
