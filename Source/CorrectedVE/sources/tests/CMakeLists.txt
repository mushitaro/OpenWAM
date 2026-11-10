add_executable(junction_species_flux_test junction_species_flux_test.cpp)
target_include_directories(junction_species_flux_test PRIVATE
    ${PROJECT_SOURCE_DIR}/Source/Boundaries)
add_test(NAME junction_species_flux COMMAND junction_species_flux_test)

add_executable(cylinder_species_layout_test cylinder_species_layout_test.cpp)
target_include_directories(cylinder_species_layout_test PRIVATE
    ${PROJECT_SOURCE_DIR}/Source/Engine)
add_test(NAME cylinder_species_layout COMMAND cylinder_species_layout_test)

add_executable(nonreactive_species_sources_test nonreactive_species_sources_test.cpp)
target_include_directories(nonreactive_species_sources_test PRIVATE
    ${PROJECT_SOURCE_DIR}/Source/Engine)
add_test(NAME nonreactive_species_sources COMMAND nonreactive_species_sources_test)

add_executable(consistent_species_flux_test consistent_species_flux_test.cpp)
target_include_directories(consistent_species_flux_test PRIVATE
    ${PROJECT_SOURCE_DIR}/Source/1DPipes)
add_test(NAME consistent_species_flux COMMAND consistent_species_flux_test)
add_executable(pipe_species_budget_test pipe_species_budget_test.cpp)
target_include_directories(pipe_species_budget_test PRIVATE ${PROJECT_SOURCE_DIR}/Source/1DPipes)
add_test(NAME pipe_species_budget COMMAND pipe_species_budget_test)
add_executable(valve_exchange_audit_test valve_exchange_audit_test.cpp)
target_include_directories(valve_exchange_audit_test PRIVATE ${PROJECT_SOURCE_DIR}/Source/Engine)
add_test(NAME valve_exchange_audit COMMAND valve_exchange_audit_test)
add_executable(conservative_pipe_volume_test conservative_pipe_volume_test.cpp)
target_include_directories(conservative_pipe_volume_test PRIVATE ${PROJECT_SOURCE_DIR}/Source/Boundaries)
add_test(NAME conservative_pipe_volume COMMAND conservative_pipe_volume_test)
add_executable(conservative_nozzle_test conservative_nozzle_test.cpp)
target_include_directories(conservative_nozzle_test PRIVATE ${PROJECT_SOURCE_DIR}/Source/Boundaries)
add_test(NAME conservative_nozzle COMMAND conservative_nozzle_test)
add_executable(conservative_pipe_nozzle_test conservative_pipe_nozzle_test.cpp)
target_include_directories(conservative_pipe_nozzle_test PRIVATE ${PROJECT_SOURCE_DIR}/Source/Boundaries)
add_test(NAME conservative_pipe_nozzle COMMAND conservative_pipe_nozzle_test)
add_executable(sensible_mixture_test sensible_mixture_test.cpp)
target_include_directories(sensible_mixture_test PRIVATE
    ${PROJECT_SOURCE_DIR}/Source/Engine ${PROJECT_SOURCE_DIR}/Source/Includes
    ${PROJECT_SOURCE_DIR}/Source/Math_wam ${PROJECT_SOURCE_DIR}/Source/Labels
    ${PROJECT_SOURCE_DIR}/Source/Wrappers)
add_test(NAME sensible_mixture COMMAND sensible_mixture_test)
add_executable(thermal_nozzle_test thermal_nozzle_test.cpp)
target_include_directories(thermal_nozzle_test PRIVATE ${PROJECT_SOURCE_DIR}/Source/Boundaries)
add_test(NAME thermal_nozzle COMMAND thermal_nozzle_test)
add_executable(thermal_wave_test thermal_wave_test.cpp)
target_include_directories(thermal_wave_test PRIVATE ${PROJECT_SOURCE_DIR}/Source/Boundaries)
add_test(NAME thermal_wave COMMAND thermal_wave_test)
add_executable(thermal_pipe_nozzle_test thermal_pipe_nozzle_test.cpp)
target_include_directories(thermal_pipe_nozzle_test PRIVATE ${PROJECT_SOURCE_DIR}/Source/Boundaries)
add_test(NAME thermal_pipe_nozzle COMMAND thermal_pipe_nozzle_test)
add_executable(thermal_pipe_volume_test thermal_pipe_volume_test.cpp)
target_include_directories(thermal_pipe_volume_test PRIVATE ${PROJECT_SOURCE_DIR}/Source/Boundaries)
add_test(NAME thermal_pipe_volume COMMAND thermal_pipe_volume_test)
add_executable(thermal_engine_adapter_test thermal_engine_adapter_test.cpp)
add_test(NAME thermal_engine_adapter COMMAND thermal_engine_adapter_test)
add_executable(thermal_cylinder_network_test thermal_cylinder_network_test.cpp)
add_test(NAME thermal_cylinder_network COMMAND thermal_cylinder_network_test)
add_executable(thermal_duct_network_test thermal_duct_network_test.cpp)
add_test(NAME thermal_duct_network COMMAND thermal_duct_network_test)
add_executable(thermal_massless_junction_test thermal_massless_junction_test.cpp)
file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/Testing/thermal_massless_junction)
add_test(NAME thermal_massless_junction COMMAND thermal_massless_junction_test ${CMAKE_BINARY_DIR}/Testing/thermal_massless_junction)
add_executable(thermal_two_pipe_valve_test thermal_two_pipe_valve_test.cpp)
file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/Testing/thermal_two_pipe_valve)
add_test(NAME thermal_two_pipe_valve COMMAND thermal_two_pipe_valve_test ${CMAKE_BINARY_DIR}/Testing/thermal_two_pipe_valve)
add_executable(thermal_cost_benchmark EXCLUDE_FROM_ALL thermal_cost_benchmark.cpp)
add_executable(thermal_area_change_test thermal_area_change_test.cpp)
file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/Testing/thermal_area_change)
add_test(NAME thermal_area_change COMMAND thermal_area_change_test ${CMAKE_BINARY_DIR}/Testing/thermal_area_change)
add_executable(thermal_equivalence_probe EXCLUDE_FROM_ALL thermal_equivalence_probe.cpp)
add_executable(thermal_intake_adapter_test thermal_intake_adapter_test.cpp)
file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/Testing/thermal_intake_adapter)
add_test(NAME thermal_intake_adapter COMMAND thermal_intake_adapter_test ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_intake_fixture.txt ${CMAKE_BINARY_DIR}/Testing/thermal_intake_adapter)

