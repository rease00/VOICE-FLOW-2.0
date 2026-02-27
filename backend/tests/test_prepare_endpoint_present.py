from app import app


def test_prepare_endpoint_present() -> None:
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/services/dubbing/prepare" in paths
