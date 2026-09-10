import { cp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createAuthEmail,
  createNotificationEmail,
  notificationPayloadSchema,
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
} from '../packages/mail/dist/index.js';

const directory = new URL('../docs/email-preview/', import.meta.url);
const appOrigin = 'https://app.example.test';
await mkdir(directory, { recursive: true });
await cp(
  new URL('../apps/conference/public/brand/email/', import.meta.url),
  new URL('assets/', directory),
  { recursive: true },
);
const examples = [];
for (const [purpose, label] of [
  ['participant-invitation', 'Pozvánka účastníka'],
  ['team-invitation', 'Pozvánka do týmu'],
  ['account-activation', 'Aktivace účtu'],
  ['sign-in', 'Přihlášení'],
]) {
  examples.push({
    id: purpose,
    label,
    content: createAuthEmail({
      purpose,
      firstName: 'Martin',
      appOrigin,
      url: `${appOrigin}/api/auth/magic-link/verify?token=synthetic-preview-only&callbackURL=${purpose === 'team-invitation' ? '%2Fadmin' : '%2Fapp'}`,
      expiresInSeconds:
        purpose === 'sign-in'
          ? LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS
          : ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
    }),
  });
}
for (const [kind, label] of [
  ['reservation_confirmed', 'Potvrzení rezervace'],
  ['reservation_cancelled', 'Zrušení rezervace'],
  ['waitlist_joined', 'Zařazení do čekací listiny'],
  ['waitlist_left', 'Odhlášení z čekací listiny'],
  ['waitlist_promoted', 'Uvolněné místo'],
  ['program_changed', 'Změna programu'],
  ['announcement', 'Zpráva organizátorů'],
  ['rating_reminder', 'Hodnocení konference'],
]) {
  const payload = notificationPayloadSchema.parse({
    kind,
    eventName: 'BYZON 2026',
    timezone: 'Europe/Prague',
    reservationId: '11111111-1111-4111-8111-111111111111',
    waitlistEntryId: '22222222-2222-4222-8222-222222222222',
    announcementId: '33333333-3333-4333-8333-333333333333',
    title: 'Večer se potkáme na nádvoří',
    body: 'dnešní večerní setkání začíná v 19:00 na nádvoří. Vstup je hlavním vchodem.\n\nTěšíme se na společné rozhovory a zážitky.',
    sessions: ['announcement', 'rating_reminder'].includes(kind)
      ? []
      : [
          {
            id: '44444444-4444-4444-8444-444444444444',
            title: 'Lidskost jako konkurenční výhoda',
            startsAt: '2026-09-18T12:00:00.000Z',
            endsAt: '2026-09-18T13:00:00.000Z',
            room: 'Hlavní sál',
            ...(kind === 'program_changed'
              ? {
                  previous: {
                    startsAt: '2026-09-18T11:00:00.000Z',
                    endsAt: '2026-09-18T12:00:00.000Z',
                    room: 'Malý sál',
                  },
                }
              : {}),
          },
        ],
  });
  examples.push({
    id: kind,
    label,
    content: createNotificationEmail(payload, { firstName: 'Jana' }, appOrigin),
  });
}
for (const { id, content } of examples) {
  // Only asset URLs differ from the renderer output; every action link is synthetic.
  await writeFile(
    new URL(`${id}.html`, directory),
    content.html.replaceAll(`${appOrigin}/brand/email/`, './assets/'),
  );
  await writeFile(
    new URL(`${id}.txt`, directory),
    `${content.subject}\n\n${content.text}\n`,
  );
}
const catalog = examples.map(({ id, label, content }) => ({
  id,
  label,
  subject: content.subject,
}));
await writeFile(
  new URL('index.html', directory),
  `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BYZON · E-maily</title><style>
*{box-sizing:border-box}body{margin:0;font:15px/1.5 Arial,sans-serif;background:#faf7f9;color:#140610}header{padding:22px 28px;background:#140610;color:white;border-bottom:4px solid #f5218e}header p{margin:4px 0 0;color:#d0c5cd;font-size:13px}h1{font-size:24px;margin:0}main{display:grid;grid-template-columns:270px minmax(0,1fr);min-height:calc(100vh - 112px)}nav{padding:20px;border-right:1px solid #dedee5;background:white}button{font:inherit;cursor:pointer}nav button{width:100%;border:0;background:none;text-align:left;padding:12px;border-radius:8px;margin-bottom:4px;color:#343a46}nav button[aria-current=true]{background:#fceef5;color:#8b1050;font-weight:bold}.workspace{padding:24px;min-width:0}.toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}.toolbar button,.toolbar a{padding:8px 12px;border:1px solid #dedee5;border-radius:20px;background:white;color:#140610;text-decoration:none;font-size:13px}#subject{font-size:16px;margin:0 0 14px}iframe{display:block;border:0;width:100%;max-width:660px;height:1100px;margin:0 auto;background:#faf7f9}.note{font-size:12px;color:#606a78;margin:20px 0}button:focus-visible,a:focus-visible{outline:3px solid #f5218e;outline-offset:2px}@media(max-width:720px){main{display:block}nav{display:flex;overflow-x:auto;gap:6px;padding:12px}nav button{width:auto;flex-shrink:0;padding:10px}.workspace{padding:16px 4px}.toolbar,#subject,.note{margin-left:12px;margin-right:12px}}
</style><header><h1>BYZON · E-maily</h1><p>12 šablon ze skutečného rendereru · HTML + prostý text · slovníkové oslovení</p></header><main><nav aria-label="Typ e-mailu">${catalog.map((e, i) => `<button type="button" data-id="${e.id}" aria-current="${i === 0}">${String(i + 1).padStart(2, '0')} &nbsp; ${e.label}</button>`).join('')}</nav><section class="workspace" aria-label="Náhled"><h2 id="subject"></h2><div class="toolbar"><button id="desktop">Počítač</button><button id="mobile">Mobil 375 px</button><a id="html" target="_blank" rel="noopener">Otevřít HTML</a><a id="text" target="_blank" rel="noopener">Prostý text</a></div><iframe id="preview" title="Náhled e-mailu"></iframe><p class="note">Ukázková jména a nefunkční testovací odkazy. Věrnost zobrazení v konkrétních poštovních klientech se může lišit.</p></section></main><script>
const catalog=${JSON.stringify(catalog)};const frame=document.getElementById('preview');function show(id){const item=catalog.find(e=>e.id===id);document.getElementById('subject').textContent=item.subject;frame.src=id+'.html';document.getElementById('html').href=id+'.html';document.getElementById('text').href=id+'.txt';document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-current',String(b.dataset.id===id)));}document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>show(b.dataset.id));document.getElementById('mobile').onclick=()=>frame.style.maxWidth='375px';document.getElementById('desktop').onclick=()=>frame.style.maxWidth='660px';show(catalog[0].id);
</script></html>`,
);
console.log(
  `Email previews: ${fileURLToPath(new URL('index.html', directory))}`,
);
