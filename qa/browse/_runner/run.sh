#!/usr/bin/env bash
# Bulk runner for qa/browse/.
#
# Usage:
#   _runner/run.sh                       # everything except human-only
#   _runner/run.sh 04-markets            # one category
#   _runner/run.sh 04-markets/trade-and-sell.md  # one spec
#   _runner/run.sh --tag fast            # only specs with `tags: [fast]`
#   _runner/run.sh --no-parallel         # serialise (debugging)
#   _runner/run.sh --jobs 8              # cap concurrency (default 4)
#   _runner/run.sh --grade               # auto-grade UX specs (default: clauded -p; override via TT_GRADER_CMD)
#   _runner/run.sh --report path.md      # write the run report somewhere stable
#   _runner/run.sh --human               # also include human-handoff specs
#   _runner/run.sh --resume              # skip PASSed specs from latest run dir
#   _runner/run.sh --resume <log-dir>    # resume into a specific run dir
#   _runner/run.sh --retry-failed        # with --resume, also re-run FAILed specs
#   _runner/run.sh --log-dir <path>      # write into this dir (overrides default)
#
# Each spec is a Markdown file with a YAML frontmatter telling the runner:
#   - id, tags, isolation, parallel-safe, needs, timeout (see _runner/frontmatter.md)
#   - goal-statement, grader (optional: auto|human|none)
#
# Output (under repo at qa-runs/<timestamp>/, with qa-runs/latest symlink):
#   - per-spec log:     $LOG_DIR/<id>.log
#   - per-spec report:  $LOG_DIR/<id>.report.md
#   - per-spec evidence: $LOG_DIR/evidence/<id>/  (copied out of /tmp post-run)
#   - aggregated:       $LOG_DIR/results.md  (also $LOG_DIR/done sentinel)
#
# Recoverability: LOG_DIR is on persistent storage by default and the runner
# tracks completion in $LOG_DIR/.results.csv. After a crash/reboot, run with
# `--resume` to skip everything that already PASSed.
#
# Spec bodies are documents, not scripts. The runner extracts every fenced
# code block tagged ```bash``` or ```bash run``` and runs them in order in a
# fresh subshell with lib.sh sourced and TT_* env exported. ```bash skip```
# blocks are documented samples, not executed.

set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
SPECS_DIR="$ROOT/qa/browse"
LIB="$SPECS_DIR/_runner/lib.sh"
RUN_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RUNS_ROOT="$ROOT/qa-runs"

JOBS=4
PARALLEL=1
TAG_FILTER=""
HUMAN_OK=0
DRY_RUN=0
GRADE=0
REPORT_OUT=""
RESUME=0
RESUME_DIR=""
RETRY_FAILED=0
LOG_DIR_ARG=""
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
    --log-dir)     LOG_DIR_ARG="$2"; shift 2;;
    --resume)
      RESUME=1; shift
      if [ $# -gt 0 ] && [ -d "$1" ]; then RESUME_DIR="$1"; shift; fi
      ;;
    --retry-failed) RETRY_FAILED=1; shift;;
    -h|--help)     sed -n '2,40p' "$0"; exit 0;;
    *)             PATTERNS+=("$1"); shift;;
  esac
done

# Resolve LOG_DIR. Precedence: --log-dir > --resume <dir> > $TT_LOG_DIR > new dated dir under qa-runs/.
if [ -n "$LOG_DIR_ARG" ]; then
  LOG_DIR="$LOG_DIR_ARG"
elif [ "$RESUME" = 1 ]; then
  if [ -n "$RESUME_DIR" ]; then
    LOG_DIR="$RESUME_DIR"
  elif [ -L "$RUNS_ROOT/latest" ] || [ -d "$RUNS_ROOT/latest" ]; then
    LOG_DIR="$RUNS_ROOT/latest"
  else
    echo "--resume: no $RUNS_ROOT/latest found and no dir argument given" >&2
    exit 2
  fi
elif [ -n "${TT_LOG_DIR:-}" ]; then
  LOG_DIR="$TT_LOG_DIR"
else
  LOG_DIR="$RUNS_ROOT/$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$LOG_DIR"
# Resolve through any symlinks (e.g. `--resume` defaults to qa-runs/latest)
# so we never re-symlink `latest` to itself.
LOG_DIR=$(cd "$LOG_DIR" && pwd -P)
RESULTS_MD="$LOG_DIR/results.md"

