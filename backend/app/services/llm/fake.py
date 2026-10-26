"""Offline stand-in for Gemma: keyword rules that return the same JSON shape.

Used in tests, CI and when no model is available (`LLM_BACKEND=fake`). The UI labels
its output as pre-generated. It is deliberately simple; it is not the product's AI.
"""

import json
import re

_LATIN_BOUND_L = r"(?<![A-Za-z])"
_LATIN_BOUND_R = r"(?![A-Za-z])"

NEED_TERMS: dict[str, list[str]] = {
    "evacuation": [
        "phanse hue", "phansay", "phanse", "phansey", "chhaton par", "chhat par", "chhaton pe", "nikalna", "nikalo",
        "nikaal", "rescue", "boat", "kashti", "stuck", "trapped", "evacuate", "evacuation",
        "پھنسے", "نکالیں", "کشتی", "ریسکیو", "چھتوں پر",
    ],
    "medicine": [
        "dawai", "dawaai", "dawa", "dwai", "medicine", "medicines", "doctor", "ilaj", "zakhmi", "injured",
        "first aid", "bimar", "beemar", "sick", "دوائی", "دوا", "ڈاکٹر", "علاج", "زخمی", "بیمار",
    ],
    "clean_water": [
        "saaf pani", "saf pani", "saaf paani", "peene ka pani", "pine ka pani", "peenay ka pani",
        "drinking water", "clean water", "صاف پانی", "پینے کا پانی",
    ],
    "food": [
        "khana", "khaana", "roti", "ration", "aata", "atta", "food", "bhook", "doodh", "milk",
        "کھانا", "راشن", "روٹی", "آٹا", "بھوک", "دودھ",
    ],
    "shelter": [
        "tent", "tents", "khaima", "shelter", "ghar gir", "ghar toot", "makan gir", "sar chupane",
        "خیمہ", "ٹینٹ", "پناہ", "گھر گر",
    ],
}

PLACES = [
    "Pir Baba", "Dera Ismail Khan", "Dera Ghazi Khan", "Buner", "Swat", "Mingora", "Shangla", "Besham", "Daggar",
    "Nowshera", "Charsadda", "Peshawar", "Sukkur", "Larkana", "Dadu", "Jacobabad", "Hyderabad", "Rajanpur",
    "Muzaffargarh", "Multan", "Lahore", "Kasur", "Narowal", "Sialkot", "Karachi", "Quetta", "Gilgit", "Hunza",
    "Chitral", "Kalam", "Bahrain", "Madyan", "Gujranwala", "Jhang", "Chiniot",
    "پیر بابا", "بونیر", "سوات", "مینگورہ", "شانگلہ", "نوشہرہ", "چارسدہ", "پشاور", "سکھر", "دادو", "ملتان",
    "لاہور", "کراچی", "حیدرآباد",
]

_NUMBER_WORDS = {
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "panch": 5, "paanch": 5, "chay": 6, "chhe": 6,
    "saat": 7, "aath": 8, "nau": 9, "das": 10, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "ایک": 1, "دو": 2, "تین": 3, "چار": 4, "پانچ": 5, "چھ": 6, "سات": 7, "آٹھ": 8, "نو": 9, "دس": 10,
}
_UNITS = {
    "bachay": "children", "bachy": "children", "bache": "children", "bachey": "children", "bachon": "children",
    "children": "children", "kids": "children", "بچے": "children", "بچوں": "children",
    "log": "people", "afrad": "people", "people": "people", "persons": "people", "لوگ": "people", "افراد": "people",
    "khandan": "families", "gharane": "families", "families": "families", "family": "families",
    "خاندان": "families",
    "aurtain": "women", "aurtein": "women", "women": "women", "خواتین": "women",
    "buzurg": "elderly", "elderly": "elderly", "بزرگ": "elderly",
    "ghar": "houses", "houses": "houses", "گھر": "houses",
}
_URDU_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")

