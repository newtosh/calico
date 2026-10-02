idf_component_register(
    SRCS "main.c" "ui.c" "net.c" "desk_view.c"
    INCLUDE_DIRS "."
    REQUIRES nvs_flash esp_wifi esp_netif esp_event esp_http_client
)
