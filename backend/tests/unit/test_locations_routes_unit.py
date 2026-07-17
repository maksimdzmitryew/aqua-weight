"""Unit tests for backend.app.routes.locations.

These tests cover the remaining branch/edge lines that integration tests do
not exercise (DB-exception guards, non-admin ACL rejections, 403/404/409 error
paths, and generic exception re-raises). All external boundaries (the DB
connection and the auth dependency) are mocked.
"""

import pymysql
import pytest
from fastapi import HTTPException

from backend.app.routes import locations as locations_module
from backend.app.routes.locations import (
    ReorderPayload,
    delete_location,
    list_locations,
    reorder_locations,
    update_location_by_name,
    create_location,
    LocationCreateRequest,
    LocationUpdateByNameRequest,
)


ADMIN_USER = {"id": b"admin", "global_role": "admin"}
NON_ADMIN_OWNER = {"id": b"owner", "global_role": "user"}
NON_ADMIN_OTHER = {"id": b"other", "global_role": "user"}


class FakeCursor:
    """Lightweight cursor mock.

    Records executed statements and returns scripted fetchone results (consumed
    in order, with the last value repeated if the script is exhausted) and a
    scripted rowcount. ``execute_error`` / ``fetchone_error`` can be set to
    raise on call to exercise exception guards.
    """

    def __init__(self, scripted_fetchone=None, rowcount=1, execute_error=None, fetchone_error=None):
        self._script = list(scripted_fetchone) if scripted_fetchone is not None else [None]
        self._script_idx = 0
        self._rowcount = rowcount
        self._execute_error = execute_error
        self._fetchone_error = fetchone_error
        self.queries = []
        self.closed = False

    def execute(self, query, params=None):
        self.queries.append((query, tuple(params) if params is not None else None))
        if self._execute_error is not None:
            raise self._execute_error

    def fetchone(self):
        if self._fetchone_error is not None:
            raise self._fetchone_error
        value = self._script[min(self._script_idx, len(self._script) - 1)]
        self._script_idx += 1
        return value

    def fetchall(self):
        return []

    @property
    def rowcount(self):
        return self._rowcount

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class FakeConn:
    def __init__(self, cursor=None, commit_error=None, rollback_error=None):
        self._cursor = cursor or FakeCursor()
        self._commit_error = commit_error
        self._rollback_error = rollback_error
        self.autocommit_called = False

    def cursor(self):
        return self._cursor

    def autocommit(self, value):
        self.autocommit_called = True

    def commit(self):
        if self._commit_error is not None:
            raise self._commit_error

    def rollback(self):
        if self._rollback_error is not None:
            raise self._rollback_error


# --------------------------------------------------------------------------- #
# list_locations                                                              #
# --------------------------------------------------------------------------- #


def test_list_locations_non_admin_uses_acl_join_query():
    """Line 33: non-admin user must hit the ACL JOIN branch."""
    # row = (id, name, description, created_at)
    cur = FakeCursor(scripted_fetchone=[], rowcount=0)
    # fetchall via fake: we need rows; extend FakeCursor to return scripted rows
    cur._rows = [
        (b"\x01" * 16, "Loc A", "desc", None),
        (b"\x02" * 16, "Loc B", None, None),
    ]

    def _fetchall():
        return cur._rows

    cur.fetchall = _fetchall

    conn = FakeConn(cursor=cur)
    results = list_locations(current_user=NON_ADMIN_OTHER, db=conn)

    # The non-admin branch SELECT must be present
    assert any("user_location_acl" in q for q, _ in cur.queries)
    assert len(results) == 2
    assert results[0].uuid == (b"\x01" * 16).hex()
    assert results[1].uuid == (b"\x02" * 16).hex()


# --------------------------------------------------------------------------- #
# create_location                                                             #
# --------------------------------------------------------------------------- #


