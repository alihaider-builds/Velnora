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
    "Chitral", "Kalam", "Bahrain", "Madyan", "Gujranwala", "Jhang", "Chiniot", "Rawalpindi", "Islamabad",
    "Lalkurti", "Lal Kurti", "Saddar", "Murree", "Attock", "Jhelum", "Chakwal", "Mardan", "Swabi", "Abbottabad",
    "Mansehra", "Kohat", "Bannu", "Faisalabad", "Sargodha", "Bahawalpur", "Sahiwal", "Okara", "Gujrat", "Mirpur",
    "Muzaffarabad", "Skardu", "Sibi", "Turbat", "Gwadar", "Thatta", "Badin", "Mirpurkhas", "Nawabshah",
    "Khairpur", "Shikarpur", "Ghotki", "Kashmore", "Taunsa", "Layyah", "Bhakkar", "Mianwali",
    "پیر بابا", "بونیر", "سوات", "مینگورہ", "شانگلہ", "نوشہرہ", "چارسدہ", "پشاور", "سکھر", "دادو", "ملتان",
    "لاہور", "کراچی", "حیدرآباد", "راولپنڈی", "اسلام آباد", "لال کرتی",
]

# Words that can be part of a place phrase ("Lalkurti Cantt", "Sector G-9", "Saddar bazaar")
AREA_WORDS = {
    "cantt", "cantonment", "town", "colony", "bazaar", "bazar", "road", "chowk", "sector", "mohalla", "mohalle",
    "block", "phase", "scheme", "village", "city", "district", "tehsil", "chhaoni",
    "کینٹ", "محلہ", "محلے", "بازار", "روڈ", "چوک", "سیکٹر",
}
# Words that end a place phrase when reading backwards from "mein" / "ke paas"
PLACE_STOPWORDS = {
    "hum", "ham", "hamara", "hamare", "hamari", "mera", "meri", "mere", "yahan", "idhar", "wahan", "udhar",
    "ghar", "gher", "gali", "gaon", "gaoon", "goth", "ilaqa", "ilaqe", "ilaake", "sab", "log", "pani", "paani",
    "aur", "ka", "ki", "ke", "ab", "abhi", "bhi", "to", "toh", "please", "plz", "help", "madad", "hai", "hain",
    "tha", "the", "se", "ko", "is", "us", "iss", "uss", "aaj", "kal", "raat", "subah", "bohat", "bahut",
    "flood", "sailab", "barish", "we", "our", "i", "my", "are", "a", "an", "of",
    # greetings that open many SMS ("Assalam o alaikum, ...")
    "assalam", "asalam", "assalamu", "salam", "salaam", "alaikum", "alaykum", "alekum", "walaikum", "aoa", "o",
    "hello", "hi", "sir", "janab", "bhai", "السلام", "علیکم",
    "ہم", "ہمارے", "ہمارا", "ہماری", "میرے", "میرا", "یہاں", "گاؤں", "گھر", "گلی", "سب", "لوگ", "اور", "کے", "کا", "کی",
}
_LOCATIVE_AFTER = {"mein", "me", "main", "mai", "men", "wale", "walay", "wali", "میں", "والے"}
_LOCATIVE_PAIR = {"paas", "pas", "qareeb", "qarib", "kareeb", "nazdeek", "nazdik", "پاس", "قریب", "نزدیک"}
_LOCATIVE_BEFORE = {"in", "near", "at", "around"}
_TOKEN = re.compile(r"\S+")
_EDGE_PUNCT = ".,;:!?()\"'\u060c\u06d4-"
_SENTENCE_END = ".!?;:\u060c\u06d4"
_ABBREV = re.compile(r"(?:[A-Za-z]\.)+")

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


def _bare(token: str) -> str:
    return token.strip(_EDGE_PUNCT).lower()


def _span(tokens: list[tuple[str, int, int]], i: int, j: int, text: str) -> tuple[int, int] | None:
    """Character span covering tokens[i..j], without edge punctuation."""
    if i > j:
        return None
    start, end = tokens[i][1], tokens[j][2]
    while start < end and text[start] in _EDGE_PUNCT:
        start += 1
    while end > start and text[end - 1] in _EDGE_PUNCT:
        end -= 1
    return (start, end) if end > start else None


def _gazetteer_hits(text: str) -> list[tuple[int, int]]:
    hits: list[tuple[int, int]] = []
    for _, pat in _PLACE_PATTERNS:
        for m in pat.finditer(text):
            if not any(a <= m.start() < b for a, b in hits):
                hits.append((m.start(), m.end()))
    return sorted(hits)


