#include "1DPipes/TTubo.h"
#include "Boundaries/TCCCilindro.h"
#include "Connections/TValvula4T.h"
#include "Engine/TBloqueMotor.h"
#include "ODModels/TDepVolCte.h"
#include "ODModels/TDeposito.h"
#include "TOpenWAM.h"
#include <memory>
#include <vector>


void TestBuilder() {
  TOpenWAM Sim;

  // 1. Create Engine
  auto Engine = std::make_unique<TBloqueMotor>(1.0, 298.0, nmCalculoCompleto, 7,
                                               nmGammaVariable, false);
  Engine->Configure(6, nm4T, 0.087, 0.091, 0.150, 11.5, 8000.0);
  Engine->SetWiebeCombustion(6.9, 2.0, 60.0, -15.0);
  TBloqueMotor *pEngine = Engine.get();
  Sim.AddEngine(std::move(Engine));

  // 2. Create Pipe (Runner)
  auto Runner = std::make_unique<TTubo>(
      7, 1, 0.1, std::vector<std::unique_ptr<TBloqueMotor>>(),
      nmCalculoCompleto, nmGammaVariable, false);
  Runner->Configure(1, 2, 0.3, 0.04, 0.04, 0.005, 350.0, 0.01, 30);
  TTubo *pRunner = Runner.get();
  Sim.AddPipe(std::move(Runner));

  // 3. Create Plenum
  auto Plenum = std::make_unique<TDepVolCte>(1, nmCalculoCompleto, 7,
                                             nmGammaVariable, false);
  Plenum->Configure(0.002, 300.0, 1.0);
  Sim.AddPlenum(std::move(Plenum));

  // 4. Create Valve Prototype
  auto ValveProto = std::make_unique<TValvula4T>();
  ValveProto->Configure(0.035, 0.01, 240.0, 350.0);
  TTipoValvula *pValve = ValveProto.get();

  // 5. Create Connection (Cylinder Intake)
  auto Conn = std::make_unique<TCCCilindro>(nmIntakeValve, 1, nmCalculoCompleto,
                                            7, nmGammaVariable, false);
  Conn->Configure(pRunner, true, pEngine, 1, pValve);
  Sim.AddConnection(std::move(Conn));

  // Success
}