def test_create_location_reraises_non_duplicate_integrity_error():
    """Lines 112: IntegrityError with a non-1062 code is re-raised as-is."""
    non_dup = pymysql.err.IntegrityError(1452, "Foreign key constraint fails")
    cur = FakeCursor(scripted_fetchone=[None], rowcount=0, execute_error=non_dup)
    conn = FakeConn(cursor=cur)

    with pytest.raises(pymysql.err.IntegrityError):
        create_location(
            payload=LocationCreateRequest(name="Plant C"),
            current_user=NON_ADMIN_OWNER,
            db=conn,
        )


def test_create_location_reraises_generic_exception():
    """Lines 113-115: a generic Exception inside the try is rolled back and re-raised."""
    cur = FakeCursor(scripted_fetchone=[None], rowcount=0, execute_error=RuntimeError("boom"))
    conn = FakeConn(cursor=cur)

    with pytest.raises(RuntimeError):
        create_location(
            payload=LocationCreateRequest(name="Plant D"),
            current_user=NON_ADMIN_OWNER,
            db=conn,
        )


# --------------------------------------------------------------------------- #
# update_location_by_name                                                     #
# --------------------------------------------------------------------------- #


def test_update_location_by_name_non_admin_without_owner_role_raises_403():
    """Lines 151-157: non-admin whose ACL row is missing is rejected (403)."""
    # orig_row present, new_row absent, acl_row absent
    cur = FakeCursor(scripted_fetchone=[(b"\x01" * 16,), None, None], rowcount=0)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        update_location_by_name(
            payload=LocationUpdateByNameRequest(original_name="Loc A", name="Loc A2"),
            current_user=NON_ADMIN_OTHER,
            db=conn,
        )
    assert exc.value.status_code == 403


def test_update_location_by_name_non_admin_with_non_owner_role_raises_403():
    """Lines 151-157: non-admin present in ACL but with role != owner is rejected (403)."""
    # orig_row, new_row, acl_row(role='helper')
    cur = FakeCursor(
        scripted_fetchone=[(b"\x01" * 16,), None, ("helper",)], rowcount=0
    )
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        update_location_by_name(
            payload=LocationUpdateByNameRequest(original_name="Loc A", name="Loc A2"),
            current_user=NON_ADMIN_OTHER,
            db=conn,
        )
    assert exc.value.status_code == 403


def test_update_location_by_name_reraises_non_duplicate_integrity_error():
    """Lines 203: IntegrityError non-1062 is re-raised as-is."""
    non_dup = pymysql.err.IntegrityError(1452, "Foreign key constraint fails")
    cur = FakeCursor(
        scripted_fetchone=[(b"\x01" * 16,), None, ("owner",)],
        rowcount=0,
        execute_error=non_dup,
    )
    conn = FakeConn(cursor=cur)

    with pytest.raises(pymysql.err.IntegrityError):
        update_location_by_name(
            payload=LocationUpdateByNameRequest(original_name="Loc A", name="Loc A2"),
            current_user=NON_ADMIN_OWNER,
            db=conn,
        )


def test_update_location_by_name_reraises_http_exception():
    """Lines 204-206: an HTTPException is rolled back and re-raised unchanged."""
    cur = FakeCursor(scripted_fetchone=[(b"\x01" * 16,), None, ("owner",)], rowcount=0)
    conn = FakeConn(cursor=cur)

    def _execute(query, params=None):
        # Reach the update branch, then raise an HTTPException to trigger 204-206
        if "UPDATE locations" in query:
            raise HTTPException(status_code=400, detail="forced")

    cur.execute = _execute

    with pytest.raises(HTTPException) as exc:
        update_location_by_name(
            payload=LocationUpdateByNameRequest(original_name="Loc A", name="Loc A2"),
            current_user=NON_ADMIN_OWNER,
            db=conn,
        )
    assert exc.value.status_code == 400


