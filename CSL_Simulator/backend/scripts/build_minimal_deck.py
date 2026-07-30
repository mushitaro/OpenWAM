#!/usr/bin/env python
"""Stage 85: splice a MINIMAL, isolated pipe network into a working engine deck.

Why this exists. Stage 80-84 hunted the intake's mass fabrication inside the
93-pipe engine deck and got the attribution wrong ten times, because every
element there is coupled to every other. This builder adds a small subnetwork
that shares nothing with the engine except the solver, so one feature can be
added at a time with the existing OPENWAM_MASS_AUDIT reading it unchanged.

The bisection it produced (see EXHAUST_STABILIZATION_NOTES Stage 85):
  quiescent 2-pipe .............. machine-exact (M bit-identical, fluxes 0)
  Sod 2-pipe through a Type-6 ... 0.014% with real flow -> Type-6 is sound
  driven by the engine .......... 0.01-0.03%
  + 10:1 mesh mismatch .......... 0.03-0.11%
  Type-12 three-pipe tee ........ 0.23-0.33%  (200x the Type-6)
  CLOSED LOOP ................... collapses in 3 cycles, 6 kg/s circulation
=> the fabrication needs the LOOP, not a defective element.

Run the emitted deck straight through the solver (it needs intake.vlv and
exhaust.vlv beside it, copied from the source deck's directory):
  OMP_NUM_THREADS=1 OPENWAM_HLLC=1 OPENWAM_MASS_AUDIT=1 OPENWAM_FAST_OUTPUT=1 \
    OPENWAM_THR_CHOKE=1 OPENWAM_VEDIAG=1 OpenWAM.exe <deck>.wam
and read the MASSAUDIT lines for the added pipe ids.
"""
import io, os, sys

def splice(src, out, pipes, plenums, conns, cycles=12):
    """pipes: list of 9-line blocks. plenums: list of 3-line blocks.
    conns: flat list of connection lines, in cid order, appended after the
    existing ones. Pipe/plenum/connection COUNTS are rewritten to match."""
    L = io.open(src, encoding="utf-8", errors="replace").read().splitlines()
    ip = next(i for i, l in enumerate(L)
              if l.strip().isdigit() and L[i + 1].strip() == "1 2 1 1")
    npipe = int(L[ip]); pe = ip + 1 + npipe * 9
    ipl = next(i for i, l in enumerate(L)
               if l.strip().isdigit() and L[i + 1].strip() == "0 0 0")
    nplen = int(L[ipl]); ple = ipl + 2 + nplen * 3
    ic = next(i for i, l in enumerate(L)
              if l.strip().isdigit() and L[i + 1].strip() == "0 0 0 0 0 0 0 0 0")
    nconn = int(L[ic])
    ia = next(i for i, l in enumerate(L) if l.strip() == "0 0 0.0 1.0")
    ce = ia - 2                                   # end of the connection list
    assert L[ce].strip() == "0" and L[ia - 1].strip() == "1", "sensor anchor moved"
    n_new_conn = sum(1 for x in conns if x.strip().isdigit() and len(x.split()) == 1
                     and x.strip() in ("3", "6", "11", "12", "10", "0", "4", "5"))
    res = (L[:ip] + [str(npipe + len(pipes) // 9)] + L[ip + 1:pe] + pipes
           + L[pe:ipl] + [str(nplen + len(plenums) // 3)] + L[ipl + 1:ple] + plenums
           + L[ple:ic] + [str(nconn + n_new_conn)] + L[ic + 1:ce] + conns + L[ce:])
    res[2] = f"1.0 {cycles}"                      # shorten the engine run
    io.open(out, "w", encoding="utf-8", newline="\n").write("\n".join(res) + "\n")
    return npipe + 1, nplen + 1, nconn         # first new pipe / plenum / cid

def pipe(nl, nr, length, dia, dx, p_bar=1.013250, t_c=20.0, comp=None, fric="0.0"):
    """9-line pipe block. friction 0 and the '1 0.0 0.0' multipliers give pure
    Euler, so any mass drift is numerical, not physical."""
    return [f"{nl} {nr} 1 1", fric, f"{t_c:.4f} {t_c:.4f} {p_bar:.6f} 0.0000",
            "1 0.0 0.0", comp, f"{dx:.5f} 2", "2 0.8", f"{dia}", f"{length} {dia}"]

def plenum(vol_m3, p_bar=1.013250, t_c=20.0, comp=None):
    return ["0", comp, f"{vol_m3:.5f} {p_bar:.6f} {t_c:.2f}"]

def air_comp(src):
    L = io.open(src, encoding="utf-8", errors="replace").read().splitlines()
    ip = next(i for i, l in enumerate(L)
              if l.strip().isdigit() and L[i + 1].strip() == "1 2 1 1")
    return L[ip + 1 + 4]

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    src = sys.argv[1] if len(sys.argv) > 1 else \
        "calib_data/stage80_acoustics/_run_s82_char_2400/cell.wam"
    c = air_comp(src)
    # the decisive case: a closed loop (3 mains + 2 stubs + 1 rail, three T12)
    p = (pipe(105, 106, 0.25, 0.05, 0.005, comp=c)      # main1  T11amb -> T12A
         + pipe(106, 107, 0.25, 0.05, 0.005, comp=c)    # main2  T12A   -> T12B
         + pipe(107, 108, 0.25, 0.05, 0.005, comp=c)    # main3  T12B   -> T11 airbox
         + pipe(106, 109, 0.030, 0.030, 0.015, comp=c)  # stub1  T12A   -> T12C
         + pipe(107, 109, 0.030, 0.030, 0.015, comp=c)  # stub2  T12B   -> T12C
         + pipe(109, 110, 0.114, 0.021, 0.025, comp=c)) # rail   T12C   -> T11 tiny
    pl = plenum(1000.0, comp=c) + plenum(0.001, comp=c)
    cn = ["11", "0 9", "25", "12", "12", "11", "0 2", "25", "12", "11", "0 10", "25"]
    os.makedirs("calib_data/shocktube", exist_ok=True)
    ids = splice(src, "calib_data/shocktube/loop.wam", p, pl, cn)
    print(f"wrote calib_data/shocktube/loop.wam  (first new pipe {ids[0]}, "
          f"plenum {ids[1]}, cid {ids[2]})")
