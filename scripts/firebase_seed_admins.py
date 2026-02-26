from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import firebase_admin  # type: ignore
    from firebase_admin import auth, credentials, firestore  # type: ignore
except Exception:
    firebase_admin = None  # type: ignore
    auth = None  # type: ignore
    credentials = None  # type: ignore
    firestore = None  # type: ignore


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def mask_email(email: str) -> str:
    value = str(email or "").strip()
    if "@" not in value:
        return "***"
    local, domain = value.split("@", 1)
    if len(local) <= 2:
        return f"{local[:1]}***@{domain}"
    return f"{local[:2]}***@{domain}"


def parse_bool(raw: Any) -> bool:
    token = str(raw or "").strip().lower()
    return token in {"1", "true", "yes", "y", "admin"}


def init_firebase() -> Any:
    if firebase_admin is None or credentials is None or firestore is None:
        raise RuntimeError("firebase-admin dependency is required.")
    sa_json = (os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or "").strip()
    if sa_json:
        payload = json.loads(sa_json)
        cred = credentials.Certificate(payload)
        app = firebase_admin.initialize_app(cred)
    else:
        app = firebase_admin.initialize_app()
    return firestore.client(app=app)


@dataclass
class SeedRow:
    email: str
    password: str
    display_name: str
    is_admin: bool


def load_rows(csv_path: Path) -> list[SeedRow]:
    rows: list[SeedRow] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"email", "password", "display_name", "is_admin"}
        missing = required.difference({str(item or "").strip() for item in (reader.fieldnames or [])})
        if missing:
            raise ValueError(f"CSV is missing required headers: {', '.join(sorted(missing))}")
        for index, raw in enumerate(reader, start=2):
            email = str(raw.get("email") or "").strip().lower()
            password = str(raw.get("password") or "")
            display_name = str(raw.get("display_name") or "").strip()
            is_admin = parse_bool(raw.get("is_admin"))
            if not email or "@" not in email:
                raise ValueError(f"Row {index}: invalid email")
            if len(password) < 8:
                raise ValueError(f"Row {index}: password must be at least 8 characters")
            rows.append(
                SeedRow(
                    email=email,
                    password=password,
                    display_name=display_name or email.split("@")[0],
                    is_admin=is_admin,
                )
            )
    return rows


def upsert_user(row: SeedRow, db: Any, dry_run: bool = False) -> tuple[str, bool]:
    created = False
    if dry_run:
        return f"dry_{row.email}", created
    if auth is None:
        raise RuntimeError("firebase-admin dependency is required.")
    try:
        record = auth.get_user_by_email(row.email)
    except auth.UserNotFoundError:
        record = auth.create_user(email=row.email, password=row.password, display_name=row.display_name)
        created = True
    else:
        record = auth.update_user(record.uid, password=row.password, display_name=row.display_name)

    custom_claims = dict(record.custom_claims or {})
    custom_claims["admin"] = bool(row.is_admin)
    auth.set_custom_user_claims(record.uid, custom_claims)
    db.collection("users").document(record.uid).set(
        {
            "email": row.email,
            "displayName": row.display_name,
            "isAdmin": bool(row.is_admin),
            "role": "admin" if row.is_admin else "user",
            "updatedAt": utc_now_iso(),
        },
        merge=True,
    )
    return record.uid, created


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Upsert Firebase Auth users from CSV and mirror admin role to custom claims + Firestore users/{uid}."
        )
    )
    parser.add_argument("--csv", required=True, help="Path to CSV with headers: email,password,display_name,is_admin")
    parser.add_argument("--dry-run", action="store_true", help="Validate input and print summary without writing")
    args = parser.parse_args()

    csv_path = Path(args.csv).expanduser().resolve()
    if not csv_path.exists():
        raise SystemExit(f"CSV file not found: {csv_path}")

    try:
        rows = load_rows(csv_path)
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Failed to load CSV: {exc}") from exc

    if not rows:
        print("No rows found. Nothing to do.")
        return 0

    if not args.dry_run:
        try:
            db = init_firebase()
        except Exception as exc:  # noqa: BLE001
            raise SystemExit(
                f"Failed to initialize Firebase Admin SDK. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS. Error: {exc}"
            ) from exc
    else:
        db = None

    created_count = 0
    updated_count = 0
    admin_count = 0
    for row in rows:
        if row.is_admin:
            admin_count += 1
        try:
            uid, created = upsert_user(row, db, dry_run=args.dry_run)
            if created:
                created_count += 1
            else:
                updated_count += 1
            print(
                f"[ok] uid={uid} email={mask_email(row.email)} admin={int(row.is_admin)} action={'create' if created else 'update'}"
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[error] email={mask_email(row.email)} reason={exc}", file=sys.stderr)
            return 1

    mode = "DRY RUN" if args.dry_run else "APPLIED"
    print(
        f"{mode}: rows={len(rows)} created={created_count} updated={updated_count} admin_rows={admin_count} at={utc_now_iso()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
