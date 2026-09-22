import { czechGreeting } from './salutation.js';
import { guidePath, guidesForRoles } from './guides.js';
import {
  notificationPayloadSchema,
  type AuthEmailInput,
  type AuthEmailPurpose,
  type EmailContent,
  type EmailRecipient,
  type NotificationPayload,
} from './contract.js';

const escape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const safeOrigin = (value: string): string => {
  const url = new URL(value);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Invalid mail origin');
  return url.origin;
};
const actionUrl = (value: string, origin: string): string => {
  const url = new URL(value, origin);
  if (safeOrigin(url.href) !== origin)
    throw new Error('Invalid email action origin');
  return url.href;
};
interface Section {
  title: string;
  lines: string[];
}
interface Layout {
  guides?: { title: string; url: string }[];
  appOrigin: string;
  subject: string;
  preheader: string;
  eyebrow: string;
  title: string;
  accent: string;
  greeting: string;
  body: string;
  cta: string;
  url: string;
  note?: string;
  sections?: Section[];
  footer?: string;
  recoveryUrl?: string;
  settingsUrl?: string;
}

const render = (input: Layout): EmailContent => {
  const origin = safeOrigin(input.appOrigin);
  const url = actionUrl(input.url, origin);
  const recovery = input.recoveryUrl
    ? actionUrl(input.recoveryUrl, origin)
    : null;
  const settings = input.settingsUrl
    ? actionUrl(input.settingsUrl, origin)
    : null;
  const e = escape;
  const guides = (input.guides ?? []).map((guide) => ({
    title: guide.title,
    url: actionUrl(guide.url, origin),
  }));
  const paragraph = (text: string) =>
    `<p style="margin:0 0 12px;">${e(text).replaceAll('\n', '<br>')}</p>`;
  const sections = (input.sections ?? [])
    .map(
      (section) =>
        `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;table-layout:fixed;"><tr><td class="detail" style="border-left:3px solid #f5218e;padding:0 0 0 16px;font-family:Inter,Arial,Helvetica,sans-serif;font-size:15px;line-height:25px;"><h2 style="font-size:16px;line-height:24px;margin:0 0 6px;">${e(section.title)}</h2>${section.lines.map(paragraph).join('')}</td></tr><tr><td height="24" style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`,
    )
    .join('');
  const text = [
    input.greeting,
    input.body,
    `${input.cta}:\n${url}`,
    input.note,
    ...(input.sections ?? []).map((s) => [s.title, ...s.lines].join('\n')),
    ...(guides.length
      ? [
          'Návody pro Vaši roli — bez přihlášení',
          'Připravte se předem. Tyto veřejné odkazy můžete sdílet a fungují i po vypršení pozvánky.',
          ...guides.map((guide) => `${guide.title}: ${guide.url}`),
        ]
      : []),
    input.footer,
    recovery ? `Odkaz už neplatí? Vyžádejte si nový: ${recovery}` : null,
    settings ? `Nastavení e-mailů a oslovení: ${settings}` : null,
    'Tým BYZON\nPotřebujete pomoc? Odpovězte na tento e-mail.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const html = `<!doctype html><html lang="cs" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${e(input.subject)}</title><style>
@font-face{font-family:Khand;font-style:normal;font-weight:700;src:url('${e(origin)}/brand/email/khand-latin.woff2') format('woff2');unicode-range:U+0000-00FF,U+2000-206F;}
@font-face{font-family:Khand;font-style:normal;font-weight:700;src:url('${e(origin)}/brand/email/khand-latin-ext.woff2') format('woff2');unicode-range:U+0100-024F,U+1E00-1EFF;}
@font-face{font-family:Inter;font-style:normal;font-weight:100 900;src:url('${e(origin)}/brand/email/inter-latin.woff2') format('woff2');unicode-range:U+0000-00FF,U+2000-206F;}
@font-face{font-family:Inter;font-style:normal;font-weight:100 900;src:url('${e(origin)}/brand/email/inter-latin-ext.woff2') format('woff2');unicode-range:U+0100-024F,U+1E00-1EFF;}
body{margin:0;}table{border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt;}td{padding:0;}a:focus-visible{outline:3px solid #b01365;outline-offset:4px;}
@media(max-width:520px){.outer{padding:12px 0!important;}.inner{padding-left:24px!important;padding-right:24px!important;}.hero-title{font-size:36px!important;line-height:40px!important;}.cta{display:block!important;text-align:center!important;}.card,.inner{border-radius:0!important;}}
@media(prefers-color-scheme:dark){.canvas{background-color:#140610!important;}.surface{background-color:#251720!important;color:#f7f0f5!important;}.copy,.detail{color:#f7f0f5!important;}.muted{color:#d0c5cd!important;}.help{background-color:#382332!important;color:#f7f0f5!important;}.help a,.settings{color:#ffa7d3!important;}.signature{color:#f7f0f5!important;}}
</style><!--[if mso]><style>body,table,td,p,a,h1,h2{font-family:Arial,sans-serif!important;}td,p,h1,h2{mso-line-height-rule:exactly;}</style><![endif]--></head>
<body class="canvas" style="margin:0;background-color:#faf7f9;color:#343a46;font-family:Inter,Arial,Helvetica,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;mso-hide:all;">${e(input.preheader)}</div>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" class="canvas" width="100%" bgcolor="#faf7f9" style="width:100%;background-color:#faf7f9;color:#343a46;font-family:Inter,Arial,Helvetica,sans-serif;"><tr><td class="outer" align="center" style="padding:28px 16px;">
<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600"><tr><td><![endif]-->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" class="card surface" width="600" bgcolor="#ffffff" style="font-family:Inter,Arial,Helvetica,sans-serif;width:100%;max-width:600px;table-layout:fixed;overflow-wrap:anywhere;word-wrap:break-word;background-color:#ffffff;border:1px solid #dedee5;border-radius:18px;">
<tr><td class="inner" bgcolor="#140610" style="background-color:#140610;padding:28px 36px;border-radius:18px 18px 0 0;"><img src="${e(origin)}/brand/email/logo-light.png" width="176" height="28" alt="BYZON.cz" style="display:block;border:0;color:white;font-size:24px;font-weight:bold;">
<p style="margin:28px 0 12px;color:#f5218e;font-size:11px;line-height:17px;letter-spacing:2px;font-weight:bold;">${e(input.eyebrow)}</p><h1 class="hero-title" style="font-family:Khand,'Arial Narrow',Arial,sans-serif;font-size:46px;line-height:51px;font-weight:700;margin:0;color:#ffffff;">${e(input.title)}<br><span style="color:#f5218e;">${e(input.accent)}</span></h1></td></tr>
<tr><td height="4" bgcolor="#f5218e" style="height:4px;background-color:#f5218e;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td class="inner copy" style="padding:28px 36px 0;color:#343a46;font-size:16px;line-height:26px;"><p style="margin:0 0 12px;font-weight:bold;">${e(input.greeting)}</p>${paragraph(input.body)}</td></tr>
<tr><td class="inner" style="padding:12px 36px 12px;">
<!--[if mso]><v:roundrect href="${e(url)}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="50%" stroke="f" fillcolor="#f5218e"><w:anchorlock/><center style="color:#140610;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${e(input.cta)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a class="cta" href="${e(url)}" style="display:inline-block;padding:16px 28px;background-color:#f5218e;border-radius:999px;color:#140610;text-decoration:none;font-size:16px;font-weight:700;line-height:20px;">${e(input.cta)} &rarr;</a><!--<![endif]-->
</td></tr><tr><td class="inner muted" style="padding:0 36px 24px;color:#606a78;font-size:13px;line-height:21px;">${input.note ? e(input.note) : ''}</td></tr>
${sections ? `<tr><td class="inner copy" style="padding:0 36px;color:#343a46;">${sections}</td></tr>` : ''}
${guides.length ? `<tr><td class="inner copy" style="padding:0 36px 24px;color:#343a46;font-size:15px;line-height:25px;"><h2 style="font-size:18px;line-height:26px;margin:0 0 8px;">Návody pro Vaši roli — bez přihlášení</h2><p style="margin:0 0 12px;">Připravte se předem. Tyto veřejné odkazy můžete sdílet a fungují i po vypršení pozvánky.</p>${guides.map((guide) => `<p style="margin:0 0 8px;"><a class="settings" href="${e(guide.url)}" style="color:#b01365;text-decoration:underline;">${e(guide.title)} &rarr;</a></p>`).join('')}</td></tr>` : ''}
${input.footer ? `<tr><td class="inner muted" style="padding:0 36px 24px;color:#606a78;font-size:14px;line-height:23px;">${paragraph(input.footer)}</td></tr>` : ''}
<tr><td class="inner help" bgcolor="#fceef5" style="padding:20px 36px;border-radius:0 0 18px 18px;background-color:#fceef5;color:#343a46;font-size:13px;line-height:22px;"><p style="margin:0 0 6px;"><strong>Nefunguje tlačítko?</strong> Zkopírujte do prohlížeče celý odkaz:</p><p style="margin:0;word-break:break-all;overflow-wrap:anywhere;"><a href="${e(url)}" style="color:#b01365;text-decoration:underline;word-break:break-all;">${e(url)}</a></p>${recovery ? `<p style="margin:10px 0 0;">Odkaz už neplatí? <a href="${e(recovery)}" style="color:#b01365;">Vyžádejte si nový na přihlašovací stránce.</a></p>` : ''}</td></tr></table>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="font-family:Inter,Arial,Helvetica,sans-serif;width:100%;max-width:600px;"><tr><td class="muted" align="center" style="padding:22px 16px;font-size:13px;line-height:22px;color:#606a78;"><p class="signature" style="margin:0 0 4px;color:#140610;font-weight:bold;">Tým BYZON</p><p style="margin:0;">Potřebujete pomoc? Odpovězte na tento e-mail.</p>${settings ? `<p style="margin:12px 0 0;"><a class="settings" href="${e(settings)}" style="color:#b01365;">Nastavení e-mailů a oslovení</a></p>` : ''}<p style="margin:12px 0 0;font-size:12px;">Lidskost jako konkurenční výhoda</p></td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { subject: input.subject, text, html };
};

const authCopy: Record<
  AuthEmailPurpose,
  Pick<Layout, 'subject' | 'eyebrow' | 'title' | 'accent' | 'body' | 'cta'>
> = {
  'participant-invitation': {
    subject: 'BYZON 2026: Váš přístup do konferenční aplikace',
    eyebrow: 'VAŠE KONFERENČNÍ APLIKACE',
    title: 'Váš BYZON',
    accent: 'začíná tady.',
    body: 'zveme Vás do aplikace konference BYZON 2026. Připravte si vlastní program a mějte důležité informace po ruce.',
    cta: 'Otevřít aplikaci',
  },
  'team-invitation': {
    subject: 'BYZON 2026: pozvánka do organizačního týmu',
    eyebrow: 'ORGANIZAČNÍ TÝM',
    title: 'Pojďme připravit',
    accent: 'skvělý BYZON.',
    body: 'zveme Vás do týmu BYZON 2026. Pomocí svého osobního odkazu otevřete aplikaci a nástroje pro svou roli.',
    cta: 'Otevřít aplikaci',
  },
  'account-activation': {
    subject: 'BYZON 2026: dokončete aktivaci účtu',
    eyebrow: 'AKTIVACE ÚČTU',
    title: 'Ještě jeden krok',
    accent: 'a jste uvnitř.',
    body: 'k dokončení aktivace účtu BYZON 2026 stačí ověřit tuto e-mailovou adresu. Pokračujte tlačítkem níže.',
    cta: 'Aktivovat účet',
  },
  'sign-in': {
    subject: 'BYZON 2026: Váš přihlašovací odkaz',
    eyebrow: 'PŘIHLÁŠENÍ DO APLIKACE',
    title: 'Přihlášení',
    accent: 'jedním kliknutím.',
    body: 'tady je Váš jednorázový odkaz do aplikace BYZON 2026. Kliknutím se přihlásíte bez hesla.',
    cta: 'Přihlásit se',
  },
};
const lifetime = (seconds: number) => {
  if (!Number.isInteger(seconds) || seconds < 1)
    throw new Error('Invalid token lifetime');
  const unit =
    seconds % 3600 === 0 ? 'hour' : seconds % 60 === 0 ? 'minute' : 'second';
  return new Intl.NumberFormat('cs-CZ', {
    style: 'unit',
    unit,
    unitDisplay: 'long',
  }).format(seconds / (unit === 'hour' ? 3600 : unit === 'minute' ? 60 : 1));
};
export const createAuthEmail = (input: AuthEmailInput): EmailContent => {
  const origin = safeOrigin(input.appOrigin);
  const url = actionUrl(input.url, origin);
  const destination = new URL(url).searchParams.get('callbackURL');
  const returnTo =
    destination && new URL(destination, origin).pathname.startsWith('/admin')
      ? '/admin'
      : destination &&
          new URL(destination, origin).pathname === '/po-prihlaseni'
        ? '/po-prihlaseni'
        : '/app';
  const recovery = new URL('/prihlaseni', origin);
  recovery.search = new URLSearchParams({
    mode: 'recovery',
    returnTo,
  }).toString();
  const ttl = lifetime(input.expiresInSeconds);
  const invitation =
    input.purpose === 'participant-invitation' ||
    input.purpose === 'team-invitation';
  const includeGuides = invitation || input.purpose === 'account-activation';
  const guides = guidesForRoles(
    input.roles ?? (input.purpose === 'team-invitation' ? [] : ['participant']),
  );
  return render({
    ...authCopy[input.purpose],
    appOrigin: origin,
    url,
    guides: includeGuides
      ? guides.length
        ? guides.map((guide) => ({
            title: `Návod: ${guide.title}`,
            url: guidePath(guide.slug),
          }))
        : [{ title: 'Vybrat návod podle své role', url: '/navody' }]
      : [],
    greeting: czechGreeting(input.firstName, input.emailSalutation),
    preheader: `${input.purpose === 'sign-in' ? 'Přihlaste se bez hesla.' : 'Otevřete svůj přístup do BYZONu.'} Odkaz platí ${ttl}.`,
    note: `Odkaz platí ${ttl} od odeslání a funguje jen jednou.`,
    sections:
      input.purpose === 'participant-invitation'
        ? [
            {
              title: 'Program podle Vás',
              lines: [
                'Uložte si zajímavé přednášky do své agendy. Program, místa konání i zprávy organizátorů najdete na jednom místě.',
              ],
            },
          ]
        : input.purpose === 'team-invitation'
          ? [
              {
                title: 'Váš přístup do týmu',
                lines: [
                  'Po přihlášení najdete nástroje podle přidělených oprávnění. Moderování, vedení aktivit a dotazy pro řečníky jsou v Můj účet → Moje role; administrátor má také přístup do administrace. Pokud Vám něco chybí, ozvěte se organizátorovi.',
                ],
              },
            ]
          : [],
    footer: `Osobní přihlašovací odkaz je určený jen Vám. Nepřeposílejte ho.\n${invitation ? 'Pokud se Vás tato pozvánka netýká, dejte nám prosím vědět odpovědí na tento e-mail.' : input.purpose === 'sign-in' ? 'Pokud se právě nepřihlašujete, můžete tento e-mail ignorovat.' : 'Pokud právě neaktivujete svůj účet, můžete tento e-mail ignorovat.'}`,
    recoveryUrl: recovery.href,
  });
};

export const createLoginCodeEmail = (input: {
  code: string;
  appOrigin: string;
  expiresInSeconds: number;
}): EmailContent => {
  const ttl = lifetime(input.expiresInSeconds);
  const content = render({
    appOrigin: input.appOrigin,
    subject: 'BYZON 2026: Váš přihlašovací kód',
    preheader: `Kód zadejte přímo v aplikaci BYZON. Platí ${ttl}.`,
    eyebrow: 'PŘIHLÁŠENÍ DO APLIKACE',
    title: 'Váš přihlašovací kód',
    accent: input.code,
    greeting: 'Dobrý den,',
    body: 'vraťte se do aplikace BYZON, ve které jste si kód vyžádali, a zadejte ho do přihlašovacího formuláře. Pokud aplikaci používáte z plochy nebo Docku, otevřete ji jejím zástupcem.',
    cta: 'Otevřít přihlašovací stránku',
    url: '/prihlaseni',
    note: `Kód platí ${ttl} a funguje jen jednou. Přihlášení poté platí 48 hodin.`,
    footer:
      'Kód je určený jen Vám. Nikomu ho nesdělujte. Pokud se právě nepřihlašujete, můžete tento e-mail ignorovat.',
  });
  return {
    ...content,
    text: `Váš přihlašovací kód: ${input.code}\n\n${content.text}`,
  };
};

export const createNotificationEmail = (
  payload: NotificationPayload,
  recipient: EmailRecipient,
  appOrigin: string,
): EmailContent => {
  const p = notificationPayloadSchema.parse(payload);
  const origin = safeOrigin(appOrigin);
  if (p.kind === 'conference_feedback') {
    const url = actionUrl(p.feedbackUrl!, origin);
    if (!/^\/hodnoceni\/[^/]+$/.test(new URL(url).pathname))
      throw new Error('Invalid feedback action path');
    return render({
      appOrigin: origin,
      subject: `${p.eventName}: ${p.reminder ? 'Ještě nám můžete říct, jaký byl Váš BYZON' : 'Jaký byl Váš BYZON? Zajímá nás Váš pohled'}`,
      preheader:
        'Pár minut pro příští BYZON. Bez přihlášení, s automatickým ukládáním.',
      eyebrow: 'BYZON VAŠIMA OČIMA',
      title: 'Co si odnášíte?',
      accent: 'A co příště lépe?',
      greeting: czechGreeting(recipient.firstName, recipient.emailSalutation),
      body: p.reminder
        ? 'ještě jednou děkujeme, že jste byli součástí BYZONu. Pokud máte chvilku, budeme rádi za Váš pohled. Jestli už máte hodnocení rozepsané, navážete přesně tam, kde jste skončili.'
        : 'děkujeme, že jste byli součástí BYZONu. Co Vás inspirovalo, co Vám chybělo a co máme příště udělat lépe? Vaše zkušenost nám pomůže připravit další ročník. Oceníme pochvalu i upřímnou kritiku.',
      cta: p.reminder ? 'Pokračovat v hodnocení' : 'Podělit se o zkušenost',
      url,
      note: 'Vyplnění Vám zabere maximálně 5 minut.',
      settingsUrl: new URL('/app/profil', origin).href,
    });
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat('cs-CZ', {
      timeZone: p.timezone,
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  const copy = {
    reservation_confirmed: [
      'Rezervace potvrzena',
      'Místo máte',
      'rezervované.',
      'Vaše rezervace je potvrzená. Podrobnosti najdete níže a ve své agendě.',
    ],
    reservation_cancelled: [
      'Zrušení rezervace',
      'Rezervace',
      'je zrušená.',
      p.cancelledByOrganizer
        ? 'organizátor zrušil Vaši rezervaci. Aktuální možnosti najdete ve své agendě. Pokud potřebujete pomoc, odpovězte na tento e-mail.'
        : 'potvrzujeme zrušení Vaší rezervace. Aktuální možnosti najdete ve své agendě.',
    ],
    waitlist_joined: [
      'Zařazení do čekací listiny',
      'Jste na',
      'čekací listině.',
      'Vaše žádost je na čekací listině. Místo zatím není rezervované. Pokud na Vás přijde řada a nekoliduje s jinou rezervací, aplikace místo automaticky potvrdí a pošleme Vám e-mail.',
    ],
    waitlist_left: [
      'Odhlášení z čekací listiny',
      'Už nečekáte',
      'na volné místo.',
      'potvrzujeme odhlášení z čekací listiny. U této aktivity už nečekáte na uvolnění místa.',
    ],
    waitlist_promoted: [
      'Místo z čekací listiny je Vaše',
      'Dobrá zpráva.',
      'Máte místo!',
      'uvolnilo se místo a Vaše rezervace je nyní potvrzená. Nemusíte ji znovu potvrzovat. Podrobnosti najdete níže a ve své agendě.',
    ],
    program_changed: [
      'Změna ve Vašem programu',
      'Váš program',
      'se změnil.',
      'organizátoři upravili program aktivit, které máte v agendě, rezervované nebo na čekací listině. Zkontrolujte prosím aktuální čas a místo.',
    ],
    announcement: [
      p.title ?? 'Zpráva od organizátorů',
      'Důležité informace',
      'od organizátorů.',
      p.body ?? 'v aplikaci najdete novou zprávu od organizátorů.',
    ],
    rating_reminder: [
      'Jaký byl Váš BYZON?',
      'Děkujeme, že',
      'jste u toho.',
      'zajímá nás, jaký byl Váš BYZON. Co se povedlo a co můžeme příště zlepšit? Podělte se s námi o své hodnocení konference.',
    ],
  }[p.kind];
  const path =
    p.kind === 'rating_reminder'
      ? '/app/hodnoceni'
      : p.kind === 'announcement'
        ? `/app/oznameni/${p.announcementId}`
        : '/app/agenda';
  const sections: Section[] = p.sessions.map((s) => ({
    title: s.title,
    lines: s.cancelled
      ? ['Tato aktivita byla zrušena nebo odebrána z programu.']
      : [
          ...(s.previous
            ? [
                `Původně: ${date(s.previous.startsAt)} – ${date(s.previous.endsAt)}${s.previous.room ? ` · ${s.previous.room}` : ''}`,
              ]
            : []),
          `${s.previous ? 'Nově: ' : ''}${date(s.startsAt)} – ${date(s.endsAt)}${s.room ? ` · ${s.room}` : ''}`,
        ],
  }));
  if ((p.totalChanges ?? 0) > p.sessions.length)
    sections.push({
      title: 'Další změny',
      lines: ['Celý aktuální program a všechny změny najdete ve své agendě.'],
    });
  return render({
    appOrigin: origin,
    subject: `${p.eventName}: ${copy[0]}`,
    preheader:
      p.kind === 'waitlist_promoted'
        ? 'Rezervace je potvrzená automaticky. Podívejte se na čas a místo.'
        : `${copy[0]}. Podrobnosti najdete v aplikaci.`,
    eyebrow: p.eventName.toLocaleUpperCase('cs'),
    title: copy[1]!,
    accent: copy[2]!,
    body: copy[3]!,
    greeting: czechGreeting(recipient.firstName, recipient.emailSalutation),
    cta:
      p.kind === 'rating_reminder'
        ? 'Ohodnotit konferenci'
        : p.kind === 'announcement'
          ? 'Přečíst zprávu'
          : 'Otevřít moji agendu',
    url: new URL(path, origin).href,
    sections,
    footer:
      p.kind === 'rating_reminder'
        ? 'Hodnocení je dobrovolné. Připomenutí hodnocení můžete vypnout v nastavení e-mailů.'
        : 'Tato zpráva se týká Vaší účasti na konferenci. Aktuální stav najdete vždy v aplikaci.',
    settingsUrl: new URL('/app/profil', origin).href,
  });
};
