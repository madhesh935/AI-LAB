import pytest
from sqlalchemy.exc import IntegrityError

from database.connection import Database
from database.models import Task


def mk_employee(client, store="store-a", name="Test Person"):
    r = client.post(f"/api/stores/{store}/staff", json={"name": name, "role": "associate", "skills": ["Stock"]})
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------------ tasks
def test_task_crud_and_lifecycle(client):
    emp = mk_employee(client)
    created = client.post("/api/stores/store-a/tasks", json={"title": "Restock milk", "priority": "high", "dueInMinutes": 30})
    assert created.status_code == 201
    task = created.json()
    assert task["status"] == "new" and task["priority"] == "high" and task["dueWithin"].endswith("mins")

    tid = task["id"]
    assert client.get(f"/api/tasks/{tid}").json()["id"] == tid

    # assign -> auto 'assigned'
    p = client.patch(f"/api/tasks/{tid}", json={"assignedEmployeeId": emp["id"]}).json()
    assert p["status"] == "assigned" and p["assignedEmployeeName"] == "Test Person"

    assert client.post(f"/api/tasks/{tid}/start", json={"employeeId": emp["id"]}).json()["task"]["status"] == "in_progress"
    done = client.post(f"/api/tasks/{tid}/complete", json={"employeeId": emp["id"], "completionNotes": "done", "hasPhotoEvidence": True}).json()["task"]
    assert done["status"] == "completed" and done["completedAt"] and done["hasPhotoEvidence"] is True

    hist = client.get(f"/api/tasks/{tid}/history").json()
    assert [h["toStatus"] for h in hist] == ["new", "assigned", "in_progress", "completed"]

    # completed is terminal
    assert client.patch(f"/api/tasks/{tid}", json={"status": "in_progress"}).status_code == 409
    assert client.patch(f"/api/tasks/{tid}", json={"title": "New title"}).status_code == 409


def test_task_delete_requires_confirmation(client):
    tid = client.post("/api/stores/store-a/tasks", json={"title": "Temp task"}).json()["id"]
    r = client.delete(f"/api/tasks/{tid}")
    assert r.status_code == 428 and r.json()["error"]["code"] == "confirmation_required"
    assert client.get(f"/api/tasks/{tid}").status_code == 200  # still there
    assert client.delete(f"/api/tasks/{tid}?confirm=true").status_code == 204
    assert client.get(f"/api/tasks/{tid}").status_code == 404


