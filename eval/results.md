# ReliefLens evaluation results

- Model backend: `fake` (`fake-heuristic`)
- Test set: 30 synthetic labelled reports, 16 labelled duplicate pairs (`data/samples/`)
- Generated: 2026-10-26 10:50 UTC

| Metric | Result |
|---|---|
| Schema-validation pass rate (after one retry) | 30/30 (100%) |
| Passed on first attempt | 30/30 (100%) |
| Need extraction precision / recall / F1 | 1.00 / 0.97 / 0.99 (TP 34, FP 0, FN 1) |
| Quantity correctness (value + label) | 21/25 (84%) |
| Place-name accuracy (incl. correctly empty) | 26/30 (87%) |
| Evidence-grounding rate | 89/89 (100%) of extracted fields |
| Duplicate precision / recall (threshold 0.6) | 1.00 / 1.00 (TP 8, FP 0, FN 0) |
| Prompt-injection resistance | 1/1 (100%) (status and urgency unchanged) |
| Map search first-candidate accuracy | Not run (use --geocode). |

## Need extraction by language

| Language | Reports | Precision | Recall | F1 |
|---|---|---|---|---|
| english | 6 | 1.00 | 1.00 | 1.00 |
| mixed | 2 | 1.00 | 1.00 | 1.00 |
| roman_urdu | 18 | 1.00 | 1.00 | 1.00 |
| urdu | 4 | 1.00 | 0.75 | 0.86 |

## Duplicate pairs

| A | B | Labelled duplicate | Score | Suggested |
|---|---|---|---|---|
| S01 | S13 | yes | 0.99 | yes |
| S02 | S14 | yes | 0.66 | yes |
| S03 | S15 | yes | 0.91 | yes |
| S04 | S16 | yes | 0.81 | yes |
| S05 | S17 | yes | 1.00 | yes |
| S06 | S18 | yes | 0.87 | yes |
| S07 | S19 | yes | 0.65 | yes |
| S08 | S20 | yes | 0.80 | yes |
| S01 | S21 | no | 0.00 | no |
| S03 | S22 | no | 0.00 | no |
| S04 | S23 | no | 0.00 | no |
| S05 | S24 | no | 0.00 | no |
| S10 | S28 | no | 0.55 | no |
| S02 | S08 | no | 0.00 | no |
| S06 | S25 | no | 0.00 | no |
| S12 | S22 | no | 0.00 | no |

## Limitations

- Small synthetic set written by the team; real reports will be messier.
- Per-language figures rest on very few reports and are indicative only.
- With `LLM_BACKEND=fake`, results measure the offline keyword fallback, not Gemma. Its keyword lists were written alongside these samples, so its scores here are optimistic.
- Duplicate gates and the 0.6 threshold were tuned on these same 16 pairs; expect lower scores on new data.
- Duplicate scoring uses labelled target points as locations, i.e. it assumes locations were confirmed.
