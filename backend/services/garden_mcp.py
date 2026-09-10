"""Garden transport adapter shared by the MCP tool and REST batch endpoint.

This module does not create actors from client input or run model calls. The
domain service owns transaction boundaries, permission checks and server time.
"""

import json
import logging

from pydantic import ValidationError

from schemas.garden import GardenAction, GardenActions, GardenInventoryQuery
from services import garden_service


logger = logging.getLogger(__name__)
READ_ACTIONS = ("status", "private", "public", "inventory", "progress")
AGENT_ACTIONS = (
    "plant", "water", "care", "harvest", "propose_clear", "consent_clear",
    "revoke_clear", "clear_dead_crop", "vote",
)
MAX_ACTIONS_JSON_LENGTH = 16_384


def error_result(code: str, detail: str, status_code: int) -> dict:
    return {"ok": False, "error": {"code": code, "detail": detail, "status_code": status_code}}


def service_error(exc) -> dict:
    return error_result(exc.code, exc.detail, exc.status_code)


def _validation_error(exc: ValidationError) -> dict:
    # Do not echo arbitrary rejected fields, values or credentials to logs.
    fields = [".".join(str(part) for part in error["loc"]) for error in exc.errors()]
    return error_result("invalid_request", "請檢查菜園參數：" + ", ".join(fields), 422)


def execute_actions(db, actor, actions: list[GardenAction]) -> dict:
    results = []
    for item in actions:
        try:
            result = garden_service.mutate(db, actor, **item.model_dump())
            results.append({"ok": True, "result": result})
        except garden_service.GardenError as exc:
            # The service rolls back domain errors itself. Defensive rollback
            # also leaves the session ready if an adapter is used in tests.
            db.rollback()
            results.append(service_error(exc))
        except Exception:
            db.rollback()
            logger.exception("Garden action failed")
            results.append(error_result("internal_error", "菜園暫時無法完成這個操作，請用原 request_id 重試", 500))
    return {"results": results}


def dispatch(db, user_id: str, *, action: str, actions_json: str = "", owner: str = "agent",
             limit: int = 100, offset: int = 0, **fields) -> dict:
    """Called only after MCP token verification; factory rechecks active owner."""
    try:
        actor = garden_service.actor_for_agent(db, user_id)
        if actions_json:
            if action != "actions":
                return error_result("invalid_request", "actions_json 請搭配 action=actions", 422)
            if len(actions_json) > MAX_ACTIONS_JSON_LENGTH:
                return error_result("invalid_request", "actions_json 太長", 422)
            if any(value is not None for value in fields.values()):
                return error_result("invalid_request", "批次模式請只在 actions_json 提供每筆動作參數", 422)
            try:
                payload = json.loads(actions_json)
            except (ValueError, TypeError):
                return error_result("invalid_request", "actions_json 必須是合法 JSON 陣列", 422)
            body = GardenActions.model_validate({"actions": payload})
            return execute_actions(db, actor, body.actions)
        if action == "actions":
            return error_result("invalid_request", "批次動作需要 actions_json", 422)
        if action in READ_ACTIONS:
            if any(value is not None for value in fields.values()):
                return error_result("invalid_request", "查詢不能夾帶動作參數", 422)
            if action in ("status", "private"):
                result = garden_service.get_private(db, actor)
            elif action == "public":
                result = garden_service.get_public(db, actor)
            elif action == "progress":
                result = garden_service.get_progress(db, actor)
            else:
                query = GardenInventoryQuery.model_validate({"owner": owner, "limit": limit, "offset": offset})
                result = garden_service.get_inventory(db, actor, **query.model_dump())
            return {"ok": True, "result": result}
        # Unknown and user-only business actions are passed to the same domain
        # permission checks as REST, preserving per-item behavior in batches.
        body = GardenAction.model_validate({"action": action, **{k: v for k, v in fields.items() if v is not None}})
        return execute_actions(db, actor, [body])["results"][0]
    except ValidationError as exc:
        return _validation_error(exc)
    except garden_service.GardenError as exc:
        db.rollback()
        return service_error(exc)
