get_filename_component(DESK_REPO_DIR "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
execute_process(
    COMMAND git -C "${DESK_REPO_DIR}" rev-parse --short=7 HEAD
    OUTPUT_VARIABLE DESK_FW_SHA
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
)
if(NOT DESK_FW_SHA)
    set(DESK_FW_SHA "unknown")
endif()

file(STRINGS "${CMAKE_CURRENT_LIST_DIR}/../VERSION" DESK_FW_VERSION LIMIT_COUNT 1)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_LIST_DIR}/../VERSION")

idf_component_register(
    SRCS "main.c" "ui.c" "net.c" "desk_view.c" "desk_status.c" "face_cover.c" "wifi_store.c" "orient.c" "icons.c" "linkdown_icon.c" "idle_cat.c" "idle_cat_anim.c" "ble_desk.c" "ble_link.c" "ble_pair.c" "control_center.c" "power.c" "power_task.c"
    INCLUDE_DIRS "."
    REQUIRES driver nvs_flash esp_wifi esp_netif esp_event esp_http_client heap bt freertos
)

target_compile_definitions(${COMPONENT_LIB} PRIVATE "DESK_FW_SHA=\"${DESK_FW_SHA}\"")
target_compile_definitions(${COMPONENT_LIB} PRIVATE "DESK_FW_VERSION=\"${DESK_FW_VERSION}\"")
