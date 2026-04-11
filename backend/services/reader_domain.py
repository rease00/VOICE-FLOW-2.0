from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import quote

READER_TEXT_WINDOW_CHARS = 1500
READER_TEXT_PREFETCH_THRESHOLD_CHARS = 1000
READER_PANEL_BATCH_SIZE = 10
READER_PANEL_PREFETCH_TRIGGER_INDEX = 5
READER_SESSION_CACHE_CHAR_LIMIT = 50_000
READER_SESSION_DELETE_WARNING_MS = 180_000
READER_BILLING_VF_PER_CHAR = 0.5

READER_REGION_DEFS: tuple[dict[str, Any], ...] = (
    {"id": "english", "label": "English", "languageCodes": ("en", "eng"), "locale": "en"},
    {"id": "hindi", "label": "Hindi", "languageCodes": ("hi", "hin"), "locale": "hi"},
    {"id": "japanese", "label": "Japanese", "languageCodes": ("ja", "jpn"), "locale": "ja"},
    {"id": "chinese", "label": "Chinese", "languageCodes": ("zh", "zho", "chi"), "locale": "zh"},
    {"id": "korean", "label": "Korean", "languageCodes": ("ko", "kor"), "locale": "ko"},
    {"id": "spanish", "label": "Spanish", "languageCodes": ("es", "spa"), "locale": "es"},
    {"id": "french", "label": "French", "languageCodes": ("fr", "fra", "fre"), "locale": "fr"},
    {"id": "german", "label": "German", "languageCodes": ("de", "deu", "ger"), "locale": "de"},
    {"id": "portuguese", "label": "Portuguese", "languageCodes": ("pt", "por"), "locale": "pt"},
    {"id": "arabic", "label": "Arabic", "languageCodes": ("ar", "ara"), "locale": "ar"},
)

