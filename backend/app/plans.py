from __future__ import annotations

FREE_PLAN = "free"
FOUNDER_PLAN = "founder"
PRO_PLAN = "pro"

PLAN_LABELS = {
    FREE_PLAN: "Free",
    FOUNDER_PLAN: "Founder Lifetime Basic",
    PRO_PLAN: "Pro",
}

BASIC_ACCESS_PLANS = {FOUNDER_PLAN, PRO_PLAN}
ADVANCED_ACCESS_PLANS = {PRO_PLAN}
LIFETIME_PLANS = {FOUNDER_PLAN}


def normalize_email(email: str) -> str:
    return email.strip().lower()


def normalize_plan(plan: str | None) -> str:
    candidate = (plan or FREE_PLAN).strip().lower()
    if candidate in PLAN_LABELS:
        return candidate
    return FREE_PLAN


def get_plan_label(plan: str | None) -> str:
    normalized = normalize_plan(plan)
    return PLAN_LABELS.get(normalized, PLAN_LABELS[FREE_PLAN])


def has_basic_access(plan: str | None) -> bool:
    return normalize_plan(plan) in BASIC_ACCESS_PLANS


def has_advanced_access(plan: str | None) -> bool:
    return normalize_plan(plan) in ADVANCED_ACCESS_PLANS


def is_lifetime_plan(plan: str | None) -> bool:
    return normalize_plan(plan) in LIFETIME_PLANS
