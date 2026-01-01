add_library(DPF STATIC TDPF.cpp)
target_include_directories(DPF PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(DPF Engine) # Might depend on Engine/BloqueMotor types? Check TDPF.h includes.
