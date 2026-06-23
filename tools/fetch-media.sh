#!/usr/bin/env bash
#
# Stáhne VŠECHNA média webu z byzon.cz do ./assets/img/ se zachováním cesty,
# takže stačí v data/content.json přepsat "media_base" na "/assets/img".
#
# Spusť LOKÁLNĚ na svém počítači (kde je byzon.cz dostupný):
#     bash tools/fetch-media.sh
#
# Pak buď:
#   a) zabal a pošli mi výsledek:   zip -r media.zip assets/img   (a nahraj do chatu)
#   b) nebo commitni (viz README – je potřeba povolit assets/img v .gitignore)
#
set -u
cd "$(dirname "$0")/.." || exit 1
URLS="tools/media-urls.txt"
[ -f "$URLS" ] || { echo "Chybí $URLS"; exit 1; }

ok=0; fail=0; failed=()
while IFS= read -r url; do
  [ -z "$url" ] && continue
  rel="${url#*/wp-content/uploads/}"     # cesta za .../uploads/
  dest="assets/img/$rel"
  mkdir -p "$(dirname "$dest")"
  if curl -fsSL "$url" -o "$dest"; then
    echo "OK    $rel"; ok=$((ok+1))
  else
    echo "FAIL  $url"; fail=$((fail+1)); failed+=("$url")
  fi
done < "$URLS"

echo "------------------------------------------------------------"
echo "Hotovo: staženo $ok, selhalo $fail  ->  ./assets/img/"
if [ "$fail" -gt 0 ]; then
  echo "Nepodařilo se stáhnout:"
  printf '   %s\n' "${failed[@]}"
  echo "(Tyto soubory dohledej ručně nebo mi dej vědět – nejspíš jde o jiný název.)"
fi
echo "Dál:  zip -r media.zip assets/img   a nahraj mi media.zip do chatu."