# Maintain qa-runs/latest -> $LOG_DIR for easy --resume. Skip if LOG_DIR
# *is* the latest target (resolved path equals the symlink target already).
if [[ "$LOG_DIR" == "$RUNS_ROOT"/* ]] && [ "$LOG_DIR" != "$RUNS_ROOT/latest" ]; then
  ln -sfn "$LOG_DIR" "$RUNS_ROOT/latest"
fi

# Clear the done sentinel from any previous attempt in this dir; we'll write
# it again at the end if we finish.
rm -f "$LOG_DIR/done"

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

# If resuming, load the IDs we should skip (default: every PASS; if
# --retry-failed is set, only PASS — FAIL gets re-run).
declare -A SKIP_IDS=()
if [ "$RESUME" = 1 ] && [ -f "$LOG_DIR/.results.csv" ]; then
  while IFS='|' read -r status id rel dur log; do
    [ -z "${id:-}" ] && continue
    if [ "$status" = "PASS" ]; then
      SKIP_IDS["$id"]=1
    elif [ "$status" = "FAIL" ] && [ "$RETRY_FAILED" = 0 ]; then
      SKIP_IDS["$id"]=1
    fi
  done < "$LOG_DIR/.results.csv"
fi

declare -a KEEP=()
for f in "${SPECS[@]}"; do
  tags=$(fm_get "$f" tags || true)
  if [ -n "$TAG_FILTER" ] && ! grep -q "$TAG_FILTER" <<<"$tags"; then continue; fi
  if grep -q "human" <<<"$tags" && [ "$HUMAN_OK" = 0 ]; then continue; fi
  id=$(fm_get "$f" id); [ -z "$id" ] && id=$(basename "$f" .md)
  if [ -n "${SKIP_IDS[$id]:-}" ]; then continue; fi
  KEEP+=("$f")
done

if [ "$DRY_RUN" = 1 ]; then
  printf '%s\n' "${KEEP[@]}"; exit 0
fi
if [ ${#KEEP[@]} -eq 0 ]; then
  if [ "$RESUME" = 1 ]; then
    echo "Nothing to resume — all matching specs already have a verdict in $LOG_DIR/.results.csv"
    echo "(Use --retry-failed to re-run FAILed specs.)"
    exit 0
  fi
  echo "no specs match"; exit 1
fi

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
  local local_run_id="$(date +%s%N)-$$"
  (
    set -uo pipefail
    export TT_TEST_ID="$id"
    export TT_RUN_ID="$local_run_id"
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

  local status_str
  if [ "$code" = 0 ]; then
    status_str="PASS"
    printf '\033[32mPASS\033[0m %s (%ds)\n' "$id" "$dur"
  else
    status_str="FAIL"
    printf '\033[31mFAIL\033[0m %s (%ds)  log: %s\n' "$id" "$dur" "$log"
  fi
  # Append to results CSV. On retry of a previously-FAILed spec, prune the
  # stale row first so the aggregator sees only the latest verdict. Wrap in
  # flock so parallel run_one workers don't race on the prune+rewrite.
  (
    flock -x 200
    if [ -f "$LOG_DIR/.results.csv" ] && grep -q "^[A-Z]*|${id}|" "$LOG_DIR/.results.csv"; then
      grep -v "^[A-Z]*|${id}|" "$LOG_DIR/.results.csv" > "$LOG_DIR/.results.csv.tmp.$$" || true
      mv -f "$LOG_DIR/.results.csv.tmp.$$" "$LOG_DIR/.results.csv"
    fi
    echo "$status_str|$id|$rel|$dur|$log" >> "$LOG_DIR/.results.csv"
  ) 200>"$LOG_DIR/.csv.lock"

  # Copy evidence out of /tmp into $LOG_DIR/evidence/<id>/ so it survives a
  # reboot. Specs write under /tmp/tt-<id>-* (TT_NS prefix in lib.sh).
  local ev_dir="$LOG_DIR/evidence/$id"
  mkdir -p "$ev_dir"
  shopt -s nullglob
  for d in /tmp/tt-${id}-*; do
    [ -e "$d" ] || continue
    cp -r "$d" "$ev_dir/" 2>/dev/null || true
  done
  shopt -u nullglob

  # Per-spec report.md alongside the log.
  local report="$LOG_DIR/${id}.report.md"
  local goal; goal=$(fm_block "$spec" goal-statement)
  local tags; tags=$(fm_get "$spec" tags)
  local iso;  iso=$(fm_get "$spec" isolation)
  {
    printf -- '# %s — %s\n\n' "$id" "$status_str"
    printf -- '- **Spec:** `%s`\n' "$rel"
    printf -- '- **Status:** %s\n' "$status_str"
    printf -- '- **Duration:** %ds\n' "$dur"
    printf -- '- **Tags:** %s\n' "$tags"
    printf -- '- **Isolation:** %s\n' "$iso"
    printf -- '- **Run:** %s (run-id %s)\n\n' "$RUN_TS" "$local_run_id"
    if [ -n "$goal" ]; then
      printf -- '## Goal\n\n%s\n\n' "$goal"
    fi
    printf -- '## Log\n\nFull log: `%s`\n\n' "$log"
    printf -- 'Last 80 lines:\n\n'
    printf -- '```\n'
    tail -80 "$log" 2>/dev/null
    printf -- '\n```\n\n'
    # Evidence from spec runs (screenshots / findings) is copied to
    # $LOG_DIR/evidence/<id>/ from /tmp/tt-<id>-* after each run.
    printf -- '## Evidence\n\n'
    local found=0
    if [ -d "$ev_dir" ]; then
      while IFS= read -r p; do
        [ -z "$p" ] && continue
        printf -- '- `%s`\n' "$p"
        found=1
      done < <(find "$ev_dir" -mindepth 1 -maxdepth 3 \( -name '*.png' -o -name 'findings.txt' -o -name '*.md' \) 2>/dev/null | sort)
    fi
    [ "$found" = 0 ] && printf -- '_no evidence files produced_ (evidence dir: `%s`)\n' "$ev_dir"
    printf -- '\n'
  } > "$report"
  return $code
}

export -f run_one fm_get fm_block extract_blocks
export ROOT SPECS_DIR LIB LOG_DIR

# Don't truncate the CSV: --resume needs prior verdicts to remain on disk.
[ -f "$LOG_DIR/.results.csv" ] || :>"$LOG_DIR/.results.csv"

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
#
# Grading pipes each `grader: auto` spec's findings + screenshots through an
# LLM CLI to produce a structured verdict. Defaults to `clauded -p` (the
# user's `~/.bashrc` alias for `claude --dangerously-skip-permissions`).
# Aliases don't load in non-interactive shells, so we invoke through
# `bash -ic` to expand. Override the whole invocation with TT_GRADER_CMD
# (e.g. `TT_GRADER_CMD='claude -p'`) if you have a different setup. The
# persona/UX specs already do their own browsing during the spec run, so
# the grader sees post-hoc evidence; with `--dangerously-skip-permissions`
# claude can also follow up with tools if it wants.

if [ "$GRADE" = 1 ]; then
  GRADER_CMD="${TT_GRADER_CMD:-clauded -p}"
  # Resolve via interactive bash so user aliases expand.
  if ! bash -ic "command -v ${GRADER_CMD%% *} >/dev/null 2>&1 || alias ${GRADER_CMD%% *} >/dev/null 2>&1" 2>/dev/null; then
    printf '\nWARN: --grade passed but `%s` is not callable; skipping grading.\n' "${GRADER_CMD%% *}"
    printf '       Override with: TT_GRADER_CMD="<full-cmd-with-args>" _runner/run.sh --grade\n'
  else
    printf '\nGrading UX specs via `%s`...\n' "$GRADER_CMD"
    while IFS='|' read -r status id rel dur log; do
      [ "$status" = "PASS" ] || continue
      spec="$SPECS_DIR/$rel"
      grader=$(fm_get "$spec" grader)
      [ "$grader" = "auto" ] || continue
      grade_prompt=$(fm_block "$spec" grade-prompt)
      [ -z "$grade_prompt" ] && continue
      verdict_file="$LOG_DIR/${id}.verdict.md"
      ev_dir="$LOG_DIR/evidence/$id"
      # Build evidence prompt: spec log tail + every findings.txt + screenshot list.
      evidence=$(printf '## findings (from spec run)\n\n```\n%s\n```\n\n' "$(tail -200 "$log")")
      if [ -d "$ev_dir" ]; then
        while IFS= read -r f; do
          [ -z "$f" ] && continue
          evidence+=$(printf -- '\n### %s\n\n```\n%s\n```\n' "${f#$ev_dir/}" "$(cat "$f" 2>/dev/null | head -c 4000)")$'\n'
        done < <(find "$ev_dir" -name 'findings.txt' 2>/dev/null | sort)
        evidence+=$'\n## screenshots\n\n'
        while IFS= read -r f; do
          [ -z "$f" ] && continue
          evidence+="- ${f#$ev_dir/}"$'\n'
        done < <(find "$ev_dir" -name '*.png' 2>/dev/null | sort)
      fi
      printf '  grading %s ...\n' "$id"
      {
        printf '%s\n\n---\n\n%s' "$grade_prompt" "$evidence"
      } | bash -ic "$GRADER_CMD" >"$verdict_file" 2>>"$log" || true
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
  [ "$GRADE" = 1 ] && printf -- '- Grading: ON (via `%s -p`)\n' "${TT_GRADER_CMD:-clauded}"
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
      printf -- '### `%s`\n\nSpec: `%s`. Duration: %ds. Per-spec report: `%s`.\n\n' \
        "$id" "$rel" "$dur" "$LOG_DIR/${id}.report.md"
      printf -- 'Last 30 lines of log (`%s`):\n\n' "$log"
      printf -- '```\n'
      tail -30 "$log" 2>/dev/null
      printf -- '\n```\n\n'
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

# Sentinel for external observers (and for `--resume` to know this run is
# finished vs interrupted).
date -u +%Y-%m-%dT%H:%M:%SZ > "$LOG_DIR/done"

printf '\nReport: %s\n' "$RESULTS_MD"
exit "$failed"
