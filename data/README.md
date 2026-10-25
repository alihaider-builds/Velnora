# Data

## `samples/` — synthetic test data (written by the team)

| File | Contents |
|---|---|
| `reports.jsonl` | 30 **synthetic** disaster reports in Roman Urdu, Urdu script, English and mixed text, across web, SMS and WhatsApp, each with labels: needs, quantities, place, time, an approximate target point, and flags for prompt injection and "no need" |
| `duplicate_pairs.jsonl` | 8 labelled duplicate pairs (different spelling, script or wording) and 8 hard negatives (same area but different need, or same need far apart) |

**These reports are fictional.** They are inspired by the kinds of messages sent during the 2025 monsoon floods but do not describe real people or real events. Sender numbers are fake (`+92300000xxxx`). Target points are approximate district or town centres, used only for evaluation and demo seeding.

They are used by:
- `python -m app.seed` (in `backend/`) to fill the demo database;
- `eval/run_eval.py` to measure extraction, evidence grounding, duplicates and injection resistance.

## External data

| Source | Used for | License / terms | Status |
|---|---|---|---|
| OpenStreetMap via Nominatim | Map search suggestions (live, cached) | Data © OpenStreetMap contributors, ODbL; [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) | In use; results are suggestions only |
| FAO, *New crop type and flood extent data for Pakistan* (Dec 2025) | Historical flood context (stretch goal) | **Not yet verified** for the specific asset | **Not used.** Do not add any file from it until the asset's license and attribution terms are recorded here |

Never commit real reports, personal data or unlicensed datasets to this folder.