add_executable(thermal_intake_cost_probe EXCLUDE_FROM_ALL thermal_intake_cost_probe.cpp)
add_executable(thermal_intake_profile_probe EXCLUDE_FROM_ALL thermal_intake_cost_probe.cpp)
target_compile_definitions(thermal_intake_profile_probe PRIVATE OPENWAM_THERMAL_COST_PROFILE=1)

add_executable(thermal_native_control_test thermal_native_control_test.cpp)
add_test(NAME thermal_native_control COMMAND thermal_native_control_test)

add_executable(thermal_initial_replay thermal_initial_replay.cpp)
foreach(initial_case base3100 base3900 cam3900)
    add_test(NAME thermal_initial_${initial_case} COMMAND thermal_initial_replay
        ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_initial/${initial_case}.txt)
endforeach()

add_executable(thermal_full_network_contract_test thermal_full_network_contract_test.cpp)
add_test(NAME thermal_full_network_contract COMMAND thermal_full_network_contract_test
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_full_fixture.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/base3900_ports.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_full/base3900_network.txt)
file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/Testing/thermal_full)
add_test(NAME thermal_full_network_probe COMMAND thermal_driven_intake_replay
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_full_fixture.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/base3900_ports.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_full/base3900_network.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_drive/base3900_drive_probe.txt
    ${CMAKE_BINARY_DIR}/Testing/thermal_full/probe.csv .3 1 --full-network)
add_executable(thermal_native_intake_replay thermal_native_intake_replay.cpp)
add_executable(thermal_driven_intake_replay thermal_driven_intake_replay.cpp)
add_executable(thermal_full_h_replay EXCLUDE_FROM_ALL thermal_full_h_replay.cpp)
if(BUILD_PARALLEL AND OpenMP_CXX_FOUND)
    add_executable(thermal_full_h_parallel_replay EXCLUDE_FROM_ALL thermal_full_h_replay.cpp)
    target_compile_definitions(thermal_full_h_parallel_replay PRIVATE OPENWAM_H_PARALLEL_RUNNER=1)
    target_link_libraries(thermal_full_h_parallel_replay PRIVATE OpenMP::OpenMP_CXX)
    add_executable(thermal_duct_parallel_test thermal_duct_parallel_test.cpp)
    target_link_libraries(thermal_duct_parallel_test PRIVATE OpenMP::OpenMP_CXX)
    file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/Testing/thermal_parallel)
    add_test(NAME thermal_duct_parallel COMMAND thermal_duct_parallel_test
        ${CMAKE_BINARY_DIR}/Testing/thermal_parallel/serial_state.txt)
