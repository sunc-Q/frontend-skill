#!/bin/sh
# Run under the skill's with_server.py, which owns the two http.server processes:
#   8137 -> demos/20260925-1810-algorithmic-art   (golden artefact, read-only)
#   8138 -> .tmp/serve                            (the two mutants from build_mutants.py)
# Expect: golden 16 PASS (minus whatever the page really fails), and each mutant
# flipping exactly the assertions it was built to break.
D=demos/20260926-1037-webapp-testing
python3 $D/e2e_art.py --url http://127.0.0.1:8137/art-index.html --mode golden \
  --shots $D/shots --download-dir $D
python3 $D/e2e_art.py --url http://127.0.0.1:8138/mutant_seed.html --mode mutant_seed \
  --shots $D/shots-mutants --download-dir $D
python3 $D/e2e_art.py --url http://127.0.0.1:8138/mutant_wiring.html --mode mutant_wiring \
  --shots $D/shots-mutants --download-dir $D
