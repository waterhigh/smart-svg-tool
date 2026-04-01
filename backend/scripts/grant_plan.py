from __future__ import annotations

import argparse
import sys
from pathlib import Path


CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]
PROJECT_DIR = BACKEND_DIR.parent

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app import crud, database  # noqa: E402
from app.plans import FOUNDER_PLAN, FREE_PLAN, PRO_PLAN, get_plan_label, normalize_email  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Grant a plan to an existing user by email.",
    )
    parser.add_argument("--email", required=True, help="Registered user email")
    parser.add_argument(
        "--plan",
        default=FOUNDER_PLAN,
        choices=[FREE_PLAN, FOUNDER_PLAN, PRO_PLAN],
        help="Plan code to grant",
    )
    parser.add_argument(
        "--note",
        default="Founder Lifetime Basic - 24.9 RMB",
        help="Optional internal note stored with the grant",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    database.ensure_schema()

    with database.SessionLocal() as db:
        user = crud.get_user_by_email(db, args.email)
        if user is None:
            print(
                f"User not found for email: {normalize_email(args.email)}",
                file=sys.stderr,
            )
            return 1

        updated_user = crud.update_user_plan(
            db=db,
            user=user,
            plan=args.plan,
            note=args.note,
        )

    print(
        f"Granted {get_plan_label(updated_user.plan)} to {updated_user.email}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
