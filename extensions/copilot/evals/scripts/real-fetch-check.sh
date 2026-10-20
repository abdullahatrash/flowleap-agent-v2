#!/usr/bin/env bash
# Real-fetch check of ADR 0017 decision 5 (#825): proves that each official law page named in
# assets/skills/legal-research/references/official-sources.md returns quotable text to a plain
# non-browser fetch (curl, default user agent, redirects followed), by looking for a known phrase
# of that section in the body. The eval suites prove the model chooses the page; this proves the
# page answers. Run from anywhere: bash evals/scripts/real-fetch-check.sh. Exit 1 when a required
# phrase is missing or a block-page phrase is found (curl retries a transient 5xx twice first).
# The log goes to $OUT (default: $TMPDIR/real-fetch-check.log), never into the repo.
#
# Each check lists the phrases to find. A phrase that starts with "!" is a block-page marker
# ("Page Not Found", "Request Access", "CAPTCHA"): the host answered 200 with a placeholder, so a
# HIT on it is a failure and the HTTP status alone proves nothing. Script, style and tags are
# stripped before the case-insensitive search. `check_info` records the same verdict but does not
# fail the run: the two human pages that block a non-browser fetch today (uscode.house.gov, the
# ecfr.gov HTML page) are kept as information because the skill names a working route for each
# (the govinfo link service, the eCFR renderer API).
set -u
OUT="${OUT:-${TMPDIR:-/tmp}/real-fetch-check.log}"
: > "$OUT"
failures=0
echo "real-fetch-check  $(date -u +%Y-%m-%dT%H:%M:%SZ)  curl $(curl --version | head -1 | cut -d' ' -f2)  UA=curl-default (no browser UA)  log=$OUT" | tee -a "$OUT"

# verdict <url> <phrase>... ; prints "<status> <final url> <bytes>B |[HIT|MISS: phrase]..." and returns 1 when a phrase fails.
verdict() {
	local url="$1"; shift
	local body; body="$(mktemp)"
	local meta; meta="$(curl -sL --max-time 40 --retry 2 --retry-delay 3 -o "$body" -w '%{http_code} %{url_effective} %{size_download}B' "$url")"
	local text; text="$(python3 -c 'import re,sys,html;t=open(sys.argv[1],encoding="utf-8",errors="replace").read();t=re.sub(r"<script.*?</script>|<style.*?</style>","",t,flags=re.S);t=html.unescape(re.sub(r"<[^>]+>"," ",t));print(re.sub(r"\s+"," ",t))' "$body")"
	rm -f "$body"
	local line="$meta |" p found ok=0
	for p in "$@"; do
		local phrase="${p#!}"
		if printf '%s' "$text" | python3 -c 'import sys;t=sys.stdin.read().lower();sys.exit(0 if sys.argv[1].lower() in t else 1)' "$phrase"; then found=1; else found=0; fi
		if [ "$p" != "$phrase" ]; then
			# block-page marker: a HIT is the failure
			if [ "$found" = 1 ]; then line="$line [BLOCK-PAGE: $phrase]"; ok=1; else line="$line [no block page: $phrase]"; fi
		elif [ "$found" = 1 ]; then line="$line [HIT: $phrase]"; else line="$line [MISS: $phrase]"; ok=1; fi
	done
	printf '%s' "$line"
	return $ok
}

# check <label> <url> <phrase>... ; a failed verdict fails the run.
check() {
	local label="$1" url="$2"; shift 2
	local line
	if line="$(verdict "$url" "$@")"; then
		echo "PASS $label | $line" | tee -a "$OUT"
	else
		echo "FAIL $label | $line" | tee -a "$OUT"
		failures=$((failures + 1))
	fi
}

# check_info <label> <url> <phrase>... ; the verdict is recorded but never fails the run.
check_info() {
	local label="$1" url="$2"; shift 2
	local line
	if line="$(verdict "$url" "$@")"; then
		echo "INFO-PASS $label | $line" | tee -a "$OUT"
	else
		echo "INFO-FAIL $label | $line" | tee -a "$OUT"
	fi
}

