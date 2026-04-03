import argparse
import csv
import json
import os
import re
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


DEFAULT_UPDATED_BY = "firebase_seed_admins.py"


@dataclass
class SeedTarget:
    uid: str
    email: str
    display_name: str
    password: str
    source: str


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def mask_email(email: str) -> str:
    value = str(email or "").strip().lower()
    if "@" not in value:
        return "***"
    local, domain = value.split("@", 1)
    if len(local) <= 2:
        return f"{local[:1]}***@{domain}"
    return f"{local[:2]}***@{domain}"


def parse_bool(raw: Any) -> bool:
    token = str(raw or "").strip().lower()
    return token in {"1", "true", "yes", "y", "admin"}


def csv_tokens(raw: str) -> list[str]:
    parts = [item.strip() for item in str(raw or "").split(",")]
    return [item for item in parts if item]


def normalize_email(email: str) -> str:
    return str(email or "").strip().lower()


def normalize_uid(uid: str) -> str:
    return str(uid or "").strip()


def is_email(value: str) -> bool:
    token = normalize_email(value)
    return bool(token and "@" in token and "." in token.split("@", 1)[1])


def synthetic_email_for_uid(uid: str) -> str:
    safe = re.sub(r"[^a-z0-9]", "", str(uid or "").lower())[:24]
    if not safe:
        safe = "adminseed"
    return f"admin-{safe}@v-flow-ai.local"


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        safe_key = key.strip()
        safe_value = value.strip()
        if (
            (safe_value.startswith('"') and safe_value.endswith('"'))
            or (safe_value.startswith("'") and safe_value.endswith("'"))
        ):
            safe_value = safe_value[1:-1]
        values[safe_key] = safe_value
    return values


def merge_env_files(paths: list[Path]) -> dict[str, str]:
    values: dict[str, str] = {}
    for candidate in paths:
        if candidate.exists():
            values.update(parse_env_file(candidate))
    return values


def get_env(key: str, fallback: dict[str, str]) -> str:
    return str(fallback.get(key) or "")


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


def load_rows_from_csv(csv_path: Path) -> list[SeedTarget]:
    rows: list[SeedTarget] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"email", "password", "display_name", "is_admin"}
        missing = required.difference({str(item or "").strip() for item in (reader.fieldnames or [])})
        if missing:
            raise ValueError(f"CSV is missing required headers: {', '.join(sorted(missing))}")
        for index, raw in enumerate(reader, start=2):
            if not parse_bool(raw.get("is_admin")):
                continue
            email = normalize_email(raw.get("email") or "")
            password = str(raw.get("password") or "")
            display_name = str(raw.get("display_name") or "").strip() or email.split("@")[0]
            if not is_email(email):
                raise ValueError(f"Row {index}: invalid email")
            if len(password) < 8:
                raise ValueError(f"Row {index}: password must be at least 8 characters")
            rows.append(
                SeedTarget(
                    uid="",
                    email=email,
                    display_name=display_name,
                    password=password,
                    source="csv",
                )
            )
    return rows


def load_rows_from_allowlists(
    env_values: dict[str, str],
    password: str,
    create_missing_uids: bool,
    allow_public_admin_env: bool = False,
) -> list[SeedTarget]:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")

    uid_tokens: list[str] = []
    uid_tokens.extend(csv_tokens(get_env("VF_ADMIN_APPROVER_UIDS", env_values)))
    if allow_public_admin_env:
        uid_tokens.extend(csv_tokens(get_env("NEXT_PUBLIC_ADMIN_UID_ALLOWLIST", env_values)))
        uid_tokens.extend(csv_tokens(get_env("VITE_ADMIN_UID_ALLOWLIST", env_values)))

    email_tokens: list[str] = []
    email_tokens.extend(csv_tokens(get_env("VF_ADMIN_APPROVER_EMAILS", env_values)))
    server_login_email = normalize_email(get_env("VF_ADMIN_LOGIN_EMAIL", env_values))
    if server_login_email:
        email_tokens.append(server_login_email)
    if allow_public_admin_env:
        email_tokens.extend(csv_tokens(get_env("NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST", env_values)))
        email_tokens.extend(csv_tokens(get_env("VITE_ADMIN_EMAIL_ALLOWLIST", env_values)))
    login_email = normalize_email(
        get_env("NEXT_PUBLIC_ADMIN_LOGIN_EMAIL", env_values) or get_env("VITE_ADMIN_LOGIN_EMAIL", env_values)
    )
    if allow_public_admin_env and login_email:
        email_tokens.append(login_email)

    unique_uids: list[str] = []
    seen_uids: set[str] = set()
    for token in uid_tokens:
        normalized = normalize_uid(token)
        if not normalized or normalized in seen_uids:
            continue
        seen_uids.add(normalized)
        unique_uids.append(normalized)

    unique_emails: list[str] = []
    seen_emails: set[str] = set()
    for token in email_tokens:
        normalized = normalize_email(token)
        if not is_email(normalized) or normalized in seen_emails:
            continue
        seen_emails.add(normalized)
        unique_emails.append(normalized)

    rows: list[SeedTarget] = []
    for index, uid in enumerate(unique_uids, start=1):
        rows.append(
            SeedTarget(
                uid=uid,
                email=synthetic_email_for_uid(uid) if create_missing_uids else "",
                display_name=f"Admin {index}",
                password=password,
                source="allowlist_uid",
            )
        )
    for email in unique_emails:
        rows.append(
            SeedTarget(
                uid="",
                email=email,
                display_name=email.split("@")[0],
                password=password,
                source="allowlist_email",
            )
        )

    return rows


