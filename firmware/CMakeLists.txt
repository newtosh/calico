cmake_minimum_required(VERSION 3.16)

# The image header (esp_app_desc) carries the release version, not a git describe.
file(STRINGS "${CMAKE_CURRENT_LIST_DIR}/VERSION" PROJECT_VER LIMIT_COUNT 1)
# main/CMakeLists.txt already registers VERSION as a configure dependency.

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

project(ginger)