def _phrase_candidates(text: str) -> list[tuple[int, int]]:
    """Place phrases read around locatives: '<X> mein', '<X> ke paas', 'near <X>', '<X> میں'."""
    tokens = [(m.group(0), m.start(), m.end()) for m in _TOKEN.finditer(text)]
    out: list[tuple[int, int]] = []
    for k, (tok, _, _) in enumerate(tokens):
        word = _bare(tok)
        nxt = _bare(tokens[k + 1][0]) if k + 1 < len(tokens) else ""
        if word in _LOCATIVE_AFTER or (word in ("ke", "کے") and nxt in _LOCATIVE_PAIR):
            end_idx = k - 1
            i = end_idx
            while i >= 0 and end_idx - i < 5:
                w = _bare(tokens[i][0])
                if not w or w in PLACE_STOPWORDS or w.isdigit():
                    break
                if i < end_idx and tokens[i][0][-1:] in _SENTENCE_END and not _ABBREV.fullmatch(tokens[i][0]):
                    break  # previous sentence or clause (but not an abbreviation like "D.I.")
                i -= 1
            span = _span(tokens, i + 1, end_idx, text)
            if span:
                out.append(span)
        elif word in _LOCATIVE_BEFORE:
            j = k + 1
            while j < len(tokens) and j - k <= 5:
                raw = tokens[j][0].strip(_EDGE_PUNCT)
                w = raw.lower()
                if not raw or not (raw[0].isupper() or w in AREA_WORDS or re.fullmatch(r"[a-z]-?\d+", w)):
                    break
                j += 1
                if tokens[j - 1][0][-1:] in _SENTENCE_END:
                    break
            span = _span(tokens, k + 1, j - 1, text)
            if span:
                out.append(span)
    # a phrase made only of area words ("mohalle") is not a place
    return [sp for sp in out if any(_bare(t) not in AREA_WORDS for t in text[sp[0]:sp[1]].split())]


def extract_place(text: str) -> dict | None:
    """Prefer a locative phrase that contains a known place, then any capitalised locative phrase,
    then a known place extended with neighbouring area words, then any locative phrase."""
    hits = _gazetteer_hits(text)
    phrases = _phrase_candidates(text)

    def has_hit(sp: tuple[int, int]) -> bool:
        return any(sp[0] <= a and b <= sp[1] for a, b in hits)

    chosen = next((sp for sp in phrases if has_hit(sp)), None)
    if chosen is None:
        chosen = next((sp for sp in phrases if any(c.isupper() for c in text[sp[0]:sp[1]])), None)
    if chosen is None and hits:
        a, b = hits[0]
        while m := re.match(r"[\s,]+(\S+)", text[b:]):
            word = m.group(1)
            if _bare(word) in AREA_WORDS or any(h[0] == b + m.start(1) for h in hits):
                b = b + m.start(1) + len(word.rstrip(_EDGE_PUNCT))
            else:
                break
        chosen = (a, b)
    if chosen is None and phrases:
        chosen = phrases[0]
    if chosen is None:
        return None
    phrase = text[chosen[0]:chosen[1]]
    display = phrase.title() if phrase.isascii() and phrase == phrase.lower() else phrase
    return {"text": display, "evidence": {"phrase": phrase}}


def heuristic_extract(text: str, categories: list[dict] | None = None) -> dict:
    allowed = {c["key"] for c in categories} if categories is not None else None
    patterns: dict[str, list[re.Pattern]] = {
        k: list(v) for k, v in _NEED_PATTERNS.items() if allowed is None or k in allowed
    }
    for c in categories or []:
        extra = [_term_pattern(w) for w in sorted(c.get("keywords") or [], key=len, reverse=True)]
        if extra:
            patterns[c["key"]] = patterns.get(c["key"], []) + extra
    found: list[tuple[int, str, str]] = []
    for cat, pats in patterns.items():
        best = None
        for pat in pats:
            m = pat.search(text)
            if m and (best is None or m.start() < best.start()):
                best = m
        if best:
            found.append((best.start(), cat, best.group(0)))
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

    place = extract_place(text)

    t = _TIME.search(text)
    time_ref = {"text": t.group(0), "evidence": {"phrase": t.group(0)}} if t else None

    uncertainties = []
    if place is None:
        uncertainties.append("No place name found in the report.")
    if not needs:
        uncertainties.append("No specific need found in the report.")
    if re.search(r"ignore (all |any )?(previous|prior) instructions", text, re.IGNORECASE):
        uncertainties.append("Report contains instructions aimed at the system; they were ignored.")

    return {
        "language": detect_language(text),
        "needs": needs[:10],
        "quantities": quantities[:10],
        "place_name": place,
        "time_reference": time_ref,
        "uncertainties": uncertainties[:5],
    }


class FakeLLMClient:
    name = "fake-heuristic"

    async def extract(self, text: str, place_hint: str | None, categories: list[dict],
                      retry_feedback: str | None = None) -> str:
        return json.dumps(heuristic_extract(text, categories), ensure_ascii=False)

    async def is_available(self) -> bool:
        return True
