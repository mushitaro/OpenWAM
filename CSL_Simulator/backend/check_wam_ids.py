import re
import sys

def check_wam_integrity(filename):
    print(f"Checking {filename}...")
    try:
        with open(filename, 'r') as f:
            lines = f.readlines()
    except FileNotFoundError:
        print("File not found.")
        return

    # Strip comments and clean
    clean_lines = []
    for line in lines:
        l = line.split('<')[0].strip() # Remove labels
        if l:
            clean_lines.append(l)

    iterator = iter(clean_lines)
    
    def get_line():
        return next(iterator, None)
    
    # 1. Header
    try:
        # Version
        ver = get_line()
        print(f"Version: {ver}")
        
        # Independent
        indep = get_line()
        
        # General Data (Skip basics)
        # We need to reach "Number of Pipes"
        # Since format is fixed/strict, we must parse sequentially or search markers?
        # OpenWAM format is positional.
        
        # Let's count items roughly to find sections.
        # But verify_wam_ids is easier if we just parse the generated file structure known from generator.
        
        # Generator structure:
        # ...
        # [Pipe Count]
        # [Pipe 1] ...
        
        # Actually, let's look for the integer counts which are usually on their own lines?
        # No, "2200" is version.
        
        # Let's try to parse broadly.
        # Everything is numbers.
        
        # Hack strategy: Parse the file assuming we know the structure derived from wam_generator.py logic.
        # We know `wam_generator.py` writes specific blocks.
        
        # Skip header items (approx 20 lines)
        # We look for "Num Pipes" which is printed after Engine Block.
        # Engine block has "6" (Cyls), "2000 ...", Wiebe params...
        
        # Let's search for the line that specifies Pipe Count.
        # In `_generate`: `self.wam_lines.append(f"{self.pipe_counter - 1}")`
        # This comes after `_finalize_pipes`.
        # And after Engine / Controllers.
        
        # Let's just read the file into tokens and parse specifically.
        all_text = " ".join(clean_lines)
        tokens = all_text.split()
        it = iter(tokens)
        
        def next_token():
            return next(it)

        # Header skip matches generator output
        # 2200
        next_token() # 2200
        next_token() # 0 (Indep)
        next_token(); next_token() # 5.0 0.001
        next_token(); next_token() # P T
        next_token(); next_token() # 1 2
        
        has_engine = int(next_token()) # 1
        if has_engine == 1:
            # Engine Block
            next_token(); next_token(); next_token() # 0 0 0
            # Fuel
            next_token(); next_token() # 1 1
            # Atmos
            for _ in range(9): next_token()
            
            # ACT
            next_token() # 0
            
            # NCilin
            n_cyl = int(next_token()) # 6
            print(f"Num Cylinders: {n_cyl}")
            
            # RPM ...
            next_token(); next_token(); next_token()
            # Impose Comp
            next_token()
            # Comp 9
            for _ in range(9): next_token()
            # PAAE
            next_token()
            # Comb Type
            next_token()
            # Eq Ratio
            next_token()
            # Comb Eff ...
            next_token(); next_token(); next_token()
            # Pipe Ref
            next_token()
            # T Walls
            next_token(); next_token(); next_token()
            # Areas
            next_token(); next_token()
            # Wall Props (4x3=12)
            for _ in range(12): next_token()
            # Heat Transfer
            for _ in range(4): next_token()
            # Wall Temp Method
            next_token()
            # Woschni
            for _ in range(3): next_token()
            # Geometry (4 main)
            for _ in range(4): next_token()
            # Minor (12)
            for _ in range(12): next_token()
            # Friction
            for _ in range(4): next_token()
            
            # Comb Laws
            next_token() # 1
            # Law 1 Header
            for _ in range(3): next_token()
            # Num Wiebes
            next_token() # 1
            # Wiebe params (5)
            for _ in range(5): next_token()
            
            # Injection
            next_token() # 0
            # Phasing
            next_token() # 1
            # Cyl IDs
            for _ in range(n_cyl): next_token()
            
            # Controllers
            next_token() # 0
            # Cyl Controllers (n_cyl)
            for _ in range(n_cyl): next_token()

        # PIPES
        n_pipes = int(next_token())
        print(f"Num Pipes: {n_pipes}")
        
        pipe_ids = []
        node_ids_used = [] # (PipeID, NodeLeft, NodeRight)
        
        for i in range(n_pipes):
            # Pipe definition
            # ID (implicit 1..N ? No, file format assumes sequential? Or does it verify?)
            # OpenWAM usually implies Pipe i matches index i+1.
            # But the file contains data.
            # Format: NodeL NodeR NSecciones NConductos
            nl = int(next_token())
            nr = int(next_token())
            n_sec = int(next_token())
            n_ducts = int(next_token())
            
            pid = i + 1
            pipe_ids.append(pid)
            node_ids_used.append((pid, nl, nr))
            
            # Friction
            next_token()
            # Init State (4)
            for _ in range(4): next_token()
            # Heat (3)
            for _ in range(3): next_token()
            # Comp (9)
            for _ in range(9): next_token()
            # Mesh (2)
            next_token(); next_token()
            
            # Geometry
            # DExt0
            next_token()
            # Segments (n_sec)
            for _ in range(n_sec):
                # Len DExt1
                next_token(); next_token()
                
            # Ext Properties (3)
            for _ in range(3): next_token()
            
            # Layers
            n_layers = int(next_token())
            # If layers > 0 ...
            if n_layers > 0:
                print("WARNING: Layers > 0 not implemented in parser")
                
        # DPF
        n_dpf = int(next_token())
        print(f"Num DPF: {n_dpf}")
        
        # Concentrics
        n_conc = int(next_token())
        print(f"Num Concentrics: {n_conc}")
        
        # VALVES
        n_valves = int(next_token())
        print(f"Num Valves: {n_valves}")
        
        for i in range(n_valves):
            vtype = int(next_token())
            # Parse based on type
            # 1 = 4T, 7 = Intake?, 8 = Exhaust?
            # Generator uses: 1 (4T) and 0 (Fixed)
            
            if vtype == 1:
                # Header: Dia NumLev IncrRef OpenAngle RefDiam Swirl
                for _ in range(6): next_token()
                # Lift Profile (37)
                for _ in range(37): next_token()
                # CD Info: 10 0.0011 (2)
                next_token(); next_token()
                # CD In (10)
                for _ in range(10): next_token()
                # CD Out (10)
                for _ in range(10): next_token()
                # Swirl (10)
                for _ in range(10): next_token()
                # Control: Type(1) Val(1.0) Num(0)
                next_token(); next_token(); next_token()
                
            elif vtype == 0:
                # CDFijo: CDIn CDOut Ref(0)
                next_token(); next_token(); next_token()
                
        # PLENUMS
        n_plenums = int(next_token())
        print(f"Num Plenums: {n_plenums}")
        
        plenum_ids = []
        for i in range(n_plenums):
             # Type
            ptype = int(next_token())
            id_chk = i + 1
            plenum_ids.append(id_chk)
            
            if ptype == 0:
                # VolCte
                # 9 fractions
                for _ in range(9): next_token()
                # Vol Pres Temp
                next_token(); next_token(); next_token()
                
        # CONNECTIONS
        # Ignored?
        ignored = next_token() # 0
        n_cons = int(next_token())
        print(f"Num Connections: {n_cons}")
        # Next 9 ints (WAMer)
        for _ in range(9): next_token()
        
        con_ids = [] # (ID, Type, Val1, Val2)
        
        for i in range(n_cons):
            cid = i + 1
            ctype = int(next_token())
            
            # Read 2 values? depend on type
            # Generator uses:
            # 11 (Plenum-Pipe): 0 PlenumID
            # 7/8 (Valve): 0 CylID
            # 6 (Pipe-Pipe): 0.0 0.0
            
            v1 = next_token()
            v2 = next_token()
            
            con_ids.append((cid, ctype, v1, v2))
            
        print("Parsing Complete.")
        
        # CHECK UNIQUE IDs within categories
        # Pipe and Plenum IDs are sequential 1..N?
        # Verify Node Usage
        
        print("--- Verification ---")
        
        # Check Node IDs referenced by Pipes
        # pipes[i] has nodes NL, NR
        # These MUST correspond to a Connection ID (cid)
        
        max_cid = n_cons
        
        for pid, nl, nr in node_ids_used:
            if nl < 0 or nl > max_cid:
                print(f"ERROR: Pipe {pid} references invalid Left Node {nl} (Max {max_cid})")
            if nr < 0 or nr > max_cid:
                print(f"ERROR: Pipe {pid} references invalid Right Node {nr} (Max {max_cid})")
                
            if nl == 0 and nr == 0:
                 print(f"WARNING: Pipe {pid} is disconnected (0 0)")
            
            # Check for self-loop
            if nl == nr and nl != 0:
                 print(f"ERROR: Pipe {pid} connected to itself (Node {nl})")
                 
        print("Verification Done.")

    except StopIteration:
        print("Unexpected End Of File during parsing.")
    except Exception as e:
        print(f"Parsing Exception: {e}")
        import traceback
        traceback.print_exc()

check_wam_integrity('test_calib.wam')
