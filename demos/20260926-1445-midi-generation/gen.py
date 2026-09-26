#!/usr/bin/env python3
"""Glue: feed composition.json through the midi-agent-skill's own scripts (normalize -> refine -> generate)."""
import json
import sys
from pathlib import Path

SKILL = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(SKILL))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / ".tmp" / "mlib"))

from skills.normalize_composition import normalize_composition  # noqa: E402
from skills.refine_composition import refine_composition  # noqa: E402
from skills.generate_midi import generate_midi  # noqa: E402

data = json.loads(Path(sys.argv[2]).read_text())
comp = normalize_composition(data)
comp = refine_composition(comp, min_notes=4)  # no-op here; keeps every track >= 4 notes
out = generate_midi(comp)
print(out)
