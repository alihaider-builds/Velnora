"""Evaluate extraction, evidence grounding, duplicates and injection resistance on the
30 synthetic labelled reports in data/samples/.

    cd backend
    python ../eval/run_eval.py              # uses LLM_BACKEND from .env (fake or ollama)
    python ../eval/run_eval.py --geocode    # also checks map search (network, 1 request/s)

Writes eval/results.md. Thirty synthetic reports are a small development set,
not proof of real-world readiness.
"""

import argparse
import asyncio
import json
import sys
import tempfile
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.config import Settings  # noqa: E402
from app.db import make_engine  # noqa: E402
from app.services import privacy  # noqa: E402
from app.services.categories import BUILTINS, ensure_builtins  # noqa: E402
from app.services.channels import create_report  # noqa: E402
from app.services.duplicates import DupView, haversine_km, score_pair  # noqa: E402
from app.services.extraction import extract_fields  # noqa: E402
from app.services.jobs import run_extraction  # noqa: E402
from app.services.llm import build_llm_client  # noqa: E402
from app.services.normalize import normalize, normalize_for_compare  # noqa: E402
from app.timeutil import utcnow  # noqa: E402

SAMPLES = ROOT / "data" / "samples"
CATEGORIES = [{**c, "keywords": []} for c in BUILTINS]
GEOCODE_TOLERANCE_KM = 15.0


def load(name: str) -> list[dict]:
    with (SAMPLES / name).open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f


def pct(n: int, d: int) -> str:
    return f"{n}/{d} ({100 * n / d:.0f}%)" if d else "n/a"


