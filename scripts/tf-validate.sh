#!/usr/bin/env bash
# Terraform hygiene gate (gap #21): `terraform fmt -check` + `validate`
# for the root module and every module dir under infra/terraform/modules.
#
# Skips cleanly (exit 0, message) when terraform is not installed, so the
# script is safe in minimal dev environments; CI should install terraform
# (hashicorp/setup-terraform) so the gate is real there.
#
# Usage: bash scripts/tf-validate.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_ROOT="$ROOT/infra/terraform"

if ! command -v terraform >/dev/null 2>&1; then
  echo "terraform not found — skipping tf-validate (install terraform to enable)"
  exit 0
fi

dirs=("$TF_ROOT")
if [ -d "$TF_ROOT/modules" ]; then
  for d in "$TF_ROOT"/modules/*/; do
    [ -d "$d" ] && dirs+=("$d")
  done
fi

fail=0
for dir in "${dirs[@]}"; do
  echo "── $dir"
  if ! terraform -chdir="$dir" fmt -check -diff; then
    echo "  fmt FAILED"
    fail=1
  fi
  # validate needs an initialized working dir; -backend=false keeps it offline.
  if ! terraform -chdir="$dir" init -backend=false -input=false -no-color >/dev/null; then
    echo "  init FAILED"
    fail=1
    continue
  fi
  if ! terraform -chdir="$dir" validate -no-color; then
    echo "  validate FAILED"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "tf-validate: OK (${#dirs[@]} module dirs)"
fi
exit "$fail"
