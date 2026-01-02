# Install script for directory: C:/Users/kazuh/OpenWAM/Source

# Set the install prefix
if(NOT DEFINED CMAKE_INSTALL_PREFIX)
  set(CMAKE_INSTALL_PREFIX "C:/Program Files (x86)/OpenWAM")
endif()
string(REGEX REPLACE "/$" "" CMAKE_INSTALL_PREFIX "${CMAKE_INSTALL_PREFIX}")

# Set the install configuration name.
if(NOT DEFINED CMAKE_INSTALL_CONFIG_NAME)
  if(BUILD_TYPE)
    string(REGEX REPLACE "^[^A-Za-z0-9_]+" ""
           CMAKE_INSTALL_CONFIG_NAME "${BUILD_TYPE}")
  else()
    set(CMAKE_INSTALL_CONFIG_NAME "Release")
  endif()
  message(STATUS "Install configuration: \"${CMAKE_INSTALL_CONFIG_NAME}\"")
endif()

# Set the component getting installed.
if(NOT CMAKE_INSTALL_COMPONENT)
  if(COMPONENT)
    message(STATUS "Install component: \"${COMPONENT}\"")
    set(CMAKE_INSTALL_COMPONENT "${COMPONENT}")
  else()
    set(CMAKE_INSTALL_COMPONENT)
  endif()
endif()

# Is this installation the result of a crosscompile?
if(NOT DEFINED CMAKE_CROSSCOMPILING)
  set(CMAKE_CROSSCOMPILING "FALSE")
endif()

if(NOT CMAKE_INSTALL_LOCAL_ONLY)
  # Include the install script for each subdirectory.
  include("C:/Users/kazuh/OpenWAM/Source/1DPipes/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Act/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Boundaries/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/DPF/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Connections/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Control/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Engine/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Extern/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Labels/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Math_wam/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/ODModels/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Output/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Turbocompressor/cmake_install.cmake")
  include("C:/Users/kazuh/OpenWAM/Source/Wrappers/cmake_install.cmake")

endif()

string(REPLACE ";" "\n" CMAKE_INSTALL_MANIFEST_CONTENT
       "${CMAKE_INSTALL_MANIFEST_FILES}")
if(CMAKE_INSTALL_LOCAL_ONLY)
  file(WRITE "C:/Users/kazuh/OpenWAM/Source/install_local_manifest.txt"
     "${CMAKE_INSTALL_MANIFEST_CONTENT}")
endif()