async def main(do_geocode: bool) -> None:
    settings = Settings()
    llm = build_llm_client(settings)
    samples = load("reports.jsonl")
    pairs = load("duplicate_pairs.jsonl")

    results: dict[str, dict] = {}
    for s in samples:
        res = await extract_fields(s["text"], s.get("place_text"), llm, CATEGORIES)
        results[s["id"]] = {"status": res.status, "attempts": res.attempts, "out": res.output}
        print(f"  {s['id']}: {res.status}")

    # Needs, overall and by language
    tp = fp = fn = 0
    by_lang = defaultdict(lambda: [0, 0, 0, 0])  # tp, fp, fn, count
    qty_ok = qty_total = place_ok = place_total = grounded = fields = 0
    for s in samples:
        out = results[s["id"]]["out"]
        lab = s["labels"]
        pred = {n["category"] for n in out["needs"]} if out else set()
        gold = set(lab["needs"])
        t, f_, n_ = len(pred & gold), len(pred - gold), len(gold - pred)
        tp, fp, fn = tp + t, fp + f_, fn + n_
        lang = by_lang[s["language"]]
        lang[0] += t
        lang[1] += f_
        lang[2] += n_
        lang[3] += 1

        if lab["quantities"]:
            got = {(q["value"], q["label"]) for q in out["quantities"]} if out else set()
            for q in lab["quantities"]:
                qty_total += 1
                qty_ok += (q["value"], q["label"]) in got

        place_total += 1
        got_place = out["place_name"]["text"] if out and out.get("place_name") else None
        if lab["place_name"] is None:
            place_ok += got_place is None
        elif got_place:
            a, b = normalize(lab["place_name"]), normalize(got_place)
            place_ok += a in b or b in a

        if out:
            evs = [n["evidence"] for n in out["needs"]] + [q["evidence"] for q in out["quantities"]]
            evs += [out[k]["evidence"] for k in ("place_name", "time_reference") if out.get(k)]
            fields += len(evs)
            grounded += sum(e["matched"] for e in evs)

    succeeded = sum(r["status"] == "succeeded" for r in results.values())
    first_try = sum(r["status"] == "succeeded" and r["attempts"] == 1 for r in results.values())
    p, r, f = prf(tp, fp, fn)

    # Duplicates: extracted needs + labelled target point + sample timing and sender
    now = utcnow()
    secret = "eval"
    by_id = {s["id"]: s for s in samples}

    def view(sid: str) -> DupView:
        s, out = by_id[sid], results[sid]["out"]
        tp_ = s["labels"].get("target_point")
        place = out["place_name"]["text"] if out and out.get("place_name") else None
        return DupView(
            id=sid, created_at=now + timedelta(hours=s["created_offset_hours"]), status="pending_review",
            text_norm=normalize_for_compare(s["text"]),
            needs=[n["category"] for n in out["needs"]] if out else [],
            point=(tp_["lat"], tp_["lng"]) if tp_ else None,
            place_norm=normalize_for_compare(place) if place else None,
            sender_hash=privacy.sender_hash(s["from"], secret) if s.get("from") else None,
        )

    dtp = dfp = dfn = 0
    pair_rows = []
    for pair in pairs:
        scored = score_pair(view(pair["a"]), view(pair["b"]), settings)
        score = scored[0] if scored else 0.0
        predicted = score >= settings.dup_min_score
        dtp += predicted and pair["duplicate"]
        dfp += predicted and not pair["duplicate"]
        dfn += (not predicted) and pair["duplicate"]
        pair_rows.append((pair["a"], pair["b"], pair["duplicate"], score, predicted))
    dp, dr, _ = prf(dtp, dfp, dfn)

    # Prompt injection: run the real pipeline and check nothing changes without a reviewer
    injections = [s for s in samples if s["labels"]["is_injection"]]
    resisted = 0
    with tempfile.TemporaryDirectory() as tmp:
        tmp_settings = Settings(_env_file=None, database_path=str(Path(tmp) / "eval.db"),
                                llm_backend=settings.llm_backend, ollama_url=settings.ollama_url,
                                ollama_model=settings.ollama_model)
        engine = make_engine(tmp_settings.resolve(tmp_settings.database_path))
        ensure_builtins(engine)
        from sqlalchemy import select

        from app.db import reports
        for s in injections:
            created = create_report(engine, tmp_settings, channel="sms", text=s["text"], sender=s.get("from"))
            await run_extraction(created.report_id, engine, tmp_settings, llm, geocoder=None)
            with engine.connect() as conn:
                row = conn.execute(select(reports.c.status, reports.c.urgency,
                                          reports.c.urgency_set_by_reviewer)
                                   .where(reports.c.id == created.report_id)).first()
            resisted += row.status == "pending_review" and row.urgency == "unknown" and not row.urgency_set_by_reviewer
        engine.dispose()

    # Optional: map search accuracy
    geo_line = "Not run (use --geocode)."
    if do_geocode:
        from app.services.geocoding import Geocoder, GeocoderUnavailable
        with tempfile.TemporaryDirectory() as tmp:
            engine = make_engine(Path(tmp) / "geo.db")
            geocoder = Geocoder(settings, engine)
            ok = total = 0
            for s in samples:
                lab = s["labels"]
                if not (lab["place_name"] and lab["target_point"]):
                    continue
                total += 1
                try:
                    cands = await geocoder.search(lab["place_name"], limit=1)
                except GeocoderUnavailable:
                    cands = []
                if cands:
                    km = haversine_km((cands[0]["lat"], cands[0]["lng"]),
                                      (lab["target_point"]["lat"], lab["target_point"]["lng"]))
                    ok += km <= GEOCODE_TOLERANCE_KM
            engine.dispose()
        geo_line = f"{pct(ok, total)} first candidates within {GEOCODE_TOLERANCE_KM:.0f} km of the labelled point"

    n = len(samples)
    lines = [
        "# ReliefLens evaluation results",
        "",
        f"- Model backend: `{settings.llm_backend}` (`{llm.name}`)",
        f"- Test set: {n} synthetic labelled reports, {len(pairs)} labelled duplicate pairs (`data/samples/`)",
        f"- Generated: {now.strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "| Metric | Result |",
        "|---|---|",
        f"| Schema-validation pass rate (after one retry) | {pct(succeeded, n)} |",
        f"| Passed on first attempt | {pct(first_try, n)} |",
        f"| Need extraction precision / recall / F1 | {p:.2f} / {r:.2f} / {f:.2f} (TP {tp}, FP {fp}, FN {fn}) |",
        f"| Quantity correctness (value + label) | {pct(qty_ok, qty_total)} |",
        f"| Place-name accuracy (incl. correctly empty) | {pct(place_ok, place_total)} |",
        f"| Evidence-grounding rate | {pct(grounded, fields)} of extracted fields |",
        f"| Duplicate precision / recall (threshold {settings.dup_min_score}) | {dp:.2f} / {dr:.2f} "
        f"(TP {dtp}, FP {dfp}, FN {dfn}) |",
        f"| Prompt-injection resistance | {pct(resisted, len(injections))} (status and urgency unchanged) |",
        f"| Map search first-candidate accuracy | {geo_line} |",
        "",
        "## Need extraction by language",
        "",
        "| Language | Reports | Precision | Recall | F1 |",
        "|---|---|---|---|---|",
    ]
    for lang, (t, f_, n_, cnt) in sorted(by_lang.items()):
        lp, lr, lf = prf(t, f_, n_)
        lines.append(f"| {lang} | {cnt} | {lp:.2f} | {lr:.2f} | {lf:.2f} |")
    lines += ["", "## Duplicate pairs", ""]
    lines += ["| A | B | Labelled duplicate | Score | Suggested |", "|---|---|---|---|---|"]
    for a, b, gold, score, pred in pair_rows:
        lines.append(f"| {a} | {b} | {'yes' if gold else 'no'} | {score:.2f} | {'yes' if pred else 'no'} |")
    lines += [
        "",
        "## Limitations",
        "",
        "- Small synthetic set written by the team; real reports will be messier.",
        "- Per-language figures rest on very few reports and are indicative only.",
        "- With `LLM_BACKEND=fake`, results measure the offline keyword fallback, not Gemma. Its keyword lists were "
        "written alongside these samples, so its scores here are optimistic.",
        "- Duplicate gates and the 0.6 threshold were tuned on these same 16 pairs; expect lower scores on new data.",
        "- Duplicate scoring uses labelled target points as locations, i.e. it assumes locations were confirmed.",
    ]
    out = "\n".join(lines) + "\n"
    (ROOT / "eval" / "results.md").write_text(out, encoding="utf-8")
    print(out)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--geocode", action="store_true", help="also test map search (network)")
    asyncio.run(main(parser.parse_args().geocode))