READER_FALLBACK_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "id": "seed_english_moonstone",
        "title": "The Moonstone",
        "author": "Wilkie Collins",
        "regionId": "english",
        "contentKind": "book",
        "provider": "project_gutenberg",
        "license": "Public domain",
        "sourceUrl": "https://www.gutenberg.org/ebooks/155",
        "summary": "A public-domain mystery sample seeded for instant Reader playback.",
        "sampleText": (
            "The first piece of family history on record is a chronicle of the capture of the famous Yellow Diamond. "
            "It was set in the forehead of the Indian idol, and guarded as a sacred inheritance by three Brahmins. "
            "When war and greed reached the shrine, the gem began a second life of pursuit, inheritance, secrecy, and unease. "
            "This V Flow AI seed includes a short public-domain sample so the Reader can start without waiting for a full-source fetch."
        ),
    },
    {
        "id": "seed_hindi_panchatantra",
        "title": "Panchatantra Sampler",
        "author": "Public Domain Retelling",
        "regionId": "hindi",
        "contentKind": "book",
        "provider": "voiceflow_seed",
        "license": "Public domain-inspired sampler",
        "sourceUrl": "https://en.wikisource.org/wiki/The_Panchatantra",
        "summary": "Hindi-region seed text for the Reader shelf.",
        "sampleText": (
            "Ek samay ek buddhiman raja ne apne rajkumaron ko kahaniyon ke madhyam se neeti aur vivek sikhane ka nishchay kiya. "
            "Har kahani mein jaanvar bolte the, lekin sandesh manav jeevan ke liye tha. "
            "Dosti, chaturai, laalach aur samay par li gayi salah hi in kahaniyon ka kendra thi. "
            "Yeh sankshipt namuna Reader launch ke liye diya gaya hai."
        ),
    },
    {
        "id": "seed_japanese_bocchan",
        "title": "Botchan Sampler",
        "author": "Natsume Soseki",
        "regionId": "japanese",
        "contentKind": "book",
        "provider": "voiceflow_seed",
        "license": "Public domain sampler",
        "sourceUrl": "https://ja.wikisource.org/",
        "summary": "Japanese-region seed text for Reader playback.",
        "sampleText": (
            "Botchan wa massugu de, sukoshi tanjun de, soshite sugu ni okoru. "
            "Toshi kara chikai chihou no gakkou ni kite miru to, ninjou to keisan ga mazakiau sekai ga matte ita. "
            "Demo kare wa, jibun no seijitsu-sa o sutezu ni sono basho to mukiau."
        ),
    },
    {
        "id": "seed_chinese_journey",
        "title": "Journey West Sampler",
        "author": "Wu Cheng'en",
        "regionId": "chinese",
        "contentKind": "book",
        "provider": "voiceflow_seed",
        "license": "Public domain sampler",
        "sourceUrl": "https://zh.wikisource.org/",
        "summary": "Chinese-region seed text for Reader playback.",
        "sampleText": (
            "Sun Wukong chu shi shi, tian di dou xiang zai kan yi chang nao ju. "
            "Ta cong hua guo shan zou lai, dai zhe hao qi, ao qi, he yong qi. "
            "Dang qu jing de lu kai shi hou, mei yi bu dou shi kao yan, ye dou shi cheng zhang."
        ),
    },
    {
        "id": "seed_korean_heungbu",
        "title": "Heungbu and Nolbu Sampler",
        "author": "Korean Folk Tale",
        "regionId": "korean",
        "contentKind": "book",
        "provider": "voiceflow_seed",
        "license": "Public domain folk sampler",
        "sourceUrl": "https://ko.wikisource.org/",
        "summary": "Korean-region seed text for Reader playback.",
        "sampleText": (
            "Heungbu-neun gajog-eul saeng-gaghaneun maeumeuro salassgo, Nolbu-neun gajang meonjeo jagi sonhae-man gyesanhaessda. "
            "Han madi-ui seontaeg-i geu deul-ui unmyeong-eul geoui jeonbu gajigo nawassda. "
            "Iyagineun seon-ui jageun haengdong-i eotteon gyeolgwa-reul mandeuneunji boyeojunda."
        ),
    },
    {
        "id": "seed_spanish_platero",
        "title": "Platero y Yo Sampler",
        "author": "Juan Ramon Jimenez",
        "regionId": "spanish",
        "contentKind": "book",
        "provider": "voiceflow_seed",
        "license": "Public domain sampler",
        "sourceUrl": "https://es.wikisource.org/",
        "summary": "Spanish-region seed text for Reader playback.",
        "sampleText": (
            "Platero es pequeno, peludo y suave; tan blando por fuera, que se diria todo de algodon. "
            "El pueblo lo mira pasar como si llevara un poco de infancia sobre el lomo. "
            "En esta muestra, la voz del narrador busca ternura, memoria y un ritmo sereno."
        ),
    },
    {
        "id": "seed_french_little_prince",
        "title": "Le Petit Prince Sampler",
        "author": "French Public Domain Shelf Sampler",
        "regionId": "french",
        "contentKind": "book",
        "provider": "voiceflow_seed",
        "license": "Open shelf sampler",
        "sourceUrl": "https://fr.wikisource.org/",
        "summary": "French-region seed text for Reader playback.",
        "sampleText": (
            "Dans les histoires les plus simples, une voix douce suffit pour faire apparaitre un desert, une etoile, ou un souvenir. "
            "Le lecteur avance page apres page, comme s'il entendait une confidence. "
            "Cette etagere de lancement utilise un court texte de demonstration pour montrer le flux Reader."
        ),
    },
    {
        "id": "seed_german_faust",
        "title": "Faust Sampler",
        "author": "Johann Wolfgang von Goethe",
        "regionId": "german",
        "contentKind": "book",
        "provider": "voiceflow_seed",
        "license": "Public domain sampler",
        "sourceUrl": "https://de.wikisource.org/",
        "summary": "German-region seed text for Reader playback.",
        "sampleText": (
            "Zwei Stimmen stehen sich gegenuber: der Hunger nach Erkenntnis und die Warnung vor dem Preis. "
            "Schon in wenigen Zeilen entsteht der Eindruck einer grossen, drangenden Bewegung. "
            "Diese kurze Probe zeigt, wie Reader ernste und dialoglastige Texte mit Cast-Zuweisung abbildet."
        ),
    },
    {
        "id": "seed_portuguese_dom_casmurro",
        "title": "Dom Casmurro Sampler",
        "author": "Machado de Assis",
        "regionId": "portuguese",
        "contentKind": "book",
        "provider": "voiceflow_seed",
        "license": "Public domain sampler",
        "sourceUrl": "https://pt.wikisource.org/",
        "summary": "Portuguese-region seed text for Reader playback.",
        "sampleText": (
            "A memoria nao volta em linha reta; ela faz curvas, insiste em detalhes, e muda de tom quando encontra saudade. "
            "Quem narra acredita ter controle do passado, mas a propria voz revela suas falhas. "
            "Aqui, a leitura procura intimidade e suspeita ao mesmo tempo."
        ),
    },
    {
        "id": "seed_arabic_maqamat",
        "title": "Maqamat Sampler",
        "author": "Classical Arabic Shelf Sampler",
        "regionId": "arabic",
        "contentKind": "book",
        "provider": "voiceflow_seed",
        "license": "Open shelf sampler",
        "sourceUrl": "https://ar.wikisource.org/",
        "summary": "Arabic-region seed text for Reader playback.",
        "sampleText": (
            "Fi al-hikaya al-qadima, al-sawt la yaqra faqat, bal yusawwir al-majlis wa yuharrik al-wajdan. "
            "Yabda al-rawi bi jumla sakinatan thumma yartafi al-iqa' ma'a al-mufaja'a aw al-hikma. "
            "Hatha nass qasir lil-ibhar bi tajribat Reader."
        ),
    },
)


