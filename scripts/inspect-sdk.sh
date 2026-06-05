#!/bin/bash
# Run this from your project root: bash scripts/inspect-sdk.sh
# It prints everything we need to know about the installed OOBE SDK
# to fix the import error and the missing SapConnection export.

PKG="node_modules/@oobe-protocol-labs/synapse-sap-sdk"

echo "════════════════════════════════════════════════════════"
echo "1. Package version + exports field in package.json"
echo "════════════════════════════════════════════════════════"
node -e "
  const p = require('./${PKG}/package.json');
  console.log('version:', p.version);
  console.log('main:', p.main);
  console.log('module:', p.module);
  console.log('types:', p.types);
  console.log('exports:', JSON.stringify(p.exports, null, 2));
"

echo ""
echo "════════════════════════════════════════════════════════"
echo "2. Top-level dist directory structure"
echo "════════════════════════════════════════════════════════"
ls ${PKG}/dist/ 2>/dev/null || echo "(no dist/ folder)"
echo ""
ls ${PKG}/dist/cjs/ 2>/dev/null | head -20 || echo "(no dist/cjs/)"
echo ""
ls ${PKG}/dist/esm/ 2>/dev/null | head -20 || echo "(no dist/esm/)"

echo ""
echo "════════════════════════════════════════════════════════"
echo "3. What does the package actually export at the top level?"
echo "════════════════════════════════════════════════════════"
node -e "
  try {
    const sdk = require('./${PKG}');
    console.log('Named exports:', Object.keys(sdk));
  } catch(e) {
    console.log('require() failed:', e.message);
  }
"

echo ""
echo "════════════════════════════════════════════════════════"
echo "4. Does SapConnection exist anywhere in the package?"
echo "════════════════════════════════════════════════════════"
grep -r "SapConnection" ${PKG}/dist/ 2>/dev/null | grep -v ".map" | head -10 || echo "SapConnection not found in dist/"
grep -r "SapConnection" ${PKG}/src/  2>/dev/null | grep -v ".map" | head -10 || echo "SapConnection not found in src/"

echo ""
echo "════════════════════════════════════════════════════════"
echo "5. What IS exported — search for 'export' in CJS index"
echo "════════════════════════════════════════════════════════"
cat ${PKG}/dist/cjs/index.js 2>/dev/null | grep "exports\." | head -30 \
  || cat ${PKG}/dist/index.js 2>/dev/null | grep "exports\." | head -30 \
  || echo "Cannot find CJS index"

echo ""
echo "════════════════════════════════════════════════════════"
echo "6. skills.md (contains real usage examples)"
echo "════════════════════════════════════════════════════════"
cat ${PKG}/skills/skills.md 2>/dev/null | head -120 || echo "No skills.md found"