#!/bin/bash
# Single source of truth for Playwright browser setup. Installs the
# Chromium binary Playwright needs at runtime. The required system
# libraries (glib, nss, atk, cups, dbus, mesa, xorg.*, fontconfig,
# freetype, pango, cairo, alsa-lib, libgbm, libxkbcommon, libdrm,
# libGL, libglvnd, expat, at-spi2-*) are declared in replit.nix so
# they're guaranteed to be present on every container.
#
# Called from:
#  - scripts/post-merge.sh (best-effort before the e2e suite runs)
#  - e2e/package.json `pretest` hook so a fresh clone can run
#    `pnpm --filter @workspace/e2e test` and it just works
#
# Idempotent: `playwright install` is a no-op when the binary is
# already on disk. First run on a fresh machine pulls ~120 MiB.
set -e

# We deliberately do NOT pass --with-deps. The nix-based Replit
# container can't `apt-get install` system libs (no apt, no root);
# the libs come from replit.nix instead. --with-deps would just
# print a noisy "not supported" warning and exit non-zero on some
# Playwright versions.
pnpm --filter @workspace/e2e exec playwright install chromium