def reader_regions() -> list[dict[str, Any]]:
    return [dict(item) for item in READER_REGION_DEFS]


def reader_region(region_id: str) -> dict[str, Any]:
    safe_id = str(region_id or "").strip().lower()
    for item in READER_REGION_DEFS:
        if str(item.get("id") or "").strip().lower() == safe_id:
            return dict(item)
    return dict(READER_REGION_DEFS[0])


def normalize_reader_surface(raw_value: object) -> str:
    token = str(raw_value or "books").strip().lower()
    if token in {"books", "novels", "book"}:
        return "books"
    if token in {"comics", "comic", "manga"}:
        return "comics"
    if token in {"uploads", "my_uploads", "mine"}:
        return "uploads"
    return "books"


def normalize_reader_content_kind(raw_value: object) -> str:
    token = str(raw_value or "book").strip().lower()
    if token in {"comic", "manga", "panel", "image"}:
        return "comic"
    return "book"


def normalize_reader_direction(raw_value: object, *, content_kind: str = "book") -> str:
    token = str(raw_value or "").strip().lower().replace("_", "-")
    if token in {"rtl-horizontal", "right-to-left-horizontal", "manga", "rtl-paged"}:
        return "rtl-horizontal"
    if token in {"vertical", "scroll", "vertical-scroll", "vertical-strip"}:
        return "vertical-scroll"
    if token in {"ltr-horizontal", "left-to-right-horizontal", "ltr-paged"}:
        return "ltr-horizontal"
    return "vertical-scroll" if normalize_reader_content_kind(content_kind) == "comic" else "vertical-scroll"


