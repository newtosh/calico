idf_component_register(
    SRCS "main.c" "ui.c" "net.c" "desk_view.c" "desk_status.c" "wifi_store.c" "orient.c" "icons.c"
    INCLUDE_DIRS "."
    REQUIRES nvs_flash esp_wifi esp_netif esp_event esp_http_client
)
