import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

try:
    import firebase_admin  # type: ignore
    from firebase_admin import auth, credentials, firestore  # type: ignore
except Exception:
    firebase_admin = None  # type: ignore
    auth = None  # type: ignore
    credentials = None  # type: ignore
    firestore = None  # type: ignore


CONFIRM_TOKEN = "WIPE_FIREBASE_NOW"


@dataclass
class WipeStats:
    firestore_docs_scanned: int = 0
    firestore_docs_deleted: int = 0
    firestore_collections_scanned: int = 0
    auth_users_scanned: int = 0
    auth_users_deleted: int = 0


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_firebase() -> tuple[Any, Any]:
    if firebase_admin is None or credentials is None or firestore is None or auth is None:
        raise RuntimeError("firebase-admin dependency is required.")
    sa_json = (os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or "").strip()
    if sa_json:
        payload = json.loads(sa_json)
        cred = credentials.Certificate(payload)
        app = firebase_admin.initialize_app(cred)
    else:
        app = firebase_admin.initialize_app()
    db = firestore.client(app=app)
    return app, db


def _iter_documents(collection_ref: Any) -> Iterable[Any]:
    # Stream handles large collections safely.
    return collection_ref.stream()


def wipe_collection_recursive(collection_ref: Any, *, dry_run: bool, stats: WipeStats) -> None:
    stats.firestore_collections_scanned += 1
    for doc_snapshot in _iter_documents(collection_ref):
        stats.firestore_docs_scanned += 1
        doc_ref = doc_snapshot.reference
        for sub_collection in doc_ref.collections():
            wipe_collection_recursive(sub_collection, dry_run=dry_run, stats=stats)
        if not dry_run:
            doc_ref.delete()
            stats.firestore_docs_deleted += 1


def wipe_firestore(db: Any, *, dry_run: bool, stats: WipeStats) -> None:
    for collection_ref in db.collections():
        wipe_collection_recursive(collection_ref, dry_run=dry_run, stats=stats)


def wipe_auth_users(*, dry_run: bool, stats: WipeStats) -> None:
    if auth is None:
        raise RuntimeError("firebase-admin dependency is required.")
    page = auth.list_users()
    while page is not None:
        for user_record in page.users:
            stats.auth_users_scanned += 1
            if not dry_run:
                auth.delete_user(user_record.uid)
                stats.auth_users_deleted += 1
        page = page.get_next_page()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Dangerous utility: wipe Firestore documents and Firebase Auth users in the active Firebase project."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Execute deletions. Without this flag, command runs in dry-run mode.",
    )
    parser.add_argument(
        "--confirm",
        default="",
        help=f"Required when --apply is set. Must equal: {CONFIRM_TOKEN}",
    )
    parser.add_argument(
        "--skip-firestore",
        action="store_true",
        help="Skip Firestore deletion phase.",
    )
    parser.add_argument(
        "--skip-auth-users",
        action="store_true",
        help="Skip Firebase Auth user deletion phase.",
    )
    args = parser.parse_args()

    dry_run = not bool(args.apply)
    if args.apply and str(args.confirm or "").strip() != CONFIRM_TOKEN:
        raise SystemExit(
            f"Refusing destructive run. Re-run with: --apply --confirm {CONFIRM_TOKEN}"
        )

    try:
        _, db = init_firebase()
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            "Failed to initialize Firebase Admin SDK. "
            "Set GOOGLE_APPLICATION_CREDENTIALS (recommended) or FIREBASE_SERVICE_ACCOUNT_JSON. "
            f"Error: {exc}"
        ) from exc

    stats = WipeStats()
    try:
        if not args.skip_firestore:
            wipe_firestore(db, dry_run=dry_run, stats=stats)
        if not args.skip_auth_users:
            wipe_auth_users(dry_run=dry_run, stats=stats)
    except Exception as exc:  # noqa: BLE001
        print(f"[error] wipe failed: {exc}", file=sys.stderr)
        return 1

    mode = "DRY RUN" if dry_run else "APPLIED"
    print(
        f"{mode}: firestore_docs_scanned={stats.firestore_docs_scanned} "
        f"firestore_docs_deleted={stats.firestore_docs_deleted} "
        f"firestore_collections_scanned={stats.firestore_collections_scanned} "
        f"auth_users_scanned={stats.auth_users_scanned} "
        f"auth_users_deleted={stats.auth_users_deleted} "
        f"timestamp={utc_now_iso()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
