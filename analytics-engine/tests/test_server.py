import io
import json

from geoeye_analytics.server import build_handlers, handle, serve


def test_handle_dispatches_and_serialises():
    handlers = build_handlers()
    response = handle(json.dumps({"id": "1", "method": "distribution.summary", "params": {"values": [1, 2, 3, 4]}}), handlers)
    assert response["id"] == "1"
    assert response["result"]["mean"] == 2.5


def test_handle_reports_unknown_method():
    response = handle(json.dumps({"id": "2", "method": "nope"}), build_handlers())
    assert response["error"]["type"] == "KeyError"


def test_serve_round_trip():
    stdin = io.StringIO(json.dumps({"id": "a", "method": "engine.info"}) + "\n\n")
    stdout = io.StringIO()
    serve(stdin, stdout)
    lines = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert lines[0]["ready"] is True
    assert lines[1]["id"] == "a" and "version" in lines[1]["result"]
