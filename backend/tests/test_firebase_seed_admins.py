from __future__ import annotations

from importlib import util as importlib_util
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / 'scripts' / 'firebase_seed_admins.py'
SCRIPT_SPEC = importlib_util.spec_from_file_location('firebase_seed_admins', SCRIPT_PATH)
assert SCRIPT_SPEC and SCRIPT_SPEC.loader
firebase_seed_admins = importlib_util.module_from_spec(SCRIPT_SPEC)
SCRIPT_SPEC.loader.exec_module(firebase_seed_admins)


def test_merge_env_files_uses_env_local_fallback(tmp_path: Path) -> None:
    repo_env = tmp_path / '.env'
    repo_env.write_text('GOOGLE_APPLICATION_CREDENTIALS=C:/creds/firebase.json\nFIREBASE_SEED_ADMIN_PASSWORD=base\n', encoding='utf-8')
    repo_env_local = tmp_path / '.env.local'
    repo_env_local.write_text(
        'FIREBASE_SEED_ADMIN_PASSWORD=local\nNEXT_PUBLIC_ADMIN_LOGIN_EMAIL=admin1@v-flow-ai.local\n',
        encoding='utf-8',
    )
    backend_env = tmp_path / 'backend.env'
    backend_env.write_text('NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST=admin2@v-flow-ai.local\n', encoding='utf-8')
    backend_env_local = tmp_path / 'backend.env.local'
    backend_env_local.write_text('VITE_ADMIN_LOGIN_EMAIL=admin3@v-flow-ai.local\nNEXT_PUBLIC_ADMIN_UID_ALLOWLIST=uid-1,uid-2\n', encoding='utf-8')

    merged = firebase_seed_admins.merge_env_files([repo_env, backend_env, repo_env_local, backend_env_local])

    assert merged['GOOGLE_APPLICATION_CREDENTIALS'] == 'C:/creds/firebase.json'
    assert merged['FIREBASE_SEED_ADMIN_PASSWORD'] == 'local'
    assert merged['NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST'] == 'admin2@v-flow-ai.local'
    assert merged['NEXT_PUBLIC_ADMIN_LOGIN_EMAIL'] == 'admin1@v-flow-ai.local'
    assert merged['VITE_ADMIN_LOGIN_EMAIL'] == 'admin3@v-flow-ai.local'


def test_load_rows_from_allowlists_ignores_public_admin_envs_by_default() -> None:
    env_values = {
        'NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST': 'admin1@v-flow-ai.local',
        'NEXT_PUBLIC_ADMIN_UID_ALLOWLIST': 'uid-1,uid-2',
    }

    rows = firebase_seed_admins.load_rows_from_allowlists(env_values, 'password123', create_missing_uids=True)

    assert rows == []


def test_load_rows_from_allowlists_allows_public_admin_envs_when_opted_in() -> None:
    env_values = {
        'NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST': 'admin1@v-flow-ai.local',
        'NEXT_PUBLIC_ADMIN_UID_ALLOWLIST': 'uid-1,uid-2',
    }

    rows = firebase_seed_admins.load_rows_from_allowlists(
        env_values,
        'password123',
        create_missing_uids=True,
        allow_public_admin_env=True,
    )

    assert {row.email for row in rows if row.email} == {'admin1@v-flow-ai.local', 'admin-uid1@v-flow-ai.local', 'admin-uid2@v-flow-ai.local'}
    assert {row.uid for row in rows if row.uid} == {'uid-1', 'uid-2'}


def test_load_rows_from_allowlists_reads_server_only_email_allowlist() -> None:
    env_values = {
        'VF_ADMIN_APPROVER_EMAILS': 'admin2@v-flow-ai.local',
    }

    rows = firebase_seed_admins.load_rows_from_allowlists(
        env_values,
        'password123',
        create_missing_uids=True,
    )

    assert len(rows) == 1
    assert rows[0].source == 'allowlist_email'
    assert rows[0].email == 'admin2@v-flow-ai.local'


def test_resolve_env_values_process_env_overrides_env_file(tmp_path: Path, monkeypatch) -> None:
    env_file = tmp_path / '.env'
    env_file.write_text('GOOGLE_CLOUD_PROJECT=from_file\n', encoding='utf-8')
    monkeypatch.setenv('GOOGLE_CLOUD_PROJECT', 'from_process')

    values = firebase_seed_admins.resolve_env_values(str(env_file))

    assert values['GOOGLE_CLOUD_PROJECT'] == 'from_process'