def collapse_whitespace(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _reader_window_overflow_char_cap(limit: int) -> int:
    return max(limit, int(round(limit * 1.2)), limit + 160)


def build_text_windows(
    raw_text: str,
    *,
    window_chars: int = READER_TEXT_WINDOW_CHARS,
) -> list[dict[str, Any]]:
    text = str(raw_text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []
    safe_window_chars = max(240, int(window_chars or READER_TEXT_WINDOW_CHARS))
    paragraphs = [segment.strip() for segment in re.split(r"\n{2,}", text) if segment.strip()]
    windows: list[dict[str, Any]] = []
    current = ""
    start = 0

    def flush() -> None:
        nonlocal current, start
        safe_text = current.strip()
        if not safe_text:
            return
        end = start + len(safe_text)
        windows.append(
            {
                "index": len(windows),
                "startChar": start,
                "endChar": end,
                "charCount": len(safe_text),
                "text": safe_text,
            }
        )
        start = end
        current = ""

    for paragraph in paragraphs:
        if len(paragraph) > safe_window_chars:
            sentence_units = [
                collapse_whitespace(item)
                for item in re.split(r"(?<=[.!?\u0964\u0965])\s+", paragraph)
                if collapse_whitespace(item)
            ]
            if not sentence_units:
                sentence_units = [paragraph]
        else:
            sentence_units = [paragraph]
        for unit in sentence_units:
            candidate = unit if not current else f"{current}\n\n{unit}"
            if len(candidate) <= safe_window_chars:
                current = candidate
                continue
            if current:
                flush()
            if len(unit) <= safe_window_chars:
                current = unit
                continue
            if len(unit) <= _reader_window_overflow_char_cap(safe_window_chars):
                current = unit
                continue
            words = [item for item in unit.split() if item]
            temp = ""
            for word in words:
                next_value = word if not temp else f"{temp} {word}"
                if len(next_value) <= safe_window_chars:
                    temp = next_value
                    continue
                current = temp
                flush()
                temp = word
            current = temp
    flush()
    return windows


def should_schedule_next_text_window(
    *,
    consumed_chars: int,
    scheduled_window_end_char: int,
    threshold_chars: int = READER_TEXT_PREFETCH_THRESHOLD_CHARS,
) -> bool:
    safe_consumed = max(0, int(consumed_chars or 0))
    safe_window_end = max(0, int(scheduled_window_end_char or 0))
    safe_threshold = max(0, int(threshold_chars or READER_TEXT_PREFETCH_THRESHOLD_CHARS))
    if safe_window_end <= 0:
        return False
    return safe_consumed >= max(0, safe_window_end - safe_threshold)


def should_schedule_next_panel_batch(
    *,
    current_panel_index: int,
    scheduled_panel_count: int,
    trigger_index: int = READER_PANEL_PREFETCH_TRIGGER_INDEX,
    batch_size: int = READER_PANEL_BATCH_SIZE,
) -> bool:
    safe_panel_index = max(0, int(current_panel_index or 0))
    safe_scheduled_count = max(0, int(scheduled_panel_count or 0))
    safe_batch_size = max(1, int(batch_size or READER_PANEL_BATCH_SIZE))
    safe_trigger = max(0, min(safe_batch_size - 1, int(trigger_index or READER_PANEL_PREFETCH_TRIGGER_INDEX)))
    if safe_scheduled_count <= 0:
        return False
    current_batch_start = (safe_panel_index // safe_batch_size) * safe_batch_size
    threshold_index = current_batch_start + safe_trigger
    return safe_panel_index >= threshold_index and safe_scheduled_count <= current_batch_start + safe_batch_size


def guess_panel_emotion(text: str) -> str:
    lowered = str(text or "").strip().lower()
    if not lowered:
        return "Neutral"
    if any(marker in lowered for marker in ("!", "run", "attack", "fight", "rage", "angry", "furious")):
        return "Intense"
    if any(marker in lowered for marker in ("?", "wonder", "huh", "who", "why")):
        return "Curious"
    if any(marker in lowered for marker in ("cry", "tears", "sob", "goodbye", "lost")):
        return "Sad"
    if any(marker in lowered for marker in ("laugh", "smile", "joy", "happy", "great")):
        return "Happy"
    if any(marker in lowered for marker in ("dark", "fear", "scared", "shadow", "whisper")):
        return "Suspense"
    return "Neutral"


def guess_panel_sfx(text: str) -> list[str]:
    lowered = str(text or "").strip().lower()
    out: list[str] = []
    if any(marker in lowered for marker in ("whoosh", "swipe", "dash")):
        out.append("whoosh")
    if any(marker in lowered for marker in ("bang", "boom", "blast", "crash")):
        out.append("impact")
    if any(marker in lowered for marker in ("rain", "storm")):
        out.append("rain")
    return out


def build_panel_manifest(
    page_rows: list[dict[str, Any]],
    *,
    title: str,
    direction: str,
) -> list[dict[str, Any]]:
    safe_direction = normalize_reader_direction(direction, content_kind="comic")
    panels: list[dict[str, Any]] = []
    for index, row in enumerate(page_rows):
        text = collapse_whitespace(row.get("text") or "")
        if not text:
            text = f"{title} panel {index + 1}"
        panel_id = f"panel_{index + 1:04d}"
        panels.append(
            {
                "panelId": panel_id,
                "pageId": f"page_{index + 1:04d}",
                "index": index,
                "direction": safe_direction,
                "text": text,
                "speaker": str(row.get("speaker") or "Narrator"),
                "emotion": str(row.get("emotion") or guess_panel_emotion(text)),
                "sfx": list(row.get("sfx") or guess_panel_sfx(text)),
                "imagePath": str(row.get("imagePath") or ""),
            }
        )
    return panels


def _extract_nested_language_code(value: object) -> str:
    if isinstance(value, dict):
        for key in ("key", "code", "id", "name"):
            code = normalize_catalog_language(value.get(key))
            if code:
                return code
    if isinstance(value, list):
        for item in value:
            code = _extract_nested_language_code(item)
            if code:
                return code
    token = str(value or "").strip().lower()
    if "/languages/" in token:
        token = token.rsplit("/languages/", 1)[-1]
    token = token.replace("_", "-")
    if len(token) >= 2:
        return token[:2]
    return ""


def normalize_catalog_language(raw_value: object) -> str:
    return _extract_nested_language_code(raw_value)


def language_matches_region(language: object, region_id: str) -> bool:
    normalized = normalize_catalog_language(language)
    if not normalized:
        return False
    region = reader_region(region_id)
    codes = {normalize_catalog_language(item) for item in region.get("languageCodes") or ()}
    codes.add(normalize_catalog_language(region.get("locale")))
    return normalized in codes


def is_open_license_string(value: object) -> bool:
    token = collapse_whitespace(value).lower()
    if not token:
        return False
    return any(
        marker in token
        for marker in (
            "public domain",
            "cc by",
            "creative commons",
            "open access",
            "open license",
            "gutenberg",
            "wikisource",
        )
    )


def normalize_reader_catalog_item(raw_item: dict[str, Any]) -> dict[str, Any]:
    region = reader_region(str(raw_item.get("regionId") or "english"))
    content_kind = normalize_reader_content_kind(raw_item.get("contentKind"))
    summary = collapse_whitespace(raw_item.get("summary") or raw_item.get("excerpt") or "")
    sample_text = str(raw_item.get("sampleText") or "").strip()
    supports_read_here = bool(raw_item.get("supportsReadHere")) or bool(sample_text or raw_item.get("contentUrl") or raw_item.get("archiveTxtUrl"))
    return {
        "id": str(raw_item.get("id") or "").strip(),
        "title": str(raw_item.get("title") or "Untitled").strip() or "Untitled",
        "author": str(raw_item.get("author") or "Unknown").strip() or "Unknown",
        "regionId": str(region.get("id") or "english"),
        "regionLabel": str(region.get("label") or "English"),
        "contentKind": content_kind,
        "surface": normalize_reader_surface(raw_item.get("surface") or ("comics" if content_kind == "comic" else "books")),
        "provider": str(raw_item.get("provider") or "catalog").strip() or "catalog",
        "license": str(raw_item.get("license") or "").strip(),
        "sourceUrl": str(raw_item.get("sourceUrl") or "").strip(),
        "summary": summary,
        "excerpt": summary,
        "sampleText": sample_text,
        "contentUrl": str(raw_item.get("contentUrl") or "").strip(),
        "archiveTxtUrl": str(raw_item.get("archiveTxtUrl") or "").strip(),
        "coverUrl": str(raw_item.get("coverUrl") or "").strip(),
        "supportsReadHere": supports_read_here,
        "sourceMeta": dict(raw_item.get("sourceMeta") or {}),
        "createdAt": str(raw_item.get("createdAt") or "").strip(),
        "updatedAt": str(raw_item.get("updatedAt") or "").strip(),
        "direction": str(raw_item.get("direction") or "").strip(),
        "readingModeDefault": str(raw_item.get("readingModeDefault") or "").strip(),
        "collectionLabel": str(raw_item.get("collectionLabel") or "").strip(),
        "stats": dict(raw_item.get("stats") or {}),
    }


def normalize_openlibrary_item(item: dict[str, Any], *, region_id: str) -> Optional[dict[str, Any]]:
    language = normalize_catalog_language(item.get("language"))
    if language and not language_matches_region(language, region_id):
        return None
    work_key = str(item.get("key") or "").strip()
    edition_key = ""
    edition_keys = item.get("edition_key")
    if isinstance(edition_keys, list) and edition_keys:
        edition_key = str(edition_keys[0] or "").strip()
    identifier = work_key.rsplit("/", 1)[-1] or edition_key or str(item.get("cover_edition_key") or "").strip()
    if not identifier:
        return None
    title = str(item.get("title") or item.get("title_suggest") or "").strip() or "Untitled"
    authors = item.get("author_name") if isinstance(item.get("author_name"), list) else []
    author = ", ".join([str(name).strip() for name in authors if str(name).strip()][:2]) or "Open Library"
    cover_id = str(item.get("cover_i") or "").strip()
    ia_ids = item.get("ia") if isinstance(item.get("ia"), list) else []
    archive_id = str(ia_ids[0] or "").strip() if ia_ids else ""
    return normalize_reader_catalog_item(
        {
            "id": f"openlibrary_{identifier}",
            "title": title,
            "author": author,
            "regionId": region_id,
            "contentKind": "book",
            "provider": "openlibrary",
            "license": "Open Library public scan",
            "sourceUrl": f"https://openlibrary.org{work_key}" if work_key else f"https://openlibrary.org/books/{quote(identifier)}",
            "summary": collapse_whitespace(item.get("first_sentence") or item.get("subtitle") or ""),
            "contentUrl": f"https://openlibrary.org{work_key}" if work_key else "",
            "archiveTxtUrl": f"https://archive.org/download/{quote(archive_id)}/{quote(archive_id)}_djvu.txt" if archive_id else "",
            "coverUrl": f"https://covers.openlibrary.org/b/id/{quote(cover_id)}-L.jpg" if cover_id else "",
            "supportsReadHere": bool(archive_id),
            "sourceMeta": {
                "workKey": work_key,
                "editionKey": edition_key,
                "language": language,
            },
        }
    )


def normalize_internet_archive_item(item: dict[str, Any], *, region_id: str) -> Optional[dict[str, Any]]:
    identifier = str(item.get("identifier") or "").strip()
    if not identifier:
        return None
    language = normalize_catalog_language(item.get("language"))
    if language and not language_matches_region(language, region_id):
        return None
    mediatype = str(item.get("mediatype") or "texts").strip().lower()
    content_kind = "comic" if mediatype == "image" else "book"
    license_value = str(item.get("licenseurl") or item.get("rights") or "Internet Archive listing").strip()
    return normalize_reader_catalog_item(
        {
            "id": f"internet_archive_{identifier}",
            "title": str(item.get("title") or identifier).strip() or identifier,
            "author": collapse_whitespace(item.get("creator") or "Internet Archive") or "Internet Archive",
            "regionId": region_id,
            "contentKind": content_kind,
            "provider": "internet_archive",
            "license": license_value,
            "sourceUrl": f"https://archive.org/details/{quote(identifier)}",
            "contentUrl": f"https://archive.org/details/{quote(identifier)}",
            "archiveTxtUrl": str(item.get("archiveTxtUrl") or f"https://archive.org/download/{quote(identifier)}/{quote(identifier)}_djvu.txt").strip(),
            "summary": collapse_whitespace(item.get("description") or ""),
            "supportsReadHere": content_kind == "book",
            "sourceMeta": {
                "identifier": identifier,
                "language": language,
                "mediatype": mediatype,
                "openLicense": is_open_license_string(license_value),
            },
        }
    )


def normalize_mediawiki_item(item: dict[str, Any], *, region_id: str, source_url: str) -> Optional[dict[str, Any]]:
    page_id = str(item.get("pageid") or item.get("id") or "").strip()
    title = str(item.get("title") or "").strip()
    if not page_id and not title:
        return None
    identifier = page_id or quote(title.replace(" ", "_"))
    return normalize_reader_catalog_item(
        {
            "id": f"mediawiki_{identifier}",
            "title": title or "Untitled",
            "author": "Wikisource",
            "regionId": region_id,
            "contentKind": "book",
            "provider": "mediawiki",
            "license": "Wikisource open text",
            "sourceUrl": str(item.get("fullurl") or item.get("canonicalurl") or f"{source_url.rstrip('/')}/wiki/{quote(title.replace(' ', '_'))}").strip(),
            "contentUrl": str(item.get("fullurl") or item.get("canonicalurl") or "").strip(),
            "summary": collapse_whitespace(item.get("extract") or ""),
            "supportsReadHere": True,
            "sourceMeta": {
                "pageId": page_id,
            },
        }
    )


def fallback_catalog_items(region_id: Optional[str] = None, *, content_kind: str = "book") -> list[dict[str, Any]]:
    safe_region = str(region_id or "").strip().lower()
    safe_content_kind = normalize_reader_content_kind(content_kind)
    out: list[dict[str, Any]] = []
    for item in READER_FALLBACK_CATALOG:
        if safe_region and str(item.get("regionId") or "").strip().lower() != safe_region:
            continue
        if normalize_reader_content_kind(item.get("contentKind")) != safe_content_kind:
            continue
        out.append(normalize_reader_catalog_item(dict(item)))
    return out