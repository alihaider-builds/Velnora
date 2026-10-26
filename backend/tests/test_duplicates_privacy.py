from datetime import timedelta

from app.services import privacy
from app.services.duplicates import DupView, score_pair
from app.services.normalize import normalize_for_compare
from app.timeutil import utcnow

NOW = utcnow()


def view(id_, text, needs, point=None, hours_ago=0, place=None, sender=None, status="pending_review"):
    return DupView(id=id_, created_at=NOW - timedelta(hours=hours_ago), status=status,
                   text_norm=normalize_for_compare(text), needs=needs, point=point,
                   place_norm=normalize_for_compare(place) if place else None, sender_hash=sender)


def test_spelling_variants_score_as_duplicates(settings):
    a = view("a", "Buner mein pani ghar mein aa gaya, 5 bachay, dawai aur saaf pani chahiye",
             ["medicine", "clean_water"], (34.51, 72.48))
    b = view("b", "Buner me paani gher mein aa gaya hai, 5 bachey, dawa aur saf pani chahye",
             ["medicine", "clean_water"], (34.515, 72.485), hours_ago=2)
    score, reasons = score_pair(a, b, settings)
    assert score >= settings.dup_min_score
    assert "Same needs: clean water, medicine" in reasons
    assert any("km apart" in r for r in reasons)


def test_far_apart_reports_are_never_duplicates(settings):
    a = view("a", "need clean water", ["clean_water"], (34.02, 71.98))
    b = view("b", "need clean water", ["clean_water"], (30.07, 71.19))
    assert score_pair(a, b, settings) is None


def test_no_shared_need_is_never_duplicate(settings):
    a = view("a", "Dadu mein dawai chahiye", ["medicine"], (26.73, 67.78))
    b = view("b", "Dadu mein tent chahiye", ["shelter"], (26.73, 67.78))
    assert score_pair(a, b, settings) is None


def test_outside_time_window(settings):
    a = view("a", "same text here", ["food"])
    b = view("b", "same text here", ["food"], hours_ago=30)
    assert score_pair(a, b, settings) is None


def test_same_sender_bonus_and_place_name_fallback(settings):
    a = view("a", "Dadu bachay bukhar dawai", ["medicine"], place="Dadu", sender="h1")
    b = view("b", "dawai abhi tak nahi aayi", ["medicine"], place="Dadu", sender="h1", hours_ago=1)
    score, reasons = score_pair(a, b, settings)
    assert reasons[0] == "Same sender"
    assert "Same place name" in reasons
    assert score >= settings.dup_min_score


def test_phone_masking_keeps_length():
    text = "Rabta 0300-1234567 ya +92 333 7654321 par karein"
    masked = privacy.mask_phones(text)
    assert len(masked) == len(text)
    assert "1234567" not in masked and "7654321" not in masked
    assert masked.startswith("Rabta 03••-•••••••")


def test_small_numbers_are_not_masked():
    assert privacy.mask_phones("5 bachay aur 12 log") == "5 bachay aur 12 log"


def test_sender_normalization_and_masking():
    assert privacy.normalize_phone("whatsapp:+92 300-1234541") == "+923001234541"
    assert privacy.normalize_phone("03001234541") == "+923001234541"
    assert privacy.normalize_phone("00923001234541") == "+923001234541"
    assert privacy.mask_sender("+923001234541") == "+92 3•• ••• ••41"


def test_sender_hash_matches_across_formats():
    assert privacy.sender_hash("03001234541", "s") == privacy.sender_hash("whatsapp:+923001234541", "s")


def test_area_label_drops_country():
    assert privacy.area_label("Pir Baba, Buner District, Khyber Pakhtunkhwa, Pakistan") == \
        "Pir Baba, Buner District, Khyber Pakhtunkhwa"
    assert privacy.area_label(None) == "Unknown area"
