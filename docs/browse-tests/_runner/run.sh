#!/usr/bin/env bash
# Bulk runner for docs/browse-tests/.
#
# Usage:
#   _runner/run.sh                       # everything except human-only
#   _runner/run.sh 04-markets            # one category
#   _runner/run.sh 04-markets/trade-and-sell.md  # one spec
#   _runner/run.sh --tag fast            # only specs with `tags: [fast]`
#   _runner/run.sh --no-parallel         # serialise (debugging)
#   _runner/run.sh --jobs 8              # cap concurrency (default 4)
#   _runner/run.sh --grade               # auto-grade UX specs via `claude -p`
#   _runner/run.sh --report path.md      # write the run report somewhere stable
#   _runner/run.sh --human               # also include human-handoff specs
#
# Each spec is a Markdown file with a YAML frontmatter telling the runner:
#   - id, tags, isolation, parallel-safe, needs, timeout (see _runner/frontmatter.md)
#   - goal-statement, grader (optional: auto|human|none)
#
# Output:
#   - per-spec log: $LOG_DIR/<id>.log
#   - aggregated report: $LOG_DIR/results.md (and a stable copy if --report is set)
#
# Spec bodies are documents, not scripts. The runner extracts every fenced
# code block tagged ```bash``` or ```bash run``` and runs them in order in a
# fresh subshell with lib.sh sourced and TT_* env exported. ```bash skip```
# blocks are documented samples, not executed.

set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
SPECS_DIR="$ROOT/docs/browse-tests"
LIB="$SPECS_DIR/_runner/lib.sh"
RUN_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG_DIR="${TT_LOG_DIR:-/tmp/browse-tests-$(date +%s)-$$}"
mkdir -p "$LOG_DIR"
RESULTS_MD="$LOG_DIR/results.md"

JOBS=4
PARALLEL=1
TAG_FILTER=""
HUMAN_OK=0
DRY_RUN=0
GRADE=0
REPORT_OUT=""
declare -a PATTERNS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --jobs)        JOBS="$2"; shift 2;;
    --no-parallel) PARALLEL=0; shift;;
    --tag)         TAG_FILTER="$2"; shift 2;;
    --human)       HUMAN_OK=1; shift;;
    --grade)       GRADE=1; shift;;
    --report)      REPORT_OUT="$2"; shift 2;;
    --dry-run|-n)  DRY_RUN=1; shift;;
    -h|--help)     sed -n '2,28p' "$0"; exit 0;;
    *)             PATTERNS+=("$1"); shift;;
  esac
done