def test_update_location_by_name_reraises_generic_exception():
    """Lines 207-209: a generic Exception is rolled back and re-raised."""
    cur = FakeCursor(scripted_fetchone=[(b"\x01" * 16,), None, ("owner",)], rowcount=0)
    conn = FakeConn(cursor=cur)

    def _execute(query, params=None):
        if "UPDATE locations" in query:
            raise ValueError("boom")

    cur.execute = _execute

    with pytest.raises(ValueError):
        update_location_by_name(
            payload=LocationUpdateByNameRequest(original_name="Loc A", name="Loc A2"),
            current_user=NON_ADMIN_OWNER,
            db=conn,
        )


# --------------------------------------------------------------------------- #
# delete_location                                                             #
# --------------------------------------------------------------------------- #


def test_delete_location_non_admin_without_owner_role_raises_403():
    """Lines 226-232: non-admin whose ACL row is missing/non-owner is rejected (403)."""
    # acl_row absent -> triggers 403 before plant-count query
    cur = FakeCursor(scripted_fetchone=[None], rowcount=1)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        delete_location(id_hex="00" * 16, current_user=NON_ADMIN_OTHER, db=conn)
    assert exc.value.status_code == 403
    # ACL query must have run
    assert any("user_location_acl" in q for q, _ in cur.queries)


def test_delete_location_non_admin_with_non_owner_role_raises_403():
    """Lines 226-232: non-admin present in ACL but role != owner is rejected (403)."""
    cur = FakeCursor(scripted_fetchone=[("helper",)], rowcount=1)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        delete_location(id_hex="00" * 16, current_user=NON_ADMIN_OTHER, db=conn)
    assert exc.value.status_code == 403


def test_delete_location_reraises_generic_exception():
    """Lines 252-254: a generic Exception is rolled back and re-raised."""
    cur = FakeCursor(scripted_fetchone=[("owner",)], rowcount=1)
    conn = FakeConn(cursor=cur)

    def _execute(query, params=None):
        if "SELECT COUNT" in query:
            raise RuntimeError("boom")

    cur.execute = _execute

    with pytest.raises(RuntimeError):
        delete_location(id_hex="00" * 16, current_user=NON_ADMIN_OTHER, db=conn)


# --------------------------------------------------------------------------- #
# reorder_locations                                                           #
# --------------------------------------------------------------------------- #


def test_reorder_locations_non_admin_partial_access_raises_403():
    """Lines 277-284: non-admin lacking access to all ids is rejected (403)."""
    # acl count returns fewer than requested ids -> 403
    cur = FakeCursor(scripted_fetchone=[(1,)], rowcount=1)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        reorder_locations(
            payload=ReorderPayload(ordered_ids=["00" * 16, "11" * 16]),
            current_user=NON_ADMIN_OTHER,
            db=conn,
        )
    assert exc.value.status_code == 403


def test_reorder_locations_reraises_generic_exception():
    """Lines 303-305: a generic Exception is rolled back and re-raised."""
    cur = FakeCursor(scripted_fetchone=[(2,)], rowcount=1)
    conn = FakeConn(cursor=cur)

    def _execute(query, params=None):
        if "SELECT COUNT(*) FROM locations" in query:
            raise ValueError("boom")

    cur.execute = _execute

    with pytest.raises(ValueError):
        reorder_locations(
            payload=ReorderPayload(ordered_ids=["00" * 16, "11" * 16]),
            current_user=NON_ADMIN_OTHER,
            db=conn,
        )


# --------------------------------------------------------------------------- #
# Success / admin / validation branches (kept self-sufficient at 100%)        #
# --------------------------------------------------------------------------- #


def test_list_locations_admin_uses_simple_query():
    """Admin branch (line 29): admin lists without the ACL JOIN."""
    cur = FakeCursor(scripted_fetchone=[], rowcount=0)
    cur._rows = [(b"\xaa" * 16, "Admin Loc", None, None)]

    def _fetchall():
        return cur._rows

    cur.fetchall = _fetchall

    conn = FakeConn(cursor=cur)
    results = list_locations(current_user=ADMIN_USER, db=conn)

    assert any("user_location_acl" not in q for q, _ in cur.queries if "ORDER BY" in q)
    assert results[0].uuid == (b"\xaa" * 16).hex()


