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
    repo_env_local.write_text('FIREBASE_SEED_ADMIN_PASSWORD=local\nVITE_ADMIN_LOGIN_EMAIL=admin1@voiceflow.local\n', encoding='utf-8')
    backend_env = tmp_path / 'backend.env'
    backend_env.write_text('VITE_ADMIN_EMAIL_ALLOWLIST=admin2@voiceflow.local\n', encoding='utf-8')
    backend_env_local = tmp_path / 'backend.env.local'
    backend_env_local.write_text('VITE_ADMIN_LOGIN_EMAIL=admin3@voiceflow.local\n', encoding='utf-8')

    merged = firebase_seed_admins.merge_env_files([repo_env, backend_env, repo_env_local, backend_env_local])

    assert merged['GOOGLE_APPLICATION_CREDENTIALS'] == 'C:/creds/firebase.json'
    assert merged['FIREBASE_SEED_ADMIN_PASSWORD'] == 'local'
    assert merged['VITE_ADMIN_EMAIL_ALLOWLIST'] == 'admin2@voiceflow.local'
    assert merged['VITE_ADMIN_LOGIN_EMAIL'] == 'admin3@voiceflow.local'