def find_or_create_auth_user(target: SeedTarget, dry_run: bool, create_missing_uids: bool) -> tuple[str, str]:
    if dry_run:
        synthetic_uid = target.uid or f"dry_{target.email}"
        return synthetic_uid, "dry-run"
    if auth is None:
        raise RuntimeError("firebase-admin dependency is required.")

    if target.uid:
        safe_uid = normalize_uid(target.uid)
        try:
            user_record = auth.get_user(safe_uid)
            updates: dict[str, Any] = {
                "password": target.password,
                "display_name": target.display_name,
                "email_verified": True,
            }
            if target.email and not str(getattr(user_record, "email", "") or "").strip():
                updates["email"] = target.email
            auth.update_user(safe_uid, **updates)
            return safe_uid, "update-by-uid"
        except auth.UserNotFoundError:
            if target.email:
                try:
                    email_record = auth.get_user_by_email(target.email)
                    auth.update_user(
                        email_record.uid,
                        password=target.password,
                        display_name=target.display_name,
                        email_verified=True,
                    )
                    return email_record.uid, "update-by-email"
                except auth.UserNotFoundError:
                    pass
            if not create_missing_uids:
                raise RuntimeError(f"UID not found in Firebase Auth: {safe_uid}")
            email_for_create = target.email or synthetic_email_for_uid(safe_uid)
            created = auth.create_user(
                uid=safe_uid,
                email=email_for_create,
                password=target.password,
                display_name=target.display_name,
                email_verified=True,
            )
            return created.uid, "create-by-uid"

    safe_email = normalize_email(target.email)
    if not is_email(safe_email):
        raise RuntimeError("Email is required for non-UID seed target.")
    try:
        record = auth.get_user_by_email(safe_email)
        auth.update_user(
            record.uid,
            email=safe_email,
            password=target.password,
            display_name=target.display_name,
            email_verified=True,
        )
        return record.uid, "update-by-email"
    except auth.UserNotFoundError:
        created = auth.create_user(
            email=safe_email,
            password=target.password,
            display_name=target.display_name,
            email_verified=True,
        )
        return created.uid, "create-by-email"


def upsert_admin_claim(uid: str, dry_run: bool) -> None:
    if dry_run:
        return
    if auth is None:
        raise RuntimeError("firebase-admin dependency is required.")
    user_record = auth.get_user(uid)
    claims = dict(user_record.custom_claims or {})
    claims["admin"] = True
    auth.set_custom_user_claims(uid, claims)


def upsert_firestore_admin_rows(
    db: Any,
    uid: str,
    email: str,
    display_name: str,
    dry_run: bool,
    skip_firestore: bool,
) -> None:
    if dry_run or skip_firestore:
        return
    now_iso = utc_now_iso()
    user_ref = db.collection("users").document(uid)
    user_snapshot = user_ref.get()
    existing_user = user_snapshot.to_dict() if user_snapshot.exists else {}
    created_at = str(existing_user.get("createdAt") or now_iso)
    user_ref.set(
        {
            "uid": uid,
            "email": normalize_email(email),
            "displayName": display_name,
            "isAdmin": True,
            "admin": True,
            "role": "admin",
            "roles": ["admin"],
            "status": "active",
            "createdAt": created_at,
            "updatedAt": now_iso,
            "updatedBy": DEFAULT_UPDATED_BY,
        },
        merge=True,
    )

    admin_ref = db.collection("admin_roles").document(uid)
    admin_snapshot = admin_ref.get()
    existing_admin = admin_snapshot.to_dict() if admin_snapshot.exists else {}
    admin_version = int(existing_admin.get("version") or 0) + 1
    admin_ref.set(
        {
            "uid": uid,
            "role": "super_admin",
            "allowOverrides": [],
            "denyOverrides": [],
            "status": "active",
            "version": admin_version,
            "updatedAt": now_iso,
            "updatedBy": DEFAULT_UPDATED_BY,
        },
        merge=True,
    )