def test_create_location_empty_name_raises_400():
    cur = FakeCursor(scripted_fetchone=[], rowcount=0)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        create_location(
            payload=LocationCreateRequest(name="   "),
            current_user=NON_ADMIN_OWNER,
            db=conn,
        )
    assert exc.value.status_code == 400


def test_create_location_duplicate_name_raises_409():
    """Lines 90-91, 108-111: duplicate triggers IntegrityError(1062) -> 409."""
    cur = FakeCursor(scripted_fetchone=[(1,)], rowcount=0)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        create_location(
            payload=LocationCreateRequest(name="Existing"),
            current_user=NON_ADMIN_OWNER,
            db=conn,
        )
    assert exc.value.status_code == 409


def test_create_location_success_returns_ok():
    """Lines 90-107: happy path inserts and returns created_at."""
    cur = FakeCursor(scripted_fetchone=[None, None], rowcount=0)
    conn = FakeConn(cursor=cur)

    result = create_location(
        payload=LocationCreateRequest(name="New Loc", description="d", sort_order=2),
        current_user=NON_ADMIN_OWNER,
        db=conn,
    )

    assert result["ok"] is True
    assert result["name"] == "New Loc"
    assert "created_at" in result


def test_update_location_by_name_empty_name_raises_400():
    cur = FakeCursor(scripted_fetchone=[], rowcount=0)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        update_location_by_name(
            payload=LocationUpdateByNameRequest(original_name="A", name="  "),
            current_user=NON_ADMIN_OWNER,
            db=conn,
        )
    assert exc.value.status_code == 400


def test_update_location_by_name_admin_noop_when_same_row():
    """Lines 150->163 (admin skips ACL), 164-165: same row is a no-op."""
    same = (b"\x01" * 16,)
    cur = FakeCursor(scripted_fetchone=[same, same], rowcount=0)
    conn = FakeConn(cursor=cur)

    result = update_location_by_name(
        payload=LocationUpdateByNameRequest(original_name="A", name="A"),
        current_user=ADMIN_USER,
        db=conn,
    )
    assert result["rows_affected"] == 0
    assert result["created"] is False


def test_update_location_by_name_conflict_when_new_row_differs_raises_409():
    """Lines 167-168, 202: different existing new name -> 409."""
    cur = FakeCursor(
        scripted_fetchone=[(b"\x01" * 16,), (b"\x02" * 16,)], rowcount=0
    )
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        update_location_by_name(
            payload=LocationUpdateByNameRequest(original_name="A", name="B"),
            current_user=ADMIN_USER,
            db=conn,
        )
    assert exc.value.status_code == 409


def test_update_location_by_name_existing_success():
    """Lines 170-180: non-admin owner updates an existing location."""
    cur = FakeCursor(
        scripted_fetchone=[(b"\x01" * 16,), None, ("owner",)], rowcount=3
    )
    conn = FakeConn(cursor=cur)

    result = update_location_by_name(
        payload=LocationUpdateByNameRequest(original_name="A", name="A2"),
        current_user=NON_ADMIN_OWNER,
        db=conn,
    )
    assert result["created"] is False
    assert result["rows_affected"] == 3


def test_update_location_by_name_creates_when_orig_missing():
    """Lines 181-198: original missing and new free -> create new location."""
    cur = FakeCursor(scripted_fetchone=[None, None], rowcount=1)
    conn = FakeConn(cursor=cur)

    result = update_location_by_name(
        payload=LocationUpdateByNameRequest(original_name="New", name="New"),
        current_user=NON_ADMIN_OWNER,
        db=conn,
    )
    assert result["created"] is True
    assert result["rows_affected"] == 1


