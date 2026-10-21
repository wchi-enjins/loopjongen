#!/usr/bin/env bash
# Crawl autoriteitpersoonsgegevens.nl: Dutch pages (documenten, actueel, themas), newest first, plus their PDFs.
#   bash scripts/ap_crawl.sh [limit]                 (from the repo root; default: everything not crawled yet)
#   SECTIONS=documenten bash scripts/ap_crawl.sh 60  (only decisions, reports and letters; these carry the PDFs)
# Output in data/ap/ (gitignored): html/, pdf/, urls.tsv (sitemap), done.tsv (url, lastmod, status, pdfs, crawl_ms,
# requests). One line per page goes to data/ap_crawl.log; the terminal shows one progress line (CLAUDE.md convention).
# Rerun to continue: pages in done.tsv and files already on disk are skipped.
# Stops hard on anything that looks like a rate limit or block: 429/403/5xx, Retry-After, the WAF "Request Rejected"
# page, a redirect to a 403 page, a PDF that is not a PDF, or a network error.
set -uo pipefail

LIMIT=${1:-1000000}
DELAY=${DELAY:-1} # seconds between requests (robots.txt sets no Crawl-delay)
BASE=https://www.autoriteitpersoonsgegevens.nl
UA="loopjongen-bwb/1.0 (+wesselchi123@gmail.com)"
OUT=${OUT:-data/ap}
SECTIONS=${SECTIONS:-documenten|actueel|themas} # which sections this run takes from urls.tsv
LOG=${LOG:-$(dirname "$OUT")/ap_crawl.log}
URLS=$OUT/urls.tsv
DONE=$OUT/done.tsv
STATE=$OUT/.progress
mkdir -p "$OUT/html" "$OUT/pdf"
touch "$DONE"

TAB=$'\t'
TTY=0; [ -t 2 ] && TTY=1
TICKER=""

now_ms() { perl -MTime::HiRes=time -e 'printf "%d", time * 1000'; }

# One line in data/ap_crawl.log (and on stdout when there is no terminal for the progress line).
log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG"
  [ "$TTY" = 1 ] || echo "$1"
}

