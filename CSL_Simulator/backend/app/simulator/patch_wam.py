
import re

path = r"C:\Users\kazuh\OpenWAM\CSL_Simulator\backend\app\simulator\wam_generator.py"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace calls: _add_con_plenum_pipe( -> _add_con_plenum_pipe_v2(
# We use regex to match word boundary or ensure we don't double patch.
# Pattern: _add_con_plenum_pipe(
# But NOT _add_con_plenum_pipe_v2(
# Since _v2 contains the string, we check if character after 'pipe' is '('.

# Regex: _add_con_plenum_pipe\(
# If matches, replace with _add_con_plenum_pipe_v2(
# But we must ensure it's not already _v2.
# Actually, if text is `_add_con_plenum_pipe_v2(`, the sequence `_add_con_plenum_pipe(` is NOT present? 
# "pipe" is followed by "_".
# So `_add_con_plenum_pipe\(` strictly matches the OLD call.

new_content = re.sub(r"_add_con_plenum_pipe\(", "_add_con_plenum_pipe_v2(", content)

# Also check for _add_con_plenum_valve_pipe(
# I renamed definition to v2.
# So replace calls too.
new_content = re.sub(r"_add_con_plenum_valve_pipe\(", "_add_con_plenum_valve_pipe_v2(", new_content)

# Also check for _add_con_valve(
# Rename logic: _add_con_valve( -> _add_con_valve_v2(
new_content = re.sub(r"_add_con_valve\(", "_add_con_valve_v2(", new_content)

with open(path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("Patch applied (Inc Valves).")
