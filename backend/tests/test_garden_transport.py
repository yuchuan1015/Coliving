"""Garden auth, input and independent transaction transport regression tests.

Domain state-machine coverage lives in the garden service tests. These tests
mock domain outcomes where they specifically verify HTTP/MCP result handling.
Run through run_tests.py to isolate all files/database and block networking.
"""

import asyncio
import json
import unittest
import uuid
import tempfile
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from types import SimpleNamespace
from unittest.mock import MagicMock, patch, sentinel

from fastapi import FastAPI
from fastapi.testclient import TestClient
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import mcp_server as M
import garden_tick
from database import Base, SessionLocal, engine
from models.agent import Agent
from models.user import User
from models.mcp_token import McpToken
from routers import garden
from services import auth_service, bed_service, garden_service as S, garden_mcp, time_service, garden_engine
from utils.deps import get_current_user, get_db


def command(**changes):
    return {"plot_id": "plot-1", "planting_id": "planting-1", "action": "water", "request_id": "request-1", **changes}


class GardenRestTransportTest(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(garden.router)
        self.db = MagicMock()
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="authenticated-user")
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.actor = self.enterContext(patch.object(S, "actor_for_user", return_value=sentinel.user_actor))
        self.mutate = self.enterContext(patch.object(S, "mutate", return_value={"changed": True}))

    def test_actor_spoofing_and_client_clock_are_rejected(self):
        for field in ("role", "kind", "actor", "user_id", "agent_id", "household_id", "now", "timestamp", "time_multiplier"):
            with self.subTest(field=field):
                response = self.client.post("/api/garden/actions", json={"actions": [command(**{field: "forged"})]})
                self.assertEqual(response.status_code, 422, response.text)
        response = self.client.post("/api/garden/actions", json={"actions": [command()], "role": "agent"})
        self.assertEqual(response.status_code, 422)
        self.mutate.assert_not_called()

    def test_main_registers_only_user_garden_routes(self):
        from main import app
        routes = {path: {method.upper() for method in entry} for path, entry in app.openapi()["paths"].items()
                  if path.startswith("/api/garden")}
        self.assertEqual(routes, {
            "/api/garden/private": {"GET"}, "/api/garden/public": {"GET"},
            "/api/garden/inventory": {"GET"}, "/api/garden/progress": {"GET"},
            "/api/garden/actions": {"POST"},
            "/api/garden/market": {"GET"}, "/api/garden/market/quote": {"POST"},
            "/api/garden/market/sell": {"POST"},
        })

    def test_request_id_is_required_nonblank_bounded_and_strict(self):
        for value in (None, "", " \t ", "x" * 129, 42):
            with self.subTest(value=value):
                response = self.client.post("/api/garden/actions", json={"actions": [command(request_id=value)]})
                self.assertEqual(response.status_code, 422, response.text)
        missing = command()
        del missing["request_id"]
        self.assertEqual(self.client.post("/api/garden/actions", json={"actions": [missing]}).status_code, 422)
        self.mutate.assert_not_called()

    def test_batch_size_and_extra_parameters_rejected_before_execution(self):
        for payload in ({"actions": []}, {"actions": [command()] * 5}, {"actions": [command(accept="true")]},
                        {"actions": [command(reason=" " * 3)]}, {"actions": [command(reason="x" * 501)]}):
            self.assertEqual(self.client.post("/api/garden/actions", json=payload).status_code, 422)
        self.mutate.assert_not_called()

    def test_multi_plot_partial_success_keeps_order_and_continues(self):
        self.mutate.side_effect = [
            {"plot_id": "plot-1", "watered": True},
            S.GardenError(409, "這塊地還沒有作物", "empty_plot"),
            {"plot_id": "plot-3", "credited_g": "100"},
            S.GardenError(403, "只能操作自己的私田", "forbidden_plot"),
        ]
        rows = [command(plot_id="plot-1"), command(plot_id="plot-2", request_id="request-2"),
                command(plot_id="plot-3", action="steal", batch_id="batch-3", request_id="request-3"),
                command(plot_id="foreign-plot", request_id="request-4")]
        response = self.client.post("/api/garden/actions", json={"actions": rows})
        self.assertEqual(response.status_code, 200, response.text)
        results = response.json()["results"]
        self.assertEqual([row["ok"] for row in results], [True, False, True, False])
        self.assertEqual(results[1]["error"], {"code": "empty_plot", "detail": "這塊地還沒有作物", "status_code": 409})
        self.assertEqual(results[3]["error"]["status_code"], 403)
        self.actor.assert_called_once_with(self.db, "authenticated-user")
        self.assertEqual(self.mutate.call_count, 4)
        for call in self.mutate.call_args_list:
            self.assertIs(call.args[1], sentinel.user_actor)
        self.assertEqual(self.db.rollback.call_count, 2)

    def test_unknown_or_user_forbidden_actions_do_not_reject_whole_batch(self):
        self.mutate.side_effect = [S.GardenError(400, "未知動作", "unknown_action"),
                                   S.GardenError(403, "需要室友執行", "forbidden_action"), {"watered": True}]
        response = self.client.post("/api/garden/actions", json={"actions": [
            command(action="unknown_action"), command(action="harvest", request_id="request-2"),
            command(request_id="request-3")]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([r["ok"] for r in response.json()["results"]], [False, False, True])

    def test_unexpected_failure_rolls_back_and_does_not_leak_exception(self):
        self.mutate.side_effect = [RuntimeError("internal-secret-marker"), {"watered": True}]
        with self.assertLogs(garden_mcp.logger, level="ERROR"):
            response = self.client.post("/api/garden/actions", json={"actions": [command(), command(request_id="request-2")]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([r["ok"] for r in response.json()["results"]], [False, True])
        self.assertNotIn("internal-secret-marker", response.text)
        self.db.rollback.assert_called_once()

    def test_read_routes_use_authenticated_user_factory(self):
        for path, name in (("private", "get_private"), ("public", "get_public"), ("progress", "get_progress")):
            with self.subTest(path=path), patch.object(S, name, return_value={"view": path}) as read:
                response = self.client.get(f"/api/garden/{path}")
                self.assertEqual(response.json(), {"view": path})
                read.assert_called_once_with(self.db, sentinel.user_actor)
        self.assertEqual(self.actor.call_count, 3)

    def test_inventory_owner_is_a_view_selector_and_pagination_is_bounded(self):
        with patch.object(S, "get_inventory", return_value={"items": []}) as read:
            for owner in ("user", "agent"):
                response = self.client.get(f"/api/garden/inventory?owner={owner}&limit=20&offset=3")
                self.assertEqual(response.status_code, 200)
                read.assert_called_with(self.db, sentinel.user_actor, owner=owner, limit=20, offset=3)
            for query in ("owner=other-household", "limit=0", "limit=101", "offset=-1"):
                self.assertEqual(self.client.get(f"/api/garden/inventory?{query}").status_code, 422)
            self.assertEqual(read.call_count, 2)

    def test_factory_denial_is_http_error_and_never_executes_mutation(self):
        self.actor.side_effect = S.GardenError(403, "需要先有室友", "agent_required")
        for method, path, kwargs in (("get", "/api/garden/private", {}),
                                     ("post", "/api/garden/actions", {"json": {"actions": [command()]}})):
            response = getattr(self.client, method)(path, **kwargs)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()["error"]["code"], "agent_required")
        self.mutate.assert_not_called()


class GardenMcpTransportTest(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.actor = self.enterContext(patch.object(S, "actor_for_agent", return_value=sentinel.agent_actor))
        self.mutate = self.enterContext(patch.object(S, "mutate", return_value={"changed": True}))

    def test_mcp_uses_verified_context_token_and_server_agent_factory(self):
        ctx = SimpleNamespace(headers={"authorization": "Bearer context-key"})
        with patch.object(M, "_verify_mcp_token", return_value="verified-user") as verify, \
             patch.object(M, "SessionLocal", return_value=self.db):
            result = json.loads(M.garden(**command(action="care"), ctx=ctx))
        self.assertTrue(result["ok"], result)
        verify.assert_called_once_with("context-key")
        self.actor.assert_called_once_with(self.db, "verified-user")
        self.assertIs(self.mutate.call_args.args[1], sentinel.agent_actor)
        self.db.close.assert_called_once()

    def test_invalid_mcp_token_stops_before_creating_actor_or_session(self):
        with patch.object(M, "_verify_mcp_token", return_value=None), patch.object(M, "SessionLocal") as session:
            result = json.loads(M.garden(action="private"))
        self.assertEqual(result["error"]["status_code"], 401)
        self.actor.assert_not_called()
        session.assert_not_called()

    def test_mcp_tool_schema_and_runtime_reject_top_level_spoofing(self):
        tool = M.mcp._tool_manager.get_tool("garden")
        self.assertFalse(tool.parameters["additionalProperties"])
        self.assertNotIn("ctx", tool.parameters["properties"])
        for field in ("role", "user_id", "agent_id", "household_id", "now", "ctx", "token"):
            with self.subTest(field=field), self.assertRaises(ToolError):
                asyncio.run(tool.run({"action": "private", field: "forged"}, context=None))
        self.actor.assert_not_called()

    def test_mcp_batch_rejects_injected_identity_time_and_oversized_json(self):
        for field in ("role", "household_id", "now"):
            result = garden_mcp.dispatch(self.db, "verified-user", action="actions", actions_json=json.dumps([command(**{field: "forged"})]))
            self.assertEqual(result["error"]["status_code"], 422)
        for payload in ("[", "{}", "[]", json.dumps([command()] * 5), " " * 16385):
            result = garden_mcp.dispatch(self.db, "verified-user", action="actions", actions_json=payload)
            self.assertEqual(result["error"]["status_code"], 422)
        self.mutate.assert_not_called()

    def test_mcp_batch_retains_partial_results_and_agent_identity(self):
        self.mutate.side_effect = [{"planted": True}, S.GardenError(403, "只有人能偷菜", "forbidden_action"),
                                  S.GardenError(400, "未知動作", "unknown_action"), {"cared": True}]
        rows = [command(action="plant", crop_id="crop"), command(action="steal", request_id="two"),
                command(action="open_vote", request_id="three"), command(action="care", request_id="four")]
        result = garden_mcp.dispatch(self.db, "verified-user", action="actions", actions_json=json.dumps(rows))
        self.assertEqual([r["ok"] for r in result["results"]], [True, False, False, True])
        for call in self.mutate.call_args_list:
            self.assertIs(call.args[1], sentinel.agent_actor)

    def test_mcp_query_and_batch_cannot_silently_ignore_mutation_parameters(self):
        for kwargs in ({"action": "private", "request_id": "unexpected"},
                       {"action": "actions", "actions_json": json.dumps([command()]), "plot_id": "ambiguous"},
                       {"action": "water", "actions_json": json.dumps([command()])}, {"action": "actions"}):
            result = garden_mcp.dispatch(self.db, "verified-user", **kwargs)
            self.assertEqual(result["error"]["status_code"], 422)
        self.mutate.assert_not_called()

    def test_mcp_inventory_bounds_and_owner_validation_match_rest(self):
        with patch.object(S, "get_inventory", return_value={"items": []}) as read:
            result = garden_mcp.dispatch(self.db, "verified-user", action="inventory", owner="user", limit=20, offset=2)
            self.assertTrue(result["ok"])
            read.assert_called_once_with(self.db, sentinel.agent_actor, owner="user", limit=20, offset=2)
            for kwargs in ({"owner": "other"}, {"limit": 101}, {"offset": -1}, {"limit": True}):
                result = garden_mcp.dispatch(self.db, "verified-user", action="inventory", **kwargs)
                self.assertEqual(result["error"]["status_code"], 422)
            self.assertEqual(read.call_count, 1)


class GardenRealAuthenticationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(engine)

    def setUp(self):
        self.db = SessionLocal()
        self.addCleanup(self.db.close)
        self.user = User(username=uuid.uuid4().hex, display_name="garden-auth-test", hashed_password="not-used")
        self.db.add(self.user)
        self.db.flush()
        self.agent = Agent(user_id=self.user.id, name=uuid.uuid4().hex, persona="test", llm_provider="claude", llm_model="offline", encrypted_api_key="")
        self.db.add(self.agent)
        self.db.commit()
        key = bed_service.issue_key(self.db, self.user.id, self.agent.id)
        self.db.commit()
        self.key_id = key.id
        self.key = bed_service.token_string(key, self.user.username)
        self.app = FastAPI()
        self.app.include_router(garden.router)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_rest_rejects_mcp_credentials_and_disabled_web_account(self):
        with patch.object(S, "actor_for_user") as factory:
            response = self.client.get("/api/garden/private", headers={"Authorization": f"Bearer {self.key}"})
            self.assertEqual(response.status_code, 401)
            access = auth_service.create_access_token(self.user.id, self.user.username, self.user.role)
            self.user.is_active = False
            self.db.commit()
            response = self.client.get("/api/garden/private", headers={"Authorization": f"Bearer {access}"})
            self.assertEqual(response.status_code, 401)
            factory.assert_not_called()

    def test_mcp_rejects_web_credentials_and_disabled_account(self):
        access = auth_service.create_access_token(self.user.id, self.user.username, self.user.role)
        with patch.object(S, "actor_for_agent") as factory:
            result = json.loads(M.garden(action="private", ctx=SimpleNamespace(headers={"authorization": f"Bearer {access}"})))
            self.assertEqual(result["error"]["status_code"], 401)
            self.user.is_active = False
            self.db.commit()
            result = json.loads(M.garden(action="private", ctx=SimpleNamespace(headers={"authorization": f"Bearer {self.key}"})))
            self.assertEqual(result["error"]["status_code"], 401)
            factory.assert_not_called()

    def test_mcp_rejects_revoked_key_before_actor_factory(self):
        self.db.get(McpToken, self.key_id).revoked_at = time_service.now_utc()
        self.db.commit()
        with patch.object(S, "actor_for_agent") as factory:
            result = json.loads(M.garden(action="private", ctx=SimpleNamespace(headers={"authorization": f"Bearer {self.key}"})))
            self.assertEqual(result["error"]["status_code"], 401)
            factory.assert_not_called()


class GardenRealEndpointFlowTest(unittest.TestCase):
    """Real auth, service, SQLite and growth; only server time/hazards controlled."""

    def setUp(self):
        temp = self.enterContext(tempfile.TemporaryDirectory(prefix="garden-transport-flow-"))
        self.engine = create_engine(f"sqlite:///{temp}/garden.db", connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.now = datetime(2026, 9, 11, tzinfo=timezone.utc)
        self.started = self.now
        self.enterContext(patch.object(time_service, "now_utc", side_effect=lambda: self.now))
        self.enterContext(patch.object(garden_engine, "_season_factor", return_value=Fraction(1)))
        self.enterContext(patch.object(garden_engine, "_random_draw", return_value=1.0))
        self.enterContext(patch.object(M, "SessionLocal", self.sessions))
        self.households = []
        with self.sessions() as db:
            for number in range(2):
                user = User(username=f"flow-user-{number}", display_name="fixture", hashed_password="not-used")
                db.add(user)
                db.flush()
                agent = Agent(user_id=user.id, name=f"flow-agent-{number}", persona="fixture", llm_provider="claude", llm_model="unused", encrypted_api_key="")
                db.add(agent)
                db.commit()
                key = bed_service.issue_key(db, user.id, agent.id)
                db.commit()
                self.households.append({"user_id": user.id, "agent_id": agent.id,
                    "access": auth_service.create_access_token(user.id, user.username, user.role),
                    "mcp": bed_service.token_string(key, user.username)})
        self.app = FastAPI()
        self.app.include_router(garden.router)
        def get_test_db():
            with self.sessions() as db:
                yield db
        self.app.dependency_overrides[get_db] = get_test_db
        self.client = TestClient(self.app, headers={"Authorization": f"Bearer {self.households[0]['access']}"})
        self.addCleanup(self.client.close)
        self.request_number = 0

    def mcp(self, action, household=0, **kwargs):
        context = SimpleNamespace(headers={"authorization": f"Bearer {self.households[household]['mcp']}"})
        tool = M.mcp._tool_manager.get_tool("garden")
        result = asyncio.run(tool.run({"action": action, **kwargs}, context=context))
        return json.loads(result)

    def rest(self, action, *, request_id=None, **kwargs):
        self.request_number += 1
        response = self.client.post("/api/garden/actions", json={"actions": [
            {"action": action, "request_id": request_id or f"rest-{self.request_number}", **kwargs}]})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["results"][0]

    def plots(self):
        response = self.client.get("/api/garden/private")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["actor"]["kind"], "user")
        return response.json()["plots"]

    def plant_mushroom(self, plot_id):
        result = self.mcp("plant", plot_id=plot_id, crop_id="petite_oyster_mushroom", request_id=f"plant-{plot_id}")
        self.assertTrue(result["ok"], result)
        return result["result"]["plot"]["planting"]["planting_id"]

    def mature(self, plot_id, planting_id):
        # Actual v1 mushroom first harvest is 6 cultivation days. Keep proper
        # care at real six-hour intervals; no fixture injects mature batch state.
        for hour in (6, 12, 18):
            self.now = self.started + timedelta(hours=hour)
            result = self.mcp("care", plot_id=plot_id, planting_id=planting_id, request_id=f"care-{hour}-{plot_id}")
            self.assertTrue(result["ok"], result)
        self.now = self.started + timedelta(microseconds=(6 * 86400 * 1_000_000 + 6) // 7)

    def test_real_rest_mcp_plant_water_mature_steal_harvest_and_persistent_stock(self):
        plot_id = self.plots()[0]["id"]
        planting_id = self.plant_mushroom(plot_id)
        self.now += timedelta(hours=1)
        self.assertTrue(self.rest("water", plot_id=plot_id, planting_id=planting_id)["ok"])
        self.assertEqual(self.rest("harvest", plot_id=plot_id, planting_id=planting_id, batch_id="invented")["error"]["code"], "action_forbidden")
        self.assertEqual(self.mcp("steal", plot_id=plot_id, planting_id=planting_id, batch_id="invented", request_id="agent-steal")["error"]["code"], "action_forbidden")
        self.mature(plot_id, planting_id)
        self.now -= timedelta(microseconds=1)
        self.assertFalse(self.plots()[0]["planting"]["batches"])
        self.now += timedelta(microseconds=1)
        ready = self.plots()[0]
        batch = next(iter(ready["planting"]["batches"].values()))
        self.assertTrue(batch["steal_available"])
        self.assertFalse(batch["harvest_available"])
        self.assertIn("steal", ready["allowed_actions"])
        stolen = self.rest("steal", plot_id=plot_id, planting_id=planting_id, batch_id=batch["id"], request_id="steal-once")
        self.assertTrue(stolen["ok"], stolen)
        self.assertEqual(Fraction(stolen["result"]["credited_g"]), Fraction(batch["yield_g"], 2))
        replay = self.rest("steal", plot_id=plot_id, planting_id=planting_id, batch_id=batch["id"], request_id="steal-once")
        self.assertEqual(replay, stolen)
        self.assertEqual(self.client.get("/api/garden/progress").json()["completed_count"], 0)
        harvested = self.mcp("harvest", plot_id=plot_id, planting_id=planting_id, batch_id=batch["id"], request_id="harvest-once")
        self.assertTrue(harvested["ok"], harvested)
        self.assertEqual(Fraction(harvested["result"]["credited_g"]), Fraction(batch["yield_g"], 2))
        self.assertEqual(self.mcp("harvest", plot_id=plot_id, planting_id=planting_id, batch_id=batch["id"], request_id="harvest-once"), harvested)
        for owner in ("user", "agent"):
            stock = self.client.get(f"/api/garden/inventory?owner={owner}").json()
            self.assertEqual(len(stock["items"]), 1)
            self.assertEqual(Fraction(stock["items"][0]["quantity_g"]), Fraction(batch["yield_g"], 2))
        self.assertEqual(self.client.get("/api/garden/progress").json()["completed_crop_ids"], ["petite_oyster_mushroom"])
        self.assertFalse(self.plots()[0]["steal_available"])

    def test_real_four_plot_partial_success_and_request_id_conflict(self):
        private = self.plots()
        plot_id, empty_id = private[0]["id"], private[1]["id"]
        planting_id = self.plant_mushroom(plot_id)
        other = self.mcp("private", household=1)["result"]["plots"][0]
        self.mature(plot_id, planting_id)
        batch_id = next(iter(self.plots()[0]["planting"]["batches"]))
        payload = {"actions": [
            {"plot_id": plot_id, "planting_id": planting_id, "action": "water", "request_id": "batch-water"},
            {"plot_id": empty_id, "planting_id": "no-plant", "action": "water", "request_id": "batch-empty"},
            {"plot_id": plot_id, "planting_id": planting_id, "batch_id": batch_id, "action": "steal", "request_id": "batch-steal"},
            {"plot_id": other["id"], "action": "water", "request_id": "batch-foreign"},
        ]}
        response = self.client.post("/api/garden/actions", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        results = response.json()["results"]
        self.assertEqual([result["ok"] for result in results], [True, False, True, False])
        self.assertEqual(results[1]["error"]["code"], "empty_plot")
        self.assertEqual(results[3]["error"]["code"], "plot_not_found")
        stock_before = self.client.get("/api/garden/inventory").json()
        self.assertEqual(self.client.post("/api/garden/actions", json=payload).json(), response.json())
        self.assertEqual(self.client.get("/api/garden/inventory").json(), stock_before)
        conflict = self.rest("water", plot_id=empty_id, planting_id="other", request_id="batch-water")
        self.assertEqual(conflict["error"]["code"], "idempotency_conflict")
        self.assertEqual(conflict["error"]["status_code"], 409)


class GardenTickEntryTest(unittest.TestCase):
    def test_tick_delegates_once_and_closes_session(self):
        db = MagicMock()
        with patch.object(garden_tick, "SessionLocal", return_value=db), patch.object(S, "tick_all", return_value={"processed": 4}) as tick:
            self.assertEqual(garden_tick.run(), {"processed": 4})
        tick.assert_called_once_with(db)
        db.close.assert_called_once()
        db.commit.assert_not_called()

    def test_tick_failure_rolls_back_closes_and_signals_timer_failure(self):
        db = MagicMock()
        with patch.object(garden_tick, "SessionLocal", return_value=db), patch.object(S, "tick_all", side_effect=RuntimeError("tick failed")), \
             self.assertLogs(garden_tick.logger, level="ERROR"), self.assertRaises(RuntimeError):
            garden_tick.run()
        db.rollback.assert_called_once()
        db.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
