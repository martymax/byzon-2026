/** Real application captures, generated with synthetic fixtures only.
 * Regenerate with scripts/capture-guide-screenshots.mjs. */
export const guideScreenshots = {
  prihlaseni: {
    title: 'Přihlášení e-mailem',
    alt: 'Přihlašovací formulář s polem pro e-mail a tlačítkem pro zaslání přihlašovacího odkazu.',
  },
  program: {
    title: 'Výběr z programu',
    alt: 'Program konference s výběrem dne a přehledem bodů programu.',
  },
  moderovani: {
    title: 'Práce s dotazy během Q&A',
    alt: 'Moderátorský přehled dotazů s označením zodpovězených otázek, výběrem ke sloučení a mazáním.',
  },
  odpoved: {
    title: 'Soukromá odpověď řečníka',
    alt: 'Dotaz účastníka a rozepsaná soukromá písemná odpověď řečníka.',
  },
  aktivita: {
    title: 'Účastníci přidělené aktivity',
    alt: 'Přehled aktivity se seznamem přihlášených účastníků a čekací listinou.',
  },
  pozvanky: {
    title: 'Pozvánky podle rolí',
    alt: 'Administrace pozvánek s rolemi příjemců, stavem pozvání a odkazy na návody.',
  },
} as const;
export type GuideScreenshotId = keyof typeof guideScreenshots;
