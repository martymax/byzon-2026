# PWA: aktualizace a instalace

Ověřujte na HTTPS s produkčním sestavením; `pnpm dev` aplikační service worker
záměrně odregistruje. Automatické komponentové testy simulují vlastnosti Safari
v Chromiu, skutečnou instalaci je nutné ověřit také na cílovém zařízení.

## Aktualizace

1. Otevřete vydání A a ponechte panel otevřený. Nasaďte vydání B a vraťte se
   do panelu, aby aplikace zkontrolovala aktualizace.
2. Po nabídnutí nové verze klikněte na **Aktualizovat**. Zobrazí se průběh,
   tlačítka jsou dočasně neaktivní a po převzetí nové verze se stránka jednou obnoví.
3. Ve stejném panelu zopakujte postup s vydáním C, i když se konstanta verze
   protokolu v `sw.js` nezměnila. Stránka se musí znovu obnovit.
4. Otevřete dva panely před aktualizací. Aktualizujte první a poté klikněte na
   nabídku v druhém: druhý panel se obnoví i po aktivaci workeru prvním panelem.
5. Pokud worker aktualizaci nedokončí, po 15 sekundách čekání na převzetí se
   zobrazí chyba a **Zkusit znovu**. Nesmí zůstat zdánlivě nefunkční tlačítko.

## Instalace

- Chrome/Edge: po nabídnutí instalace prohlížečem se zobrazí **Nainstalovat**.
  Manifest obsahuje PNG ikony 192 × 192 a 512 × 512 i maskovatelnou ikonu.
- Safari na iPhonu/iPadu (včetně desktopového režimu iPadu): **Jak nainstalovat**
  otevře návod pro **Sdílet → Přidat na plochu**.
- Safari na Macu: **Jak nainstalovat** otevře návod pro **Soubor → Přidat do Docku**
  (macOS Sonoma nebo novější).
- Po spuštění jako nainstalovaná aplikace se instalační nabídka nezobrazuje.
- **Zavřít** potlačí instalační nabídku na 30 dní. Při opakovaném QA odstraňte
  pouze klíč `byzon:pwa-install-dismissed-until:v1` z Local Storage testovaného webu.
- Offline oznámení a nabídka aktualizace mají před instalací přednost. Volba
  **Později** u aktualizace umožní zobrazit dostupnou instalační nabídku.

Nativní instalaci Safari nelze spustit webovým tlačítkem přes
[`beforeinstallprompt`](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event).
Postup pro Mac popisuje také [podpora Apple](https://support.apple.com/cs-cz/104996).
