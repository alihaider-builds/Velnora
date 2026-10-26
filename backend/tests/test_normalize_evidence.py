from app.services.evidence import find_evidence
from app.services.normalize import normalize, normalize_for_compare, normalize_with_map

DEMO = "Buner mein pani ghar mein aa gaya, 5 bachay hain, dawai aur saaf pani chahiye."


def test_roman_urdu_variants_collapse():
    assert normalize("PAANI!!") == "pani"
    assert normalize_for_compare("Buner me paani gher mein") == normalize_for_compare("Buner mein pani ghar main")
    assert normalize_for_compare("dawa chahye") == "dawai chahiye"


def test_urdu_diacritics_and_letter_variants():
    assert normalize("پانیٔ") == normalize("پانی")
    assert normalize("كتاب") == normalize("کتاب")  # Arabic kaf -> Urdu kaf
    assert normalize("بَچّے") == normalize("بچے")


def test_index_map_points_back_to_original():
    norm, idx = normalize_with_map("  Saaf,   PAANI ")
    assert norm == "saf pani"
    assert len(idx) == len(norm)
    assert idx[0] == 2


def test_exact_evidence_offsets_match_docs():
    assert find_evidence(DEMO, "Buner") == {"phrase": "Buner", "start": 0, "end": 5, "matched": True}
    assert find_evidence(DEMO, "5 bachay")["start"] == 35
    assert find_evidence(DEMO, "dawai")["start"] == 50
    ev = find_evidence(DEMO, "saaf pani")
    assert (ev["start"], ev["end"]) == (60, 69)


def test_normalized_evidence_maps_to_original_span():
    text = "Hamein SAAF  paani chahiye"
    ev = find_evidence(text, "saaf pani")
    assert ev["matched"]
    assert text[ev["start"]:ev["end"]] == "SAAF  paani"


def test_unmatched_evidence():
    ev = find_evidence(DEMO, "khana")
    assert ev == {"phrase": "khana", "start": None, "end": None, "matched": False}


def test_repeated_phrase_uses_next_unused_occurrence():
    used: set = set()
    first = find_evidence("pani pani", "pani", used)
    second = find_evidence("pani pani", "pani", used)
    assert (first["start"], second["start"]) == (0, 5)


def test_offsets_are_code_points_with_emoji():
    text = "🙏 Swat mein khana chahiye"
    ev = find_evidence(text, "khana")
    assert text[ev["start"]:ev["end"]] == "khana"
    assert ev["start"] == 12  # one code point for the emoji (two UTF-16 units in JavaScript)


def test_urdu_script_evidence():
    text = "ہمارے گاؤں میں پینے کا پانی ختم ہو گیا ہے"
    ev = find_evidence(text, "پینے کا پانی")
    assert ev["matched"] and text[ev["start"]:ev["end"]] == "پینے کا پانی"
