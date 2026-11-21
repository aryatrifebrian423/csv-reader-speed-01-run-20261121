# csv-reader-speed — fast drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/aryatrifebrian423/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/aryatrifebrian423/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

An original, dependency-free (Node stdlib only) fast reader that returns
exactly csv-reader 1.0.0's answer — `{columns, rows, errors}` — for every
input, including its broken-row policy: BOM drop, LF/CRLF record ends,
empty lines as no record, stray CRs dropped with `stray_cr`, quoted fields
with `""` escapes and CR/LF read as LF inside quotes, `quote_junk` after a
closing quote, `unterminated_quote` re-read as unquoted, and `short_row` /
`long_row` padding and cutting to the first record's width.

## How it is fast

The reference reads one character at a time and builds every field by
repeated concatenation. This reader instead slices fields out of the input
with native `indexOf` scans: an unquoted field runs to the next comma or LF
and is sliced whole; a quoted field runs to its closing quote and is sliced
whole. Slow paths run only when a field actually needs them — a doubled
quote, a line break inside quotes, a stray CR, junk after a closing quote,
or an unterminated quote. On the practice set (6 cases, ~10.6 MB of CSV)
it runs about 2x faster than the house baseline.

## Run it

```sh
node main.ts
```

Reads every case from `$MAKEFUN_INPUT_DIR/cases.json` (else `/input`) and
writes `$MAKEFUN_OUTPUT_DIR/answers.json` (else `/output`). Node 22,
standard library only, deterministic.

---

<sub>Entered on [make.fun](https://make.fun/?ref=2tg9044f&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
