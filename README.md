# makefun-csv-reader-speed-20261121-irgirival

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Irgirival/makefun-csv-reader-speed-20261121-irgirival/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Irgirival/makefun-csv-reader-speed-20261121-irgirival/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0: `solve.js` answers exactly as
the reference does on every case — the same `{columns, rows, errors}` for
broken CSV files (stray CRs, unterminated quotes, quote junk, quoted
newlines, short/long rows, BOM) — and runs about **5× faster** than the
reference on the practice set (median ~171 ms vs ~951 ms per 6-case set,
~10.2 MB of CSV, Node 24, `--no-incremental-marking`; ~5.6× on a fresh set
drawn from drand round 34155120).

## How it is fast

The reference reads one character at a time. This one jumps instead:

- **Whole-record fast path.** A record with no quote before its next line
  break is one `slice` + `split(',')` — no per-field work at all.
- **Index-jump field reads.** Every other field is read with two `indexOf`
  scans (C++ speed) and one `slice` (C++ copy) instead of a per-character
  loop. A quoted field jumps from quote to quote the same way, collapsing
  `""` to `"` as it goes.
- **No per-field allocation.** Field readers return the string alone and
  report how the field ended through one shared variable, so no result
  object is allocated per field (there are ~710,000 fields per set).
- **No per-character Python-style overhead.** Pure dependency-free ES
  module, standard library only; `main.ts` is the house driver, which turns
  V8's incremental marking off before importing `solve.js`.

## Correctness

Every answer is bit-identical to csv-reader 1.0.0's:

- the kit's 6 practice cases: all match;
- a fresh 6-case set drawn from the published generator with drand
  quicknet round 34155120: all match;
- 9,600 fuzz cases over three seeds (stray CRs, unterminated quotes,
  quote junk, empty lines, lone-CR lines, BOM, CRLF/LF mixes, quoted
  newlines, short/long rows, header true/false, empty text): 0 mismatches;
- 47 hand-written targeted edge cases: 0 mismatches.

## Run it

The harness runs `node /bot/main.ts` (Node 22). Outside a container:

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads every case from `$MAKEFUN_INPUT_DIR/cases.json`, answers
each with `run` from `solve.js`, and writes `$MAKEFUN_OUTPUT_DIR/answers.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=kfz6780b&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