def resolve_env_values(env_file: str) -> dict[str, str]:
    process_values = dict(os.environ)
    if env_file:
        file_values = merge_env_files([Path(env_file).expanduser().resolve()])
        return {**file_values, **process_values}

    repo_root = Path(__file__).resolve().parents[2]
    backend_root = Path(__file__).resolve().parents[1]
    file_values = merge_env_files(
        [
            repo_root / ".env",
            backend_root / ".env",
            repo_root / ".env.local",
            backend_root / ".env.local",
        ]
    )
    return {**file_values, **process_values}


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Seed Firebase admin users from allowlists (default) or CSV, then enforce admin claims and Firestore admin rows."
        )
    )
    parser.add_argument(
        "--csv",
        default="",
        help="Optional CSV with headers email,password,display_name,is_admin. If omitted, allowlists are used.",
    )
    parser.add_argument(
        "--env-file",
        default="",
        help="Optional .env file path used to resolve allowlists when shell env is not exported.",
    )
    parser.add_argument(
        "--password",
        default="",
        help=(
            "Password for allowlist-seeded users. "
            "If omitted, FIREBASE_SEED_ADMIN_PASSWORD from env/.env is used."
        ),
    )
    parser.add_argument(
        "--skip-create-missing-uids",
        action="store_true",
        help="Do not create auth users for allowlisted UIDs missing in Firebase Auth.",
    )
    parser.add_argument(
        "--skip-firestore",
        action="store_true",
        help="Skip Firestore users/admin_roles upserts and only manage Firebase Auth + custom claims.",
    )
    parser.add_argument(
        "--allow-public-admin-env",
        action="store_true",
        help=(
            "Allow legacy NEXT_PUBLIC/VITE admin allowlist env vars. "
            "Disabled by default; prefer server-only VF_ADMIN_APPROVER_UIDS/VF_ADMIN_APPROVER_EMAILS."
        ),
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate and print actions without writing.")
    args = parser.parse_args()

    create_missing_uids = not bool(args.skip_create_missing_uids)

    try:
        env_values = resolve_env_values(args.env_file)
        allow_public_admin_env = bool(args.allow_public_admin_env)
        for key in (
            "GOOGLE_APPLICATION_CREDENTIALS",
            "GOOGLE_CLOUD_PROJECT",
            "GCLOUD_PROJECT",
            "FIREBASE_SERVICE_ACCOUNT_JSON",
        ):
            value = str(env_values.get(key) or "").strip()
            if value:
                os.environ[key] = value
        if args.csv:
            csv_path = Path(args.csv).expanduser().resolve()
            if not csv_path.exists():
                raise SystemExit(f"CSV file not found: {csv_path}")
            targets = load_rows_from_csv(csv_path)
        else:
            resolved_password = str(args.password or "").strip() or str(
                get_env("FIREBASE_SEED_ADMIN_PASSWORD", env_values)
            ).strip()
            if not resolved_password:
                raise ValueError(
                    "Missing admin seed password. Set --password or FIREBASE_SEED_ADMIN_PASSWORD in env/.env."
                )
            if allow_public_admin_env:
                print(
                    "[warn] using legacy public admin allowlist env vars (NEXT_PUBLIC/VITE). "
                    "Prefer server-only VF_ADMIN_APPROVER_UIDS/VF_ADMIN_APPROVER_EMAILS.",
                    file=sys.stderr,
                )
            targets = load_rows_from_allowlists(
                env_values=env_values,
                password=resolved_password,
                create_missing_uids=create_missing_uids,
                allow_public_admin_env=allow_public_admin_env,
            )
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Failed to load seed targets: {exc}") from exc

    if not targets:
        print("No admin targets found. Nothing to do.")
        return 0

    if not args.dry_run:
        try:
            init_db = init_firebase()
            db = None if args.skip_firestore else init_db
        except Exception as exc:  # noqa: BLE001
            raise SystemExit(
                "Failed to initialize Firebase Admin SDK. "
                "Set GOOGLE_APPLICATION_CREDENTIALS (recommended) or FIREBASE_SERVICE_ACCOUNT_JSON. "
                f"Error: {exc}"
            ) from exc
    else:
        db = None

    created_count = 0
    updated_count = 0
    processed_uids: set[str] = set()
    for target in targets:
        try:
            uid, action = find_or_create_auth_user(
                target=target,
                dry_run=args.dry_run,
                create_missing_uids=create_missing_uids,
            )
            if uid in processed_uids:
                print(f"[skip] uid={uid} source={target.source} reason=duplicate_target")
                continue
            processed_uids.add(uid)

            record_email = target.email or synthetic_email_for_uid(uid)
            upsert_admin_claim(uid=uid, dry_run=args.dry_run)
            upsert_firestore_admin_rows(
                db=db,
                uid=uid,
                email=record_email,
                display_name=target.display_name,
                dry_run=args.dry_run,
                skip_firestore=bool(args.skip_firestore),
            )

            if "create" in action:
                created_count += 1
            else:
                updated_count += 1

            print(
                f"[ok] uid={uid} email={mask_email(record_email)} source={target.source} action={action} admin=1"
            )
        except Exception as exc:  # noqa: BLE001
            print(
                f"[error] uid={target.uid or '-'} email={mask_email(target.email)} source={target.source} reason={exc}",
                file=sys.stderr,
            )
            return 1

    mode = "DRY RUN" if args.dry_run else "APPLIED"
    print(
        f"{mode}: targets={len(targets)} unique_uids={len(processed_uids)} created={created_count} updated={updated_count} at={utc_now_iso()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