# Progress state for the ticker: "ok gone total t0_ms base", then the current item. ok, gone and total include earlier
# runs, so a rerun continues the bar; base = pages done before this run, so speed and time left use this run only.
DONE_N=0; GONE_N=0; TOTAL=0; T0=0; BASE_N=0; LABEL=""
state() { printf '%s %s %s %s %s\n%s\n' "$DONE_N" "$GONE_N" "$TOTAL" "$T0" "$BASE_N" "$LABEL" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"; }

# Inconsistencies (page or PDF gone, network retry, hard stop): logged, and the last 5 shown in red under the progress line.
EVENTS=$OUT/.events
STOPF=$OUT/.stop
: > "$EVENTS"; rm -f "$STOPF"
warn() { log "$1"; [ "$TTY" = 1 ] && echo "$(date +%H:%M:%S) $1" >> "$EVENTS"; }

term_cols() { local c; c=$(stty size < /dev/tty 2> /dev/null | awk '{print $2}'); [ "${c:-0}" -gt 0 ] || c=80; echo $(( c - 1 )); }

# The only writer to the terminal while crawling. Every second it moves back up to the progress line and rewrites it
# plus the last 5 events in red under it, each cut to the terminal width (a wrapped line breaks the redraw).
# Stops after a final redraw when $STOPF exists.
ticker() {
  trap '' INT
  local drawn=0 cols line
  while :; do
    cols=$(term_cols)
    [ "$drawn" -gt 1 ] && printf '\033[%dA' $(( drawn - 1 )) >&2
    draw
    drawn=1
    while IFS= read -r line; do
      printf '\n\r\033[2K\033[31m%s\033[0m' "${line:0:$cols}" >&2
      drawn=$(( drawn + 1 ))
    done < <(tail -n 5 "$EVENTS")
    [ -e "$STOPF" ] && break
    sleep 1
  done
  printf '\n' >&2
}

# Blue bar of up to 30 cells, done/total, pages gone, seconds per page, time left and the expected finish (nl-NL), then
# the current item. Fits the terminal width (the bar shrinks, then the text is cut): a wrapped line can't be redrawn.
draw() {
  local d g t t0 base label cols n run text per left eta finish width filled
  { read -r d g t t0 base; read -r label; } < "$STATE" 2> /dev/null || return
  cols=$(term_cols)
  n=$(( d + g )); run=$(( n - base ))
  text=" $d/$t pages"
  [ "$g" -gt 0 ] && text="$text, $g gone"
  if [ "$run" -gt 0 ]; then
    read -r per left <<< "$(awk -v ms=$(( $(now_ms) - t0 )) -v n="$run" -v r=$(( t - n )) 'BEGIN { p = ms / 1000 / n; printf "%.1f %d", p, p * r }')"
    if [ "$left" -gt 3600 ]; then eta=$(awk -v l="$left" 'BEGIN { printf "%.1f h", l / 3600 }'); else eta="$(( (left + 30) / 60 )) min"; fi
    finish=$(LC_ALL=nl_NL.UTF-8 date -r $(( $(date +%s) + left )) '+%a %e %b, %H:%M' | tr -s ' ')
    text="$text, $per s each, $eta left, done $finish"
  fi
  width=$(( cols - ${#text} ))
  [ "$width" -gt 30 ] && width=30
  [ "$width" -lt 5 ] && width=5
  text="$text  $label" # the current item is cut first, so it never shrinks the bar
  [ $(( cols - width )) -gt 0 ] && text=${text:0:$(( cols - width ))} || text=""
  filled=$(( t > 0 ? n * width / t : width ))
  local done_cells="" todo_cells="" i
  for (( i = 0; i < filled; i++ )); do done_cells+="█"; done
  for (( i = filled; i < width; i++ )); do todo_cells+="░"; done
  printf '\r\033[2K\033[34m%s\033[0m%s%s' "$done_cells" "$todo_cells" "$text" >&2
}

# Lets the ticker do its final redraw (events included) and waits for it.
finish_bar() {
  [ -n "$TICKER" ] || return 0
  state; touch "$STOPF"; wait "$TICKER" 2> /dev/null; TICKER=""
}
trap '[ -n "$TICKER" ] && kill "$TICKER" 2> /dev/null; rm -f "$STATE" "$STATE.tmp" "$EVENTS" "$STOPF"' EXIT
trap 'warn "interrupted"; finish_bar; echo "Rerun to continue." >&2; exit 130' INT TERM

stop() {
  warn "stopping: $1"
  if [ -n "$TICKER" ]; then finish_bar; elif [ "$TTY" = 1 ]; then printf '\033[31mstopping: %s\033[0m\n' "$1" >&2; fi
  echo "Rerun to continue where it stopped." >&2
  exit 2
}

# fetch URL FILE [pdf]: downloads to FILE (skips if present), sets CODE and counts REQ. Stops on any sign of a block.
REQ=0
fetch() {
  local url=$1 file=$2 kind=${3:-html} hdr res final
  CODE=200
  [ -s "$file" ] && return
  sleep "$DELAY"
  REQ=$(( REQ + 1 ))
  hdr=$(mktemp)
  # A network error (e.g. a timeout) gets one retry after 30 s; a second one stops the crawl.
  local tries=0 err
  until res=$(curl -sSL -A "$UA" --max-time 60 -D "$hdr" -o "$file.part" -w '%{http_code} %{url_effective}' "$url" 2> "$hdr.err"); do
    err=$(tr '\n' ' ' < "$hdr.err")
    tries=$(( tries + 1 ))
    [ "$tries" -ge 2 ] && { rm -f "$hdr" "$hdr.err" "$file.part"; stop "Network error twice on $url: $err"; }
    warn "network error, retrying in 30 s: $err$url"
    sleep 30; REQ=$(( REQ + 1 ))
  done
  rm -f "$hdr.err"
  CODE=${res%% *}
  final=${res#* }
  if grep -qi '^retry-after:' "$hdr"; then rm -f "$hdr" "$file.part"; stop "Retry-After header on $url (HTTP $CODE)"; fi
  rm -f "$hdr"
  case $CODE in
    200) ;;
    404|410) rm -f "$file.part"; return ;;
    *) rm -f "$file.part"; stop "HTTP $CODE on $url" ;;
  esac
  case $final in */403|*/403\?*|*/system/403*) rm -f "$file.part"; stop "Redirected to $final" ;; esac
  grep -aq 'Request Rejected' "$file.part" && { rm -f "$file.part"; stop "WAF rejected $url"; }
  [ "$kind" = pdf ] && [ "$(head -c 4 "$file.part")" != "%PDF" ] && { rm -f "$file.part"; stop "Not a PDF: $url"; }
  mv "$file.part" "$file"
}

# 1. Sitemap -> urls.tsv (lastmod <tab> url), Dutch content only, newest first. Fetched once.
if [ ! -s "$URLS" ]; then
  echo "Fetching sitemap..." >&2
  fetch "$BASE/sitemap.xml" "$OUT/sitemap.xml"
  n=0
  for page in $(perl -ne 'print "$1\n" while /<loc>([^<]+)<\/loc>/g' "$OUT/sitemap.xml" | sed 's/&amp;/\&/g'); do
    n=$(( n + 1 )); fetch "$page" "$OUT/sitemap-$n.xml"
  done
  cat "$OUT"/sitemap-*.xml \
    | perl -0ne 'for (split /<\/url>/) { my ($l) = /<loc>([^<]+)/ or next; my ($m) = /<lastmod>([^<]+)/; $l =~ s/&amp;/&/g; print(($m // "") . "\t$l\n") }' \
    | grep -E "$TAB$BASE/(documenten|actueel|themas)/" | sort -r > "$URLS"
  echo "$(wc -l < "$URLS" | tr -d ' ') pages in sitemap." >&2
fi

# 2. This run's batch: pages not in done.tsv yet.
BATCH=$OUT/batch.tsv
awk -F'\t' 'FILENAME == ARGV[1] { d[$1]; next } !($2 in d)' "$DONE" "$URLS" | grep -E "$TAB$BASE/($SECTIONS)/" | head -n "$LIMIT" > "$BATCH"
TODO=$(wc -l < "$BATCH" | tr -d ' ')
[ "$TODO" -eq 0 ] && { echo "Nothing left to crawl." >&2; exit 0; }
read -r DONE_N GONE_N <<< "$(grep -E "^$BASE/($SECTIONS)/" "$DONE" | awk -F'\t' '{ if ($3 == 200) ok++; else gone++ } END { print ok + 0, gone + 0 }')"
BASE_N=$(( DONE_N + GONE_N ))
TOTAL=$(( BASE_N + TODO ))
log "crawling $TODO pages ($BASE_N done before), ${DELAY}s between requests"

T0=$(now_ms); state
if [ "$TTY" = 1 ]; then
  ticker &
  TICKER=$!
fi

i=0; pdfs=0; gone=0
while IFS=$'\t' read -r lastmod url; do
  i=$(( i + 1 ))
  t=$(now_ms); REQ=0; k=0; links=""
  path=${url#"$BASE"/}
  slug=$(printf '%s' "$path" | tr '/' '_')
  LABEL=$path; state
  fetch "$url" "$OUT/html/$slug.html"
  page=$CODE
  if [ "$page" = 200 ]; then
    for href in $(perl -ne 'print "$1\n" while /<a [^>]*href="([^"]+)"[^>]*data-type="pdf"/g' "$OUT/html/$slug.html" | sed 's/&amp;/\&/g' | awk '!s[$0]++'); do
      k=$(( k + 1 ))
      [[ $href == http* ]] || href=$BASE$href
      LABEL="pdf $k: $path"; state
      fetch "$href" "$OUT/pdf/$slug-$k.pdf" pdf
      if [ "$CODE" = 200 ]; then pdfs=$(( pdfs + 1 )); else warn "pdf gone ($CODE): $href"; fi
      links="$links${links:+ }$href"
    done
  fi
  ms=$(( $(now_ms) - t ))
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$url" "$lastmod" "$page" "$links" "$ms" "$REQ" >> "$DONE"
  if [ "$page" = 200 ]; then
    DONE_N=$(( DONE_N + 1 ))
    log "[$(( BASE_N + i ))/$TOTAL] ${lastmod:0:10} ${path:0:70}: $k pdf, $REQ requests, $(awk -v ms="$ms" 'BEGIN { printf "%.1f", ms / 1000 }')s"
  else
    GONE_N=$(( GONE_N + 1 )); gone=$(( gone + 1 ))
    warn "page gone ($page): $url"
  fi
  state
done < "$BATCH"

finish_bar
log "$(( i - gone )) crawled ($pdfs pdfs), $gone gone (404/410), $(( ($(now_ms) - T0) / 60000 )) min; total $(wc -l < "$DONE" | tr -d ' ') of $(wc -l < "$URLS" | tr -d ' '), $(du -sh "$OUT" | cut -f1)"
[ "$TTY" = 1 ] && tail -1 "$LOG" | cut -d' ' -f2- >&2
