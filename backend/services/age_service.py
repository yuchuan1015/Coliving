from datetime import datetime, timezone

# 年齡分級（女性健康中心用）；成人區只看 is_adult
TIER_ORDER = ["child", "teen", "adult"]
ADULT_AGE = 18
TEEN_AGE = 13


def age_of(birth_year: int | None) -> int | None:
    if not birth_year:
        return None
    return datetime.now(timezone.utc).year - birth_year


def age_to_tier(age: int) -> str:
    if age < TEEN_AGE:
        return "child"
    if age < ADULT_AGE:
        return "teen"
    return "adult"


def user_age_tier(birth_year: int | None) -> str | None:
    """依出生年推算分級。沒填出生年回 None。"""
    age = age_of(birth_year)
    return None if age is None else age_to_tier(age)


def is_adult(birth_year: int | None) -> bool:
    age = age_of(birth_year)
    return age is not None and age >= ADULT_AGE


def allowed_tiers(user_tier: str) -> list[str]:
    """使用者能看的分級：自己這級和更低的。"""
    idx = TIER_ORDER.index(user_tier)
    return TIER_ORDER[: idx + 1]


def can_access_tier(user_tier: str, article_tier: str) -> bool:
    return article_tier in allowed_tiers(user_tier)