endif()
add_executable(thermal_h_selection_test thermal_h_selection_test.cpp)
add_test(NAME thermal_h_selection COMMAND thermal_h_selection_test
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_full_fixture.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/base3900_ports.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_full/base3900_network.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_drive/base3900_drive_5us.txt)
add_executable(thermal_driven_profile_probe EXCLUDE_FROM_ALL thermal_driven_profile_probe.cpp)
add_executable(thermal_full_h_profile EXCLUDE_FROM_ALL thermal_driven_profile_probe.cpp)
target_compile_definitions(thermal_full_h_profile PRIVATE OPENWAM_THERMAL_COST_PROFILE=1 OPENWAM_PROFILE_FULL_H=1)
add_executable(thermal_h_volume_probe EXCLUDE_FROM_ALL thermal_h_volume_probe.cpp)
add_executable(thermal_h_accuracy_probe EXCLUDE_FROM_ALL thermal_h_accuracy_probe.cpp)
add_executable(thermal_h_face_probe EXCLUDE_FROM_ALL thermal_h_face_probe.cpp)
add_executable(thermal_volume_face_contract_test thermal_volume_face_contract_test.cpp)
add_test(NAME thermal_volume_face_contract COMMAND thermal_volume_face_contract_test)
target_compile_definitions(thermal_driven_profile_probe PRIVATE OPENWAM_THERMAL_COST_PROFILE=1)
add_executable(thermal_drive_contract_test thermal_drive_contract_test.cpp)
add_executable(thermal_long_drive_contract_test thermal_long_drive_contract_test.cpp)
add_test(NAME thermal_isolated_drive_contract COMMAND thermal_long_drive_contract_test
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/base3900_ports.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_full/base3900_network.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_isolated_drive/cylinder3_2ms_5us.txt)
add_test(NAME thermal_fine_drive_contract COMMAND thermal_long_drive_contract_test
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/base3900_ports.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_full/base3900_network.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_long_drive/base3900_2ms_5us.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_long_drive/cam3900_2ms_5us.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_fine_drive/base3900_2ms_2_5us.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_fine_drive/cam3900_2ms_2_5us.txt)
add_test(NAME thermal_long_drive_contract COMMAND thermal_long_drive_contract_test
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/base3900_ports.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_full/base3900_network.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_long_drive/base3900_2ms_10us.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_long_drive/cam3900_2ms_10us.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_long_drive/base3900_2ms_5us.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_long_drive/cam3900_2ms_5us.txt)
add_executable(thermal_paired_drive_contract_test thermal_paired_drive_contract_test.cpp)
add_test(NAME thermal_paired_drive_contract COMMAND thermal_paired_drive_contract_test
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/base3900_ports.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/base3900_network.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_drive/base3900_drive_5us.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_paired_drive/cam3900_drive_5us.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_drive/cam3900_drive_5us.txt)
file(MAKE_DIRECTORY ${CMAKE_BINARY_DIR}/Testing/thermal_drive)
add_test(NAME thermal_drive_contract COMMAND thermal_drive_contract_test
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/base3900_ports.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/base3900_network.txt
    ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_drive/base3900_drive_10us.txt
    ${CMAKE_BINARY_DIR}/Testing/thermal_drive/invalid.txt)
foreach(drive_case base3100 base3900 cam3900)
    add_test(NAME thermal_drive_probe_${drive_case} COMMAND thermal_driven_intake_replay
        ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_intake_fixture.txt
        ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/${drive_case}_ports.txt
        ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/${drive_case}_network.txt
        ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_drive/${drive_case}_drive_probe.txt
        ${CMAKE_BINARY_DIR}/Testing/thermal_drive/${drive_case}_probe.csv .3 1)
endforeach()
add_executable(thermal_timestep_inspect EXCLUDE_FROM_ALL thermal_timestep_inspect.cpp)
add_executable(thermal_nozzle_context_test thermal_nozzle_context_test.cpp)
add_test(NAME thermal_nozzle_context COMMAND thermal_nozzle_context_test)
add_executable(thermal_wall_heat_source_test thermal_wall_heat_source_test.cpp)
add_test(NAME thermal_wall_heat_source COMMAND thermal_wall_heat_source_test)
add_executable(thermal_wall_friction_source_test thermal_wall_friction_source_test.cpp)
add_test(NAME thermal_wall_friction_source COMMAND thermal_wall_friction_source_test)
add_executable(thermal_closed_reaction_test thermal_closed_reaction_test.cpp)
add_test(NAME thermal_closed_reaction COMMAND thermal_closed_reaction_test)
add_executable(thermal_closed_source_coupling_test thermal_closed_source_coupling_test.cpp)
add_test(NAME thermal_closed_source_coupling COMMAND thermal_closed_source_coupling_test)
add_executable(thermal_open_inventory_test thermal_open_inventory_test.cpp)
add_test(NAME thermal_open_inventory COMMAND thermal_open_inventory_test)
add_executable(thermal_open_source_coupling_test thermal_open_source_coupling_test.cpp)
add_test(NAME thermal_open_source_coupling COMMAND thermal_open_source_coupling_test)
add_executable(thermal_external_reservoir_test thermal_external_reservoir_test.cpp)
add_test(NAME thermal_external_reservoir COMMAND thermal_external_reservoir_test)
add_executable(thermal_intake_initialization_test thermal_intake_initialization_test.cpp)
add_test(NAME thermal_intake_initialization COMMAND thermal_intake_initialization_test ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_intake_fixture.txt)
foreach(native_case base3100 base3900 cam3900)
    add_test(NAME thermal_native_intake_${native_case} COMMAND thermal_native_intake_replay
        ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_intake_fixture.txt
        ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/${native_case}_ports.txt
        ${CMAKE_CURRENT_SOURCE_DIR}/data/thermal_native_intake/${native_case}_network.txt)
endforeach()
