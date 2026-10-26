import asyncio
import json

from app.services.categories import BUILTINS
from app.services.extraction import extract_fields

CATS = [{**c, "keywords": []} for c in BUILTINS]

VALID = {
    "language": "roman_urdu",
    "needs": [{"category": "medicine", "evidence": {"phrase": "dawai"}},
              {"category": "medicine", "evidence": {"phrase": "dawai"}}],
    "quantities": [{"value": 5, "label": "children", "evidence": {"phrase": "5 bachay"}},
                   {"value": 9, "label": "children", "evidence": {"phrase": "5 bachay"}}],
    "place_name": {"text": "Buner", "evidence": {"phrase": "Buner"}},
    "time_reference": None,
    "uncertainties": [],
}
TEXT = "Buner mein 5 bachay hain, dawai chahiye"


class ScriptedLLM:
    name = "scripted"

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    async def extract(self, text, place_hint, categories, retry_feedback=None):
        self.calls.append(retry_feedback)
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    async def is_available(self):
        return True


def run(llm):
    return asyncio.run(extract_fields(TEXT, None, llm, CATS))


def test_valid_output_succeeds_first_time_and_is_grounded():
    res = run(ScriptedLLM(json.dumps(VALID)))
    assert res.status == "succeeded" and res.attempts == 1
    assert [n["category"] for n in res.output["needs"]] == ["medicine"]  # duplicate category dropped
    assert res.output["place_name"]["evidence"]["start"] == 0


def test_quantity_value_must_appear_in_its_evidence():
    res = run(ScriptedLLM(json.dumps(VALID)))
    q5, q9 = res.output["quantities"]
    assert q5["evidence"]["matched"] is True
    assert q9["evidence"]["matched"] is False


def test_invalid_output_retries_once_with_feedback():
    bad = json.dumps({**VALID, "language": "klingon"})
    llm = ScriptedLLM(bad, json.dumps(VALID))
    res = run(llm)
    assert res.status == "succeeded" and res.attempts == 2
    assert llm.calls[0] is None and "language" in llm.calls[1]


def test_two_invalid_outputs_fail():
    res = run(ScriptedLLM("not json", json.dumps({"needs": "wrong"})))
    assert res.status == "failed" and res.attempts == 2
    assert res.error == "Model output did not match the schema."


def test_model_unavailable_fails_cleanly():
    res = run(ScriptedLLM(ConnectionError("down"), ConnectionError("down")))
    assert res.status == "failed"
    assert "Model unavailable" in res.error


def test_unknown_need_category_is_rejected():
    bad = json.dumps({**VALID, "needs": [{"category": "money", "evidence": {"phrase": "dawai"}}]})
    res = run(ScriptedLLM(bad, bad))
    assert res.status == "failed"