[ ${#PATTERNS[@]} -eq 0 ] && PATTERNS=(.)

# ---------- discovery ----------------------------------------------------

declare -a SPECS=()
for p in "${PATTERNS[@]}"; do
  if [ -f "$SPECS_DIR/$p" ]; then SPECS+=("$SPECS_DIR/$p")
  elif [ -d "$SPECS_DIR/$p" ]; then
    while IFS= read -r f; do SPECS+=("$f"); done < <(find "$SPECS_DIR/$p" -maxdepth 2 -name '*.md' ! -name 'README.md' ! -path "*/_runner/*" | sort)
  else
    while IFS= read -r f; do SPECS+=("$f"); done < <(find "$SPECS_DIR" -name "$p" ! -path "*/_runner/*" | sort)
  fi
done

# Single-key frontmatter reader. Empty if absent. Supports flat scalars and
# the first line of a YAML block scalar (`key: |`).
fm_get() {
  awk -v k="$2" '
    NR==1 && $0=="---" { in_fm=1; next }
    in_fm && $0=="---" { exit }
    in_fm && $0 ~ "^"k": " { sub("^"k": *",""); print; exit }
  ' "$1"
}

# Multi-line block scalar reader (key: | ... \n  body lines). Echoes body.
fm_block() {
  awk -v k="$2" '
    NR==1 && $0=="---" { in_fm=1; next }
    in_fm && $0=="---" { exit }
    in_fm && $0 ~ "^"k": *\\|" { in_block=1; next }
    in_block {
      if (match($0, /^[^ \t]/)) { exit }
      sub(/^  /, ""); print
    }
  ' "$1"
}

declare -a KEEP=()
for f in "${SPECS[@]}"; do
  tags=$(fm_get "$f" tags || true)
  if [ -n "$TAG_FILTER" ] && ! grep -q "$TAG_FILTER" <<<"$tags"; then continue; fi
  if grep -q "human" <<<"$tags" && [ "$HUMAN_OK" = 0 ]; then continue; fi
  KEEP+=("$f")
done

if [ "$DRY_RUN" = 1 ]; then
  printf '%s\n' "${KEEP[@]}"; exit 0
fi
[ ${#KEEP[@]} -eq 0 ] && { echo "no specs match"; exit 1; }

# ---------- block extractor ---------------------------------------------

extract_blocks() {
  awk '
    /^```bash$/        { running=1; next }
    /^```bash run$/    { running=1; next }
    /^```bash skip$/   { skipping=1; next }
    /^```/             { running=0; skipping=0; next }
    running && !skipping { print }
  ' "$1"
}

# ---------- per-spec runner ----------------------------------------------

run_one() {
  local spec="$1"
  local id; id=$(fm_get "$spec" id)
  [ -z "$id" ] && id=$(basename "$spec" .md)
  local log="$LOG_DIR/${id}.log"
  local rel="${spec#$SPECS_DIR/}"
  local timeout; timeout=$(fm_get "$spec" timeout); timeout="${timeout:-60s}"

  local t0=$(date +%s)
  (
    set -uo pipefail
    export TT_TEST_ID="$id"
    export TT_RUN_ID="$(date +%s%N)-$$"
    export ROOT
    # shellcheck disable=SC1090
    source "$LIB"
    extract_blocks "$spec" | bash
  ) >"$log" 2>&1 &
  local pid=$!
  ( sleep "${timeout%s}" 2>/dev/null && kill -0 $pid 2>/dev/null && kill -TERM $pid 2>/dev/null ) &
  local watchdog=$!
  wait $pid; local code=$?
  kill $watchdog 2>/dev/null; wait $watchdog 2>/dev/null
  local t1=$(date +%s)
  local dur=$((t1-t0))

  if [ "$code" = 0 ]; then
    printf '\033[32mPASS\033[0m %s (%ds)\n' "$id" "$dur"
    echo "PASS|$id|$rel|$dur|$log" >> "$LOG_DIR/.results.csv"
  else
    printf '\033[31mFAIL\033[0m %s (%ds)  log: %s\n' "$id" "$dur" "$log"
    echo "FAIL|$id|$rel|$dur|$log" >> "$LOG_DIR/.results.csv"
  fi
  return $code
}

export -f run_one fm_get fm_block extract_blocks
export ROOT SPECS_DIR LIB LOG_DIR

:>"$LOG_DIR/.results.csv"

# ---------- bucketing -----------------------------------------------------

declare -a PAR=() SER=()
for f in "${KEEP[@]}"; do
  ps=$(fm_get "$f" parallel-safe)
  iso=$(fm_get "$f" isolation)
  if [ "$ps" = "false" ] || [ "$iso" = "global" ] || [ "$PARALLEL" = 0 ]; then
    SER+=("$f")
  else
    PAR+=("$f")
  fi
done

failed=0
T_START=$(date +%s)
if [ ${#PAR[@]} -gt 0 ]; then
  printf '\nRunning %d spec(s) in parallel (jobs=%d)...\n' "${#PAR[@]}" "$JOBS"
  printf '%s\0' "${PAR[@]}" | xargs -0 -n1 -P "$JOBS" -I{} bash -c 'run_one "$@"' _ {} || failed=1
fi
if [ ${#SER[@]} -gt 0 ]; then
  printf '\nRunning %d spec(s) serially...\n' "${#SER[@]}"
  for f in "${SER[@]}"; do run_one "$f" || failed=1; done
fi
T_END=$(date +%s)
TOTAL_DUR=$((T_END-T_START))

# ---------- optional grading (UX specs) ----------------------------------

if [ "$GRADE" = 1 ]; then
  if ! command -v claude >/dev/null 2>&1; then
    printf '\nWARN: --grade passed but `claude` CLI not on PATH; skipping grading.\n'
  else
    printf '\nGrading UX specs via `claude -p`...\n'
    while IFS='|' read -r status id rel dur log; do
      [ "$status" = "PASS" ] || continue
      spec="$SPECS_DIR/$rel"
      grader=$(fm_get "$spec" grader)
      [ "$grader" = "auto" ] || continue
      grade_prompt=$(fm_block "$spec" grade-prompt)
      [ -z "$grade_prompt" ] && continue
      verdict_file="$LOG_DIR/${id}.verdict.md"
      ns_glob="/tmp/tt-${id}-*"
      evidence=$(printf '## findings (from spec run)\n\n```\n%s\n```\n\n## screenshots\n\n' "$(tail -200 "$log")")
      for f in $ns_glob; do
        [ -d "$f" ] && evidence+=$(printf -- '- %s\n' "$f"/*.png)$'\n'
      done
      printf '  grading %s ...\n' "$id"
      {
        printf '%s\n\n---\n\n%s' "$grade_prompt" "$evidence"
      } | claude -p --no-tools >"$verdict_file" 2>>"$log" || true
    done < "$LOG_DIR/.results.csv"
  fi
fi

# ---------- aggregate report --------------------------------------------

n_pass=$(grep -c '^PASS|' "$LOG_DIR/.results.csv" 2>/dev/null || echo 0)
n_fail=$(grep -c '^FAIL|' "$LOG_DIR/.results.csv" 2>/dev/null || echo 0)

{
  printf '# browse-tests run @ %s\n\n' "$RUN_TS"
  printf '- **%d passed**, **%d failed**, total **%ds**\n' "$n_pass" "$n_fail" "$TOTAL_DUR"
  printf '- Log dir: `%s`\n' "$LOG_DIR"
  [ "$GRADE" = 1 ] && printf '- Grading: ON (via `claude -p`)\n'
  printf '\n## Results\n\n| Status | Spec | Duration | Goal |\n|---|---|---|---|\n'
  while IFS='|' read -r status id rel dur log; do
    spec="$SPECS_DIR/$rel"
    goal=$(fm_block "$spec" goal-statement | tr '\n' ' ' | sed 's/  */ /g; s/|/-/g' | head -c 200)
    icon="✅"; [ "$status" = "FAIL" ] && icon="❌"
    printf '| %s %s | `%s` | %ds | %s |\n' "$icon" "$status" "$id" "$dur" "$goal"
  done < "$LOG_DIR/.results.csv"

  if [ "$n_fail" -gt 0 ]; then
    printf '\n## Failures\n\n'
    while IFS='|' read -r status id rel dur log; do
      [ "$status" = "FAIL" ] || continue
      printf '### `%s`\n\nSpec: `%s`. Duration: %ds.\n\n' "$id" "$rel" "$dur"
      printf 'Last 30 lines of log (`%s`):\n\n```\n' "$log"
      tail -30 "$log"
      printf '\n```\n\n'
    done < "$LOG_DIR/.results.csv"
  fi

  if [ "$GRADE" = 1 ]; then
    printf '\n## Grading verdicts\n\n'
    for v in "$LOG_DIR"/*.verdict.md; do
      [ -f "$v" ] || continue
      vid=$(basename "$v" .verdict.md)
      printf '### `%s`\n\n' "$vid"
      cat "$v"
      printf '\n'
    done
  fi
} > "$RESULTS_MD"

[ -n "$REPORT_OUT" ] && cp "$RESULTS_MD" "$REPORT_OUT" && echo "Report copied to: $REPORT_OUT"

printf '\nReport: %s\n' "$RESULTS_MD"
exit "$failed"