def test_task_validation(client):
    assert client.post("/api/stores/store-a/tasks", json={"title": "x"}).status_code == 422
    bad = client.post("/api/stores/store-a/tasks", json={"title": "Valid title", "priority": "urgent"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "validation_error"
    assert client.post("/api/stores/store-a/tasks", json={"title": "Valid title", "quantity": -4}).status_code == 422
    assert client.post("/api/stores/nope/tasks", json={"title": "Valid title"}).status_code == 404
    assert client.post("/api/stores/store-a/tasks", json={"title": "Valid title", "assignedEmployeeId": "ghost"}).status_code == 404


def test_store_filtering_is_strict(client):
    emp_b = mk_employee(client, "store-b", "B Person")
    client.post("/api/stores/store-a/tasks", json={"title": "Task for A"})
    client.post("/api/stores/store-b/tasks", json={"title": "Task for B"})
    a = client.get("/api/stores/store-a/tasks").json()
    b = client.get("/api/stores/store-b/tasks").json()
    assert [t["title"] for t in a["items"]] == ["Task for A"] and a["total"] == 1
    assert [t["title"] for t in b["items"]] == ["Task for B"]
    # an employee of store B cannot be assigned work in store A
    r = client.post("/api/stores/store-a/tasks", json={"title": "Cross store", "assignedEmployeeId": emp_b["id"]})
    assert r.status_code == 404
    assert client.get("/api/stores/store-a/staff").json()["total"] == 0


def test_report_issue_returns_task_to_pool(client):
    emp = mk_employee(client)
    tid = client.post("/api/stores/store-a/tasks", json={"title": "Fetch pallet", "assignedEmployeeId": emp["id"]}).json()["id"]
    client.post(f"/api/tasks/{tid}/start", json={"employeeId": emp["id"]})
    t = client.post(f"/api/tasks/{tid}/report-issue", json={"employeeId": emp["id"], "issueReason": "Pallet blocked"}).json()["task"]
    assert t["status"] == "new" and t["issueReported"] == "Pallet blocked" and t["assignedEmployeeId"] is None


# ----------------------------------------------------------------- alerts
def test_alert_crud(client):
    body = {"title": "Shelf B2 empty", "category": "stock_shortage", "module": "inventory", "severity": "critical", "description": "0 units"}
    created = client.post("/api/stores/store-a/alerts", json=body)
    assert created.status_code == 201
    aid = created.json()["id"]
    assert created.json()["status"] == "active" and created.json()["timestamp"] == "Just now"

    assert client.get(f"/api/alerts/{aid}").json()["title"] == "Shelf B2 empty"
    assert client.patch(f"/api/alerts/{aid}", json={"severity": "warning"}).json()["severity"] == "warning"
    ack = client.post(f"/api/alerts/{aid}/acknowledge", json={"actor": "Arjun"}).json()
    assert ack["status"] == "acknowledged" and ack["acknowledgedBy"] == "Arjun"
    res = client.post(f"/api/alerts/{aid}/resolve").json()
    assert res["status"] == "resolved" and res["resolvedAt"]
    assert client.post(f"/api/alerts/{aid}/acknowledge").status_code == 409  # cannot go backwards

    listing = client.get("/api/stores/store-a/alerts", params={"status": "resolved"}).json()
    assert listing["total"] == 1
    assert client.get("/api/stores/store-b/alerts").json()["total"] == 0

    assert client.delete(f"/api/alerts/{aid}").status_code == 428
    assert client.delete(f"/api/alerts/{aid}?confirm=true").status_code == 204
    assert client.get(f"/api/alerts/{aid}").status_code == 404


def test_alert_validation_and_foreign_references(client):
    assert client.post("/api/stores/store-a/alerts", json={"title": "ab", "category": "x"}).status_code == 422
    r = client.post("/api/stores/store-a/alerts", json={"title": "Valid alert", "category": "camera", "cameraId": "missing"})
    assert r.status_code == 404
    assert client.get("/api/stores/store-a/alerts", params={"status": "bogus"}).status_code == 422


# ----------------------------------------------------- foreign keys / SQLite
def test_foreign_keys_are_enforced_at_database_level(client):
    db = Database(client.settings.database_url)
    with pytest.raises(IntegrityError):
        with db.transaction() as s:
            s.add(Task(id="TSK-BAD", store_id="no-such-store", title="orphan", category="x", priority="low", status="new"))
    db.dispose()


def test_persistence_survives_app_restart(settings, client):
    tid = client.post("/api/stores/store-a/tasks", json={"title": "Survives restart"}).json()["id"]
    from fastapi.testclient import TestClient
    from main import create_app

    with TestClient(create_app(settings)) as again:
        assert again.get(f"/api/tasks/{tid}").json()["title"] == "Survives restart"


# ----------------------------------------------------------------- staff
def test_staff_pwa_flow(client):
    emp = mk_employee(client, name="Pwa User")
    eid = emp["id"]
    assert client.get("/api/staff/me", params={"employee_id": eid}).json()["name"] == "Pwa User"
    tid = client.post("/api/stores/store-a/tasks", json={"title": "Open task for pool"}).json()["id"]

    tasks = client.get("/api/staff/me/tasks", params={"employee_id": eid}).json()
    assert [t["id"] for t in tasks] == [tid]  # unassigned open tasks are offered

    acc = client.post(f"/api/tasks/{tid}/accept", json={"employeeId": eid}).json()["task"]
    assert acc["assignedEmployeeId"] == eid and acc["status"] == "assigned"

    ci = client.post("/api/staff/me/check-in", json={"employeeId": eid}).json()
    assert ci["success"] and client.get("/api/staff/me/attendance", params={"employee_id": eid}).json()["isCheckedIn"] is True
    assert client.post("/api/staff/me/check-in", json={"employeeId": eid}).status_code == 409
    assert client.post("/api/staff/me/check-out", json={"employeeId": eid}).json()["record"]["status"] == "completed"
    assert client.post("/api/staff/me/check-out", json={"employeeId": eid}).status_code == 409
    assert client.get("/api/staff/me", params={"employee_id": "ghost"}).status_code == 404


def test_employee_deactivate_keeps_history(client):
    emp = mk_employee(client)
    assert client.post(f"/api/staff/{emp['id']}/deactivate").json()["isActive"] is False
    assert client.get("/api/stores/store-a/staff").json()["total"] == 0
    assert client.get("/api/stores/store-a/staff", params={"includeInactive": True}).json()["total"] == 1