_QUANTITY = re.compile(
    r"(?<![\w])(\d+|[۰-۹]+|" + "|".join(sorted(map(re.escape, _NUMBER_WORDS), key=len, reverse=True)) + r")"
    r"\s+(" + "|".join(sorted(map(re.escape, _UNITS), key=len, reverse=True)) + r")(?![\w])",
    re.IGNORECASE,
)
_TIME = re.compile(
    r"(kal raat se|kal raat|kal se|subah se|parson se|\d+\s+din se|do din se|teen din se|\d+\s+ghante se|"
    r"since yesterday|last night|this morning|since \w+ days?|for \d+ days|"
    r"کل رات سے|کل رات|کل سے|صبح سے|دو دن سے|تین دن سے)",
    re.IGNORECASE,
)
_URGENT = re.compile(r"(fori|foran|urgent|jaldi|emergency|khatra|khatre|فوری|جلدی|خطرہ)", re.IGNORECASE)
_ROMAN_MARKERS = {
    "mein", "hai", "hain", "ka", "ki", "ke", "nahi", "chahiye", "pani", "ghar", "aur", "se", "hum", "hamare",
}
_EN_MARKERS = {"the", "and", "is", "are", "need", "needs", "water", "we", "our", "in", "please", "people", "no"}


def _term_pattern(term: str) -> re.Pattern:
    if term.isascii():
        return re.compile(_LATIN_BOUND_L + re.escape(term) + _LATIN_BOUND_R, re.IGNORECASE)
    return re.compile(re.escape(term))


_NEED_PATTERNS = {
    cat: [_term_pattern(t) for t in sorted(terms, key=len, reverse=True)] for cat, terms in NEED_TERMS.items()
}
_PLACE_PATTERNS = [(p, _term_pattern(p)) for p in sorted(PLACES, key=len, reverse=True)]


def detect_language(text: str) -> str:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return "unknown"
    arabic = sum(1 for c in letters if "؀" <= c <= "ۿ" or "ݐ" <= c <= "ݿ")
    if arabic / len(letters) > 0.5:
        return "urdu"
    words = set(re.findall(r"[a-z]+", text.lower()))
    roman = len(words & _ROMAN_MARKERS)
    english = len(words & _EN_MARKERS)
    if roman >= 2 and english >= 2:
        return "mixed"
    if roman >= 2:
        return "roman_urdu"
    if english >= 1:
        return "english"
    return "roman_urdu" if roman else "unknown"


def heuristic_extract(text: str) -> dict:
    found: list[tuple[int, str, str]] = []
    for cat, patterns in _NEED_PATTERNS.items():
        for pat in patterns:
            m = pat.search(text)
            if m:
                found.append((m.start(), cat, m.group(0)))
                break
    found.sort()
    needs = [{"category": cat, "evidence": {"phrase": phrase}} for _, cat, phrase in found]

    quantities = []
    for m in _QUANTITY.finditer(text):
        num, unit = m.group(1), m.group(2)
        value = int(num.translate(_URDU_DIGITS)) if num.translate(_URDU_DIGITS).isdigit() else _NUMBER_WORDS.get(
            num.lower(), _NUMBER_WORDS.get(num, 0)
        )
        label = _UNITS.get(unit.lower(), _UNITS.get(unit, "people"))
        quantities.append({"value": value, "label": label, "evidence": {"phrase": m.group(0)}})

    place = None
    for name, pat in _PLACE_PATTERNS:
        m = pat.search(text)
        if m:
            place = {"text": name, "evidence": {"phrase": m.group(0)}}
            break

    t = _TIME.search(text)
    time_ref = {"text": t.group(0), "evidence": {"phrase": t.group(0)}} if t else None

    cats = {n["category"] for n in needs}
    if "evacuation" in cats or _URGENT.search(text) or ("medicine" in cats and quantities):
        urgency = "high"
    elif cats:
        urgency = "medium"
    else:
        urgency = "low"

    uncertainties = []
    if place is None:
        uncertainties.append("No place name found in the report.")
    if not needs:
        uncertainties.append("No specific need found in the report.")
    if re.search(r"ignore (all |any )?(previous|prior) instructions", text, re.IGNORECASE):
        uncertainties.append("Report contains instructions aimed at the system; they were ignored.")
        urgency = "unknown"

    return {
        "language": detect_language(text),
        "needs": needs[:10],
        "quantities": quantities[:10],
        "place_name": place,
        "time_reference": time_ref,
        "urgency_suggestion": urgency,
        "uncertainties": uncertainties[:5],
    }


class FakeLLMClient:
    name = "fake-heuristic"

    async def extract(self, text: str, place_hint: str | None, retry_feedback: str | None = None) -> str:
        return json.dumps(heuristic_extract(text), ensure_ascii=False)

    async def is_available(self) -> bool:
        return True
