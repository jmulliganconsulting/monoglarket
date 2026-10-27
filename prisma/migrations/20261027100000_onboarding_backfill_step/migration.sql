-- Members backfilled as onboarded are on the last screen, so the screens refuse to run again.
UPDATE "users" SET "onboarding_step" = 6 WHERE "onboarded_at" IS NOT NULL;
