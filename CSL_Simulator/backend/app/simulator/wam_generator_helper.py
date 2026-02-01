
    def _generate_engine_block(self, c):
        # Matches TBloqueMotor::LeeMotor Order (OpenWAM v2.2)
        
        # 1. ACT Usage (0=No, 1=Yes)
        # We assume standard Wiebe (Non-ACT) for CSL
        self._add("0", "ACT=No")
        # If ACT=1, would read MixtureProcessCte. Skipped.
        
        # 2. Cylinders
        self._add(f"{c.engine.cylinders}", "Num Cylinders")
        
        # 3. Initial Conditions
        # FRegimen, FPresionInicialRCA, FMasaInicial
        # ImponerComposicionAE (0/1), FComposicionInicial...
        # TipoPresionAAE (0/1), FPresionAAE (if 1)
        
        p_init = 101325.0
        m_init = 0.0006 # Initial mass estimate
        
        # Regimen Presion Masa
        self._add(f"{c.engine.rpm} {p_init} {m_init}", "Initial: RPM Press Mass")
        
        # ImponerComposicionAE (0=False)
        self._add("0", "Impose Comp AE=0")
        
        # FComposicionInicial (Loop NumSpecies-1)
        # We need N-1 values (Rest is implicit)
        # BUT our air_comp string has 10/11 values?
        # NumSpecies=11. We need 10.
        # air_comp (updated to 11 values in Step 9570) -> 0.233 ... 0.0 (11 values).
        # We need 10. So strip the last one?
        # Or if air_comp has 11, and we print it all, we print 11 values.
        # OpenWAM reads 10. 1 is left over.
        # ISSUE!
        # If I output `self.air_comp` containing 11 values, I pollute the stream.
        # I MUST output exactly N-1 values.
        # Logic: Split air_comp, take N-1.
        
        # My updated air_comp has 11 values (0..10).
        # n_species = 11. Read 10.
        # So I should output first 10.
        ac_list = self.air_comp.strip().split()
        expected = len(ac_list) # 11
        to_write = expected - 1 # 10
        self._add(" ".join(ac_list[:to_write]), "Initial Composition")
        
        # TipoPresionAAE (0=Calc)
        self._add("0", "Calc AAE Pressure")
        # If 1, FPresionAAE. Skipped.
        
        # 4. Combustion Type
        # 0=MEC, 1=MEP. CSL=MEP.
        self._add("1", "Combustion=MEP")
        
        # 5. Fuel / Dosado
        if True: # MEP
            self._add("1.0", "Dosado")
        
        # 6. Efficiency & Fuel Props
        # Rend, LHV, Dens
        self._add("0.98 44000000 750", "Eff LHV Rho")
        
        # 7. Ref Pipe
        self._add("1", "Ref Pipe")
        
        # 8. Thermal Params
        # CyclesWithoutInertia (Assigned from Argument, NOT READ here usually?)
        # Wait, TBloqueMotor line 227: FNumero... = CiclosSinInerciaTermica.
        # Does input stream provide it?
        # TBloqueMotor.cpp line 103: `LeeMotor(..., int Ciclos..., ...)`
        # It comes from ARGUMENT.
        # Who calls LeeMotor? TOpenWAM.
        # TOpenWAM reads `CiclosSinInercia` in HEADER.
        # So it is NOT in Engine Block.
        
        # Temps: Piston Head Cyl
        self._add("500 450 400", "Temps")
        
        # Areas: Piston Head
        bore = c.engine.geometry.bore / 1000.0
        area = math.pi * (bore/2.0)**2
        self._add(f"{area:.6f} {area*1.1:.6f}", "Areas")
        
        # Wall Props: Piston(4), Head(4), Cyl(4) (Thick, Cond, Dens, Cp)
        self._add("0.01 150 2700 900", "Wall Piston")
        self._add("0.01 150 2700 900", "Wall Head")
        self._add("0.005 50 7800 500", "Wall Cyl")
        
        # Adjustments: 4 vars
        self._add("1.0 1.0 1000.0 350.0", "Heat Transfer Adj")
        
        # Wall Temp Calc (2=Fixed)
        self._add("2", "Wall Temp Calc")
        
        # 9. Woschni
        self._add("2.28 0.00324 0.0", "Woschni Params")
        
        # 10. Geometry (16 vars)
        rod = c.engine.geometry.rod_length / 1000.0
        stroke = c.engine.geometry.stroke / 1000.0
        # bore already calc
        cr = c.engine.geometry.compression_ratio
        # BowlD, BowlH, DistValv, BlowByA, BlowByCD, Ecc, PinD, CrownH, RodMass, PistMass, ModElast, CoefDef
        geom_line = f"{rod:.4f} {stroke:.4f} {bore:.4f} {cr:.2f} 0.0 0.0 0.0 0.0001 0.8 0.0 0.0 0.0 0.5 0.4 2.1e11 0.0"
        self._add(geom_line, "Geometry")
        
        # 11. Mechanical Losses (4 vars)
        self._add("0.1 0.0 0.0 0.0", "Mech Losses")
        
        # 12. Vehicle Model (Only if Transient)
        # We set `SimulationType = nmTransitorioRegimen` ONLY if Engine Controller Param 0 is read.
        # But we haven't reached proper Controller reading yet?
        # Wait, Controller reading is at step 16.
        # Step 12 depends on `SimulationType`.
        # `SimulationType` passed as ARGUMENT reference.
        # Initial value?
        # `TOpenWAM::LeeDatos`: `SimulationType` read from Header?
        # Header: `1 2` (Species). `1` (Engine). `0 0 0` (Cycle, Model, EGR).
        # `Model` = 0 (Steady).
        # So `SimulationType` starts as 0.
        # So Step 12 (Vehicle) is SKIPPED.
        
        # 13. Injection (If ACT... No, we are Non-ACT)
        # 13b. Heat Release (Wiebe)
        # Num Laws
        self._add("1", "Num Heat Laws")
        # Law 1: ma, mf, n
        self._add("1.0 1.0 2000.0", "Heat Law logic")
        # Num Wiebes
        self._add("1", "Num Wiebes")
        # m, C, Beta, IncAlpha, Alpha0
        # Typical S54: Duration ~60?
        self._add("2.0 6.9 0.0 60.0 -15.0", "Wiebe Params")
        
        # 14. Injections (Data)
        # TipoDatosIny (0=None)
        self._add("0", "Injection Data Type (0=None)")
        
        # 15. Cylinder Objects (Desfase)
        if c.engine.cylinders > 1:
            # Type Desfase (0=Custom, 1=Even)
            self._add("1", "Firing Order Type (1=Even)")
            # If 1: Reads Cilindro Reference?
            # `FileInput >> cil;`. Loop NCilin.
            # Usually we list 1, 5, 3, 6, 2, 4
            self._add("1 5 3 6 2 4", "Firing Order")
        else:
            # If 1 cyl, no desfase data read?
            # "else { FDesfase[0] = 0.; }"
            pass
            
        # 16. Controllers
        # NumControllers
        # NOTE: This defines `Engine Speed Controller` (Param 0).
        # If we define this, FRegimen is overridden.
        # AND SimulationType becomes Transient.
        # BUT Vehicle Model logic (Step 12) was already passed.
        # So we don't need to provide Vehicle Data here.
        
        # My Controller Logic:
        # If schedule exists -> 1 Controller (Param 0 -> ID 1).
        # This is where `Num Engine Controllers` goes.
        
        # We need to access schedule.
        # I'll pass schedule to this method.
        pass 
