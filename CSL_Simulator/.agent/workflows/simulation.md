---
description: OpenWAM simulation workflow — file generation, execution, result handling, and crash debugging procedures
---

# OpenWAM Simulation Workflow

## File Generation

// turbo

1. Generate WAM input file:

```
cd c:\Users\kazuh\OpenWAM\CSL_Simulator\backend
python -c "
import sys, io; sys.path.insert(0,'.')
from app.models import SimConfig
from app.simulator.wam_generator import WAMGenerator
config = SimConfig(rpm=XXXX, ro_percent=X.XX)
old=sys.stdout; sys.stdout=io.StringIO()
gen = WAMGenerator(config, output_dir='output')
content = gen.generate()
sys.stdout = old
print(f'Plenums: {len(gen.plenum_ids)}, Pipes: {len(gen.pipes)}')
with open('sim_XXXX_XX.wam','w') as f: f.write(content)
"
```

## Simulation Execution

2. Run OpenWAM:

```
$exe = 'c:\Users\kazuh\OpenWAM\build\bin\release\OpenWAM.exe'
$wam = 'c:\Users\kazuh\OpenWAM\CSL_Simulator\backend\sim_XXXX_XX.wam'
$out = 'c:\Users\kazuh\OpenWAM\CSL_Simulator\backend\sim_stdout.txt'
$err = 'c:\Users\kazuh\OpenWAM\CSL_Simulator\backend\sim_stderr.txt'
$proc = Start-Process -FilePath $exe -ArgumentList $wam -WorkingDirectory 'c:\Users\kazuh\OpenWAM\CSL_Simulator\backend' -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -Wait
Write-Output "Exit: $($proc.ExitCode)"
Get-Content $out -Tail 10
```

## CRITICAL: Result File Protection

// turbo
3. After a SUCCESSFUL run (Exit code = 0), IMMEDIATELY copy the INS file:

```
Copy-Item sim_XXXX_XXINS.DAT sim_XXXX_XX_GOOD_INS.DAT
```

NEVER re-run simulation with the same WAM filename without first protecting the INS file.
The INS output filename is derived from the WAM filename: `{wam_basename}INS.DAT`
A crashed simulation DELETES or CORRUPTS the INS file.

## Result Visualization

4. The flow field visualization script reads INS.DAT files.

- Pipe IDs in FLOW_PATH must match the current wam_generator topology.
- If wam_generator topology changed, re-run dump_ids.py and update FLOW_PATH.

## C++ Rebuild (when needed)

5. If C++ source in Source/ was modified:

```
cd c:\Users\kazuh\OpenWAM\build
cmake --build . --config Release 2>&1 | Select-Object -Last 5
```

## Known Crash Patterns

### "StudyInflowOutflowMass" Error

- Cause: Plenum gas mass reaches zero during blowdown or backflow
- Affected: Small plenums (ITB_Junction, Split_Plenum, ValvePocket, Port_Junct, H_Junc)
- Current workaround: Volume clamp at 50cc (0.00005 m3) in _add_plenum()
- THIS CLAMP IS THE ROOT CAUSE OF VE INACCURACY — see MODEL_SPEC.md

### "TTubo::Transforma2Area / NaN in pipe N" Error

- Cause: Numerical divergence in pipe boundary conditions
- Usually triggered by sonic flow at a Type 12 branch junction near valves
- Type 12 is ONLY stable at collector-level (3-header → 1-col_out) junctions
- DO NOT use Type 12 for valve-adjacent junctions (Split_Plenum, Port_Junct)

### "Sonic condition in boundary: N"

- Cause: Flow reaches Mach 1.0 at a boundary condition
- Often precedes NaN crash
- Check pipe diameter transitions and junction geometries

## RULES — DO NOT VIOLATE

1. NEVER overwrite a successful INS file by re-running simulation with the same WAM filename
2. ALWAYS git commit wam_generator.py BEFORE making topology changes
3. ALWAYS verify pipe/plenum counts after wam_generator changes (expected: 87 pipes, 48 plenums for current topology)
4. If crash occurs, check sim_stdout.txt FIRST — it contains the pipe ID and error type
5. DO NOT try to fix crashes by changing visualization code — they are generator/C++ issues