check "MPEP 2143 (uspto.gov)"              "https://www.uspto.gov/web/offices/pac/mpep/s2143.html" "prima facie" "R-01.2024"
check "MPEP chapter index 2100"            "https://www.uspto.gov/web/offices/pac/mpep/mpep-2100.html" "Patentability"
check "35 USC 103 govinfo link service"    "https://www.govinfo.gov/link/uscode/35/103?link-type=html" "non-obvious" "United States Code, 2024 Edition"
check "35 USC 112 govinfo link service"    "https://www.govinfo.gov/link/uscode/35/112?link-type=html" "specification shall contain" "2024 Edition"
check_info "35 USC 103 uscode.house.gov (OLRC human page, blocks a non-browser fetch today)" "https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title35-section103&num=0&edition=prelim" "non-obvious" "!Page Not Found" "!temporary format"
check "35 USC 103 mirror (law.cornell)"    "https://www.law.cornell.edu/uscode/text/35/103" "non-obvious"
check_info "37 CFR 1.362 ecfr.gov HTML page (human page, blocks a non-browser fetch today)" "https://www.ecfr.gov/current/title-37/section-1.362" "maintenance fee" "!Request Access" "!CAPTCHA"
check "37 CFR 1.362 ecfr.gov renderer API" "https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-37?section=1.362" "maintenance fee" "1.362 Time for payment"
check "37 CFR 1.362 mirror (law.cornell)"  "https://www.law.cornell.edu/cfr/text/37/1.362" "maintenance fee"
check "EPC Art. 54 (epo.org)"              "https://www.epo.org/en/legal/epc/2020/a54.html" "novelty" "state of the art"
check "EPC Rule 6 (epo.org)"               "https://www.epo.org/en/legal/epc/2020/r6.html" "translation"
check "EPC index (TOC sits in a script block)" "https://www.epo.org/en/legal/epc/2020/index.html" "European Patent Convention"
check "Guidelines index (edition)"         "https://www.epo.org/en/legal/guidelines-epc" "2026 edition" "entered into force"
check "Guidelines 2026 G-VII 5"            "https://www.epo.org/en/legal/guidelines-epc/2026/g_vii_5.html" "problem-solution approach" "closest prior art"
check "Guidelines 2025 G-VII 5 (old year still served)" "https://www.epo.org/en/legal/guidelines-epc/2025/g_vii_5.html" "problem-solution approach"
check "Guidelines PCT-EPO 2026 index"      "https://www.epo.org/en/legal/guidelines-pct/2026/index.html" "PCT"
check "Case Law index"                     "https://www.epo.org/en/legal/case-law" "11th edition"
check "Case Law book 2025 I.C.4.1"         "https://www.epo.org/en/legal/case-law/2025/clr_i_c_4_1.html" "General rules of interpretation" "prior art"
check "Board decision G 1/19"              "https://www.epo.org/en/boards-of-appeal/decisions/g190001ex1" "Pedestrian simulation"
check "Board decision T 641/00"            "https://www.epo.org/en/boards-of-appeal/decisions/t000641ex1" "T 0641/00"
check "PCT Rule 4 (wipo.int)"              "https://www.wipo.int/en/web/pct-system/texts/rules/r4" "Rule 4" "The Request"
check "PCT Rule 4 old path (redirects)"    "https://www.wipo.int/pct/en/texts/rules/r4.html" "Rule 4"
check "PCT Art. 3 (wipo.int)"              "https://www.wipo.int/en/web/pct-system/texts/articles/a3" "Article 3" "International Application"
check "PCT texts index (edition)"          "https://www.wipo.int/en/web/pct-system/texts/index" "as in force from"
check "PCT Applicant's Guide index"        "https://www.wipo.int/en/web/pct-system/guide/index" "Applicant's Guide"
check "PCT AG national-phase index"        "https://www.wipo.int/en/web/pct-system/guide/npindex" "national phase"
check "PCT AG EP chapter (pctlegal)"       "https://pctlegal.wipo.int/eGuide/view-doc.xhtml?doc-code=EP&doc-lang=en" "European Patent Organisation" "Valid as from"
check "PCT AG US chapter (pctlegal)"       "https://pctlegal.wipo.int/eGuide/view-doc.xhtml?doc-code=US&doc-lang=en" "United States" "Valid as from"
check "CAFC opinions (cafc.uscourts.gov)"  "https://www.cafc.uscourts.gov/home/case-information/opinions-orders/" "Opinions"
check "SCOTUS opinions"                    "https://www.supremecourt.gov/opinions/opinions.aspx" "Opinions"

echo "done $(date -u +%Y-%m-%dT%H:%M:%SZ)  failures=$failures" | tee -a "$OUT"
exit $((failures > 0 ? 1 : 0))