def test_update_location_by_name_create_conflict_raises_409():
    """Lines 183-185, 202: new name already exists on create -> 409."""
    cur = FakeCursor(scripted_fetchone=[None, (b"\x02" * 16,)], rowcount=0)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        update_location_by_name(
            payload=LocationUpdateByNameRequest(original_name="X", name="Taken"),
            current_user=NON_ADMIN_OWNER,
            db=conn,
        )
    assert exc.value.status_code == 409


def test_delete_location_invalid_id_raises_400():
    cur = FakeCursor(scripted_fetchone=[], rowcount=0)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        delete_location(id_hex="not-hex!", current_user=ADMIN_USER, db=conn)
    assert exc.value.status_code == 400


def test_delete_location_admin_success():
    """Lines 225->238 (admin skips ACL), 239-247, 256: delete with no plants."""
    cur = FakeCursor(scripted_fetchone=[(0,)], rowcount=1)
    conn = FakeConn(cursor=cur)

    result = delete_location(id_hex="00" * 16, current_user=ADMIN_USER, db=conn)
    assert result == {"ok": True}


def test_delete_location_not_found_raises_404():
    cur = FakeCursor(scripted_fetchone=[(0,)], rowcount=0)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        delete_location(id_hex="00" * 16, current_user=ADMIN_USER, db=conn)
    assert exc.value.status_code == 404


def test_delete_location_non_admin_owner_success():
    """Lines 226-235 (ACL passes for owner), 239-248, 256."""
    cur = FakeCursor(scripted_fetchone=[("owner",), (0,)], rowcount=1)
    conn = FakeConn(cursor=cur)

    result = delete_location(id_hex="00" * 16, current_user=NON_ADMIN_OWNER, db=conn)
    assert result == {"ok": True}


def test_delete_location_has_plants_raises_409():
    cur = FakeCursor(scripted_fetchone=[("owner",), (5,)], rowcount=0)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        delete_location(id_hex="00" * 16, current_user=NON_ADMIN_OWNER, db=conn)
    assert exc.value.status_code == 409


def test_reorder_locations_empty_list_raises_400():
    cur = FakeCursor(scripted_fetchone=[], rowcount=0)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        reorder_locations(
            payload=ReorderPayload(ordered_ids=[]),
            current_user=ADMIN_USER,
            db=conn,
        )
    assert exc.value.status_code == 400


def test_reorder_locations_admin_success():
    """Lines 276->287 (admin skips access), 292-299, 307."""
    cur = FakeCursor(scripted_fetchone=[(2,)], rowcount=1)
    conn = FakeConn(cursor=cur)

    result = reorder_locations(
        payload=ReorderPayload(ordered_ids=["00" * 16, "11" * 16]),
        current_user=ADMIN_USER,
        db=conn,
    )
    assert result == {"ok": True}


def test_reorder_locations_non_admin_success():
    """Lines 277-284 (= branch, no 403), 292-299, 307."""
    cur = FakeCursor(scripted_fetchone=[(2,), (2,)], rowcount=1)
    conn = FakeConn(cursor=cur)

    result = reorder_locations(
        payload=ReorderPayload(ordered_ids=["00" * 16, "11" * 16]),
        current_user=NON_ADMIN_OTHER,
        db=conn,
    )
    assert result == {"ok": True}


def test_reorder_locations_missing_ids_raises_400():
    """Lines 293-294: some ids do not exist -> 400."""
    cur = FakeCursor(scripted_fetchone=[(1,)], rowcount=0)
    conn = FakeConn(cursor=cur)

    with pytest.raises(HTTPException) as exc:
        reorder_locations(
            payload=ReorderPayload(ordered_ids=["00" * 16, "11" * 16]),
            current_user=ADMIN_USER,
            db=conn,
        )
    assert exc.value.status_code == 400
